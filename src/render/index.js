// Renderer: an old naturalist's plate. The static world (paper, sky, soil, rocks, curiosities) is painted once into a
// cached layer, off the main thread in a worker when the browser allows it; living things (roots, deposits, mycelium,
// flows, trees, mushrooms, feedback, effects) are drawn every frame from sprites and incremental caches.
// No frame ever paints or uploads a whole plate: a worker paints it, or the main thread paints it in slices of a few
// milliseconds into a software canvas; either way the finished plate crosses into a page canvas in bands, a couple per
// frame (plate-bands.js), and the old plate (or the blank paper) stays on show meanwhile.
// Public API: createRenderer(canvas) -> { resize(view), draw(state, view, dt) }.
import { PAL, makeCanvas } from './ink.js';
import { createWorldPainter } from './world-layer.js';
import { cutBands, closeBands } from './plate-bands.js';
import { loadSprites, onSpritesReady, spritesReady } from './sprites.js';

const optional = (path) =>
  import(path).catch((err) => {
    // a missing file is fine (the game runs without that part); a broken one must be loud
    if (!(err instanceof TypeError)) console.error(`[render] ${path}`, err);
    return null;
  });
// illustrations (assets/art): loaded in the background; startup waits for them only briefly, and never fails without them
const spritesLoaded = Promise.race([loadSprites(), new Promise((ok) => setTimeout(ok, 2500))]);
const [treesMod, mushMod, depositsMod, mycMod, flowsMod, effectsMod, feedbackMod, ambientMod, atmosMod, faunaMod, rivalMod, feedMarkMod] = await Promise.all([
  optional('./trees.js'),
  optional('./mushrooms.js'),
  optional('./deposits.js'),
  optional('./mycelium.js'),
  optional('./flows.js'),
  optional('./effects.js'),
  optional('./feedback.js'),
  optional('./ambient.js'),
  optional('./atmosphere.js'),
  optional('./fauna.js'),
  optional('./rival.js'),
  optional('./feed-mark.js'),
  spritesLoaded,
]);

const REBUILD_DELAY = 0.2; // seconds the window size must stay put before the world layer is repainted
const WORKER_TIMEOUT = 20; // seconds before a silent worker is given up for main-thread painting
const REVEAL = 0.5; // seconds a freshly painted plate takes to come up out of the blank paper
const SEASON_FADE = 20; // seconds an old season's plate takes to dissolve into the new one (test knob: globalThis.__seasonFade)
const FADE_STEP = 0.5; // seconds between re-mixed pictures of that dissolve: one blit per frame in between instead of two
const PAINT_BUDGET = 6; // ms of main-thread plate painting per frame (twice that while only blank paper is on show)
const FONT_WAIT = 0.6; // seconds a main-thread plate waits for the notebook italic, so that it is painted once, not twice
const BANDS_PER_FRAME = 2; // bands of a finished plate copied into the page's canvas per frame

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const layer = { canvas: null, world: null, key: '', vkey: '', season: '', dirty: false, born: -1, bare: false, path: '', fonts: true };
  // a plate painted before the illustrations arrived is painted again once they have
  onSpritesReady(() => {
    if (layer.bare) layer.dirty = true;
  });
  let fade = null; // season change: { from: the old plate's canvas, at, mix, mixK } while it dissolves into layer.canvas
  let changedAt = 0; // real time of the last size change
  let lastKey = '';
  const profile = {};
  let profiling = false;
  const stats = {};

  // World layer painting: a module worker when available, else (or if it fails) the main thread.
  let worker = null;
  let workerOk = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'transferToImageBitmap' in OffscreenCanvas.prototype;
  let job = null; // the request in flight: { id, key, world, at }
  let jobSeq = 0;

  // the plate lettering uses the notebook fonts. The worker loads its own copy; a main-thread plate waits briefly for the
  // page's one (see request) and is repainted only if it still had to be lettered without it
  let fontsReady = false; // the italic has loaded, or will never
  let firstDrawAt = -1;
  const fontLoaded = () => {
    try {
      return !document.fonts || document.fonts.check('italic 15px "Old Standard TT"');
    } catch {
      return true;
    }
  };
  try {
    document.fonts.load('italic 15px "Old Standard TT"').then(
      () => {
        fontsReady = true;
        if (layer.canvas && layer.path === 'main' && !layer.fonts) layer.dirty = true;
      },
      () => {
        fontsReady = true;
      },
    );
  } catch {
    fontsReady = true; // no font API: the fallback serif is fine
  }

  // Optional modules: each one is isolated so a failure in one never kills the frame loop.
  const mods = [];
  const add = (name, factory) => {
    if (!factory) return null;
    const entry = { name, api: factory(), errors: 0 };
    mods.push(entry);
    return entry;
  };
  const trees = add('trees', treesMod?.createTrees);
  const mushrooms = add('mushrooms', mushMod?.createMushrooms);
  const deposits = add('deposits', depositsMod?.createDeposits);
  const mycelium = add('mycelium', mycMod?.createMycelium);
  const flows = add('flows', flowsMod?.createFlows);
  const effects = add('effects', effectsMod?.createEffects);
  const feedback = add('feedback', feedbackMod?.createFeedback);
  const ambient = add('ambient', ambientMod?.createAmbient);
  const atmos = add('atmos', atmosMod?.createAtmosphere); // day, night, weather, snow (only with state.flags.seasons)
  const fauna = add('fauna', faunaMod?.createFauna); // nematodes, cut-off hyphae dying away, trap rings (state.fauna / state.traps)
  const rival = add('rival', rivalMod?.createRival); // honey fungus: stump, rhizomorphs, rot stains, barriers (state.rival / state.barriers)
  const refs = { trees: trees?.api, mushrooms: mushrooms?.api, mycelium: mycelium?.api };
  fauna?.api.attach?.(refs);
  const feedMark = add('feedMark', feedMarkMod?.createFeedMark); // «Подкормка»: the golden drop and «+N/с» at the fed tree's foot (state.feed)
  let modsWorld = null;
  let modsKey = '';
  let warmWorld = null;

  function call(entry, method, ...args) {
    if (!entry || entry.errors > 3) return;
    if (method !== 'reset' && method !== 'setScale' && method !== 'event' && typeof window !== 'undefined' && window.__renderOff?.[entry.name]) return;
    try {
      if (profiling && args[0] === ctx) {
        const t0 = performance.now();
        entry.api[method]?.(...args);
        ctx.getImageData(0, 0, 1, 1); // force the raster to finish so the time is real
        const k = `${entry.name}.${method}`;
        profile[k] = (profile[k] || 0) + (performance.now() - t0);
        return;
      }
      entry.api[method]?.(...args);
    } catch (err) {
      entry.errors++;
      console.error(`[render:${entry.name}.${method}]`, err);
    }
  }

  function resize(view) {
    const w = Math.round(view.cssW * view.dpr);
    const h = Math.round(view.cssH * view.dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    changedAt = performance.now() / 1000;
  }

  function viewKey(view) {
    return `${canvas.width}x${canvas.height}|${view.scale.toFixed(4)}|${view.ox.toFixed(1)}|${view.oy.toFixed(1)}`;
  }

  /** Living modules follow the requested view and world at once (their sprites re-render in the background). */
  function prepareModules(world, view, key) {
    const worldChanged = modsWorld !== world;
    if (!worldChanged && modsKey === key) return;
    modsWorld = world;
    modsKey = key;
    const s = view.scale * view.dpr;
    for (const m of mods) {
      call(m, 'setScale', s, view);
      if (worldChanged) call(m, 'reset', world, view);
    }
  }

  /** Hand a canvas back to the allocator right away instead of waiting for the garbage collector. */
  function free(c) {
    if (c) c.width = c.height = 0;
  }

  /** The plate's look at this instant while a season fade runs: the old plate under the new at progress k (into `into`, if it fits). */
  function bakeFade(k, into = null) {
    const fits = into && into.width === layer.canvas.width && into.height === layer.canvas.height;
    if (into && !fits) free(into);
    const c = fits ? into : makeCanvas(layer.canvas.width, layer.canvas.height);
    const g = c.getContext('2d', { alpha: false });
    g.drawImage(fade.from, 0, 0, c.width, c.height);
    g.globalAlpha = k * k * (3 - 2 * k);
    g.drawImage(layer.canvas, 0, 0);
    return c;
  }

  function install(c, world, key, vkey, season, bare = false, path = 'main', fonts = true) {
    const fresh = layer.world !== world;
    const prev = layer.canvas;
    const dur = globalThis.__seasonFade ?? SEASON_FADE;
    if (!fresh && prev && vkey === layer.vkey && season !== layer.season && dur > 0) {
      // only the season changed: keep showing the old plate and dissolve it into the new one
      const now = performance.now() / 1000;
      const from = fade ? bakeFade(Math.min(1, (now - fade.at) / dur)) : prev;
      if (fade) {
        free(fade.from);
        free(fade.mix);
        free(prev);
      }
      fade = { from, at: now, mix: null, mixK: -1 };
    } else {
      free(fade?.from);
      free(fade?.mix);
      free(prev);
      fade = null;
    }
    layer.canvas = c;
    layer.world = world;
    layer.key = key;
    layer.vkey = vkey;
    layer.season = season;
    layer.bare = bare;
    layer.path = path;
    layer.fonts = fonts;
    layer.dirty = false;
    if (fresh) layer.born = performance.now() / 1000;
    stats.worldPaints = (stats.worldPaints || 0) + 1;
  }

  function publish() {
    if (typeof window !== 'undefined') window.__renderStats = { ...(window.__renderStats || {}), ...stats };
  }

  function giveUpWorker(why) {
    if (worker) console.warn('[render] world-layer worker unavailable, painting on the main thread:', why);
    try {
      worker?.terminate();
    } catch {
      /* already gone */
    }
    worker = null;
    workerOk = false;
    job = null;
  }

  function startWorker() {
    if (worker || !workerOk) return worker;
    try {
      worker = new Worker(new URL('./world-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const msg = e.data || {};
        if (!job || msg.id !== job.id) {
          closeBands(msg.bands); // superseded
          return;
        }
        const done = job;
        job = null;
        if (msg.error || !msg.bands?.length) {
          closeBands(msg.bands);
          giveUpWorker(msg.error || 'no bands');
          layer.dirty = true;
          return;
        }
        receive({ ...done, bands: msg.bands, ms: msg.ms, bare: !msg.sprites, path: 'worker', fonts: true });
      };
      worker.onerror = (e) => {
        giveUpWorker(e?.message || 'error');
        layer.dirty = true;
      };
    } catch (err) {
      giveUpWorker(err?.message || err);
    }
    return worker;
  }

  /**
   * Main-thread painting, in slices: into a software canvas (the drawing is rasterised as it is recorded, so a slice's
   * time is real; a GPU canvas would only record commands and pay in whichever frame flushes it).
   */
  let painting = null; // { painter, c, world, key, vkey, season, w, h, at, spent }
  function startPaint(state, view, key, vkey, season, at) {
    const w = canvas.width;
    const h = canvas.height;
    const c = makeCanvas(w, h);
    const g = c.getContext('2d', { alpha: false, willReadFrequently: true });
    const v = { scale: view.scale, ox: view.ox, oy: view.oy, cssW: view.cssW, cssH: view.cssH, dpr: view.dpr };
    const painter = createWorldPainter(g, w, h, state.world, v, season, () => g.getImageData(0, 0, 1, 1));
    painting = { painter, c, world: state.world, key, vkey, season, w, h, at, spent: 0 };
  }

  function cancelPaint() {
    if (painting) free(painting.c);
    painting = null;
  }

  function advancePaint(budget) {
    const p = painting;
    const t0 = performance.now();
    const done = p.painter.step(budget);
    p.spent += performance.now() - t0;
    stats.worldSliceMaxMs = Math.round(p.painter.maxUnitMs * 10) / 10;
    if (!done) return;
    painting = null;
    const plate = { world: p.world, key: p.key, vkey: p.vkey, season: p.season, at: p.at, ms: p.spent, bare: !spritesReady(), path: 'main', fonts: fontLoaded() };
    cutBands(p.c, p.w, p.h).then(
      (bands) => {
        free(p.c);
        receive({ ...plate, bands });
      },
      (err) => {
        // no createImageBitmap for canvases: one copy, as before
        console.warn('[render] cannot cut the plate into bands, copying it whole:', err?.message || err);
        const c = makeCanvas(p.w, p.h);
        c.getContext('2d', { alpha: false }).drawImage(p.c, 0, 0);
        free(p.c);
        finishPlate(c, plate);
      },
    );
  }

  /** A finished plate as bands of bitmaps (from the worker or from the main-thread painter): copy them in over a few frames. */
  let upload = null; // { c, g, bands, next, plate }
  let curWorld = null;
  function receive(plate) {
    cancelUpload();
    if (plate.world !== curWorld) {
      closeBands(plate.bands); // the game moved on to another world while this was painted
      return;
    }
    const w = plate.bands[0].bitmap.width;
    const h = plate.bands.reduce((sum, b) => sum + b.bitmap.height, 0);
    const c = makeCanvas(w, h);
    upload = { c, g: c.getContext('2d', { alpha: false }), bands: plate.bands, next: 0, plate, frames: 0 };
  }

  function cancelUpload() {
    if (!upload) return;
    closeBands(upload.bands.slice(upload.next));
    free(upload.c);
    upload = null;
  }

  function advanceUpload() {
    const u = upload;
    for (let n = 0; n < BANDS_PER_FRAME && u.next < u.bands.length; n++) {
      const b = u.bands[u.next++];
      u.g.drawImage(b.bitmap, 0, b.y);
      b.bitmap.close?.();
    }
    u.frames++;
    if (u.next < u.bands.length) {
      u.g.getImageData(0, 0, 1, 1); // submit this frame's uploads now, not all at once with the first blit of the plate
      return;
    }
    upload = null;
    stats.worldUploadFrames = u.frames;
    finishPlate(u.c, u.plate);
  }

  function finishPlate(c, plate) {
    install(c, plate.world, plate.key, plate.vkey, plate.season, plate.bare, plate.path, plate.fonts);
    stats.worldBuildMs = Math.round(plate.ms);
    stats.worldSeason = plate.season;
    (stats.worldBuildBySeason ||= {})[plate.season || 'none'] = stats.worldBuildMs;
    stats.worldPath = plate.path === 'worker' ? 'worker' : 'main';
    stats.worldWaitMs = Math.round((performance.now() / 1000 - plate.at) * 1000);
    publish();
  }

  function request(state, view, key, vkey, season, now) {
    prepareModules(state.world, view, vkey);
    const wk = startWorker();
    if (wk) {
      const v = { scale: view.scale, ox: view.ox, oy: view.oy, cssW: view.cssW, cssH: view.cssH, dpr: view.dpr };
      job = { id: ++jobSeq, key, vkey, season, world: state.world, at: performance.now() / 1000 };
      try {
        wk.postMessage({ id: job.id, w: canvas.width, h: canvas.height, world: state.world, view: v, season });
        return;
      } catch (err) {
        giveUpWorker(err?.message || err); // e.g. a world that cannot be cloned
      }
    }
    // the first plate waits a moment for the page's italic: lettered without it, it would be painted a second time
    if (!layer.canvas && !fontsReady && now - firstDrawAt < FONT_WAIT) return;
    startPaint(state, view, key, vkey, season, performance.now() / 1000);
  }

  function draw(state, view, dt = 1 / 60) {
    profiling = typeof window !== 'undefined' && !!window.__renderProfile;
    if (profiling) window.__renderProfile = profile;
    const now = performance.now() / 1000;
    const vkey = viewKey(view);
    const season = state.flags?.seasons && state.clock ? state.clock.season : '';
    const key = `${vkey}|${season}`;
    const world = state.world;
    if (job && now - job.at > WORKER_TIMEOUT) giveUpWorker('timeout');
    if (firstDrawAt < 0) firstDrawAt = now;
    if (curWorld !== world) {
      // another world (a new game): nothing painted or copied for the old one is of any use
      curWorld = world;
      cancelPaint();
      cancelUpload();
    }
    if (painting && painting.key !== key) cancelPaint(); // the window or the season moved on while it was being painted

    // does the plate need (re)painting?
    const ready = !!layer.canvas && layer.world === world;
    let want = !ready || layer.dirty;
    if (!want && vkey !== layer.vkey) {
      if (vkey !== lastKey) {
        lastKey = vkey;
        changedAt = now;
      }
      want = now - changedAt > REBUILD_DELAY;
    } else if (!want && season !== layer.season) {
      want = true; // the season turned: repaint in the background, the old plate stays on show meanwhile
    }
    const coming = (j) => j && j.world === world && j.key === key; // a plate for exactly this is already on its way
    if (want && !coming(job) && !coming(painting) && !coming(upload?.plate)) request(state, view, key, vkey, season, now);
    const plateOnShow = !!layer.canvas && layer.world === world;
    if (painting) advancePaint(plateOnShow ? PAINT_BUDGET : PAINT_BUDGET * 2);
    if (upload) advanceUpload();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const s = view.scale * view.dpr;

    if (!layer.canvas || layer.world !== world) {
      // blank paper while the plate is being painted; the living parts get their sprites ready meanwhile
      ctx.fillStyle = PAL.paper;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (warmWorld !== world) {
        warmWorld = world;
        warmStep = 0;
      }
      if (warmStep < WARM_STEPS.length && !painting) warmUp(warmStep++, state, view, s, now, dt);
      return;
    }

    const tl = performance.now();
    const stretch = layer.vkey !== vkey; // stretched until the new size settles
    const blit = (c) => (stretch ? ctx.drawImage(c, 0, 0, canvas.width, canvas.height) : ctx.drawImage(c, 0, 0));
    const fadeDur = globalThis.__seasonFade ?? SEASON_FADE;
    const fk = fade ? (now - fade.at) / fadeDur : 1;
    if (fade && fk < 1) {
      // two full-screen blits per frame for the whole dissolve would be the page's biggest steady cost: the mix is
      // baked every FADE_STEP seconds (a 1-3 % step of alpha, not visible) and each frame blits that one picture
      if ((fk - Math.max(0, fade.mixK)) * fadeDur >= FADE_STEP) {
        fade.mix = bakeFade(fk, fade.mix);
        fade.mixK = fk;
      }
      blit(fade.mixK < 0 ? fade.from : fade.mix);
    } else {
      if (fade) {
        free(fade.from);
        free(fade.mix);
        fade = null;
      }
      blit(layer.canvas);
    }
    if (profiling) {
      ctx.getImageData(0, 0, 1, 1);
      profile.worldLayer = (profile.worldLayer || 0) + performance.now() - tl;
    }

    ctx.setTransform(s, 0, 0, s, view.ox * view.dpr, view.oy * view.dpr);
    for (const ev of state.events || []) for (const m of mods) call(m, 'event', ev, state);

    const t = now;
    const frame = { t, dt, view, refs, atmos: atmos?.api };
    call(atmos, 'drawSky', ctx, state, t, dt);
    call(ambient, 'drawSky', ctx, state, t, dt);
    call(trees, 'drawRoots', ctx, state, t, dt); // roots pass behind the water and mineral pockets
    call(deposits, 'draw', ctx, state, t, dt, frame);
    call(atmos, 'drawSoil', ctx, state, t, dt);
    call(mycelium, 'draw', ctx, state, t, dt, frame);
    call(flows, 'draw', ctx, state, t, dt, frame);
    call(rival, 'drawSoil', ctx, state, t, dt, frame); // the rhizomorph web creeps through the soil, under the worms
    call(fauna, 'draw', ctx, state, t, dt, frame); // worms live in the soil, over the mycelium and its flows
    call(trees, 'drawTrees', ctx, state, t, dt);
    call(rival, 'drawSurface', ctx, state, t, dt); // the old stump and honey-mushroom tufts stand over the tree trunks
    call(ambient, 'draw', ctx, state, t, dt, frame);
    call(mushrooms, 'draw', ctx, state, t, dt);
    call(feedMark, 'draw', ctx, state, t, dt, frame); // on the grass beside the fed tree's foot, clear of the rot ring and its infection mark
    call(fauna, 'drawTop', ctx, state, t, dt); // ghosts of mushrooms that wilted when their node was cut off
    call(atmos, 'drawOver', ctx, state, t, dt);
    call(feedback, 'draw', ctx, state, t, dt, frame);
    call(effects, 'draw', ctx, state, t, dt, frame);
    call(rival, 'drawFx', ctx, state, t, dt); // barrier tool cursor and the rival's event effects
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // a new plate comes up out of the paper
    const k = layer.born >= 0 ? (now - layer.born) / REVEAL : 1;
    if (k < 1) {
      ctx.globalAlpha = 1 - k * k * (3 - 2 * k);
      ctx.fillStyle = PAL.paper;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Invisible passes into a scratch canvas, one group per frame while the plate is being painted: trees, deposits,
   * clouds and caches paint their sprites now instead of all at once on the frame the plate appears.
   */
  let scratch = null;
  let warmStep = 0;
  const WARM_STEPS = [
    ['ambient.drawSky', 'deposits.draw', 'mycelium.draw', 'mushrooms.draw'],
    ['trees.drawRoots'],
    ['trees.drawTrees'],
  ];
  const byName = { ambient, deposits, mycelium, mushrooms, trees };
  function warmUp(step, state, view, s, now, dt) {
    const t0 = performance.now();
    scratch = scratch || makeCanvas(4, 4).getContext('2d');
    scratch.setTransform(s, 0, 0, s, view.ox * view.dpr, view.oy * view.dpr);
    const frame = { t: now, dt, view, refs };
    for (const name of WARM_STEPS[step]) {
      const [mod, method] = name.split('.');
      call(byName[mod], method, scratch, state, now, dt, frame);
    }
    stats.warmUpMs = (step ? stats.warmUpMs || 0 : 0) + Math.round(performance.now() - t0);
    publish();
  }

  return { resize, draw };
}

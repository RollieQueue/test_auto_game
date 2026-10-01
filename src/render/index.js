// Renderer: an old naturalist's plate. The static world (paper, sky, soil, rocks, curiosities) is painted once into a
// cached layer, off the main thread in a worker when the browser allows it; living things (roots, deposits, mycelium,
// flows, trees, mushrooms, feedback, effects) are drawn every frame from sprites and incremental caches.
// Public API: createRenderer(canvas) -> { resize(view), draw(state, view, dt) }.
import { PAL, makeCanvas } from './ink.js';
import { paintWorldLayer } from './world-layer.js';

const optional = (path) =>
  import(path).catch((err) => {
    // a missing file is fine (the game runs without that part); a broken one must be loud
    if (!(err instanceof TypeError)) console.error(`[render] ${path}`, err);
    return null;
  });
const [treesMod, mushMod, depositsMod, mycMod, flowsMod, effectsMod, feedbackMod, ambientMod, atmosMod] = await Promise.all([
  optional('./trees.js'),
  optional('./mushrooms.js'),
  optional('./deposits.js'),
  optional('./mycelium.js'),
  optional('./flows.js'),
  optional('./effects.js'),
  optional('./feedback.js'),
  optional('./ambient.js'),
  optional('./atmosphere.js'),
]);

const REBUILD_DELAY = 0.2; // seconds the window size must stay put before the world layer is repainted
const WORKER_TIMEOUT = 20; // seconds before a silent worker is given up for main-thread painting
const REVEAL = 0.5; // seconds a freshly painted plate takes to come up out of the blank paper
const SEASON_FADE = 20; // seconds an old season's plate takes to dissolve into the new one (test knob: globalThis.__seasonFade)

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const layer = { canvas: null, world: null, key: '', vkey: '', season: '', dirty: false, born: -1 };
  let fade = null; // season change: { from: the old plate's canvas, at } while it dissolves into layer.canvas
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

  // the plate lettering uses the notebook fonts; a main-thread layer is repainted once they have loaded
  try {
    document.fonts?.load('italic 15px "Old Standard TT"').then(() => {
      if (!worker) layer.dirty = true;
    });
  } catch {
    /* no font API: the fallback serif is fine */
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
  const refs = { trees: trees?.api, mushrooms: mushrooms?.api };
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

  /** The plate's look at this instant while a season fade runs: the old plate under the new at progress k. */
  function bakeFade(k) {
    const c = makeCanvas(layer.canvas.width, layer.canvas.height);
    const g = c.getContext('2d', { alpha: false });
    g.drawImage(fade.from, 0, 0, c.width, c.height);
    g.globalAlpha = k * k * (3 - 2 * k);
    g.drawImage(layer.canvas, 0, 0);
    return c;
  }

  function install(c, world, key, vkey, season) {
    const fresh = layer.world !== world;
    const prev = layer.canvas;
    const dur = globalThis.__seasonFade ?? SEASON_FADE;
    if (!fresh && prev && vkey === layer.vkey && season !== layer.season && dur > 0) {
      // only the season changed: keep showing the old plate and dissolve it into the new one
      const now = performance.now() / 1000;
      const from = fade ? bakeFade(Math.min(1, (now - fade.at) / dur)) : prev;
      if (fade) {
        free(fade.from);
        free(prev);
      }
      fade = { from, at: now };
    } else {
      free(fade?.from);
      free(prev);
      fade = null;
    }
    layer.canvas = c;
    layer.world = world;
    layer.key = key;
    layer.vkey = vkey;
    layer.season = season;
    layer.dirty = false;
    if (fresh) layer.born = performance.now() / 1000;
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
        if (!job || msg.id !== job.id) return; // superseded
        const done = job;
        job = null;
        if (msg.error || !msg.bitmap) {
          giveUpWorker(msg.error || 'no bitmap');
          layer.dirty = true;
          return;
        }
        // copy into a regular canvas once, so the per-frame blit reads a texture that already lives on the GPU
        const c = makeCanvas(msg.bitmap.width, msg.bitmap.height);
        c.getContext('2d', { alpha: false }).drawImage(msg.bitmap, 0, 0);
        msg.bitmap.close?.();
        install(c, done.world, done.key, done.vkey, done.season);
        stats.worldBuildMs = Math.round(msg.ms);
        stats.worldSeason = done.season;
        (stats.worldBuildBySeason ||= {})[done.season || 'none'] = stats.worldBuildMs;
        stats.worldPath = 'worker';
        stats.worldWaitMs = Math.round((performance.now() / 1000 - done.at) * 1000);
        publish();
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

  function paintSync(state, view, key, vkey, season) {
    const t0 = performance.now();
    const c = makeCanvas(canvas.width, canvas.height);
    paintWorldLayer(c.getContext('2d', { alpha: false }), canvas.width, canvas.height, state.world, view, season);
    install(c, state.world, key, vkey, season);
    stats.worldBuildMs = Math.round(performance.now() - t0);
    stats.worldSeason = season;
    (stats.worldBuildBySeason ||= {})[season || 'none'] = stats.worldBuildMs;
    stats.worldPath = 'main';
    publish();
  }

  function request(state, view, key, vkey, season) {
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
    paintSync(state, view, key, vkey, season);
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
    if (want && !(job && job.world === world && job.key === key)) request(state, view, key, vkey, season);

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
      if (warmStep < WARM_STEPS.length) warmUp(warmStep++, state, view, s, now, dt);
      return;
    }

    const tl = performance.now();
    const stretch = layer.vkey !== vkey; // stretched until the new size settles
    const blit = (c) => (stretch ? ctx.drawImage(c, 0, 0, canvas.width, canvas.height) : ctx.drawImage(c, 0, 0));
    const fk = fade ? (now - fade.at) / (globalThis.__seasonFade ?? SEASON_FADE) : 1;
    if (fade && fk < 1) {
      blit(fade.from);
      ctx.globalAlpha = fk * fk * (3 - 2 * fk);
      blit(layer.canvas);
      ctx.globalAlpha = 1;
    } else {
      if (fade) {
        free(fade.from);
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
    call(trees, 'drawTrees', ctx, state, t, dt);
    call(ambient, 'draw', ctx, state, t, dt, frame);
    call(mushrooms, 'draw', ctx, state, t, dt);
    call(atmos, 'drawOver', ctx, state, t, dt);
    call(feedback, 'draw', ctx, state, t, dt, frame);
    call(effects, 'draw', ctx, state, t, dt, frame);
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

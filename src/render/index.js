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
const [treesMod, mushMod, depositsMod, mycMod, flowsMod, effectsMod, feedbackMod, ambientMod] = await Promise.all([
  optional('./trees.js'),
  optional('./mushrooms.js'),
  optional('./deposits.js'),
  optional('./mycelium.js'),
  optional('./flows.js'),
  optional('./effects.js'),
  optional('./feedback.js'),
  optional('./ambient.js'),
]);

const REBUILD_DELAY = 0.2; // seconds the window size must stay put before the world layer is repainted
const WORKER_TIMEOUT = 20; // seconds before a silent worker is given up for main-thread painting
const REVEAL = 0.5; // seconds a freshly painted plate takes to come up out of the blank paper

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const layer = { canvas: null, world: null, key: '', dirty: false, born: -1 };
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

  function install(c, world, key) {
    const fresh = layer.world !== world;
    layer.canvas = c;
    layer.world = world;
    layer.key = key;
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
        install(c, done.world, done.key);
        stats.worldBuildMs = Math.round(msg.ms);
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

  function paintSync(state, view, key) {
    const t0 = performance.now();
    const c = makeCanvas(canvas.width, canvas.height);
    paintWorldLayer(c.getContext('2d', { alpha: false }), canvas.width, canvas.height, state.world, view);
    install(c, state.world, key);
    stats.worldBuildMs = Math.round(performance.now() - t0);
    stats.worldPath = 'main';
    publish();
  }

  function request(state, view, key) {
    prepareModules(state.world, view, key);
    const wk = startWorker();
    if (wk) {
      const v = { scale: view.scale, ox: view.ox, oy: view.oy, cssW: view.cssW, cssH: view.cssH, dpr: view.dpr };
      job = { id: ++jobSeq, key, world: state.world, at: performance.now() / 1000 };
      try {
        wk.postMessage({ id: job.id, w: canvas.width, h: canvas.height, world: state.world, view: v });
        return;
      } catch (err) {
        giveUpWorker(err?.message || err); // e.g. a world that cannot be cloned
      }
    }
    paintSync(state, view, key);
  }

  function draw(state, view, dt = 1 / 60) {
    profiling = typeof window !== 'undefined' && !!window.__renderProfile;
    if (profiling) window.__renderProfile = profile;
    const now = performance.now() / 1000;
    const key = viewKey(view);
    const world = state.world;
    if (job && now - job.at > WORKER_TIMEOUT) giveUpWorker('timeout');

    // does the plate need (re)painting?
    const ready = !!layer.canvas && layer.world === world;
    let want = !ready || layer.dirty;
    if (!want && key !== layer.key) {
      if (key !== lastKey) {
        lastKey = key;
        changedAt = now;
      }
      want = now - changedAt > REBUILD_DELAY;
    }
    if (want && !(job && job.world === world && job.key === key)) request(state, view, key);

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
    if (layer.key === key) ctx.drawImage(layer.canvas, 0, 0);
    else ctx.drawImage(layer.canvas, 0, 0, canvas.width, canvas.height); // stretched until the new size settles
    if (profiling) {
      ctx.getImageData(0, 0, 1, 1);
      profile.worldLayer = (profile.worldLayer || 0) + performance.now() - tl;
    }

    ctx.setTransform(s, 0, 0, s, view.ox * view.dpr, view.oy * view.dpr);
    for (const ev of state.events || []) for (const m of mods) call(m, 'event', ev, state);

    const t = now;
    const frame = { t, dt, view, refs };
    call(ambient, 'drawSky', ctx, state, t, dt);
    call(trees, 'drawRoots', ctx, state, t, dt); // roots pass behind the water and mineral pockets
    call(deposits, 'draw', ctx, state, t, dt, frame);
    call(mycelium, 'draw', ctx, state, t, dt, frame);
    call(flows, 'draw', ctx, state, t, dt, frame);
    call(trees, 'drawTrees', ctx, state, t, dt);
    call(ambient, 'draw', ctx, state, t, dt, frame);
    call(mushrooms, 'draw', ctx, state, t, dt);
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

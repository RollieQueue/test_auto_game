// Gallery for the honey-fungus rival (src/render/rival.js, NOT part of the game): the real renderer on a fake state.
// Open /src/render/gallery-rival.html
//   (default)  the whole scene: stump, ~300-segment rhizomorph web with growing tips and withering edges, grips, trees at
//              infection 0 (mantle) / 0.3 / 0.7 / lost, honey clusters, a fresh and a fading barrier, the barrier cursor
//   ?pick=denied     the barrier cursor in its «denied» look (default ok);  ?tool=grow hides the cursor
//   ?freeze=1        state.time and the barriers stand still (stable screenshots);  ?t=100 sets state.time
//   ?events=1        fires rival-wake, rival-cut, tree-lost, tree-freed, barrier-placed and rival-fruit after 2.5 s (&at=ms)
//   ?mode=bench      frame cost of rival.js at ?n=300 segments (window.__bench, also shown on the page)
//   ?mode=zoom       the scene at 2.2x around the stump and the web (&zx=, &zy= centre in world units)
//   ?seed=7 &dpr=1 &edges=300 &stumpart=1 (use decor.stump.1 / mushroom.honey.N from the manifest when it has them)
import { createState } from '../state.js';
import { createRenderer } from './index.js';
import { applyFixture, applyRivalFixture } from './fixture.js';
import { createRival } from './rival.js';
import { loadSprites } from './sprites.js';
import { WORLD_W, WORLD_H } from '../config.js';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed')) || 7;
const mode = q.get('mode') || 'scene';
const dpr = Number(q.get('dpr')) || 1;
const edgesN = Number(q.get('n') || q.get('edges')) || 300;
const frozen = q.get('freeze') === '1';

const canvas = document.getElementById('c');

function makeState(pick) {
  const state = createState(seed);
  applyFixture(state, { nodes: Number(q.get('player')) || 380 });
  state.phase = 'playing';
  applyRivalFixture(state, { edges: edgesN, pick: pick || q.get('pick') || 'ok', time: q.get('t') ? Number(q.get('t')) : 100 });
  if (q.get('tool')) state.ui.tool = q.get('tool');
  if (q.get('nolink') === '1') for (const t of state.world.trees) t.linked = false;
  return state;
}

/* ------------------------------------------------------------------ bench */

async function bench() {
  const state = makeState();
  const W = Math.round(WORLD_W * dpr);
  const H = Math.round(WORLD_H * dpr);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4a3a33';
  ctx.fillRect(0, 0, W, H);
  const rival = createRival();
  rival.reset(state.world);
  rival.setScale(dpr);
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  const summary = (label, js, total) => {
    js.sort((x, y) => x - y);
    total.sort((x, y) => x - y);
    const f = (v) => +v.toFixed(3);
    return { label, frames: js.length, jsMedianMs: f(pct(js, 0.5)), jsP95Ms: f(pct(js, 0.95)), jsMaxMs: f(js[js.length - 1]), flushedMedianMs: f(pct(total, 0.5)), flushedP95Ms: f(pct(total, 0.95)) };
  };
  // js = the time the draw calls take on the main thread; flushed = the same plus the raster finishing (readback)
  const run = (label, frames, step, body) => {
    const js = [];
    const total = [];
    for (let i = 0; i < frames + 6; i++) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      step(i);
      const t0 = performance.now();
      body(i);
      const t1 = performance.now();
      ctx.getImageData(0, 0, 1, 1);
      const t2 = performance.now();
      if (i >= 6) {
        js.push(t1 - t0);
        total.push(t2 - t0);
      }
    }
    return summary(label, js, total);
  };
  const frame = (i) => {
    rival.drawSoil(ctx, state, i / 60, 1 / 60);
    rival.drawSurface(ctx, state, i / 60, 1 / 60);
    rival.drawFx(ctx, state, i / 60, 1 / 60);
  };
  const out = { n: state.rival.edges.length, dpr, results: [] };
  // baseline of this machine: blitting one full-size canvas, which any cached layer costs (the mycelium does it twice)
  const c2 = document.createElement('canvas');
  c2.width = W;
  c2.height = H;
  c2.getContext('2d').fillRect(10, 10, 50, 50);
  out.results.push(run('baseline: one full-canvas blit', 200, () => {}, () => ctx.drawImage(c2, 0, 0)));
  // 1. a steady frame: the cache exists, drawn live are the tips, a few young edges, withering ones, barriers, stump, tufts
  out.results.push(run('steady (tips, young + withering edges, barriers)', 300, (i) => (state.time = 100 + i / 60), frame));
  // 2. everything mature and nothing live but the tips
  for (const e of state.rival.edges) e.born = 0;
  state.rival.ver++;
  out.results.push(run('steady, all mature', 300, (i) => (state.time = 100 + i / 60), frame));
  // 3. the worst case: the sim bumps ver every frame, so the cache is repainted every frame
  out.results.push(run('ver bumped every frame', 150, (i) => (state.rival.ver++, (state.time = 100 + i / 60)), frame));
  // 4. the camera changes every frame (a window resize): the cache is cleared and every edge is painted again
  out.results.push(run('camera moves every frame (full repaint)', 150, (i) => ctx.setTransform(dpr, 0, 0, dpr, (i % 2) * 0.5, 0), frame));
  out.stats = { ...rival.stats };
  window.__bench = out;
  document.title = 'bench done';
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:8px;background:#fffbe8;color:#222;font:12px monospace;z-index:2';
  pre.textContent = JSON.stringify(out, null, 1);
  document.body.append(pre);
}

/* ------------------------------------------------------------------ scene */

async function scene() {
  if (q.get('stumpart') !== '0') await loadSprites();
  const state = makeState();
  const renderer = createRenderer(canvas);
  const zoom = mode === 'zoom' ? Number(q.get('z')) || 2.2 : 1;
  const view = { scale: 1, ox: 0, oy: 0, cssW: 1, cssH: 1, dpr };
  function resize() {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const fit = Math.min(cssW / WORLD_W, cssH / WORLD_H);
    const scale = fit * zoom;
    let ox = (cssW - WORLD_W * scale) / 2;
    let oy = (cssH - WORLD_H * scale) / 2;
    if (zoom !== 1) {
      const zx = Number(q.get('zx')) || state.world.stumps[0].x + 280;
      const zy = Number(q.get('zy')) || state.world.stumps[0].y + 40;
      ox = cssW / 2 - zx * scale;
      oy = cssH / 2 - zy * scale;
    }
    Object.assign(view, { scale, ox, oy, cssW, cssH, dpr });
    renderer.resize(view);
  }
  window.addEventListener('resize', resize);
  resize();
  window.__game = { state, view, renderer };
  let last = performance.now();
  const started = last;
  let fired = false;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!frozen) {
      state.time += dt;
      for (const b of state.barriers) b.t += dt;
    }
    if (q.get('events') === '1' && !fired && now - started > (Number(q.get("at")) || 2500)) {
      fired = true;
      fire(state);
    }
    renderer.draw(state, view, dt);
    state.events.length = 0;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function fire(state) {
  const r = state.rival;
  const trees = state.world.trees.slice().sort((a, b) => a.x - b.x);
  const s = state.world.stumps[0];
  const web = r.nodes[Math.floor(r.nodes.length * 0.4)];
  state.events.push(
    { type: 'rival-wake', x: s.x, y: s.y, stumpId: s.id },
    { type: 'rival-cut', x: web.x, y: web.y, edges: 4 },
    { type: 'tree-lost', treeId: trees[3].id, x: trees[3].x, y: trees[3].baseY },
    { type: 'tree-freed', treeId: trees[1].id, x: trees[1].x, y: trees[1].baseY },
    { type: 'barrier-placed', id: 1, x: state.barriers[0].x, y: state.barriers[0].y },
    { type: 'rival-fruit', treeId: trees[2].id, x: trees[2].x, y: trees[2].baseY, n: 5 },
  );
}

if (mode === 'bench') bench();
else scene();

// Gallery for the honey-fungus rival (src/render/rival.js, NOT part of the game): the real renderer on a fake state.
// Open /src/render/gallery-rival.html
//   (default)  the whole scene: stump, ~300-segment rhizomorph web with growing tips and withering edges, grips, trees at
//              infection 0 (mantle) / 0.3 / 0.7 / lost, honey clusters, a fresh and a fading barrier, the barrier cursor
//   ?pick=denied     the barrier cursor in its «denied» look (default ok);  ?tool=grow hides the cursor
//   ?freeze=1        state.time and the barriers stand still (stable screenshots);  ?t=100 sets state.time
//   ?events=1        fires rival-wake, rival-cut, tree-lost, tree-freed, barrier-placed and rival-fruit after 2.5 s (&at=ms)
//   ?mode=bench      frame cost of rival.js at ?n=300 segments (window.__bench, also shown on the page)
//   ?mode=zoom       the scene at 2.2x around the stump and the web (&zx=, &zy= centre in world units)
//   ?mode=cords      the cords alone on a soil board at 100 % (left) and 50 % (right): right-angle turns smoothed, a fork, tips, a heading path
//   ?inf=0,0.4,0.8,1 the four trees' infection left to right (default 0, 0.3, 0.7, lost = 1); grips and rot rings follow
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
  if (q.get('inf')) applyInfection(state, q.get('inf').split(',').map(Number));
  addHeadingTip(state);
  return state;
}

/** ?inf=a,b,c,d: the trees left to right get these infections (1 = lost); every infected tree gets a grip, a cluster when it is rotten. */
function applyInfection(state, list) {
  const trees = state.world.trees.slice().sort((a, b) => a.x - b.x);
  const r = state.rival;
  trees.slice(0, 4).forEach((t, i) => {
    const v = Number.isFinite(list[i]) ? list[i] : 0;
    Object.assign(t, { infection: v, lost: v >= 1, mantle: v >= 1 ? 0 : t.mantle });
    r.grip = r.grip.filter((g) => g.treeId !== t.id);
    r.clusters = r.clusters.filter((c) => c.treeId !== t.id);
    if (v > 0 && v < 1) {
      const tp = t.tips[Math.min(1, t.tips.length - 1)];
      let best = 0;
      let bd = Infinity;
      for (const n of r.nodes) {
        const d = Math.hypot(n.x - tp.x, n.y - tp.y);
        if (d < bd) {
          bd = d;
          best = n.id;
        }
      }
      r.grip.push({ treeId: t.id, node: best, x: tp.x, y: tp.y, since: state.time - 40, tip: 0 });
    }
    if (v >= 0.4) r.clusters.push({ id: 20 + i, treeId: t.id, x: t.x + (i % 2 ? 16 : -16), y: t.baseY, n: 5 + (i % 3), age: 30 });
  });
}

/** One more tip, 100 u from a root point of the first tree (not held, not linked), so the dashed heading path shows. */
function addHeadingTip(state) {
  const r = state.rival;
  const tree = state.world.trees.slice().sort((a, b) => a.x - b.x)[0];
  const tp = tree.tips[Math.min(2, tree.tips.length - 1)];
  const near = (n) => Math.hypot(n.x - tp.x, n.y - tp.y);
  const from = r.nodes.reduce((b, n) => (near(n) < near(b) ? n : b), r.nodes[0]);
  const ang = Math.atan2(from.y - tp.y, from.x - tp.x);
  const tx = tp.x + Math.cos(ang) * 100;
  const ty = tp.y + Math.sin(ang) * 100;
  let prev = from.id;
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const id = r.nodes.length;
    r.nodes.push({ id, x: from.x + (tx - from.x) * k, y: from.y + (ty - from.y) * k, alive: true, born: state.time - 300 });
    r.edges.push({ id: r.edges.length, a: prev, b: id, w: 1.2, alive: true, born: state.time - 300, wither: 0 });
    prev = id;
  }
  r.tips.push({ id: 77, node: prev, x: tx + Math.cos(ang + Math.PI) * 5, y: ty + Math.sin(ang + Math.PI) * 5, dir: ang + Math.PI, target: { kind: 'tree', id: tree.id }, speed: 6 });
  r.ver++;
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

/* ------------------------------------------------------------------ cords: the rhizomorph at 100 % and 50 % */

/** A synthetic web on a soil-coloured board, painted twice by the real rival.js: at scale 1 (left) and 0.5 (right), next to a
 *  brown root and a glowing white-gold thread, with right-angle turns, a fork and tips (one near its target, one far). */
function cords() {
  const state = makeState();
  const W = Math.round(1600 * dpr);
  const H = Math.round(900 * dpr);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const nodes = [];
  const edges = [];
  const add = (x, y) => (nodes.push({ id: nodes.length, x, y, alive: true, born: -50 }), nodes.length - 1);
  const chain = (pts, from = null) => {
    let prev = from;
    for (const [x, y] of pts) {
      const id = add(x, y);
      if (prev !== null) edges.push({ id: edges.length, a: prev, b: id, w: 1.2, alive: true, born: -50, wither: 0 });
      prev = id;
    }
    return prev;
  };
  // 1. box-like right-angle turns, the way the sim's steering used to leave them
  const boxEnd = chain([[20, 40], [80, 40], [140, 40], [140, 90], [140, 140], [80, 140], [80, 190], [150, 190], [220, 190], [220, 130], [220, 70], [290, 70], [340, 70]]);
  // 2. a fork: a side branch leaves the third node of the second chain
  const secondStart = nodes.length;
  const fork = chain([[60, 250], [110, 270], [160, 262], [215, 285], [270, 270]]);
  chain([[210, 320], [225, 360], [270, 380], [320, 372]], secondStart + 2);
  // 3. a long winding cord towards a tree: its tip is about 90 u from the root point
  const long = chain([[20, 430], [60, 440], [110, 420], [160, 430], [215, 455], [265, 440], [300, 450], [340, 470]]);
  const far = chain([[400, 40], [440, 70], [470, 110], [500, 130], [515, 160]]);
  const tree = { id: 7, species: 'birch', stage: 3, x: 560, baseY: 380, health: 1, infection: 0, lost: false, tips: [{ x: 410, y: 480, minStage: 0 }, { x: 600, y: 560, minStage: 0 }] };
  const tips = [
    { id: 11, node: long, x: nodes[long].x + 8, y: nodes[long].y + 4, dir: 0.4, target: { kind: 'tree', id: 7 }, speed: 6 },
    { id: 12, node: far, x: nodes[far].x + 6, y: nodes[far].y + 6, dir: 1.1, target: { kind: 'tree', id: 7 }, speed: 6 },
    { id: 13, node: boxEnd, x: nodes[boxEnd].x + 8, y: nodes[boxEnd].y, dir: 0, target: null, speed: 6 },
    { id: 14, node: fork, x: nodes[fork].x + 6, y: nodes[fork].y - 2, dir: 0, target: null, speed: 0 },
  ];
  state.world = { ...state.world, trees: [tree], stumps: [] };
  state.rival = { awake: true, nodes, edges, tips, grip: [], clusters: [], spores: 0, ver: 1, rs: 1 };
  state.barriers = [];
  state.ui.tool = 'grow';
  state.time = 100;
  const panel = (x0, scale) => {
    const ra = createRival();
    ra.reset(state.world);
    ra.setScale(dpr * scale);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 * dpr, 0, 800 * dpr, H);
    ctx.clip();
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (x0 + 20) * dpr, 40 * dpr);
    // soil board
    const g = ctx.createLinearGradient(0, 0, 0, 560);
    g.addColorStop(0, '#2a1b13');
    g.addColorStop(1, '#3a281c');
    ctx.fillStyle = g;
    ctx.fillRect(-20 / scale, -40 / scale, 800 / scale, 900 / scale);
    // a brown tree root (what the cord must not be mistaken for) and a glowing player thread
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#7b5a37';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(360, 230);
    ctx.bezierCurveTo(420, 260, 450, 330, 520, 340);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(430, 300);
    ctx.bezierCurveTo(470, 380, 410, 430, 410, 480);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,236,170,0.35)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(380, 120);
    ctx.bezierCurveTo(440, 180, 520, 160, 600, 250);
    ctx.stroke();
    ctx.strokeStyle = '#fff3cc';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ra.drawSoil(ctx, state, 5, 1 / 60);
    ra.drawSurface(ctx, state, 5, 1 / 60);
    ra.drawFx(ctx, state, 5, 1 / 60);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#f2e8cf';
    ctx.font = '15px Georgia, serif';
    ctx.fillText(scale === 1 ? '100 %' : '50 %', x0 + 20, 24);
    ctx.restore();
  };
  panel(0, 1);
  panel(800, 0.5);
  window.__game = { state };
  document.title = 'cords done';
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
else if (mode === 'cords') cords();
else scene();

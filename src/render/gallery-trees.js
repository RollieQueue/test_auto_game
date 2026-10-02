// Gallery for src/render/trees.js (NOT part of the game). Open /src/render/gallery-trees.html
//   ?mode=sheet   3 species x stage 0..3 on paper
//   ?mode=health  3 species x health .2/.6/1 (stage 3)
//   ?mode=world   the real world's trees on sky + soil, with roots (?stages=1,2,3 &linked=1)
//   ?mode=anim    a stage increase as a film strip with roots (?sp=oak&from=1)
//   ?mode=live    real-time loop with sway, stage changes and a frame-cost readout
//   ?mode=seasons 3 species x 4 seasons at one stage (?stage=3)
// Seasons: &season=spring|summer|autumn|winter paints every mode in that season (no param = no seasons, as before);
//   &buttons=1 adds a small season bar. &fade=0.01 sets the crown cross-fade (window.__seasonFade) for screenshots.
// Common: ?zoom=2 &ox=300 &oy=100 (world offset of the view), &t=3 (animation time for sway), &dpr=1, &seed=7
import { generateWorld } from '../world/generate.js';
import { createTrees } from './trees.js';
import { PAL, mix } from './ink.js';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed')) || 7;
const mode = q.get('mode') || 'sheet';
const zoom = Number(q.get('zoom')) || 1;
const ox = Number(q.get('ox')) || 0;
const oy = Number(q.get('oy')) || 0;
const dpr = Number(q.get('dpr')) || window.devicePixelRatio || 1;
const season = ['spring', 'summer', 'autumn', 'winter'].includes(q.get('season')) ? q.get('season') : '';
if (q.get('fade')) globalThis.__seasonFade = Number(q.get('fade'));
const tFixed = q.get('t') === null ? 3 : Number(q.get('t'));

const canvas = document.getElementById('c');
canvas.width = Math.round(1920 * dpr);
canvas.height = Math.round(1080 * dpr);
const ctx = canvas.getContext('2d');
const S = zoom * dpr;

const world = generateWorld(seed);
const SPECIES = ['birch', 'oak', 'pine'];
const baseTrees = SPECIES.map((s) => world.trees.find((t) => t.species === s));

const trees = createTrees();
trees.setScale(S);

function setView() {
  ctx.setTransform(S, 0, 0, S, -ox * S, -oy * S);
}

function paper(x0, y0, w, h) {
  ctx.fillStyle = PAL.paper;
  ctx.fillRect(x0, y0, w, h);
}

function soil(x0, y0, w, h, groundY) {
  const g = ctx.createLinearGradient(0, groundY, 0, groundY + h);
  g.addColorStop(0, '#5a4330');
  g.addColorStop(0.25, '#3f2c20');
  g.addColorStop(0.55, '#4a3a33');
  g.addColorStop(1, '#26304a');
  ctx.fillStyle = g;
  ctx.fillRect(x0, groundY, w, h - (groundY - y0));
}

function label(txt, x, y) {
  ctx.fillStyle = PAL.sepia;
  ctx.font = '15px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(txt, x, y);
}

function copyTree(t, id, over) {
  return { ...t, id, ...over };
}

function fakeState(list, s = season) {
  return { world: { trees: list }, events: [], ...(s ? { flags: { seasons: true }, clock: { season: s } } : {}) };
}

// Sprites are painted in the background and fade in: for a still frame, run the frames and the painting off-screen first.
const scratch = document.createElement('canvas').getContext('2d');
function warm(inst, st) {
  for (let i = 0; i < 10; i++) {
    inst.drawRoots(scratch, st, tFixed, 0.1);
    inst.drawTrees(scratch, st, tFixed, 0.1);
    inst.settle();
  }
}

let sheetWorld = null;
function frame(list, t, dt = 1 / 60) {
  const st = fakeState(list);
  if (!sheetWorld || sheetWorld.trees !== list) sheetWorld = st.world;
  if (mode !== 'live') warm(trees, st);
  trees.drawRoots(ctx, st, t, dt);
  trees.drawTrees(ctx, st, t, dt);
}

/* ------------------------------------------------------------------ modes */

function drawSheet() {
  paper(0, 0, 1920, 1080);
  const list = [];
  SPECIES.forEach((sp, r) => {
    for (let s = 0; s < 4; s++) {
      const gx = 240 + s * 480;
      const gy = 300 + r * 350;
      list.push(copyTree(baseTrees[r], 10 + r * 4 + s, { stage: s, x: gx, baseY: gy, health: 0.8, roots: [], tips: [] }));
      ctx.strokeStyle = 'rgba(58,42,30,.35)';
      ctx.beginPath();
      ctx.moveTo(gx - 200, gy + 3);
      ctx.lineTo(gx + 200, gy + 3);
      ctx.stroke();
      label(`${sp} · stage ${s}`, gx, gy + 24);
    }
  });
  const st = fakeState(list);
  warm(trees, st);
  trees.drawTrees(ctx, st, tFixed, 1 / 60);
}

function drawHealth() {
  paper(0, 0, 1920, 1080);
  const list = [];
  const hs = [0.2, 0.6, 1.0];
  SPECIES.forEach((sp, r) => {
    hs.forEach((h, c) => {
      const gx = 330 + c * 630;
      const gy = 320 + r * 350;
      list.push(copyTree(baseTrees[r], 40 + r * 3 + c, { stage: 3, x: gx, baseY: gy, health: h, roots: [], tips: [] }));
      ctx.strokeStyle = 'rgba(58,42,30,.35)';
      ctx.beginPath();
      ctx.moveTo(gx - 250, gy + 3);
      ctx.lineTo(gx + 250, gy + 3);
      ctx.stroke();
      label(`${sp} · health ${h}`, gx, gy + 24);
    });
  });
  const st = fakeState(list);
  warm(trees, st);
  trees.drawTrees(ctx, st, tFixed, 1 / 60);
}

function drawSeasons() {
  paper(0, 0, 1920, 1080);
  const stage = Number(q.get('stage') ?? 3);
  const seasons = ['spring', 'summer', 'autumn', 'winter'];
  const cw = 1920 / 4;
  seasons.forEach((se, c) => {
    const inst = createTrees();
    inst.setScale(S);
    const list = [];
    SPECIES.forEach((sp, r) => {
      const gx = cw * (c + 0.5);
      const gy = 330 + r * 350;
      list.push(copyTree(baseTrees[r], 70 + r, { stage, x: gx, baseY: gy, health: 0.85, roots: [], tips: [] }));
      ctx.strokeStyle = 'rgba(58,42,30,.35)';
      ctx.beginPath();
      ctx.moveTo(gx - cw * 0.45, gy + 3);
      ctx.lineTo(gx + cw * 0.45, gy + 3);
      ctx.stroke();
      label(`${sp} · ${se}`, gx, gy + 24);
    });
    const st = fakeState(list, se);
    warm(inst, st);
    inst.drawTrees(ctx, st, tFixed, 1 / 60);
  });
}

function paintWorldBackdrop() {
  paper(0, 0, 1920, 1080);
  // sky wash hint
  const g = ctx.createLinearGradient(0, 0, 0, 300);
  g.addColorStop(0, 'rgba(120,150,170,.10)');
  g.addColorStop(1, 'rgba(120,150,170,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1920, 300);
  const step = world.step;
  for (const h of world.horizons) {
    ctx.beginPath();
    h.top.forEach((y, k) => (k ? ctx.lineTo(k * step, y) : ctx.moveTo(0, y)));
    ctx.lineTo(1920, 1080);
    ctx.lineTo(0, 1080);
    ctx.closePath();
    ctx.fillStyle = h.color;
    ctx.fill();
  }
  // darken towards the depth (umber -> indigo)
  const dg = ctx.createLinearGradient(0, 300, 0, 1080);
  dg.addColorStop(0, 'rgba(20,12,8,0.10)');
  dg.addColorStop(1, 'rgba(38,48,74,0.7)');
  ctx.fillStyle = dg;
  ctx.beginPath();
  world.horizons[0].top.forEach((y, k) => (k ? ctx.lineTo(k * step, y) : ctx.moveTo(0, y)));
  ctx.lineTo(1920, 1080);
  ctx.lineTo(0, 1080);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PAL.sepia;
  ctx.lineWidth = 2;
  ctx.beginPath();
  world.horizons[0].top.forEach((y, k) => (k ? ctx.lineTo(k * step, y) : ctx.moveTo(0, y)));
  ctx.stroke();
}

function worldTrees() {
  const stages = (q.get('stages') || '1,2,0').split(',').map(Number);
  const linked = q.get('linked') === '1';
  const hs = (q.get('health') || '0.5,0.5,0.5').split(',').map(Number);
  return world.trees.map((t, i) => ({ ...t, stage: stages[i] ?? t.stage, linked, health: hs[i] ?? 0.5 }));
}

function drawWorld() {
  paintWorldBackdrop();
  const list = worldTrees();
  frame(list, tFixed);
  if (q.get('rings') === '1') {
    ctx.strokeStyle = PAL.wax;
    for (const t of list) {
      const b = trees.bounds(t);
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    }
  }
}

function moved(t, x, y, over) {
  const dx = x - t.x;
  const dy = y - t.baseY;
  return {
    ...t,
    ...over,
    x,
    baseY: y,
    roots: t.roots.map((r) => ({ ...r, points: r.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) })),
    tips: t.tips.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  };
}

function drawAnim() {
  const sp = q.get('sp') || 'oak';
  const from = Number(q.get('from') || 1);
  const bt = baseTrees[SPECIES.indexOf(sp)] || baseTrees[1];
  const times = [-1, 0.3, 0.8, 1.3, 1.9, 3.2];
  paper(0, 0, 1920, 1080);
  const groundY = 380;
  const scratch = document.createElement('canvas').getContext('2d');
  times.forEach((T, i) => {
    const gx = 160 + i * 320;
    const inst = createTrees();
    inst.setScale(S);
    const mk = (stage) => moved(bt, gx, groundY, { id: 1, stage, linked: i >= 4, health: 0.9 });
    const w = { trees: [mk(from)] };
    const st = fakeState(w.trees);
    st.world = w;
    inst.drawRoots(scratch, st, 0, 1 / 60);
    inst.drawTrees(scratch, st, 0, 1 / 60);
    if (T >= 0) {
      const w2 = { ...w, trees: [mk(from + 1)] };
      // keep the same world identity so the records survive
      w.trees = w2.trees;
      // let the background painting of the new look finish (dt = 0: the animation clock does not move)
      for (let k = 0; k < 600; k++) {
        inst.drawTrees(scratch, st, k * 0.001, 0);
        inst.drawRoots(scratch, st, k * 0.001, 0);
      }
      let t = 1;
      const t1 = t + T;
      while (t < t1 - 1e-6) {
        const d = Math.min(1 / 30, t1 - t);
        t += d;
        inst.drawRoots(scratch, st, t, d);
        inst.drawTrees(scratch, st, t, d);
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(i * 320, 0, 320, 1080);
    ctx.clip();
    paper(i * 320, 0, 320, 1080);
    soil(i * 320, 0, 320, 1080, groundY);
    inst.drawRoots(ctx, st, 1 + T + 0.001, 1 / 60);
    inst.drawTrees(ctx, st, 1 + T + 0.001, 1 / 60);
    ctx.strokeStyle = 'rgba(0,0,0,.3)';
    ctx.strokeRect(i * 320, 0, 320, 1080);
    ctx.restore();
    label(T < 0 ? `stage ${from}` : `+${T.toFixed(1)}s`, gx, 40);
  });
}

/* ------------------------------------------------------------------ live */

const costs = [];
function drawLive(now) {
  const t = now / 1000;
  setView();
  paintWorldBackdrop();
  const k = Math.floor(t / 6);
  const stages = [(k + 1) % 4, (k + 2) % 4, k % 4];
  const list = world.trees.map((tr, i) => ({ ...tr, stage: stages[i], linked: k % 2 === 0, health: i === 0 ? 0.2 + 0.8 * ((t / 6) % 1) : 0.5 + 0.5 * Math.sin(t) }));
  const t0 = performance.now();
  frame(list, t, 1 / 60);
  costs.push(performance.now() - t0);
  if (costs.length > 120) costs.shift();
  ctx.fillStyle = '#fff';
  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
  ctx.fillText(`stages ${stages.join(',')}  frame cost avg ${avg.toFixed(3)} ms`, 20, 30);
  requestAnimationFrame(drawLive);
}

// Cost of the trees on top of the backdrop with the main canvas flushed every frame (software raster: an upper bound).
function flushBench(stage = 3, n = 120) {
  const list = world.trees.map((t) => ({ ...t, stage, linked: true, health: 0.8 }));
  const st = fakeState(list);
  const inst = createTrees();
  inst.setScale(S);
  const run = (withTrees) => {
    const times = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      paintWorldBackdrop();
      if (withTrees) {
        inst.drawRoots(ctx, st, 50 + i / 60, 1 / 60);
        inst.drawTrees(ctx, st, 50 + i / 60, 1 / 60);
      }
      ctx.getImageData(0, 0, 1, 1);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return times[n >> 1];
  };
  run(true); // warm up (sprite painting)
  const without = run(false);
  const withT = run(true);
  return { backdropMs: +without.toFixed(2), withTreesMs: +withT.toFixed(2), treesMs: +(withT - without).toFixed(2) };
}

function benchmark(nFrames = 600) {
  // steady-state cost of drawRoots + drawTrees for the real 3 trees at every stage
  const out = {};
  for (let stage = 0; stage < 4; stage++) {
    const list = world.trees.map((t) => ({ ...t, stage, linked: true, health: 0.8 }));
    const w = { trees: list };
    const st = fakeState(list);
    st.world = w;
    const inst = createTrees();
    inst.setScale(S);
    const c0 = performance.now();
    inst.drawRoots(ctx, st, 0, 1 / 60);
    inst.drawTrees(ctx, st, 0, 1 / 60);
    const first = performance.now() - c0;
    const times = [];
    for (let i = 1; i <= nFrames; i++) {
      const t0 = performance.now();
      inst.drawRoots(ctx, st, i / 60, 1 / 60);
      inst.drawTrees(ctx, st, i / 60, 1 / 60);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    // hitch: a stage increase and a health change while drawing normally
    const hs = [];
    list.forEach((t) => { t.stage = Math.min(3, stage + 1); t.health = 0.3; });
    for (let i = 1; i <= 240; i++) {
      const t0 = performance.now();
      inst.drawRoots(ctx, st, 20 + i / 60, 1 / 60);
      inst.drawTrees(ctx, st, 20 + i / 60, 1 / 60);
      hs.push(performance.now() - t0);
    }
    out[stage + 'hitch'] = { maxMs: +Math.max(...hs).toFixed(1), framesOver4ms: hs.filter((x) => x > 4).length };
    out[stage] = { firstFrameMs: +first.toFixed(1), medianMs: +times[nFrames >> 1].toFixed(3), p95Ms: +times[Math.floor(nFrames * 0.95)].toFixed(3), maxMs: +times[nFrames - 1].toFixed(3) };
  }
  return out;
}

setView();
if (mode === 'live') requestAnimationFrame(drawLive);
else {
  const t0 = performance.now();
  if (mode === 'sheet') drawSheet();
  else if (mode === 'health') drawHealth();
  else if (mode === 'world') drawWorld();
  else if (mode === 'anim') drawAnim();
  else if (mode === 'seasons') drawSeasons();
  window.__renderMs = performance.now() - t0;
}
window.G = { trees, world, benchmark, flushBench, mix };
document.title = `trees gallery: ${mode}`;

if (q.get('buttons') === '1') {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:12px;top:10px;font:13px monospace;background:#0008;padding:4px 8px;border-radius:4px';
  for (const se of ['', 'spring', 'summer', 'autumn', 'winter']) {
    const u = new URLSearchParams(location.search);
    if (se) u.set('season', se);
    else u.delete('season');
    const a = document.createElement('a');
    a.href = '?' + u;
    a.textContent = se || 'none';
    a.style.cssText = 'color:' + (se === season ? '#ffd27a' : '#fff') + ';margin:0 6px;text-decoration:none';
    bar.append(a);
  }
  document.body.append(bar);
}

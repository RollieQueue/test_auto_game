// Gallery page for src/render/mushrooms.js (NOT part of the game).
// ?only=sheet|game|anim shows a single section; window.__gal exposes helpers for screenshots and benchmarks.
import { createMushrooms } from './mushrooms.js';
import { PAL, inkStroke, noise1, mulberry, rgba } from './ink.js';

const dpr = window.devicePixelRatio || 1;
const params = new URLSearchParams(location.search);
const only = params.get('only');
const GROWTHS = [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1];

function setup(id, cssW, cssH) {
  const c = document.getElementById(id);
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  c.style.width = `${cssW}px`;
  c.style.height = `${cssH}px`;
  if (only && only !== id) {
    c.style.display = 'none';
    c.previousElementSibling.style.display = 'none';
  }
  return c.getContext('2d');
}

/** Paper, ragged inked ground line with grass, dark soil below. World units. */
function drawGround(ctx, x0, x1, y, soilH, seed = 1) {
  const g = ctx.createLinearGradient(0, y, 0, y + soilH);
  g.addColorStop(0, '#5a4131');
  g.addColorStop(1, '#2c2018');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x0, y + 1);
  const pts = [];
  for (let x = x0; x <= x1; x += 4) pts.push({ x, y: y + 1.2 * noise1(x * 0.07 + seed) + 0.5 * noise1(x * 0.3 + seed * 3) });
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.lineTo(x1, y + soilH);
  ctx.lineTo(x0, y + soilH);
  ctx.closePath();
  ctx.fill();
  inkStroke(ctx, pts, { w: 1.7, color: PAL.sepia, taperStart: 0.01, taperEnd: 0.01, seed, step: 3 });
  const rng = mulberry(seed * 9 + 1);
  for (let x = x0 + 4; x < x1; x += 3 + rng() * 5) {
    const h = 3 + rng() * 7;
    const d = (rng() - 0.5) * 5;
    inkStroke(ctx, [{ x, y: y + 1 }, { x: x + d * 0.4, y: y - h * 0.6 }, { x: x + d, y: y - h }], {
      w: 0.8, color: rng() < 0.5 ? '#566629' : '#6b7a34', alpha: 0.85, taperEnd: 0.7, seed: x, step: 1.5,
    });
  }
}

function paper(ctx, w, h) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAL.paper;
  ctx.fillRect(0, 0, w * dpr, h * dpr);
  const g = ctx.createRadialGradient(w * dpr * 0.5, h * dpr * 0.4, h * dpr * 0.2, w * dpr * 0.5, h * dpr * 0.5, w * dpr * 0.7);
  g.addColorStop(0, 'rgba(255,250,230,0.25)');
  g.addColorStop(1, 'rgba(180,150,100,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w * dpr, h * dpr);
  ctx.restore();
}

function mush(id, kindSub, x, baseY, growth, extra = {}) {
  return { id, nodeId: id, x, baseY, species: 'common', variant: kindSub, age: 0, growth, mature: growth >= 1, spores: 0, ...extra };
}

/* ---------------------------------------------------------------- sheet (x3 zoom) */
const Z = 3;
const CELL_W = 90;
const ROW_H = 112;
const sheetCss = { w: CELL_W * Z * 7 + 20, h: ROW_H * Z * 4 };
const sctx = setup('sheet', sheetCss.w, sheetCss.h);
const sheetM = createMushrooms();
sheetM.setScale(Z * dpr);
function drawSheet() {
  paper(sctx, sheetCss.w, sheetCss.h);
  sctx.save();
  sctx.setTransform(dpr * Z, 0, 0, dpr * Z, 10 * dpr, 0);
  for (let v = 0; v < 4; v++) {
    const gy = v * ROW_H + 90;
    drawGround(sctx, 0, CELL_W * 7, gy, ROW_H - 90 - 1, 3 + v);
    const list = GROWTHS.map((g, i) => mush(v * 10 + i + 1, v, CELL_W * (i + 0.5), gy, g, {}));
    sheetM.draw(sctx, { mushrooms: list }, 0, 0);
    sctx.fillStyle = rgba(PAL.sepia, 0.8);
    sctx.font = 'italic 4.5px Georgia, serif';
    GROWTHS.forEach((g, i) => sctx.fillText(`${v}: g=${g}`, CELL_W * i + 4, v * ROW_H + 8));
  }
  sctx.restore();
}

/* ---------------------------------------------------------------- game scale */
const GS = 0.8333;
const gameCss = { w: 1600, h: 300 };
const gctx = setup('game', gameCss.w, gameCss.h);
const gameM = createMushrooms();
gameM.setScale(GS * dpr);
function drawGame() {
  paper(gctx, gameCss.w, gameCss.h);
  gctx.save();
  gctx.setTransform(dpr * GS, 0, 0, dpr * GS, 0, 0);
  const gy = 250;
  drawGround(gctx, 0, 1920, gy, 120, 11);
  const list = [];
  let x = 40;
  let id = 100;
  for (let v = 0; v < 4; v++) {
    for (const g of GROWTHS) {
      list.push(mush(id++, v, x, gy + (id % 3) - 1, g));
      x += 56;
    }
    x += 40;
  }
  // a few extra variants (sub 1) at full growth
  for (let v = 0; v < 4; v++) {
    list.push(mush(id++, v + 4, x, gy, 1));
    x += 60;
  }
  gameM.draw(gctx, { mushrooms: list }, 0, 0);
  gctx.restore();
}

/* ---------------------------------------------------------------- animated */
const animCss = { w: 1600, h: 420 };
const actx = setup('anim', animCss.w, animCss.h);
const animM = createMushrooms();
const AZ = Number(params.get('zoom')) || 1; // ?zoom=3&pan=700 magnifies the animated section
const AS = GS * AZ;
const APAN = Number(params.get('pan')) || 0;
animM.setScale(AS * dpr);
const astate = { mushrooms: [], events: [] };
let animT = 0;
const AG = 380;
const slots = [220, 520, 800, 1100, 1400, 1700];
function regrow() {
  astate.mushrooms = slots.map((x, i) => mush(200 + i, i, x, AG, 0, { delay: i * 2.5 }));
  astate.events.length = 0;
  animM.reset();
  animT = 0;
}
regrow();
function stepAnim(dt) {
  animT += dt;
  for (const m of astate.mushrooms) {
    if (animT < m.delay) continue;
    if (m.age === 0) astate.events.push({ type: 'mushroom-planted', id: m.id, x: m.x, y: m.baseY });
    m.age += dt;
    m.growth = Math.min(1, m.age / 11);
    if (!m.mature && m.growth >= 1) {
      m.mature = true;
      astate.events.push({ type: 'mushroom-mature', id: m.id, x: m.x, y: m.baseY });
    }
    if (m.mature) {
      m.spores += dt;
      if (m.spores > 4 + (m.id % 3)) {
        m.spores = 0;
        astate.events.push({ type: 'spores', id: m.id, amount: 20 + (m.id % 4) * 15, x: m.x, y: m.baseY });
      }
    }
  }
}
function frameAnim(dt) {
  stepAnim(dt);
  for (const ev of astate.events) animM.event(ev, astate);
  astate.events.length = 0;
  paper(actx, animCss.w, animCss.h);
  actx.save();
  actx.setTransform(dpr * AS, 0, 0, dpr * AS, -APAN * AS * dpr, (AZ > 1 ? animCss.h * 0.8 - AG * AS : 0) * dpr);
  drawGround(actx, 0, 1920, AG, 120, 21);
  animM.draw(actx, astate, animT, dt);
  actx.restore();
}
document.getElementById('anim').addEventListener('click', (e) => {
  const r = e.target.getBoundingClientRect();
  const wx = (e.clientX - r.left) / AS + APAN;
  let best = null;
  for (const m of astate.mushrooms) if (!best || Math.abs(m.x - wx) < Math.abs(best.x - wx)) best = m;
  if (best) astate.events.push({ type: 'spores', id: best.id, amount: 60, x: best.x, y: best.baseY });
});
document.getElementById('puff').onclick = () => {
  for (const m of astate.mushrooms) astate.events.push({ type: 'spores', id: m.id, amount: 60, x: m.x, y: m.baseY });
};
document.getElementById('regrow').onclick = regrow;

/* ---------------------------------------------------------------- run */
let last = performance.now();
let manual = false;
let settle = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // sprites are rendered a couple per frame: repaint the static sheets until the cache is warm
  if (settle < 90) {
    settle++;
    if (!only || only === 'sheet') drawSheet();
    if (!only || only === 'game') drawGame();
    document.title = settle < 90 ? 'mushrooms gallery (warming)' : 'mushrooms gallery';
  }
  if (!manual && (!only || only === 'anim')) frameAnim(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/**
 * Main-thread cost of draw() with 20 mature mushrooms and about 300 live spores (one 11-spore burst every 10 frames,
 * 4.5 s average life). The sprite cache is warm. `spores = 0` measures the bodies alone.
 */
function bench(frames = 1500, spores = 18) {
  const m = createMushrooms();
  m.setScale(GS * dpr);
  const c = document.createElement('canvas');
  c.width = 1600 * dpr;
  c.height = 900 * dpr;
  const g = c.getContext('2d');
  g.setTransform(dpr * GS, 0, 0, dpr * GS, 0, 0);
  const list = [];
  for (let i = 0; i < 20; i++) list.push(mush(300 + i, i, 80 + i * 90, 700 + (i % 3) * 4, 1, { mature: true }));
  const st = { mushrooms: list };
  for (let i = 0; i < 12; i++) m.draw(g, st, i * 0.016, 0.016);
  let t = 1;
  const times = [];
  for (let f = 0; f < frames; f++) {
    if (spores && f % 10 === 0) m.event({ type: 'spores', id: 300 + ((f / 10) % 20), amount: spores }, st);
    t += 0.016;
    g.clearRect(0, 0, c.width, c.height);
    const a = performance.now();
    m.draw(g, st, t, 0.016);
    times.push(performance.now() - a);
  }
  const tail = times.slice(Math.min(400, frames >> 1)).sort((x, y) => x - y);
  const q = (p) => +tail[Math.min(tail.length - 1, Math.floor(tail.length * p))].toFixed(2);
  return { frames: tail.length, median: q(0.5), mean: +(tail.reduce((s, v) => s + v, 0) / tail.length).toFixed(2), p95: q(0.95), p99: q(0.99) };
}

window.__gal = {
  anim: animM,
  state: astate,
  /** advance the animated section by `sec` seconds of fixed 1/60 frames (pauses the live loop) */
  simulate(sec) {
    manual = true;
    for (let i = 0; i < Math.round(sec * 60); i++) frameAnim(1 / 60);
  },
  bench,
  regrow,
};
document.getElementById('info').textContent = `dpr ${dpr}`;

// Scratch gallery for src/render/decor.js (not part of the game). Open /src/render/gallery-decor.html
// ?seed=N changes the plates; ?only=acorn,leaf shows a subset; ?rot=0 keeps everything upright in the small rows.
import { DECOR_TYPES, DECOR_SIZE, drawDecor } from './decor.js';
import { wash, blobPoly, stipple, hatch, mulberry, makeCanvas } from './ink.js';

const q = new URLSearchParams(location.search);
const SEED = Number(q.get('seed') || 7);
const only = q.get('only') ? q.get('only').split(',') : null;
const types = DECOR_TYPES.filter((t) => !only || only.includes(t));
const keepUpright = q.get('rot') === '0';

/** Dark umber / indigo watercolor soil, like the game's underground. */
function soil(ctx, w, h, seed) {
  const rng = mulberry(seed);
  ctx.fillStyle = '#35261f';
  ctx.fillRect(0, 0, w, h);
  const tones = ['#2c2a3a', '#46322a', '#3a2a22', '#2a2230', '#4a3a2c'];
  for (let i = 0; i < Math.ceil((w * h) / 2600); i++) {
    const poly = blobPoly(rng() * w, rng() * h, 14 + rng() * 40, 10 + rng() * 26, seed + i, { n: 10, jitter: 0.3, rot: rng() * 3 });
    wash(ctx, poly, { color: tones[(rng() * tones.length) | 0], alpha: 0.3 + rng() * 0.3, layers: 3, ragged: 3, edge: 0.4, seed: seed + i * 3 });
  }
  const full = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  hatch(ctx, full, { angle: 0.7, gap: 7, w: 0.6, color: '#14100e', alpha: 0.28, seed, lenVar: 0.9 });
  stipple(ctx, full, { count: Math.floor((w * h) / 90), color: '#6a5442', alpha: 0.45, rMax: 1.2, seed });
  stipple(ctx, full, { count: Math.floor((w * h) / 500), color: '#14100e', alpha: 0.5, rMax: 1.6, seed: seed + 1 });
}

function cell(parent, w, h, dpr, drawFn, seed) {
  const c = makeCanvas(w * dpr, h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  parent.appendChild(c);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  soil(ctx, w, h, seed);
  drawFn(ctx, w, h);
  return c;
}

const t0 = performance.now();
const timing = {};
function timed(type, fn) {
  const a = performance.now();
  fn();
  timing[type] = (timing[type] || 0) + performance.now() - a;
}

// big, x4
for (const [i, type] of types.entries()) {
  cell(document.getElementById('big'), 240, 240, 1, (ctx, w, h) => {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(4, 4);
    timed(type, () => drawDecor(ctx, { id: i, type, x: 0, y: 0, rot: 0, scale: 1 }, { seed: SEED }));
    ctx.restore();
    ctx.fillStyle = 'rgba(255,240,200,0.7)';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${type} (${DECOR_SIZE[type]})`, 8, 14);
  }, 100 + i);
}

// actual size, dpr 2 and dpr 1 at game scale: all types in a row, each at a few rotations
function strip(parentId, dpr, scale) {
  const per = 4;
  const cw = 60;
  const ch = 66;
  const w = cw * per;
  const rows = [];
  for (let r = 0; r < Math.ceil(types.length / 1); r++) rows.push(r);
  for (const [i, type] of types.entries()) {
    cell(document.getElementById(parentId), w, ch, dpr, (ctx) => {
      ctx.save();
      ctx.scale(scale, scale);
      for (let k = 0; k < per; k++) {
        const rot = keepUpright ? 0 : [0, 2.2, -1.3, 3.5][k];
        const sc = [1, 1.2, 0.85, 1.05][k];
        timed(type, () => drawDecor(ctx, { id: i * 8 + k, type, x: ((k + 0.5) * cw) / scale, y: ch / 2 / scale, rot, scale: sc }, { seed: SEED }));
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(255,240,200,0.6)';
      ctx.font = '10px sans-serif';
      ctx.fillText(type, 3, 10);
    }, 200 + i);
  }
}
strip('real', 2, 1);
strip('game', 1, 0.8333);

window.__decorTiming = timing;
console.log('decor timing (ms, summed over all draws)', JSON.stringify(Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, +v.toFixed(1)]))), 'total', (performance.now() - t0).toFixed(0));

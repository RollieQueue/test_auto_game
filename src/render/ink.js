// Ink-and-watercolor drawing primitives shared by every render module.
// Canvas 2D only, no game state. Everything is drawn in whatever units the caller's transform uses
// (world units in practice: sizes below are "world units", a stroke of w = 2 is about 1.7 CSS px).
// Randomness is derived from integer seeds so a seed always paints the same picture.
import { hash32, makeNoise1D } from '../core/rng.js';
import { resample } from '../core/geom.js';

export const PAL = {
  paper: '#efe4cc',
  paperShade: '#dccaa0',
  sepia: '#3a2a1e',
  sepiaSoft: '#6a4c35',
  indigo: '#26304a',
  cream: '#fff6dc',
  wax: '#a8322d',
  gold: '#e0a93a',
  water: '#4f9fc4',
  phosphor: '#8d63b8',
  nitrogen: '#8f9a45',
  sugar: '#ffb347',
};

/* ------------------------------------------------------------------ colour */

const colorCache = new Map();
/** '#rgb' | '#rrggbb' -> [r, g, b] */
export function rgb(c) {
  let v = colorCache.get(c);
  if (!v) {
    let h = c.slice(1);
    if (h.length === 3) h = h.replace(/./g, (m) => m + m);
    const n = parseInt(h, 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    colorCache.set(c, v);
  }
  return v;
}
export function rgba(c, a = 1) {
  const [r, g, b] = rgb(c);
  return `rgba(${r},${g},${b},${a})`;
}
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export function mix(c1, c2, t) {
  const a = rgb(c1);
  const b = rgb(c2);
  return `#${hex2(a[0] + (b[0] - a[0]) * t)}${hex2(a[1] + (b[1] - a[1]) * t)}${hex2(a[2] + (b[2] - a[2]) * t)}`;
}
export const lighten = (c, t) => mix(c, '#ffffff', t);
export const darken = (c, t) => mix(c, '#000000', t);
/** Multiply the channels: k < 1 darker, k > 1 lighter. */
export function shade(c, k) {
  const a = rgb(c);
  return `#${hex2(a[0] * k)}${hex2(a[1] * k)}${hex2(a[2] * k)}`;
}

/* ------------------------------------------------------------------ noise */

const N = makeNoise1D(0x51ed270b);
/** Smooth 1D value noise in [-1, 1] (period 256). */
export const noise1 = (x) => N(x);
/** Two-octave noise, roughly [-1, 1]. */
export const wob = (x) => 0.7 * N(x) + 0.3 * N(x * 2.7 + 11.3);
/** Small float offset derived from an integer seed, for decorrelating strokes. */
export const seedOf = (seed) => ((Math.imul(seed | 0, 0x9e3779b1) >>> 0) % 4096) * 0.37;
export const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** Derive a sub-seed from any values. */
export const subSeed = (...v) => hash32(...v);

/* ------------------------------------------------------------------ paths */

/** Catmull-Rom interpolation through points; `k` samples per span. */
export function catmull(pts, k = 4, closed = false) {
  const n = pts.length;
  if (n < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  const out = [];
  const get = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  if (!closed) out.push({ x: pts[n - 1].x, y: pts[n - 1].y });
  return out;
}

/** Add a path through pts to the current path (does not begin/stroke). Smooth = quadratic through midpoints. */
export function tracePath(ctx, pts, closed = true, smooth = true) {
  const n = pts.length;
  if (!n) return;
  if (!smooth || n < 3) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    return;
  }
  if (closed) {
    const last = pts[n - 1];
    ctx.moveTo((last.x + pts[0].x) / 2, (last.y + pts[0].y) / 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    ctx.closePath();
  } else {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
  }
}

/** Irregular closed blob around (cx, cy) as a point array. */
export function blobPoly(cx, cy, rx, ry, seed = 1, o = {}) {
  const { n = 14, jitter = 0.14, rot = 0 } = o;
  const so = seedOf(seed);
  const pts = [];
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const m = 1 + jitter * noise1(i * 1.7 + so);
    const x = Math.cos(a) * rx * m;
    const y = Math.sin(a) * ry * m;
    pts.push({ x: cx + x * cr - y * sr, y: cy + x * sr + y * cr });
  }
  return pts;
}

/** Jitter a polygon/polyline along its normals with smooth noise (hand-cut, uneven edge). */
export function raggedPoly(pts, amp, seed = 1, o = {}) {
  const { step = 6, closed = true } = o;
  const so = seedOf(seed);
  const out = [];
  let acc = 0;
  const m = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const k = Math.max(1, Math.round(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const off = amp * (0.75 * noise1((acc + t * len) * 0.035 + so) + 0.25 * noise1((acc + t * len) * 0.13 + so + 9));
      out.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off });
    }
    acc += len;
  }
  if (!closed) out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
  return out;
}

/** Clip to a point-array polygon, or to an ellipse {cx, cy, rx, ry, rot?}, or run a custom path function. */
export function clipTo(ctx, shape) {
  ctx.beginPath();
  if (typeof shape === 'function') shape(ctx);
  else if (Array.isArray(shape)) tracePath(ctx, shape, true, false);
  else ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, shape.rot || 0, 0, Math.PI * 2);
  ctx.clip();
}

export function boundsOf(shape) {
  if (Array.isArray(shape)) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of shape) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
    return { x0, y0, x1, y1 };
  }
  const r = Math.max(shape.rx, shape.ry);
  return { x0: shape.cx - r, y0: shape.cy - r, x1: shape.cx + r, y1: shape.cy + r };
}

function inShape(shape, x, y) {
  if (Array.isArray(shape)) {
    let inside = false;
    for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
      const a = shape[i];
      const b = shape[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  if (shape.cx === undefined) return true;
  const dx = (x - shape.cx) / shape.rx;
  const dy = (y - shape.cy) / shape.ry;
  return dx * dx + dy * dy <= 1;
}

/* ------------------------------------------------------------------ ink */

/**
 * A pen stroke along a polyline: a filled ribbon with pressure variation, hand tremor and tapered ends.
 * o: { w = 2, color, alpha, taperStart = .25, taperEnd = .4 (fractions of length), press = .3, tremor = .35,
 *      seed, step = 2.5, smooth = true }
 */
export function inkStroke(ctx, pts, o = {}) {
  if (pts.length < 2) return;
  const {
    w = 2,
    color = PAL.sepia,
    alpha = 1,
    taperStart = 0.25,
    taperEnd = 0.4,
    press = 0.3,
    tremor = 0.35,
    seed = 1,
    step = 2.5,
    smooth = true,
  } = o;
  const path = smooth && pts.length > 2 ? catmull(pts, 4) : pts;
  const s = resample(path, step);
  const n = s.length;
  if (n < 2) return;
  const so = seedOf(seed);
  const L = [];
  const R = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = s[i > 0 ? i - 1 : 0];
    const b = s[i < n - 1 ? i + 1 : n - 1];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    if (i) acc += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
    const t = i / (n - 1);
    const taper = Math.min(taperStart > 0 ? smooth01(t / taperStart) : 1, taperEnd > 0 ? smooth01((1 - t) / taperEnd) : 1);
    const pr = 1 + press * noise1(acc * 0.045 + so);
    const half = Math.max(0.07, w * 0.5 * pr * (0.16 + 0.84 * taper));
    const tr = tremor * noise1(acc * 0.09 + so + 50);
    const px = s[i].x - dy * tr;
    const py = s[i].y + dx * tr;
    L.push(px - dy * half, py + dx * half);
    R.push(px + dy * half, py - dx * half);
  }
  ctx.beginPath();
  ctx.moveTo(L[0], L[1]);
  for (let i = 2; i < L.length; i += 2) ctx.lineTo(L[i], L[i + 1]);
  for (let i = R.length - 2; i >= 0; i -= 2) ctx.lineTo(R[i], R[i + 1]);
  ctx.closePath();
  ctx.fillStyle = alpha < 1 ? rgba(color, alpha) : color;
  ctx.fill();
}

/** A single straight-ish ink line with a faint bow. */
export function inkLine(ctx, x0, y0, x1, y1, o = {}) {
  const { bow = 0.04, seed = 1 } = o;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const k = bow * noise1(seedOf(seed)) * 1.0;
  inkStroke(ctx, [{ x: x0, y: y0 }, { x: (x0 + x1) / 2 - dy * k, y: (y0 + y1) / 2 + dx * k }, { x: x1, y: y1 }], o);
}

/** Dashed ink: each dash is its own tapered stroke. o adds { dash = 6, gap = 3 } */
export function inkDashed(ctx, pts, o = {}) {
  const { dash = 6, gap = 3.5, seed = 1 } = o;
  const s = resample(pts.length > 2 ? catmull(pts, 4) : pts, 1.5);
  let i = 0;
  let k = 0;
  const so = seedOf(seed);
  while (i < s.length - 1) {
    const len = Math.max(2, Math.round((dash * (1 + 0.35 * noise1(k * 1.3 + so))) / 1.5));
    const seg = s.slice(i, Math.min(s.length, i + len + 1));
    if (seg.length > 1) inkStroke(ctx, seg, { ...o, smooth: false, taperStart: 0.3, taperEnd: 0.3, seed: seed + k });
    i += len + Math.max(1, Math.round((gap * (1 + 0.3 * noise1(k * 2.1 + so + 7))) / 1.5));
    k++;
  }
}

/** Closed outline drawn as one continuous pen line (slight overshoot where it closes). */
export function inkOutline(ctx, poly, o = {}) {
  const n = poly.length;
  if (n < 3) return;
  const pts = poly.concat([poly[0], poly[1], poly[2]].slice(0, Math.max(1, Math.round(n * 0.12))));
  inkStroke(ctx, pts, { taperStart: 0.04, taperEnd: 0.18, ...o });
}

/** Parallel hatching clipped to a shape. o: { angle, gap, w, color, alpha, seed, lenVar, jitter, density(x,y)->0..1, bounds } */
export function hatch(ctx, shape, o = {}) {
  const { angle = Math.PI / 4, gap = 4, w = 0.7, color = PAL.sepia, alpha = 0.6, seed = 1, lenVar = 0.35, density } = o;
  const b = o.bounds || boundsOf(shape);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = -dy;
  const py = dx;
  const proj = (x, y, ax, ay) => x * ax + y * ay;
  const corners = [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x1, b.y1],
    [b.x0, b.y1],
  ];
  let pMin = Infinity;
  let pMax = -Infinity;
  let dMin = Infinity;
  let dMax = -Infinity;
  for (const [x, y] of corners) {
    const p = proj(x, y, px, py);
    const d = proj(x, y, dx, dy);
    if (p < pMin) pMin = p;
    if (p > pMax) pMax = p;
    if (d < dMin) dMin = d;
    if (d > dMax) dMax = d;
  }
  const rng = mulberry(seed);
  ctx.save();
  clipTo(ctx, shape);
  for (let p = pMin + gap * rng() * 0.5; p < pMax; p += gap * (0.75 + rng() * 0.5)) {
    const span = dMax - dMin;
    const d0 = dMin + span * lenVar * rng() * 0.5;
    const d1 = dMax - span * lenVar * rng() * 0.5;
    if (density) {
      // shading: the line is cut into short pieces, each kept with probability density(x, y) and shortened by it
      const piece = Math.max(7, gap * 3);
      for (let d = d0 + rng() * piece * 0.5; d < d1; d += piece * (0.8 + rng() * 0.5)) {
        const mx = d * dx + p * px;
        const my = d * dy + p * py;
        const k = density(mx, my);
        if (k <= 0 || rng() > k) continue;
        const half = (piece * (0.35 + 0.65 * Math.min(1, k))) / 2;
        inkStroke(
          ctx,
          [
            { x: mx - dx * half, y: my - dy * half },
            { x: mx + dx * half, y: my + dy * half },
          ],
          { w, color, alpha, taperStart: 0.25, taperEnd: 0.4, press: 0.25, tremor: 0.25, seed: seed * 31 + ((d * 7) | 0), step: 4, smooth: false },
        );
      }
      continue;
    }
    const wig = (rng() - 0.5) * gap * 0.5;
    const x0 = d0 * dx + p * px;
    const y0 = d0 * dy + p * py;
    const x1 = d1 * dx + p * px;
    const y1 = d1 * dy + p * py;
    inkStroke(
      ctx,
      [
        { x: x0, y: y0 },
        { x: (x0 + x1) / 2 + px * wig, y: (y0 + y1) / 2 + py * wig },
        { x: x1, y: y1 },
      ],
      { w, color, alpha, taperStart: 0.2, taperEnd: 0.3, press: 0.25, tremor: 0.25, seed: seed * 31 + ((p * 7) | 0), step: 4 },
    );
  }
  ctx.restore();
}

/** Random dots inside a shape. o: { count, rMin, rMax, color, alpha, seed, density(x,y)->0..1 } */
export function stipple(ctx, shape, o = {}) {
  const { count = 40, rMin = 0.35, rMax = 0.95, color = PAL.sepia, alpha = 0.6, seed = 1, density } = o;
  const b = o.bounds || boundsOf(shape);
  const rng = mulberry(seed);
  ctx.fillStyle = alpha < 1 ? rgba(color, alpha) : color;
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 12; tries++) {
    const x = b.x0 + (b.x1 - b.x0) * rng();
    const y = b.y0 + (b.y1 - b.y0) * rng();
    if (!inShape(shape, x, y)) continue;
    if (density && rng() > density(x, y)) continue;
    const r = rMin + (rMax - rMin) * rng() * rng();
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.7 + 0.5 * rng()), rng() * 3, 0, Math.PI * 2);
    ctx.fill();
    placed++;
  }
}

/** An irregular ink blot with a few satellite droplets. */
export function inkBlot(ctx, x, y, r, o = {}) {
  const { color = PAL.sepia, alpha = 0.9, seed = 1, drops = 4 } = o;
  const rng = mulberry(seed);
  ctx.save();
  ctx.fillStyle = rgba(color, alpha);
  ctx.beginPath();
  tracePath(ctx, blobPoly(x, y, r, r * (0.8 + rng() * 0.3), seed, { n: 11, jitter: 0.28, rot: rng() * 3 }), true, true);
  ctx.fill();
  for (let i = 0; i < drops; i++) {
    const a = rng() * Math.PI * 2;
    const d = r * (1.1 + rng() * 1.1);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.1 + rng() * 0.18), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Tiny deterministic PRNG for drawing code (returns floats in [0, 1)). */
export function mulberry(seed) {
  let a = (seed | 0) + 0x6d2b79f5;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ watercolor */

/**
 * A watercolor wash in a polygon: several translucent layers with different ragged edges,
 * then a darkened rim just inside the edge. o: { color, alpha = .5, layers = 3, ragged = 2.5, edge = .5, edgeW = 1.6,
 * seed, closed = true, smooth = true, comp (globalCompositeOperation) }
 */
export function wash(ctx, pts, o = {}) {
  const { color = '#6b5238', alpha = 0.5, layers = 3, ragged = 2.5, edge = 0.5, edgeW = 1.6, seed = 1, smooth = true, comp, rimColor } = o;
  if (smooth && pts.length <= 24) pts = catmull(pts, 4, true); // round a coarse blob before roughening it
  ctx.save();
  if (comp) ctx.globalCompositeOperation = comp;
  const per = 1 - Math.pow(1 - Math.min(0.98, alpha), 1 / layers);
  let first = null;
  for (let l = 0; l < layers; l++) {
    const p = raggedPoly(pts, ragged * (1 + l * 0.55), seed + l * 17);
    if (!first) first = p;
    ctx.beginPath();
    tracePath(ctx, p, true, smooth);
    ctx.fillStyle = rgba(color, per);
    ctx.fill();
  }
  if (edge > 0) {
    ctx.save();
    ctx.beginPath();
    tracePath(ctx, first, true, smooth);
    ctx.clip();
    const dark = rimColor || darken(color, 0.38);
    for (const k of [2.4, 1.4, 0.7]) {
      ctx.lineWidth = edgeW * k * 2;
      ctx.strokeStyle = rgba(dark, Math.min(0.9, edge * alpha * 0.4));
      ctx.beginPath();
      tracePath(ctx, first, true, smooth);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Wash of an ellipse (convenience over blobPoly + wash). */
export function washEllipse(ctx, cx, cy, rx, ry, o = {}) {
  wash(ctx, blobPoly(cx, cy, rx, ry, o.seed || 1, { n: 16, jitter: o.jitter ?? 0.06, rot: o.rot || 0 }), o);
}

/* ------------------------------------------------------------------ grain, sprites */

let grainTiles = null;
function makeTiles() {
  if (grainTiles) return grainTiles;
  const size = 256;
  const rng = mulberry(0xbeef);
  const make = (rgbv, power, maxA) => {
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = Math.pow(rng(), power);
      img.data[i * 4] = rgbv[0];
      img.data[i * 4 + 1] = rgbv[1];
      img.data[i * 4 + 2] = rgbv[2];
      img.data[i * 4 + 3] = Math.round(v * maxA);
    }
    g.putImageData(img, 0, 0);
    return c;
  };
  grainTiles = { dark: make([58, 42, 30], 2.2, 255), light: make([255, 250, 232], 2.6, 255) };
  return grainTiles;
}
const patternCache = new WeakMap();
function patternFor(ctx, tile) {
  let m = patternCache.get(ctx);
  if (!m) patternCache.set(ctx, (m = new Map()));
  let p = m.get(tile);
  if (!p) m.set(tile, (p = ctx.createPattern(tile, 'repeat')));
  return p;
}

/**
 * Paper tooth / pigment granulation over what is already painted (only where pixels exist: source-atop).
 * Works in device pixels of the canvas. amount ~ .1 – .3.
 */
export function granulate(ctx, w, h, amount = 0.14, light = 0.6) {
  const t = makeTiles();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = amount;
  ctx.fillStyle = patternFor(ctx, t.dark);
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = amount * light;
  ctx.fillStyle = patternFor(ctx, t.light);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Grain pattern tiles, for paper and multiply overlays: { dark, light } canvases. */
export const grainTilesOf = () => makeTiles();

export function makeCanvas(w, h) {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (typeof document === 'undefined') return new OffscreenCanvas(cw, ch); // inside the world-layer worker
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  return c;
}

/**
 * A sprite canvas drawn in world units around an anchor. Draw in the returned ctx with the anchor at (0, 0):
 * x in [-ax, w - ax], y in [-ay, h - ay]. px = device pixels per world unit (view.scale * view.dpr).
 */
export function makeSprite(w, h, px, ax, ay) {
  const canvas = makeCanvas(w * px, h * px);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(px, 0, 0, px, ax * px, ay * px);
  return { canvas, ctx, px, w, h, ax, ay, cw: canvas.width, ch: canvas.height };
}

/** Draw a sprite so its anchor lands on (x, y); optional scale / rotation about the anchor / alpha. */
export function blit(ctx, sp, x, y, o = {}) {
  const { scale = 1, rot = 0, alpha = 1, sx = 1 } = o;
  if (alpha <= 0) return;
  const prevA = ctx.globalAlpha;
  ctx.globalAlpha = prevA * alpha;
  if (rot || scale !== 1 || sx !== 1) {
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.scale(scale * sx, scale);
    ctx.drawImage(sp.canvas, -sp.ax, -sp.ay, sp.w, sp.h);
    ctx.restore();
  } else {
    ctx.drawImage(sp.canvas, x - sp.ax, y - sp.ay, sp.w, sp.h);
  }
  ctx.globalAlpha = prevA;
}

const glowCache = new Map();
/** Radial glow sprite (soft dot): returns a canvas of `size` px; draw it centred and scaled as needed. */
export function glowSprite(color, size = 48, hard = 0.18) {
  const key = `${color}|${size}|${hard}`;
  let c = glowCache.get(key);
  if (!c) {
    c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, rgba('#ffffff', 1));
    grad.addColorStop(hard, rgba(color, 0.95));
    grad.addColorStop(0.45, rgba(color, 0.32));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    glowCache.set(key, c);
  }
  return c;
}

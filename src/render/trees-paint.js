// Painting of tree models (trees-model.js) into a sprite context: ink trunks and branches, watercolor crowns.
// The context is in tree-local world units (origin at the trunk base, y up is negative); sprites are cached by trees.js.
import {
  PAL,
  inkStroke,
  wash,
  blobPoly,
  raggedPoly,
  tracePath,
  stipple,
  granulate,
  mulberry,
  noise1,
  seedOf,
  mix,
  lighten,
  darken,
  rgba,
  smooth01,
  grainTilesOf,
} from './ink.js';
import { makeLimb } from './trees-model.js';
import { infectionLook, snagKeep, snagWidths, snagSpires } from './infection-look.js';

const SEP = PAL.sepia;
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rr = (rng, a, b) => a + (b - a) * rng();

/* ------------------------------------------------------------------ palettes */

const COLORS = {
  oak: {
    good: { base: '#5d7d2b', mid: '#45611f', dark: '#26371a', lite: '#9db55a', ink: '#1e2812' },
    sick: { base: '#ae9a55', mid: '#8a7541', dark: '#5b4a2b', lite: '#d9c685', ink: '#43361f' },
  },
  birch: {
    good: { base: '#a6cb55', mid: '#7dac3c', dark: '#43702a', lite: '#dcec9c', ink: '#2c3d1c' },
    sick: { base: '#cdbf6c', mid: '#aa9448', dark: '#76612f', lite: '#ece0a2', ink: '#4a3b22' },
  },
  pine: {
    good: { base: '#3f7f73', mid: '#2e655f', dark: '#17403f', lite: '#7fb3a2', ink: '#12302f' },
    sick: { base: '#8f9061', mid: '#767247', dark: '#514b2d', lite: '#bdb888', ink: '#3b3620' },
  },
};

/** Good-vitality colours per season (summer is COLORS itself, so a summer sprite equals the season-less one). */
const SEASON_GOOD = {
  spring: {
    birch: { base: '#b8dc6a', mid: '#92c44c', dark: '#5a9136', lite: '#e8f5b0', ink: '#34481f' },
    oak: { base: '#86a83e', mid: '#6a8e2f', dark: '#3c5424', lite: '#c0d778', ink: '#26361a' },
    pine: { base: '#47897c', mid: '#34706a', dark: '#1c4a48', lite: '#9fd0b4', ink: '#12302f' },
  },
  autumn: {
    birch: { base: '#e3c23e', mid: '#d09a2c', dark: '#9a6a22', lite: '#f6e486', ink: '#4a3418' },
    oak: { base: '#c4812e', mid: '#a65a24', dark: '#6a3418', lite: '#e6b565', ink: '#3a2212' },
    pine: { base: '#43806f', mid: '#316a5e', dark: '#1a4440', lite: '#85b79c', ink: '#14312d' },
  },
  winter: {
    // oak and birch are bare: only `ink` (the twigs) and `lite`/`dark` for the snow shade are used
    birch: { base: '#8c8279', mid: '#6d6560', dark: '#3d332c', lite: '#cfd4d8', ink: '#2e241f' },
    oak: { base: '#8a7e74', mid: '#6a5f56', dark: '#3a2e26', lite: '#cfd4d8', ink: '#33271f' },
    pine: { base: '#2a4f4f', mid: '#1f403f', dark: '#0f2a2c', lite: '#5f8f8b', ink: '#0b1c1e' },
  },
};

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/** Painting season: anything that is not spring/autumn/winter paints exactly as before (summer included). */
const paintSeason = (season) => (season === 'spring' || season === 'autumn' || season === 'winter' ? season : undefined);

/** `season`: optional 'spring' | 'summer' | 'autumn' | 'winter'; undefined (and 'summer') = the original palette. */
export function palette(species, v, season) {
  const key = COLORS[species] ? species : 'oak';
  const set = COLORS[key];
  const t = smooth01(clamp(v, 0, 1));
  const ss = paintSeason(season);
  let good = set.good;
  let sick = set.sick;
  if (ss) {
    good = SEASON_GOOD[ss][key];
    const k = ss === 'autumn' ? 0.5 : 0.3;
    sick = {};
    for (const c of Object.keys(good)) sick[c] = mix(set.sick[c], good[c], k);
  }
  const out = {};
  for (const k of Object.keys(good)) out[k] = mix(sick[k], good[k], t);
  return out;
}

/* ------------------------------------------------------------------ ribbons */

/** Offset a polyline with per-point widths into left/right edges (p = (-dy, dx): to the right when going up). */
function ribbon(pts, w, seed = 1, tremor = 0.3) {
  const n = pts.length;
  const so = seedOf(seed);
  const L = [];
  const R = [];
  const C = [];
  const P = [];
  const hw = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i > 0 ? i - 1 : 0];
    const b = pts[i < n - 1 ? i + 1 : n - 1];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    if (i) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const px = -dy;
    const py = dx;
    const tr = tremor * noise1(acc * 0.12 + so);
    const half = Math.max(0.12, w[i] * 0.5 * (1 + 0.07 * noise1(acc * 0.21 + so + 5)));
    const cx = pts[i].x + px * tr;
    const cy = pts[i].y + py * tr;
    C.push({ x: cx, y: cy });
    P.push({ x: px, y: py });
    hw.push(half);
    L.push({ x: cx - px * half, y: cy - py * half });
    R.push({ x: cx + px * half, y: cy + py * half });
  }
  return { L, R, C, P, hw, n };
}

function fillBand(ctx, A, B, color, alpha = 1, dx = 0, dy = 0) {
  if (A.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(A[0].x + dx, A[0].y + dy);
  for (let i = 1; i < A.length; i++) ctx.lineTo(A[i].x + dx, A[i].y + dy);
  for (let i = B.length - 1; i >= 0; i--) ctx.lineTo(B[i].x + dx, B[i].y + dy);
  ctx.closePath();
  ctx.fillStyle = alpha < 1 ? rgba(color, alpha) : color;
  ctx.fill();
}

/** Band between two lateral fractions u0..u1 (-1 left edge .. 1 right edge) of a ribbon. */
function lateral(rb, u0, u1) {
  const A = [];
  const B = [];
  for (let i = 0; i < rb.n; i++) {
    const c = rb.C[i];
    const p = rb.P[i];
    const h = rb.hw[i];
    A.push({ x: c.x + p.x * h * u0, y: c.y + p.y * h * u0 });
    B.push({ x: c.x + p.x * h * u1, y: c.y + p.y * h * u1 });
  }
  return [A, B];
}

function furrows(ctx, rb, rng, o) {
  const { count, minLen, maxLen, wMin = 0.6, wMax = 1.3, color = SEP, uLo = -0.75, uHi = 0.9, aLo = 0.25, aHi = 0.7, bias = 1, ticks = 0, yFrom = 0, yTo = 1 } = o;
  const n = rb.n;
  for (let k = 0; k < count; k++) {
    const u = lerp(uLo, uHi, Math.pow(rng(), bias));
    const cnt = Math.max(3, Math.round(rr(rng, minLen, maxLen) / 3));
    const i0 = Math.floor(lerp(yFrom, yTo, rng()) * Math.max(1, n - cnt - 1));
    const i1 = Math.min(n - 1, i0 + cnt);
    if (i1 - i0 < 2) continue;
    const pts = [];
    const wig = rr(rng, 0.04, 0.16);
    for (let i = i0; i <= i1; i++) {
      const uu = u + wig * noise1(i * 0.45 + k * 3.1);
      pts.push({ x: rb.C[i].x + rb.P[i].x * rb.hw[i] * uu, y: rb.C[i].y + rb.P[i].y * rb.hw[i] * uu });
    }
    const a = lerp(aLo, aHi, (u + 1) / 2);
    inkStroke(ctx, pts, { w: rr(rng, wMin, wMax), color, alpha: a, taperStart: 0.3, taperEnd: 0.45, tremor: 0.18, press: 0.25, seed: 11 + k, step: 3 });
    if (ticks && rng() < ticks) {
      const e = pts[pts.length - 1];
      const p = rb.P[i1];
      const ln = rb.hw[i1] * rr(rng, 0.25, 0.6);
      inkStroke(ctx, [{ x: e.x - p.x * ln, y: e.y - p.y * ln }, { x: e.x + p.x * ln, y: e.y + p.y * ln + 0.6 }], { w: wMin, color, alpha: a, taperStart: 0.2, taperEnd: 0.4, tremor: 0.1, seed: 99 + k, step: 3, smooth: false });
    }
  }
}

function edges(ctx, rb, w, color, seed, alpha = 0.92) {
  inkStroke(ctx, rb.L, { w, color, alpha, taperStart: 0.04, taperEnd: 0.25, tremor: 0.35, press: 0.35, seed, step: 3, smooth: false });
  inkStroke(ctx, rb.R, { w: w * 1.15, color, alpha, taperStart: 0.04, taperEnd: 0.25, tremor: 0.35, press: 0.35, seed: seed + 7, step: 3, smooth: false });
}

/* ------------------------------------------------------------------ trunks and limbs */

const BARK = {
  oak: { fill: '#7d5e40', shade: '#3f2c1f', light: '#c1a47c', thin: '#4a3626', thick: 3.6 },
  birch: { fill: '#f6f0de', shade: '#8e8c98', light: '#fffaf0', thin: '#4a352a', thick: 3.4 },
  pine: { fill: '#9b5a39', shade: '#5a3223', light: '#d08c55', thin: '#5a3a26', thick: 3.2 },
};

function birchMarks(ctx, rb, rng, hScale, upTo = 1) {
  const n = rb.n;
  let i = 2;
  while (i < n * upTo - 2) {
    const hw = rb.hw[i];
    if (hw > 0.9) {
      const len = hw * 2 * rr(rng, 0.3, 0.92);
      const u = rr(rng, -0.45, 0.4);
      const c = { x: rb.C[i].x + rb.P[i].x * hw * u, y: rb.C[i].y + rb.P[i].y * hw * u };
      const p = rb.P[i];
      const bow = rr(rng, -0.7, 0.7);
      const a = { x: c.x - p.x * len * 0.5, y: c.y - p.y * len * 0.5 };
      const b = { x: c.x + p.x * len * 0.5, y: c.y + p.y * len * 0.5 + rr(rng, -0.5, 0.5) };
      const m = { x: c.x + bow, y: c.y + Math.abs(bow) * 0.8 };
      inkStroke(ctx, [a, m, b], { w: rr(rng, 0.9, 1.9) * Math.min(1.3, 0.55 + hw * 0.12) * hScale, color: '#241a13', alpha: 0.9, taperStart: 0.35, taperEnd: 0.4, tremor: 0.1, press: 0.3, seed: 300 + i, step: 2 });
    }
    i += 1 + Math.floor(rr(rng, 1, hw > 3 ? 4 : 6));
  }
}

/** One limb as a few steps; `hold.rb` receives the ribbon once the first step has run. */
function limbSteps(ctx, limb, species, rng, seed, hold = {}) {
  const st = BARK[species];
  const pts = limb.pts;
  if (pts.length < 2) return [];
  const thick = limb.w0 >= st.thick;
  const bigW = limb.w0;
  let rb = null;
  if (!thick) {
    return [
      () => {
        rb = ribbon(pts, limb.w, seed, 0.2);
        fillBand(ctx, rb.L, rb.R, species === 'birch' && limb.w0 > 2 ? '#3a2a22' : st.thin, 0.95);
      },
    ];
  }
  return [
    () => {
      rb = ribbon(pts, limb.w, seed, limb.w0 > 6 ? 0.4 : 0.2);
      hold.rb = rb;
      // watercolor, slightly off-register with the ink
      fillBand(ctx, rb.L, rb.R, st.fill, species === 'birch' ? 1 : 0.9, 0.6, 0.35);
      if (species !== 'birch') {
        const [a, b] = lateral(rb, 0.12, 1.0);
        fillBand(ctx, a, b, st.shade, 0.55, 0.5, 0.3);
        const [c, d] = lateral(rb, -1.0, -0.45);
        fillBand(ctx, c, d, st.light, 0.32, 0.5, 0.3);
      } else {
        const [a, b] = lateral(rb, 0.3, 1.0);
        fillBand(ctx, a, b, st.shade, 0.5, 0.4, 0.3);
        const [a2, b2] = lateral(rb, 0.62, 1.0);
        fillBand(ctx, a2, b2, '#6f6c7a', 0.3, 0.4, 0.3);
      }
    },
    () => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(rb.L[0].x, rb.L[0].y);
      for (let i = 1; i < rb.n; i++) ctx.lineTo(rb.L[i].x, rb.L[i].y);
      for (let i = rb.n - 1; i >= 0; i--) ctx.lineTo(rb.R[i].x, rb.R[i].y);
      ctx.closePath();
      ctx.clip();
      const area = limb.len * bigW;
      if (species === 'oak') {
        furrows(ctx, rb, rng, { count: Math.round(clamp(area / 14, 6, 110)), minLen: 10, maxLen: 50, wMin: 0.7, wMax: 2.1, color: darken(SEP, 0.1), aLo: 0.25, aHi: 0.85, bias: 1.1, ticks: 0.15 });
      } else if (species === 'pine') {
        furrows(ctx, rb, rng, { count: Math.round(clamp(area / 12, 4, 100)), minLen: 5, maxLen: 20, wMin: 0.6, wMax: 1.2, color: '#3a2016', aLo: 0.3, aHi: 0.85, bias: 0.9, ticks: 0.7 });
      } else {
        furrows(ctx, rb, rng, { count: Math.round(clamp(area / 70, 2, 24)), minLen: 8, maxLen: 30, wMin: 0.5, wMax: 0.9, color: '#6c6a76', uLo: 0.2, uHi: 0.95, aLo: 0.3, aHi: 0.6 });
        birchMarks(ctx, rb, rng, 1);
      }
      ctx.restore();
    },
    () => edges(ctx, rb, clamp(0.9 + bigW * 0.05, 1, 2.2), SEP, seed, species === 'birch' ? 0.85 : 0.92),
  ];
}

function groundHatch(ctx, w0, rng) {
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const x0 = side * (w0 * rr(rng, 0.4, 0.9));
    const ln = rr(rng, 6, 12 + w0 * 0.9);
    const y = 0.8 + rng() * 3.5;
    inkStroke(ctx, [{ x: x0, y }, { x: x0 + side * ln * 0.5, y: y + 0.4 }, { x: x0 + side * ln, y: y + rr(rng, -0.3, 0.8) }], { w: rr(rng, 0.7, 1.2), color: SEP, alpha: 0.5, taperStart: 0.1, taperEnd: 0.6, tremor: 0.15, seed: 700 + i, step: 2 });
  }
}

/** Painting split into small steps so a caller can spread the work over frames. Steps must run in order. */
export function trunkSteps(ctx, m, W, H) {
  const steps = [];
  const rng = mulberry(m.seed ^ 0x7761 ^ (m.stage * 977));
  const sp = m.species;
  steps.push(() => groundHatch(ctx, m.trunk.w0, rng));
  const order = m.limbs.slice().sort((a, b) => (b.depth || 1) - (a.depth || 1));
  let k = 0;
  for (const L of order) steps.push(...limbSteps(ctx, L, sp, rng, m.seed + 31 * ++k));
  for (const L of m.butt || []) steps.push(...limbSteps(ctx, L, sp, rng, m.seed + 5000 + k++));
  const hold = { rb: null };
  steps.push(...limbSteps(ctx, m.trunk, sp, rng, m.seed + 99, hold));
  steps.push(() => {
    const rb = hold.rb;
    if (!rb) return;
    const w0 = m.trunk.w0;
    if (sp === 'oak') {
      const [a, b] = lateral(rb, -1, 1);
      for (const f of [0.34, 0.22, 0.11]) {
        const n = Math.max(3, Math.round(rb.n * f));
        fillBand(ctx, a.slice(rb.n - n), b.slice(rb.n - n), '#1c120b', 0.17, 0.4, 0.3);
      }
    }
    if (sp === 'oak' && w0 > 8) {
      // knots
      for (let i = 0; i < Math.round(w0 / 9); i++) {
        const idx = Math.floor(rr(rng, 0.15, 0.8) * rb.n);
        const u = rr(rng, -0.5, 0.5);
        const x = rb.C[idx].x + rb.P[idx].x * rb.hw[idx] * u;
        const y = rb.C[idx].y;
        const r = rr(rng, 2.2, 3.6) * (w0 / 18);
        ctx.fillStyle = rgba(SEP, 0.7);
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 1.5, 0.2, 0, TAU);
        ctx.fill();
        inkStroke(ctx, [{ x: x - r * 1.5, y: y + r * 0.2 }, { x: x, y: y - r * 2.1 }, { x: x + r * 1.5, y: y + r * 0.1 }], { w: 0.9, color: SEP, alpha: 0.8, taperStart: 0.3, taperEnd: 0.3, seed: 3 + i, step: 1.5 });
      }
    }
    if (sp === 'birch') {
      // dark rough base
      furrows(ctx, rb, rng, { count: 9, minLen: 5, maxLen: 13, wMin: 0.9, wMax: 1.8, color: '#1e1611', uLo: -0.8, uHi: 0.8, aLo: 0.55, aHi: 0.9, yFrom: 0, yTo: 0.12 });
    }
  });
  steps.push(() => granulate(ctx, W, H, 0.1, 0.4));
  return steps;
}

/* ------------------------------------------------------------------ crowns */

function scribbles(ctx, l, pal, rng, seed, count, alpha) {
  for (let i = 0; i < count; i++) {
    const a = rr(rng, 0.08, 0.88) * Math.PI;
    const d = rr(rng, 0.45, 0.95);
    const x = l.x + Math.cos(a) * l.rx * d;
    const y = l.y + Math.sin(a) * l.ry * d * 0.9;
    const s = rr(rng, 2.8, 5.8) * clamp(l.rx / 32, 0.6, 1.25);
    const sk = rr(rng, -0.4, 0.4);
    inkStroke(ctx, [{ x: x - s, y: y - s * 0.1 + sk }, { x: x - s * 0.1, y: y + s * 0.6 }, { x: x + s * 0.9, y: y - s * 0.25 + sk }], { w: rr(rng, 0.65, 1.0), color: pal.ink, alpha, taperStart: 0.3, taperEnd: 0.4, tremor: 0.15, seed: seed + i, step: 1.4 });
    if (rng() < 0.4) inkStroke(ctx, [{ x: x - s * 0.4, y: y + s * 0.5 }, { x: x + s * 0.3, y: y + s * 1.05 }, { x: x + s * 1.2, y: y + s * 0.4 }], { w: 0.7, color: pal.ink, alpha: alpha * 0.9, taperStart: 0.3, taperEnd: 0.4, tremor: 0.15, seed: seed + 50 + i, step: 1.4 });
  }
}

function crescent(l, a0, a1, inner) {
  const pts = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n);
    pts.push({ x: l.x + Math.cos(a) * l.rx * 0.99, y: l.y + Math.sin(a) * l.ry * 0.99 });
  }
  for (let i = n; i >= 0; i--) {
    const a = lerp(a0, a1, i / n);
    pts.push({ x: l.x + Math.cos(a) * l.rx * 0.85 + l.rx * 0.07, y: l.y + Math.sin(a) * l.ry * inner + l.ry * 0.05 });
  }
  return pts;
}

function leafyPoly(l, seed, amp = 0.09) {
  const per = Math.PI * (l.rx + l.ry);
  const nB = Math.max(5, Math.round(per / 15));
  const N = nB * 5;
  const so = seedOf(seed);
  const ph = (seed % 7) * 0.9;
  const cr = Math.cos(l.rot);
  const sr = Math.sin(l.rot);
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const m = 1 + amp * (Math.abs(Math.sin((a * nB) / 2 + ph)) - 0.5) + 0.07 * noise1(i * 0.55 + so);
    const ex = Math.cos(a) * l.rx * m;
    const ey = Math.sin(a) * l.ry * m;
    pts.push({ x: l.x + ex * cr - ey * sr, y: l.y + ex * sr + ey * cr });
  }
  return pts;
}

/* ------------------------------------------------------------------ oak crown: one unified wash, form painted on top */

const SHADE = { x: 0.62, y: 0.78 }; // light from the upper left: shade falls to the lower right

function polyBox(p) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of p) {
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.y > y1) y1 = q.y;
  }
  return { x0, y0, x1, y1 };
}

function pipPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Is (x, y) covered by any lobe silhouette except `skip`? */
function inUnion(G, x, y, skip = -1) {
  for (let k = 0; k < G.polyA.length; k++) {
    if (k === skip) continue;
    const b = G.boxes[k];
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
    // the silhouette stays within ~0.78..1.25 of the lobe ellipse: only the band in between needs the polygon test
    const l = G.vis[k];
    const dx = x - l.x;
    const dy = y - l.y;
    const c = Math.cos(l.rot);
    const sn = Math.sin(l.rot);
    const u = (dx * c + dy * sn) / l.rx;
    const w = (-dx * sn + dy * c) / l.ry;
    const q = u * u + w * w;
    if (q < 0.6) return true;
    if (q > 1.56) continue;
    if (pipPoly(G.polyA[k], x, y)) return true;
  }
  return false;
}

/** All lobe silhouettes as one path: with the nonzero rule, fill/clip give their union (overlaps do not stack). */
function unionPath(ctx, polys) {
  ctx.beginPath();
  for (const p of polys) tracePath(ctx, p, true, false);
}

/** Outward normal of the crown at (x, y) dotted with the shade direction: >0 faces the shade, <0 faces the light. */
function shadeSide(G, x, y) {
  const nx = (x - G.cx) / (G.rw * G.rw);
  const ny = (y - G.cy) / (G.rh * G.rh);
  const len = Math.hypot(nx, ny) || 1;
  return (nx * SHADE.x + ny * SHADE.y) / len;
}

function shadeLobe(ctx, G, i, pal, rng) {
  const l = G.vis[i];
  const reach = Math.abs(SHADE.x) * l.rx + Math.abs(SHADE.y) * l.ry;
  // wet-in-wet drift of tone (no edge)
  const ox = l.x + rr(rng, -0.35, 0.35) * l.rx;
  const oy = l.y + rr(rng, -0.3, 0.3) * l.ry;
  const tone = l.k < 0.5 ? pal.lite : pal.mid;
  let g = ctx.createRadialGradient(ox, oy, 0, ox, oy, Math.max(l.rx, l.ry) * 1.05);
  g.addColorStop(0, rgba(tone, 0.28));
  g.addColorStop(1, rgba(tone, 0));
  ctx.fillStyle = g;
  ctx.fillRect(l.x - l.rx * 1.2, l.y - l.ry * 1.2, l.rx * 2.4, l.ry * 2.4);
  // layered crescents: each wash is the clump minus the clump shifted toward the light, so the shade lands on the
  // lower right and steps darker toward the edge (wet-in-wet look, no outlines)
  const low = clamp((l.y - G.cy) / G.rh, -0.3, 1);
  const k = (0.25 + 0.95 * clamp((low + 0.5) / 1.3, 0, 1)) * (0.7 + 0.3 * rng()) * (l.ring >= 0.9 ? 1 : 0.8);
  const poly = G.polyB[i];
  const crescent2 = (d, color, alpha, sgn) => {
    ctx.beginPath();
    ctx.rect(l.x - l.rx * 1.5, l.y - l.ry * 1.5, l.rx * 3, l.ry * 3);
    const sx = -SHADE.x * d * sgn;
    const sy = -SHADE.y * d * sgn;
    ctx.moveTo(poly[0].x + sx, poly[0].y + sy);
    for (let q = 1; q < poly.length; q++) ctx.lineTo(poly[q].x + sx, poly[q].y + sy);
    ctx.closePath();
    ctx.fillStyle = rgba(color, alpha);
    ctx.fill('evenodd');
  };
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, poly, true, false);
  ctx.clip();
  crescent2(reach * 0.5, pal.mid, 0.27 * k, 1);
  crescent2(reach * 0.32, pal.mid, 0.34 * k, 1);
  crescent2(reach * 0.16, pal.dark, 0.44 * k, 1);
  if (l.ring >= 0.9) {
    crescent2(reach * 0.3, pal.lite, 0.28 * (1 - 0.5 * clamp(low, 0, 1)), -1);
    crescent2(reach * 0.14, pal.lite, 0.36 * (1 - 0.5 * clamp(low, 0, 1)), -1);
  }
  ctx.restore();
}

function leafMarks(ctx, G, i, pal, rng, seed, v) {
  const l = G.vis[i];
  const count = Math.round(clamp((l.rx * l.ry) / 260, 1, 12) * (0.55 + 0.45 * v));
  for (let q = 0; q < count; q++) {
    // clustered on the shade side, a few on the lit side
    const a = rng() < 0.85 ? rr(rng, -0.1, 0.75) * Math.PI : rng() * TAU;
    const d = rr(rng, 0.3, 0.92);
    const x = l.x + Math.cos(a) * l.rx * d;
    const y = l.y + Math.sin(a) * l.ry * d * 0.95;
    const s = rr(rng, 2.8, 5.6) * clamp(l.rx / 32, 0.6, 1.25);
    if (!inUnion(G, x, y) || !inUnion(G, x + s, y + s * 0.5)) continue;
    const sk = rr(rng, -0.4, 0.4);
    const al = a > 0 && a < Math.PI ? 0.55 : 0.4;
    inkStroke(ctx, [{ x: x - s, y: y - s * 0.1 + sk }, { x: x - s * 0.1, y: y + s * 0.6 }, { x: x + s * 0.9, y: y - s * 0.25 + sk }], { w: rr(rng, 0.65, 1.0), color: pal.ink, alpha: al, taperStart: 0.3, taperEnd: 0.4, tremor: 0.15, seed: seed + q, step: 1.4 });
    if (rng() < 0.4) inkStroke(ctx, [{ x: x - s * 0.4, y: y + s * 0.5 }, { x: x + s * 0.3, y: y + s * 1.05 }, { x: x + s * 1.2, y: y + s * 0.4 }], { w: 0.7, color: pal.ink, alpha: al * 0.9, taperStart: 0.3, taperEnd: 0.4, tremor: 0.15, seed: seed + 50 + q, step: 1.4 });
  }
  const poly = G.polyA[i];
  stipple(ctx, poly, { count: Math.round(l.rx * 0.8), color: pal.dark, alpha: 0.5, rMin: 0.3, rMax: 0.85, seed: seed + 6, density: (x, y) => clamp(((y - l.y) / l.ry) * 0.6 + 0.45, 0.05, 1) });
  stipple(ctx, poly, { count: Math.round(l.rx * 0.3), color: pal.lite, alpha: 0.55, rMin: 0.3, rMax: 0.8, seed: seed + 8, density: (x, y) => clamp(0.7 - ((y - l.y) / l.ry) * 0.6, 0.05, 1) });
}

/** Where a limb shows through the foliage: a few small gaps on the limbs, inside the crown. */
function pickHoles(G, m, v, rng) {
  const want = [0, 0, 2, 3][m.stage] + (m.stage >= 2 && v < 0.5 ? 1 : 0);
  const cands = [];
  for (const L of m.limbs) {
    if ((L.depth || 1) > 2) continue;
    const n = L.pts.length;
    for (let k = 1; k < n - 1; k++) {
      const f = k / (n - 1);
      if (f < 0.4 || f > 0.95 || L.pts[k].y < G.cy + 0.1 * G.rh) continue;
      const p = L.pts[k];
      const q = L.pts[k + 1];
      const r = L.pts[k - 1];
      cands.push({ x: p.x, y: p.y, w: L.w[k], rot: Math.atan2(q.y - r.y, q.x - r.x), limb: L });
    }
  }
  const out = [];
  while (out.length < want && cands.length) {
    const h = cands.splice(Math.floor(rng() * cands.length), 1)[0];
    h.rx = rr(rng, 7.5, 11) * (0.8 + 0.07 * m.stage);
    h.ry = Math.max(rr(rng, 3.8, 5.2), h.w * 0.7 + 2.6);
    let ok = true;
    for (let a = 0; a < 8 && ok; a++) ok = inUnion(G, h.x + Math.cos(a * 0.785) * (h.rx + 5), h.y + Math.sin(a * 0.785) * (h.ry + 5));
    if (ok && out.every((o) => Math.hypot(o.x - h.x, o.y - h.y) > 42)) out.push(h);
  }
  return out;
}

function paintHole(ctx, h, pal, rng, seed) {
  const poly = leafyPoly({ x: h.x, y: h.y, rx: h.rx, ry: h.ry, rot: h.rot }, seed, 0.3);
  const path = () => {
    ctx.beginPath();
    tracePath(ctx, poly, true, false);
  };
  // dark pooled edge on the foliage side, then cut the paper out
  ctx.save();
  path();
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = rgba(pal.dark, 0.34);
  ctx.stroke();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  path();
  ctx.fill();
  ctx.restore();
  // the limb behind, in shadow from the leaves above
  ctx.save();
  path();
  ctx.clip();
  ctx.fillStyle = rgba(mix(pal.lite, SEP, 0.1), 0.4); // the gap is not pure paper: a faint wash of the light behind
  ctx.fillRect(h.x - h.rx * 1.3, h.y - h.ry * 1.3, h.rx * 2.6, h.ry * 2.6);
  const rb = ribbon(h.limb.pts, h.limb.w, seed + 5, 0.2);
  fillBand(ctx, rb.L, rb.R, '#6a5036', 1);
  const [a, b] = lateral(rb, 0.05, 1);
  fillBand(ctx, a, b, '#2c1f15', 0.6);
  const g = ctx.createLinearGradient(0, h.y - h.ry, 0, h.y + h.ry);
  g.addColorStop(0, rgba(pal.dark, 0.5));
  g.addColorStop(0.6, rgba(pal.dark, 0.08));
  g.addColorStop(1, rgba(pal.dark, 0));
  ctx.fillStyle = g;
  ctx.fillRect(h.x - h.rx * 1.3, h.y - h.ry * 1.3, h.rx * 2.6, h.ry * 2.6);
  edges(ctx, rb, 1, SEP, seed, 0.85);
  ctx.restore();
  // broken ink rim
  const n = poly.length;
  const s0 = Math.floor(rng() * n);
  const run = [];
  for (let k = 0; k <= Math.round(n * 0.75); k++) run.push(poly[(s0 + k) % n]);
  inkStroke(ctx, run, { w: 1, color: pal.ink, alpha: 0.6, taperStart: 0.2, taperEnd: 0.35, tremor: 0.2, seed, step: 1.6 });
}

let toothTile = null;
/** granulate()'s dark and light grain baked into one CPU canvas: one fill per band instead of two, and no GPU readback per fill. */
function cpuToothTile(amount = 0.13, light = 0.5) {
  if (!toothTile) {
    const src = grainTilesOf();
    toothTile = document.createElement('canvas');
    toothTile.width = src.dark.width;
    toothTile.height = src.dark.height;
    const g = toothTile.getContext('2d', { willReadFrequently: true });
    g.globalAlpha = amount;
    g.drawImage(src.dark, 0, 0);
    g.globalAlpha = amount * light;
    g.drawImage(src.light, 0, 0);
  }
  return toothTile;
}

function oakCrownSteps(ctx, m, vis, pal, v, W, H, airy = false) {
  const steps = [];
  if (!vis.length) return steps;
  const sd = m.seed;
  const G = { vis, polyA: [], polyB: [], boxes: [], outer: [], holes: [], cx: 0, cy: 0, rw: 1, rh: 1, bb: null };
  const lobeSeed = (i) => sd + 13 * (i + 1);
  // steps over groups of lobes, so that every step stays within a few milliseconds
  const chunks = (n, fn, ch = 3) => {
    for (let i0 = 0; i0 < n; i0 += ch) steps.push(() => fn(i0, Math.min(n, i0 + ch)));
  };

  chunks(
    vis.length,
    (i0, i1) => {
      for (let i = i0; i < i1; i++) {
        const base = leafyPoly(vis[i], lobeSeed(i), 0.1);
        G.polyA[i] = raggedPoly(base, 1.1, lobeSeed(i) + 3);
        G.polyB[i] = raggedPoly(base, 2.6, lobeSeed(i) + 9);
        G.boxes[i] = polyBox(G.polyA[i]);
      }
    },
    6,
  );
  steps.push(() => {
    const bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const b of G.boxes) {
      bb.x0 = Math.min(bb.x0, b.x0);
      bb.y0 = Math.min(bb.y0, b.y0);
      bb.x1 = Math.max(bb.x1, b.x1);
      bb.y1 = Math.max(bb.y1, b.y1);
    }
    G.bb = bb;
    G.cx = (bb.x0 + bb.x1) / 2;
    G.cy = (bb.y0 + bb.y1) / 2;
    G.rw = Math.max(1, (bb.x1 - bb.x0) / 2);
    G.rh = Math.max(1, (bb.y1 - bb.y0) / 2);
  });
  chunks(
    vis.length,
    (i0, i1) => {
      for (let i = i0; i < i1; i++) G.outer[i] = G.polyA[i].map((p) => !inUnion(G, p.x, p.y, i));
    },
    2,
  );

  // 1. the whole crown as one flat wash (overlaps never stack), a second looser pass for ragged edge variation
  steps.push(() => {
    ctx.save();
    unionPath(ctx, G.polyA);
    ctx.fillStyle = rgba(mix(pal.base, pal.lite, airy ? 0.2 : 0.12), airy ? 0.64 : 0.72);
    ctx.fill();
    ctx.restore();
  });
  steps.push(() => {
    ctx.save();
    unionPath(ctx, G.polyB);
    ctx.fillStyle = rgba(pal.base, 0.3);
    ctx.fill();
    ctx.restore();
  });
  // main limbs faintly through the leaves
  steps.push(() => {
    ctx.save();
    unionPath(ctx, G.polyA);
    ctx.clip();
    for (const L of m.limbs) {
      if ((L.depth || 1) > 2 || L.pts.length < 2) continue;
      const rb = ribbon(L.pts, L.w.map((w) => w * 0.9), 5, 0.2);
      fillBand(ctx, rb.L, rb.R, '#2e2016', 0.3);
    }
    ctx.restore();
  });

  // 2. one volume for the whole crown: dark underside and shade on the right, light upper left
  const volume = (paint) => () => {
    const bb = G.bb;
    const w = bb.x1 - bb.x0;
    const h = bb.y1 - bb.y0;
    ctx.save();
    unionPath(ctx, G.polyB);
    ctx.clip();
    paint(bb, w, h);
    ctx.restore();
  };
  const wholeBox = (bb, w, h) => ctx.fillRect(bb.x0 - 3, bb.y0 - 3, w + 6, h + 6);
  steps.push(
    volume((bb, w, h) => {
      const g = ctx.createLinearGradient(0, bb.y0, 0, bb.y1);
      g.addColorStop(0, rgba(pal.mid, 0));
      g.addColorStop(0.42, rgba(pal.mid, 0));
      g.addColorStop(0.78, rgba(pal.mid, 0.3));
      g.addColorStop(1, rgba(pal.dark, 0.44));
      ctx.fillStyle = g;
      wholeBox(bb, w, h);
    }),
    volume((bb, w, h) => {
      const g = ctx.createLinearGradient(bb.x0 + w * 0.45, 0, bb.x1, 0);
      g.addColorStop(0, rgba(pal.dark, 0));
      g.addColorStop(1, rgba(pal.dark, 0.2));
      ctx.fillStyle = g;
      wholeBox(bb, w, h);
    }),
    volume((bb, w, h) => {
      const gx = bb.x0 + w * 0.3;
      const gy = bb.y0 + h * 0.24;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, w * 0.5);
      g.addColorStop(0, rgba(pal.lite, 0.4));
      g.addColorStop(1, rgba(pal.lite, 0));
      ctx.fillStyle = g;
      wholeBox(bb, w, h);
    }),
  );

  // 3. darker pooled edge only along the outer silhouette, strongest on the shade side (three widths, one step each)
  const rim = { buckets: null };
  steps.push(() => {
    const buckets = [new Path2D(), new Path2D(), new Path2D()];
    vis.forEach((l, i) => {
      const P = G.polyA[i];
      const O = G.outer[i];
      for (let k = 0; k < P.length - 1; k++) {
        if (!O[k] || !O[k + 1]) continue;
        const a = P[k];
        const b = P[k + 1];
        const s = shadeSide(G, (a.x + b.x) / 2, (a.y + b.y) / 2);
        const B = buckets[s < -0.15 ? 0 : s < 0.35 ? 1 : 2];
        B.moveTo(a.x, a.y);
        B.lineTo(b.x, b.y);
      }
    });
    rim.buckets = buckets;
  });
  for (const [wd, f] of [[6, 0.45], [3.4, 0.7], [1.6, 1]]) {
    steps.push(() => {
      ctx.save();
      unionPath(ctx, G.polyA);
      ctx.clip();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = wd;
      const al = [0.07, 0.14, 0.26];
      rim.buckets.forEach((B, q) => {
        ctx.strokeStyle = rgba(pal.dark, al[q] * f * (0.7 + 0.3 * v));
        ctx.stroke(B);
      });
      ctx.restore();
    });
  }

  // 4. form per clump (shade lower right, light upper left), clipped to the crown so no clump rims show outside
  chunks(
    vis.length,
    (i0, i1) => {
      const rng = mulberry(sd ^ 0x51ab ^ (i0 * 131));
      ctx.save();
      unionPath(ctx, G.polyB);
      ctx.clip();
      for (let i = i0; i < i1; i++) shadeLobe(ctx, G, i, pal, rng);
      ctx.restore();
    },
    2,
  );

  // 5. a few deep accents in the interior
  const innerLobes = vis.map((l, i) => i).filter((i) => vis[i].ring < 0.95);
  const nAccent = Math.min(innerLobes.length, 2 + m.stage);
  [0, 1].forEach((half) => steps.push(() => {
    const rng = mulberry(sd ^ 0x77d1 ^ (half * 4093));
    const inner = innerLobes;
    ctx.save();
    unionPath(ctx, G.polyB);
    ctx.clip();
    for (let q = half; q < nAccent; q += 2) {
      const l = vis[inner[Math.floor(rng() * inner.length)]];
      const x = l.x + l.rx * rr(rng, 0.1, 0.45);
      const y = l.y + l.ry * rr(rng, 0.2, 0.55);
      const r = rr(rng, 5, 10) * (0.75 + 0.08 * m.stage);
      wash(ctx, blobPoly(x, y, r * 1.3, r * 0.8, sd + q * 7, { n: 9, jitter: 0.25, rot: rr(rng, -0.4, 0.4) }), { color: pal.dark, alpha: 0.42, layers: 2, ragged: 2.2, edge: 0, seed: sd + q });
    }
    ctx.restore();
  }));

  // 6. leaf clusters and stipple, clustered on the shade side
  chunks(vis.length, (i0, i1) => {
    const rng = mulberry(sd ^ 0x2e11 ^ (i0 * 977));
    for (let i = i0; i < i1; i++) leafMarks(ctx, G, i, pal, rng, lobeSeed(i) + 10, v);
  }, 2);

  // 7. small gaps where limbs show through the leaves, only once an ailing crown thins out (a full crown reads
  // better closed: at game scale the little windows looked like cut-outs)
  steps.push(() => {
    if (v >= 0.5) return;
    const rng = mulberry(sd ^ 0x9a3f);
    G.holes = pickHoles(G, m, v, rng);
    G.holes.forEach((h, q) => paintHole(ctx, h, pal, rng, sd + 400 + q * 11));
  });

  // 8. ink scalloped contour on parts of the outer silhouette only (the lit upper left stays unfinished)
  chunks(vis.length, (i0, i1) => {
    const rng = mulberry(sd ^ 0x4c07 ^ (i0 * 313));
    for (let i = i0; i < i1; i++) {
      const P = G.polyA[i];
      const O = G.outer[i];
      let run = [];
      const flush = () => {
        if (run.length >= 3 && rng() < 0.84) inkStroke(ctx, run, { w: 1.1 * rr(rng, 0.8, 1.15), color: pal.ink, alpha: 0.62 + 0.3 * v, taperStart: 0.25, taperEnd: 0.35, tremor: 0.25, seed: lobeSeed(i) + run.length, step: 1.6, smooth: false });
        run = [];
      };
      for (let k = 0; k < P.length; k++) {
        if (!O[k]) flush();
        else if (shadeSide(G, P[k].x, P[k].y) < -0.5 && rng() < 0.5) flush();
        else run.push(P[k]);
      }
      flush();
    }
  });
  // paper tooth / granulation: granulate() restricted to the crown and split into bands (the pattern fill is the costly part)
  steps.push(() => cpuToothTile());
  const BANDS = 6;
  for (let band = 0; band < BANDS; band++) {
    steps.push(() => {
      const T = ctx.getTransform();
      const bb = G.bb;
      const x0 = Math.max(0, Math.floor(T.a * bb.x0 + T.e) - 2);
      const x1 = Math.min(W, Math.ceil(T.a * bb.x1 + T.e) + 2);
      const y0 = Math.max(0, Math.floor(T.d * bb.y0 + T.f) - 2);
      const y1 = Math.min(H, Math.ceil(T.d * bb.y1 + T.f) + 2);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      const tile = cpuToothTile();
      const S = tile.width;
      const ya = y0 + Math.floor(((y1 - y0) * band) / BANDS);
      const yb = y0 + Math.floor(((y1 - y0) * (band + 1)) / BANDS);
      // tiles are laid on the canvas origin, like a repeating pattern, and blitted whole (much cheaper than a pattern shader)
      for (let ty = Math.floor(ya / S); ty * S < yb; ty++) {
        for (let tx = Math.floor(x0 / S); tx * S < x1; tx++) {
          const dx0 = Math.max(x0, tx * S);
          const dx1 = Math.min(x1, tx * S + S);
          const dy0 = Math.max(ya, ty * S);
          const dy1 = Math.min(yb, ty * S + S);
          if (dx1 > dx0 && dy1 > dy0) ctx.drawImage(tile, dx0 - tx * S, dy0 - ty * S, dx1 - dx0, dy1 - dy0, dx0, dy0, dx1 - dx0, dy1 - dy0);
        }
      }
      ctx.restore();
    });
  }
  return steps;
}

function inkLimbOver(ctx, limb, alpha) {
  if (limb.pts.length < 2) return;
  const rb = ribbon(limb.pts, limb.w.map((w) => w * 0.9), 5, 0.2);
  fillBand(ctx, rb.L, rb.R, '#33251b', alpha);
}

const LEAF_TINT = (pal, rng) => {
  const r = rng();
  return r < 0.35 ? pal.lite : r < 0.75 ? pal.base : pal.mid;
};

function leafShape(ctx, x, y, ang, len, wid) {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const tx = x + ca * len;
  const ty = y + sa * len;
  const c1x = x + ca * len * 0.45 - sa * wid;
  const c1y = y + sa * len * 0.45 + ca * wid;
  const c2x = x + ca * len * 0.45 + sa * wid;
  const c2y = y + sa * len * 0.45 - ca * wid;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(c1x, c1y, tx, ty);
  ctx.quadraticCurveTo(c2x, c2y, x, y);
}

function birchLobeSteps(ctx, l, lobes, pal, rng, seed, v, sz) {
  const poly = blobPoly(l.x, l.y, l.rx, l.ry, seed, { n: 12, jitter: 0.14, rot: l.rot });
  return [
    () => {
  wash(ctx, poly, { color: mix(pal.base, pal.lite, 0.5 * (1 - l.k)), alpha: 0.34, layers: 2, ragged: 2.2, edge: 0.35, edgeW: 1, seed, rimColor: pal.dark });
  wash(ctx, crescent(l, 0.1 * Math.PI, 0.88 * Math.PI, 0.45), { color: pal.mid, alpha: 0.3, layers: 1, ragged: 1.5, edge: 0.1, seed: seed + 3 });
    },
    () => {
  const nLeaves = Math.round(clamp((l.rx * l.ry) / 55, 6, 40) * (0.55 + 0.45 * v));
  ctx.lineWidth = 0.5;
  for (let i = 0; i < nLeaves; i++) {
    const a = rng() * TAU;
    const d = Math.pow(rng(), 0.55);
    const x = l.x + Math.cos(a) * l.rx * d;
    const y = l.y + Math.sin(a) * l.ry * d;
    const ang = Math.PI / 2 + rr(rng, -1.15, 1.15) + (x - l.x) * 0.004;
    const len = rr(rng, 6, 9.5) * sz;
    const lowSide = (y - l.y) / l.ry;
    const col = mix(LEAF_TINT(pal, rng), pal.dark, clamp(lowSide * 0.35, 0, 0.35));
    leafShape(ctx, x, y, ang, len, len * 0.34);
    ctx.fillStyle = rgba(col, 0.78);
    ctx.fill();
    ctx.strokeStyle = rgba(pal.ink, 0.5);
    ctx.stroke();
  }
    },
    () => {
  scribbles(ctx, l, pal, rng, seed + 10, Math.round(2 + l.rx / 9), 0.42);
  stipple(ctx, poly, { count: Math.round(l.rx * 0.4), color: pal.dark, alpha: 0.4, rMin: 0.3, rMax: 0.7, seed: seed + 6 });
    },
  ];
}

function fringeStroke(ctx, f, pal, rng, seed, v, sz) {
  inkStroke(ctx, f.pts, { w: 0.75, color: mix(pal.ink, SEP, 0.4), alpha: 0.65, taperStart: 0.1, taperEnd: 0.6, tremor: 0.12, seed, step: 2 });
  const n = 3;
  ctx.lineWidth = 0.45;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.4 + rng() * 0.4) / n;
    const p = f.pts[Math.min(f.pts.length - 1, Math.round(t * (f.pts.length - 1)))];
    const ang = Math.PI / 2 + rr(rng, -0.7, 0.7);
    const len = rr(rng, 6, 9) * sz;
    leafShape(ctx, p.x, p.y, ang, len, len * 0.34);
    ctx.fillStyle = rgba(LEAF_TINT(pal, rng), 0.82);
    ctx.fill();
    ctx.strokeStyle = rgba(pal.ink, 0.5);
    ctx.stroke();
  }
}

/** Spring: a birch catkin hanging from the tip of a drooping twig, ochre with a pen outline. */
function catkin(ctx, pts, rng, seed) {
  if (rng() > 0.45) return;
  const e = pts[pts.length - 1];
  const x = e.x + rr(rng, -1.5, 1.5);
  const y = e.y + 0.5;
  const ln = rr(rng, 4.5, 6.5);
  inkStroke(ctx, [{ x, y }, { x: x + 0.4, y: y + ln * 0.5 }, { x: x + 0.2, y: y + ln }], { w: 1.9, color: '#cfaa4a', alpha: 0.92, taperStart: 0.15, taperEnd: 0.5, tremor: 0.08, seed, step: 1.5 });
  inkStroke(ctx, [{ x: x - 0.9, y: y + 0.4 }, { x: x - 0.7, y: y + ln * 0.6 }, { x, y: y + ln + 0.4 }], { w: 0.5, color: '#4a3418', alpha: 0.7, taperStart: 0.2, taperEnd: 0.5, tremor: 0.08, seed: seed + 5, step: 1.5 });
}

function pineTuft(ctx, t, pal, rng, seed, v, sz, snow = false) {
  const rx = t.r * 1.7;
  const ry = t.r * 0.78;
  const droop = (1 - v) * 0.35;
  const cx = t.x;
  const cy = t.y + (1 - v) * 3;
  const rot = t.leader ? Math.PI / 2 - 0.1 : clamp(t.ang, -1.3, 1.3) * 0.4 + (Math.cos(t.ang) < 0 ? 0 : 0);
  const poly = blobPoly(cx, cy, t.leader ? t.r * 0.9 : rx, t.leader ? t.r * 1.6 : ry, seed, { n: 11, jitter: 0.22, rot: t.leader ? 0 : rot });
  const tone = t.k;
  if (!t.leader) wash(ctx, poly, { color: mix(pal.base, tone < 0.5 ? pal.lite : pal.mid, Math.abs(tone - 0.5) * 0.6), alpha: 0.46, layers: 2, ragged: 1.6, edge: 0.4, edgeW: 1.1, seed, rimColor: pal.dark });
  if (!t.leader) {
    wash(ctx, blobPoly(cx + t.r * 0.1, cy + ry * 0.5, rx * 0.85, ry * 0.42, seed + 3, { n: 9, jitter: 0.2, rot }), { color: pal.dark, alpha: 0.42, layers: 1, ragged: 1.4, edge: 0, seed: seed + 3 });
    wash(ctx, blobPoly(cx - rx * 0.2, cy - ry * 0.4, rx * 0.5, ry * 0.3, seed + 5, { n: 8, jitter: 0.2, rot }), { color: pal.lite, alpha: 0.32, layers: 1, ragged: 1.2, edge: 0, seed: seed + 5 });
  }
  // needles: fans radiating away from the branch axis
  const nN = Math.round(clamp(t.r * 4, 12, 44));
  const dir = t.leader ? -Math.PI / 2 : t.ang;
  const passes = [
    { col: rgba(pal.ink, 0.62), w: 0.6, n: nN },
    { col: rgba(pal.dark, 0.5), w: 0.55, n: Math.round(nN * 0.6) },
    { col: rgba(pal.lite, 0.65), w: 0.5, n: Math.round(nN * 0.4) },
  ];
  for (let p = 0; p < passes.length; p++) {
    ctx.beginPath();
    for (let i = 0; i < passes[p].n; i++) {
      const along = rr(rng, -rx * 0.9, rx * 0.9);
      const off = rr(rng, -ry * 0.4, ry * 0.4);
      const ox = cx + Math.cos(dir) * along - Math.sin(dir) * off;
      const oy = cy + Math.sin(dir) * along + Math.cos(dir) * off;
      const up = rng() < (p === 2 ? 0.8 : 0.4);
      const side = t.leader ? (rng() < 0.5 ? -1 : 1) : up ? -1 : 1;
      let a = t.leader ? dir + side * rr(rng, 0.1, 0.9) : dir + side * (Math.PI / 2) * rr(rng, 0.45, 0.95) + (side > 0 ? droop * 0.5 : 0);
      if (!t.leader && Math.cos(dir) < 0) a = dir - side * (Math.PI / 2) * rr(rng, 0.45, 0.95) + (side > 0 ? 0 : 0);
      if (!t.leader) a += (Math.PI / 2 - a > 0 ? 1 : -1) * 0; // keep
      const len = rr(rng, 5.5, 11.5) * sz * (t.leader ? 0.8 : 1);
      ctx.moveTo(ox, oy);
      ctx.quadraticCurveTo(ox + Math.cos(a) * len * 0.6 + Math.cos(dir) * 1.2, oy + Math.sin(a) * len * 0.6 + 0.8, ox + Math.cos(a) * len, oy + Math.sin(a) * len + (side > 0 ? 1 : 0));
    }
    ctx.strokeStyle = passes[p].col;
    ctx.lineWidth = passes[p].w;
    ctx.stroke();
  }
  if (snow) pineSnow(ctx, t, cx, cy, rx, ry, rot, seed);
}

/** Winter: a white wash cap on the upper side of a tuft over a pale blue-grey shade, with a few pale pen strokes. */
function pineSnow(ctx, t, cx, cy, rx, ry, rot, seed) {
  const rng = mulberry(seed ^ 0x5a07);
  if (t.leader) {
    const r = t.r;
    wash(ctx, blobPoly(cx - r * 0.05, cy - r * 0.45, r * 0.6, r * 0.75, seed + 21, { n: 9, jitter: 0.25 }), { color: '#a9bccb', alpha: 0.4, layers: 1, ragged: 1.6, edge: 0, seed: seed + 21 });
    wash(ctx, blobPoly(cx - r * 0.1, cy - r * 0.62, r * 0.4, r * 0.55, seed + 22, { n: 9, jitter: 0.3 }), { color: '#fbfdff', alpha: 0.88, layers: 2, ragged: 1.8, edge: 0, seed: seed + 22 });
    for (let i = 0; i < 5; i++) {
      const x = cx + rr(rng, -0.4, 0.3) * r;
      const y = cy - r * rr(rng, 0.2, 0.7);
      const a = -Math.PI / 2 + rr(rng, -1, 1);
      inkStroke(ctx, [{ x, y }, { x: x + Math.cos(a) * 4, y: y + Math.sin(a) * 4 }], { w: 0.55, color: '#1c3b3c', alpha: 0.55, taperStart: 0.1, taperEnd: 0.6, tremor: 0.05, seed: seed + 50 + i, step: 2, smooth: false });
    }
    return;
  }
  const sh = rr(rng, 0.45, 0.62); // how much of the tuft the snow covers
  const off = rr(rng, -0.25, 0.25) * rx;
  wash(ctx, blobPoly(cx + off + rx * 0.04, cy - ry * 0.3, rx * (sh + 0.12), ry * 0.36, seed + 21, { n: 10, jitter: 0.28, rot }), { color: '#a9bccb', alpha: 0.42, layers: 1, ragged: 1.8, edge: 0, seed: seed + 21 });
  wash(ctx, blobPoly(cx + off - rx * 0.03, cy - ry * 0.48, rx * sh, ry * 0.27, seed + 22, { n: 10, jitter: 0.3, rot }), { color: '#fbfdff', alpha: 0.9, layers: 2, ragged: 1.9, edge: 0, seed: seed + 22 });
  // a few needles poking through the snow
  for (let i = 0; i < 7; i++) {
    const x = cx + off + rr(rng, -sh, sh) * rx * 0.9;
    const y = cy - ry * rr(rng, 0.38, 0.62);
    const a = -Math.PI / 2 + rr(rng, -0.9, 0.9);
    const ln = rr(rng, 3, 6);
    inkStroke(ctx, [{ x, y }, { x: x + Math.cos(a) * ln, y: y + Math.sin(a) * ln }], { w: 0.55, color: '#1c3b3c', alpha: 0.55, taperStart: 0.1, taperEnd: 0.6, tremor: 0.05, seed: seed + 40 + i, step: 2, smooth: false });
  }
  for (let i = 0; i < 3; i++) {
    const a = rr(rng, -0.7, 0.7) * rx;
    const y = cy - ry * rr(rng, 0.45, 0.9);
    const ln = rr(rng, 5, 10);
    inkStroke(ctx, [{ x: cx + a - ln, y: y + 0.6 }, { x: cx + a, y: y - 0.6 }, { x: cx + a + ln, y: y + 0.5 }], { w: 0.9, color: '#eef4f8', alpha: 0.8, taperStart: 0.3, taperEnd: 0.4, tremor: 0.15, seed: seed + 30 + i, step: 2 });
  }
}

/* ------------------------------------------------------------------ winter: bare crowns */

/** Radius of a (rotated) lobe ellipse in direction `a`. */
function lobeReach(l, a) {
  const c = Math.cos(a - l.rot);
  const s = Math.sin(a - l.rot);
  return (l.rx * l.ry) / Math.hypot(l.ry * c, l.rx * s);
}

function inLobe(l, x, y, k) {
  const c = Math.cos(l.rot);
  const s = Math.sin(l.rot);
  const dx = x - l.x;
  const dy = y - l.y;
  const u = (dx * c + dy * s) / l.rx;
  const w = (-dx * s + dy * c) / l.ry;
  return u * u + w * w <= k * k;
}

const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const droopPull = (a, k) => (k ? Math.atan2(Math.sin(a) + k, Math.cos(a)) : a);

/**
 * Where each lobe of the (former) crown is fed from: the nearest point on the skeleton (trunk, limbs, boughs made so far),
 * preferring points below the lobe. Lobes nearest the trunk top go first so the farther ones branch off their boughs.
 */
function planBare(m, vis, oak) {
  const anchors = [];
  const addAnchors = (limb, f0, f1) => {
    const n = limb.pts.length;
    for (let i = Math.floor((n - 1) * f0); i <= Math.ceil((n - 1) * f1) && i < n; i += 2) {
      const a = limb.pts[Math.max(0, i - 1)];
      const b = limb.pts[Math.min(n - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      anchors.push({ x: limb.pts[i].x, y: limb.pts[i].y, w: limb.w[i], tx: (b.x - a.x) / l, ty: (b.y - a.y) / l }); // tx, ty: heading towards the tip
    }
  };
  addAnchors(m.trunk, 0.6, 1);
  for (const L of m.limbs) if (L.pts.length > 2) addAnchors(L, 0.3, 1);
  const top = m.trunk.pts[m.trunk.pts.length - 1];
  const order = vis.map((l, i) => i).sort((a, b) => Math.hypot(vis[a].x - top.x, vis[a].y - top.y) - Math.hypot(vis[b].x - top.x, vis[b].y - top.y));
  const rng = mulberry(m.seed ^ 0x6b0b ^ (m.stage * 211));
  const boughs = [];
  const infos = new Array(vis.length);
  if (oak && m.stage <= 2 && vis.length) {
    // the trunk ends in a flat cut that foliage normally hides: carry it on up to the middle of the crown
    const tw = m.trunk.w[m.trunk.w.length - 1];
    let tg = vis[0];
    let bs = Infinity;
    for (const l of vis) {
      const sc = Math.hypot(l.x - top.x, l.y - (top.y - 35));
      if (sc < bs) {
        bs = sc;
        tg = l;
      }
    }
    const len = Math.hypot(tg.x - top.x, tg.y - top.y);
    if (len > 8) {
      const bend = rr(rng, 0.05, 0.12) * (rng() < 0.5 ? 1 : -1);
      const mid = { x: (top.x + tg.x) / 2 - ((tg.y - top.y) / len) * len * bend, y: (top.y + tg.y) / 2 + ((tg.x - top.x) / len) * len * bend };
      const B = makeLimb([{ x: top.x, y: top.y }, mid, { x: tg.x, y: tg.y }], Math.max(1.8, tw * 0.95), Math.max(1.4, tw * 0.3), { step: 3, pow: 1.5 });
      B.depth = 2;
      boughs.push(B);
      addAnchors(B, 0.3, 0.8);
    }
  }
  for (const i of order) {
    const l = vis[i];
    let best = null;
    let bd = Infinity;
    for (const a of anchors) {
      const dl = Math.hypot(l.x - a.x, l.y - a.y) || 1;
      // a bough leaves its parent forwards, not back along it: sideways costs more, backwards most
      let d = dl * (1 + 0.6 * (1 - ((l.x - a.x) * a.tx + (l.y - a.y) * a.ty) / dl));
      if (a.y < l.y) d += 0.7 * (l.y - a.y);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    const A = best || top;
    const len = Math.hypot(l.x - A.x, l.y - A.y);
    infos[i] = { l, i, back: Math.atan2(A.y - l.y, A.x - l.x) };
    if (len < 6) continue;
    const bend = rr(rng, 0.06, 0.2) * (rng() < 0.5 ? 1 : -1);
    const nx = -(l.y - A.y) / len;
    const ny = (l.x - A.x) / len;
    const mid = { x: (A.x + l.x) / 2 + nx * len * bend, y: (A.y + l.y) / 2 + ny * len * bend - (oak ? len * 0.05 : 0) };
    const R = Math.sqrt(l.rx * l.ry);
    const w0 = oak ? clamp(Math.min(A.w * 0.9, R * 0.24 + 0.8), 1.7, 9) : clamp(Math.min(A.w * 0.8, 1.7), 0.9, 1.7);
    const w1 = oak ? clamp(w0 * 0.34, 1.2, 2.2) : 0.7;
    const B = makeLimb([{ x: A.x, y: A.y }, mid, { x: l.x, y: l.y }], w0, w1, { step: 3, pow: 0.8 });
    B.depth = 2;
    boughs.push(B);
    addAnchors(B, 0.3, 0.8);
  }
  return { boughs, infos };
}

/** Thin flat strips of snow along the upper side of a limb, broken by gaps and left off the steep stretches. */
function snowOnLimb(ctx, limb, rng, seed) {
  const P = limb.pts;
  const n = P.length;
  if (n < 5) return;
  let i = 1 + Math.floor(rng() * 2);
  let q = 0;
  while (i < n - 2) {
    const j = Math.min(n - 2, i + 3 + Math.floor(rng() * 6));
    const up = [];
    const dn = [];
    let steep = 0;
    let hw = 0;
    for (let k = i; k <= j; k++) {
      const a = P[k - 1];
      const b = P[k + 1];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      let nx = -dy;
      let ny = dx;
      if (ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      const h = Math.max(0.3, limb.w[k] * 0.5);
      hw += h;
      steep += Math.abs(dy);
      up.push({ x: P[k].x + nx * h * 0.82, y: P[k].y + ny * h * 0.82 - 0.3 });
      dn.push({ x: P[k].x + nx * h * 0.3, y: P[k].y + ny * h * 0.3 + 0.2 });
    }
    const cnt = j - i + 1;
    if (cnt >= 3 && steep / cnt < 0.8) {
      hw /= cnt;
      inkStroke(ctx, dn, { w: clamp(hw * 1.1, 0.9, 3.4), color: '#9eb1c6', alpha: 0.5, taperStart: 0.3, taperEnd: 0.4, tremor: 0.1, press: 0.2, seed: seed + q, step: 2 });
      inkStroke(ctx, up, { w: clamp(hw * 1.05, 1.1, 3.6), color: '#ffffff', alpha: 0.92, taperStart: 0.3, taperEnd: 0.4, tremor: 0.1, press: 0.2, seed: seed + 70 + q, step: 2 });
    }
    q++;
    i = j + 1 + Math.floor(rng() * 4);
  }
}

/**
 * Winter oak and birch: no leaf wash. Boughs lead from the skeleton to every former lobe, where fine twigs fork two or
 * three times out to the rim of the lobe; limbs and forks carry a little snow.
 */
function bareCrownSteps(ctx, m, vis, pal, v, oak) {
  const steps = [];
  const sd = m.seed;
  const sp = oak ? 'oak' : 'birch';
  const { boughs, infos } = planBare(m, vis, oak);
  // boughs: thin ones first so the thick ones lie over their bases (same order as the trunk sprite)
  const bs = boughs.slice().sort((a, b) => a.w0 - b.w0);
  const brng = mulberry(sd ^ 0x2d9b);
  bs.forEach((B, k) => steps.push(...limbSteps(ctx, B, sp, brng, sd + 8100 + 17 * k)));

  // the cut ends of the model limbs (hidden by leaves in summer) run on into a short tapering twig
  const tipRng = mulberry(sd ^ 0x71b5);
  steps.push(() => {
    for (const L of m.limbs) {
      const n = L.pts.length;
      if (n < 3 || L.w[n - 1] < 0.7) continue;
      const e = L.pts[n - 1];
      const b = L.pts[n - 3];
      const a = Math.atan2(e.y - b.y, e.x - b.x);
      const ln = rr(tipRng, 7, 13);
      const mid = { x: e.x + Math.cos(a + 0.15) * ln * 0.5, y: e.y + Math.sin(a + 0.15) * ln * 0.5 };
      inkStroke(ctx, [{ x: e.x - Math.cos(a), y: e.y - Math.sin(a) }, mid, { x: e.x + Math.cos(a - 0.1) * ln, y: e.y + Math.sin(a - 0.1) * ln }], { w: L.w[n - 1] * 1.05, color: '#3f2e22', alpha: 0.95, taperStart: 0, taperEnd: 0.9, tremor: 0.1, press: 0.1, seed: sd + 7000 + n, step: 2 });
    }
  });

  const cells = new Map();
  const o = oak
    ? { levels: m.stage >= 3 ? 4 : m.stage >= 1 ? 3 : 2, n0: m.stage >= 2 ? 4 : 3, f: [0.4, 0.32, 0.27, 0.22], w0: m.stage >= 2 ? 2 : 1.4, droop: 0, dab: 0.2, alpha: 0.9 }
    : { levels: 2, n0: 3, f: [0.5, 0.42, 0.3], w0: 1.05, droop: 0.4, dab: 0.12, alpha: 0.85 };
  const tw = (l, x, y, ang, len, w, level, rng, seed) => {
    let ex = 0;
    let ey = 0;
    let ok = false;
    for (let tr = 0; tr < 2 && !ok; tr++) {
      ex = x + Math.cos(ang) * len;
      ey = y + Math.sin(ang) * len;
      ok = inLobe(l, ex, ey, 1.08);
      if (!ok) len *= 0.6;
    }
    if (!ok) return;
    const key = Math.floor(ex / 3) * 10007 + Math.floor(ey / 3);
    const c = cells.get(key) || 0;
    if (c >= 2) return;
    cells.set(key, c + 1);
    const bend = rr(rng, -0.16, 0.16) * len;
    const mid = { x: (x + ex) / 2 - Math.sin(ang) * bend, y: (y + ey) / 2 + Math.cos(ang) * bend };
    inkStroke(ctx, [{ x, y }, mid, { x: ex, y: ey }], { w, color: pal.ink, alpha: o.alpha, taperStart: 0.1, taperEnd: 0.6, tremor: 0.12, press: 0.2, seed, step: 2 });
    if (level >= 1 && rng() < o.dab) {
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.beginPath();
      ctx.ellipse(x, y - 0.5, rr(rng, 0.8, 1.4), rr(rng, 0.5, 0.9), 0, 0, TAU);
      ctx.fill();
    }
    if (level + 1 >= o.levels) return;
    // the first child carries on, the others branch off to alternating sides and are shorter
    const nc = level === 0 && rng() < 0.3 ? 3 : 2;
    const spread = rr(rng, 0.5, 0.95);
    const sgn = rng() < 0.5 ? 1 : -1;
    for (let k = 0; k < nc; k++) {
      const da = k === 0 ? rr(rng, -0.25, 0.25) : (k === 1 ? sgn : -sgn) * spread;
      const a = droopPull(ang + da, o.droop * 0.5);
      tw(l, ex, ey, a, o.f[level + 1] * lobeReach(l, a) * (k === 0 ? 1 : k === 1 ? 0.75 : 0.6) * rr(rng, 0.85, 1.1), w * (k === 0 ? 0.68 : 0.55), level + 1, rng, seed + 3 * (k + 1));
    }
  };
  const per = oak ? 2 : 3;
  for (let i0 = 0; i0 < infos.length; i0 += per) {
    steps.push(() => {
      const rng = mulberry(sd ^ 0x7b3d ^ (i0 * 977));
      for (let i = i0; i < Math.min(infos.length, i0 + per); i++) {
        const f = infos[i];
        if (!f) continue;
        const l = f.l;
        const base = rng() * TAU;
        let placed = 0;
        for (let k = 0; k < o.n0; k++) {
          const a = droopPull(base + (k * TAU) / o.n0 + rr(rng, -0.35, 0.35), o.droop * 0.5);
          if (o.n0 > 2 && angDiff(a, f.back) < 0.55 && placed + (o.n0 - k - 1) >= 2) continue;
          placed++;
          tw(l, l.x, l.y, a, o.f[0] * lobeReach(l, a) * rr(rng, 0.85, 1.15), o.w0, 0, rng, sd + 400 * (i + 1) + 11 * k);
        }
      }
    });
  }

  if (!oak) {
    // the drooping birch twigs, bare
    const fr = m.fringe || [];
    const sparse = 0.3 + 0.7 * v;
    const frng = mulberry(sd ^ 0x44f1);
    for (let i = 0; i < fr.length; i += 8) {
      const chunk = fr.slice(i, i + 8);
      steps.push(() =>
        chunk.forEach((f, q) => {
          if (frng() > 0.35 + 0.65 * sparse) return;
          const pts = f.pts.map((p, k) => ({ x: p.x, y: p.y + (1 - v) * 3 * k }));
          inkStroke(ctx, pts, { w: 0.8, color: pal.ink, alpha: 0.75, taperStart: 0.1, taperEnd: 0.6, tremor: 0.12, seed: sd + 900 + i + q, step: 2 });
          const e = pts[pts.length - 1];
          const b = pts[pts.length - 2];
          const ang = Math.atan2(e.y - b.y, e.x - b.x);
          for (const s of [-1, 1]) {
            const ln = rr(frng, 3.5, 6.5);
            inkStroke(ctx, [{ x: e.x, y: e.y }, { x: e.x + Math.cos(ang + s * 0.6) * ln, y: e.y + Math.sin(ang + s * 0.6) * ln }], { w: 0.5, color: pal.ink, alpha: 0.65, taperStart: 0.1, taperEnd: 0.7, tremor: 0.1, seed: sd + 950 + i + q + s, step: 2, smooth: false });
          }
        }),
      );
    }
  }

  // snow on the heavier limbs (model limbs and boughs alike)
  const thr = oak ? 2.4 : 1.5;
  const bearing = m.limbs.filter((L) => L.w0 >= thr).concat(boughs.filter((B) => B.w0 >= thr));
  const srng = mulberry(sd ^ 0x5e0f);
  for (let i = 0; i < bearing.length; i += 4) {
    const chunk = bearing.slice(i, i + 4);
    steps.push(() => chunk.forEach((L, q) => snowOnLimb(ctx, L, srng, sd + 6000 + 131 * (i + q))));
  }
  return steps;
}

/** The lobes of a leafy crown that are drawn at vitality v (sparser and drooping when weak), sorted from the top down. */
function visibleLobes(m, v) {
  const sparse = 0.3 + 0.7 * v;
  const vis = m.lobes
    .filter((l) => (l.ring === 1 && v > 0.25) || l.k <= sparse + 0.04 || l.ring < 0.3)
    .map((l) => {
      const dx = (l.x - m.cx) / (m.rx || 1);
      const droop = (1 - v) * (m.H * 0.05) * (0.3 + Math.abs(dx));
      const sc = 0.88 + 0.12 * v;
      return { ...l, y: l.y + droop, rx: l.rx * sc, ry: l.ry * (sc + (1 - v) * 0.1) };
    });
  vis.sort((a, b) => a.y - b.y);
  return vis;
}

/**
 * Crown painting as an ordered list of steps (vitality v in 0..1; W, H = canvas size in device px for granulation).
 * `season` (optional): 'spring' | 'summer' | 'autumn' | 'winter'; undefined and 'summer' paint the original crown.
 */
export function crownSteps(ctx, m, v, W, H, season) {
  const steps = [];
  const rng = mulberry(m.seed ^ 0x3c91 ^ (m.stage * 4421));
  const sp = m.species;
  const ss = paintSeason(season);
  const pal = palette(sp, v, ss);
  const sz = (0.7 + 0.1 * m.stage) * (ss === 'spring' ? 0.82 : 1); // young leaves are small
  const sparse = 0.3 + 0.7 * v;

  if (sp === 'pine') {
    const keep = m.tufts.filter((t) => t.leader || t.k <= sparse + 0.04);
    keep.sort((a, b) => a.y - b.y);
    const seq = keep.filter((t) => !t.front).concat(keep.filter((t) => t.front));
    for (let i = 0; i < seq.length; i += 2) {
      const chunk = seq.slice(i, i + 2);
      steps.push(() => chunk.forEach((t, q) => pineTuft(ctx, t, pal, rng, m.seed + 7 * (i + q + 1), v, sz, ss === 'winter')));
    }
  } else {
    const vis = visibleLobes(m, v);
    if (ss === 'winter') return bareCrownSteps(ctx, m, vis, pal, v, sp === 'oak');
    if (sp === 'oak') steps.push(...oakCrownSteps(ctx, m, vis, pal, v, W, H, ss === 'spring'));
    else vis.forEach((l, idx) => steps.push(...birchLobeSteps(ctx, l, vis, pal, rng, m.seed + 13 * (idx + 1), v, sz)));
    if (sp === 'birch') {
      const fr = m.fringe || [];
      const crng = mulberry(m.seed ^ 0xca7); // catkins draw from their own stream, the leaf stream stays as it is
      for (let i = 0; i < fr.length; i += 8) {
        const chunk = fr.slice(i, i + 8);
        steps.push(() =>
          chunk.forEach((f, q) => {
            if (rng() > 0.35 + 0.65 * sparse) return;
            const droopPts = f.pts.map((p, k) => ({ x: p.x, y: p.y + (1 - v) * 3 * k }));
            fringeStroke(ctx, { pts: droopPts }, pal, rng, m.seed + 900 + i + q, v, sz);
            if (ss === 'spring') catkin(ctx, droopPts, crng, m.seed + 1300 + i + q);
          }),
        );
      }
    }
    // fallen / dying leaves for a weak tree
    if (v < 0.6) {
      steps.push(() => {
        const n = Math.round((0.6 - v) * 40);
        for (let q = 0; q < n; q++) {
          const l = vis[Math.floor(rng() * vis.length)];
          if (!l) break;
          const x = l.x + rr(rng, -1, 1) * l.rx;
          const y = l.y + l.ry * rr(rng, 0.4, 1.1) + rng() * 10;
          leafShape(ctx, x, y, rr(rng, 0, TAU), rr(rng, 4, 6.5) * sz, 1.8);
          ctx.fillStyle = rgba(mix('#9a7440', '#c9a24a', rng()), 0.7);
          ctx.fill();
        }
      });
    }
  }
  if (sp !== 'oak') steps.push(() => granulate(ctx, W, H, 0.13, 0.5));
  return steps;
}

/* ------------------------------------------------------------------ honey-fungus infection on a crown */

/** The painted crown as ellipses to sample (leafy lobes, or pine tufts), with their summed area. */
function crownShapes(m, v) {
  const list =
    m.species === 'pine'
      ? m.tufts.filter((t) => t.leader || t.k <= 0.3 + 0.7 * v + 0.04).map((t) => ({ x: t.x, y: t.y + (1 - v) * 3, rx: t.r * 1.7, ry: t.r * 0.78, rot: 0 }))
      : visibleLobes(m, v);
  let area = 0;
  for (const l of list) area += Math.PI * l.rx * l.ry;
  return { list, area };
}

/** A random point inside a random shape, shapes weighted by their area. */
function spotIn(shapes, rng) {
  const { list, area } = shapes;
  let u = rng() * area;
  let l = list[list.length - 1];
  for (const c of list) {
    u -= Math.PI * c.rx * c.ry;
    if (u <= 0) {
      l = c;
      break;
    }
  }
  const a = rng() * TAU;
  const r = Math.sqrt(rng()) * 0.92;
  const ex = Math.cos(a) * l.rx * r;
  const ey = Math.sin(a) * l.ry * r;
  const cr = Math.cos(l.rot || 0);
  const sr = Math.sin(l.rot || 0);
  return { x: l.x + ex * cr - ey * sr, y: l.y + ex * sr + ey * cr, l };
}

/** A leaf outline appended to the current path (no beginPath): from (x, y) len along ang. */
function leafOutline(ctx, x, y, ang, len, wid) {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + ca * len * 0.45 - sa * wid, y + sa * len * 0.45 + ca * wid, x + ca * len, y + sa * len);
  ctx.quadraticCurveTo(x + ca * len * 0.45 + sa * wid, y + sa * len * 0.45 - ca * wid, x, y);
}

/**
 * Honey fungus on a painted crown, as extra steps after crownSteps (same contract): a rust wash over the leaves, dark
 * dying patches, dead brown leaves (rusty needle streaks on a pine) and, last, gaps and speckles erased out of the
 * crown so the branches show through. `ib` is the infection bucket (rival-logic infBucket); 0 paints nothing, so a
 * healthy crown stays exactly as it was. Everything is drawn from `m.seed` with streams that do not depend on the
 * bucket, so the speckles of one step are the first speckles of the next. `v` is the vitality the crown was painted with.
 */
export function infectionSteps(ctx, m, ib, v, season, W, H) {
  const P = infectionLook(ib, m.species, season);
  if (!P.active) return [];
  const steps = [];
  const pine = m.species === 'pine';
  const shapes = crownShapes(m, v);
  if (!shapes.list.length) return steps;
  const sc = clamp(Math.sqrt((m.rx || 40) * (m.ry || 40)) / 62, 0.55, 1.2);
  const area = shapes.area * 0.62; // the shapes overlap

  if (P.wash > 0) {
    steps.push(() => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = P.wash;
      ctx.fillStyle = P.color;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    });
  }

  if (P.blotches > 0) {
    steps.push(() => {
      const brng = mulberry(m.seed ^ 0x2b71);
      const dark = pine ? '#6a3a1e' : '#4a2c16';
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      for (let i = 0; i < P.blotches; i++) {
        const p = spotIn(shapes, brng);
        const r = Math.max(10, (m.rx || 40) * rr(brng, 0.2, 0.36));
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, rgba(dark, P.blotchAlpha));
        g.addColorStop(0.6, rgba(dark, P.blotchAlpha * 0.55));
        g.addColorStop(1, rgba(dark, 0));
        ctx.fillStyle = g;
        ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      }
      ctx.restore();
    });
  }

  const nDead = Math.min(260, Math.round((P.dead * area) / 1000));
  if (nDead > 0) {
    const drng = mulberry(m.seed ^ 0x5d1e);
    const tones = pine ? ['#8f4f26', '#a8643a', '#6e3a1e'] : ['#7a4f26', '#9a6a30', '#5b3a1d', '#a87a3a'];
    for (let i = 0; i < nDead; i += 40) {
      const n = Math.min(40, nDead - i);
      steps.push(() => {
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        for (let q = 0; q < n; q++) {
          const p = spotIn(shapes, drng);
          const col = tones[Math.floor(drng() * tones.length)];
          const ang = rr(drng, 0, TAU);
          if (pine) {
            // a streak of dead needles
            const ln = rr(drng, 6, 11) * sc;
            ctx.beginPath();
            for (let k = 0; k < 4; k++) {
              const a = ang + rr(drng, -0.5, 0.5);
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(p.x + Math.cos(a) * ln, p.y + Math.sin(a) * ln);
            }
            ctx.lineWidth = 0.9;
            ctx.strokeStyle = rgba(col, 0.85);
            ctx.stroke();
          } else {
            ctx.beginPath();
            leafOutline(ctx, p.x, p.y, ang, rr(drng, 4.5, 7.5) * sc * (0.7 + 0.1 * m.stage), 1.9 * sc);
            ctx.fillStyle = rgba(col, 0.88);
            ctx.fill();
          }
        }
        ctx.restore();
      });
    }
  }

  // the erased part: dead branch tips without leaves (a gap with a bare twig spray in it), then thin foliage: clusters of
  // small leaf-shaped speckles taken out of the crown
  const gapArea = 190 * sc * sc;
  const nGap = Math.min(40, Math.round((P.cover * 0.45 * area) / gapArea));
  if (nGap > 0) {
    const grng = mulberry(m.seed ^ 0x77c3);
    for (let i = 0; i < nGap; i += 8) {
      const n = Math.min(8, nGap - i);
      steps.push(() => {
        const at = [];
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.beginPath();
        for (let q = 0; q < n; q++) {
          const p = spotIn(shapes, grng);
          const len = rr(grng, 12, 22) * sc;
          const rot = rr(grng, 0.2, 1.3) * (grng() < 0.5 ? -1 : 1); // slanting, either way
          at.push({ x: p.x, y: p.y, len, rot });
          // the leaves along the twig are gone
          for (let k = 0; k < 11; k++) {
            const u = rr(grng, -0.6, 0.6) * len;
            const off = rr(grng, -0.3, 0.3) * len * 0.5;
            leafOutline(ctx, p.x + Math.cos(rot) * u - Math.sin(rot) * off, p.y + Math.sin(rot) * u + Math.cos(rot) * off, rr(grng, 0, TAU), rr(grng, 3.5, 6.2) * sc, rr(grng, 1.3, 2.1) * sc);
          }
        }
        ctx.fill();
        ctx.restore();
        if (P.bare) return; // a bare crown is all twigs already
        at.forEach((g, q) => {
          const ca = Math.cos(g.rot);
          const sa = Math.sin(g.rot);
          const a = { x: g.x - ca * g.len * 0.55, y: g.y - sa * g.len * 0.55 };
          const b = { x: g.x + ca * g.len * 0.05, y: g.y + sa * g.len * 0.05 + 0.6 };
          const e = { x: g.x + ca * g.len * 0.58, y: g.y + sa * g.len * 0.58 + 1.5 };
          const sd = m.seed + 61 * (i + q + 1);
          inkStroke(ctx, [a, b, e], { w: 1, color: '#33210f', alpha: 0.88, taperStart: 0.12, taperEnd: 0.6, tremor: 0.12, seed: sd, step: 2 });
          for (const [f, side] of [[0.45, -1], [0.7, 1]]) {
            const o = { x: lerp(a.x, e.x, f), y: lerp(a.y, e.y, f) };
            const ln = g.len * rr(grng, 0.2, 0.3);
            inkStroke(ctx, [o, { x: o.x + (ca * 0.5 + sa * side * 0.85) * ln, y: o.y + (sa * 0.5 - ca * side * 0.85) * ln }], { w: 0.65, color: '#33210f', alpha: 0.82, taperStart: 0.1, taperEnd: 0.8, tremor: 0.1, seed: sd + f * 10, step: 2 });
          }
        });
      });
    }
  }
  const nSpk = Math.min(600, Math.round((P.cover * 0.55 * area) / (7 * sc * sc)));
  if (nSpk > 0) {
    const srng = mulberry(m.seed ^ 0x39b5);
    for (let i = 0; i < nSpk; i += 60) {
      const n = Math.min(60, nSpk - i);
      steps.push(() => {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        let c = null;
        const leaves = [];
        for (let q = 0; q < n; q++) {
          if (!c || q % 4 === 0) c = spotIn(shapes, srng);
          leaves.push([c.x + rr(srng, -7, 7) * sc, c.y + rr(srng, -6, 6) * sc, rr(srng, 0, TAU), rr(srng, 3.2, 5.8) * sc, rr(srng, 1.2, 2) * sc]);
        }
        [0.5, 0.72, 0.9].forEach((a, L) => {
          ctx.fillStyle = `rgba(0,0,0,${a})`;
          ctx.beginPath();
          for (let q = L; q < n; q += 3) leafOutline(ctx, ...leaves[q]);
          ctx.fill();
        });
        ctx.restore();
      });
    }
  }
  return steps;
}

/* ------------------------------------------------------------------ snag: a tree the honey fungus has killed */

const SNAG = {
  oak: { fill: '#7a6953', shade: '#2f241b', light: '#b7a582', furrow: '#1a110b', ridge: '#a39172' },
  birch: { fill: '#d3ccbd', shade: '#7a746a', light: '#f5f1e6', furrow: '#1e1611', ridge: '#ffffff' },
  pine: { fill: '#8a6755', shade: '#35251d', light: '#bf9f88', furrow: '#2b1a12', ridge: '#b08d76' },
};
const SNAG_BARE = '#d8cbaa'; // bare wood where the bark has gone and in the splinters
const SNAG_BARE_SHADE = '#a8946c';
const SNAG_PEEL = '#5b4a3b'; // the underside of a peeling strip of bark
const SNAG_DARK = '#1f150e'; // the shadowed break, a hollow

/** A point on a ribbon: fractional index f (0..n-1) and lateral u (-1 left .. 1 right). */
function ribAt(rb, f, u = 0) {
  const i = clamp(Math.floor(f), 0, rb.n - 2);
  const t = clamp(f - i, 0, 1);
  const cx = lerp(rb.C[i].x, rb.C[i + 1].x, t);
  const cy = lerp(rb.C[i].y, rb.C[i + 1].y, t);
  const px = lerp(rb.P[i].x, rb.P[i + 1].x, t);
  const py = lerp(rb.P[i].y, rb.P[i + 1].y, t);
  const hw = lerp(rb.hw[i], rb.hw[i + 1], t);
  return { x: cx + px * hw * u, y: cy + py * hw * u, hw, px, py, cx, cy };
}

function clipRibbon(ctx, rb) {
  ctx.beginPath();
  ctx.moveTo(rb.L[0].x, rb.L[0].y);
  for (let i = 1; i < rb.n; i++) ctx.lineTo(rb.L[i].x, rb.L[i].y);
  for (let i = rb.n - 1; i >= 0; i--) ctx.lineTo(rb.R[i].x, rb.R[i].y);
  ctx.closePath();
  ctx.clip();
}

/** Plated bark of an old pine: irregular rows of rough plates (every other row shifted), dark cracks between them. */
function barkPlates(ctx, rb, rng, pal) {
  const rowH = clamp(rb.hw[Math.floor(rb.n / 2)] * 1.15, 4.5, 9.5);
  const top = rb.C[rb.n - 1].y;
  let y = rb.C[0].y - rowH * 0.3;
  let r = 0;
  while (y > top + 2) {
    const h = rowH * rr(rng, 0.7, 1.35);
    const f = clamp(((rb.C[0].y - y) / (rb.C[0].y - top)) * (rb.n - 1), 0, rb.n - 1.001);
    const hw = ribAt(rb, f).hw;
    const cols = Math.max(2, Math.round(hw / 2.1));
    const off = (r % 2 ? 0.5 : 0) + rr(rng, -0.15, 0.15);
    for (let c = -1; c <= cols; c++) {
      const u0 = ((c + off + rr(rng, -0.12, 0.12)) / cols) * 2 - 1;
      const u1 = ((c + off + 1 + rr(rng, -0.12, 0.12)) / cols) * 2 - 1;
      const a = ribAt(rb, f, u0 + 0.04);
      const b = ribAt(rb, f, u1 - 0.04);
      const y0 = -h * rr(rng, 0.9, 1.1);
      const poly = [
        { x: a.x + rr(rng, -0.6, 0.6), y: y + y0 * rr(rng, 0.9, 1.1) },
        { x: lerp(a.x, b.x, 0.5), y: y + y0 + rr(rng, -1, 0.5) },
        { x: b.x + rr(rng, -0.6, 0.6), y: y + y0 * rr(rng, 0.8, 1.1) },
        { x: b.x + rr(rng, -0.5, 0.5), y: y + rr(rng, -0.3, 0.4) },
        { x: lerp(a.x, b.x, 0.45), y: y + rr(rng, -0.2, 0.8) },
        { x: a.x + rr(rng, -0.5, 0.5), y: y + rr(rng, -0.3, 0.4) },
      ];
      ctx.beginPath();
      tracePath(ctx, poly, true, false);
      const tone = rng();
      ctx.fillStyle = rgba(tone < 0.4 ? pal.light : tone < 0.75 ? pal.fill : pal.shade, 0.16 + 0.3 * rng());
      ctx.fill();
      ctx.lineWidth = rr(rng, 0.5, 1.1);
      ctx.strokeStyle = rgba(pal.furrow, 0.3 + 0.45 * rng());
      ctx.stroke();
    }
    y -= h;
    r++;
  }
}

/** A broken limb: the first part of a limb, a pale jagged break at its end. */
function limbStub(ctx, L, k, wScale, minW, seed, rng, pal) {
  const pts = L.pts.slice(0, k);
  const ws = L.w.slice(0, k).map((w) => Math.max(minW, w * wScale));
  const rb = ribbon(pts, ws, seed, 0.2);
  fillBand(ctx, rb.L, rb.R, pal.fill, 0.97, 0.5, 0.3);
  const [a, b] = lateral(rb, 0.1, 1.0);
  fillBand(ctx, a, b, pal.shade, 0.55, 0.4, 0.3);
  const [c, d] = lateral(rb, -1.0, -0.45);
  fillBand(ctx, c, d, pal.light, 0.3, 0.4, 0.3);
  edges(ctx, rb, 1, SEP, seed + 3, 0.85);
  const e = rb.C[rb.n - 1];
  const dir = Math.atan2(rb.C[rb.n - 1].y - rb.C[Math.max(0, rb.n - 3)].y, rb.C[rb.n - 1].x - rb.C[Math.max(0, rb.n - 3)].x);
  const hw = rb.hw[rb.n - 1];
  // splintered end: a few short pale spikes along the direction of the limb
  const nSp = 3;
  const ca = Math.cos(dir);
  const sa = Math.sin(dir);
  const at = (u, h) => ({ x: e.x + ca * h - sa * hw * u, y: e.y + sa * h + ca * hw * u });
  const poly = [at(-1, -1)];
  for (let i = 0; i < nSp; i++) {
    poly.push(at(-1 + (2 * (i + 0.5)) / nSp, rr(rng, 0.4, 1.3) * hw * 0.9 + 1));
    poly.push(at(-1 + (2 * (i + 1)) / nSp, rr(rng, 0.1, 0.35) * hw));
  }
  poly.push(at(1, -1));
  ctx.beginPath();
  tracePath(ctx, poly, true, false);
  ctx.fillStyle = rgba(SNAG_BARE, 0.97);
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = rgba(SEP, 0.9);
  ctx.lineJoin = 'round';
  ctx.stroke();
  // the dark hollow of the break
  ctx.fillStyle = rgba(SNAG_DARK, 0.55);
  ctx.beginPath();
  ctx.ellipse(e.x + ca * 0.5, e.y + sa * 0.5, Math.max(0.8, hw * 0.28), Math.max(0.8, hw * 0.55), dir + Math.PI / 2, 0, TAU);
  ctx.fill();
}

/**
 * A dead tree as painting steps (same contract as trunkSteps): a broken trunk, shorter than the living one and thicker
 * for its height, in the bark of its species (papery white birch with dark lenticels and peeling strips, deeply furrowed
 * oak, plated reddish pine). Bark has peeled off in places, two or three limbs are short broken stubs, the top is a jagged
 * break of pale spires of different heights over a dark hollow, and a hollow or a bracket fungus sits on the stem.
 * No crown. The painting is deterministic from the model's seed.
 */
export function snagSteps(ctx, m, W, H) {
  const steps = [];
  const rng = mulberry(m.seed ^ 0x5a6e ^ (m.stage * 311));
  const sp = SNAG[m.species] ? m.species : 'oak';
  const pal = SNAG[sp];
  const T = m.trunk;
  const n = Math.max(5, Math.min(T.pts.length, Math.round(T.pts.length * snagKeep(sp, rng()))));
  const pts = T.pts.slice(0, n);
  const ws = snagWidths(T.w, T.w0, n);
  const topY = pts[n - 1].y;
  const hold = { rb: null };
  const seed = m.seed;
  steps.push(() => groundHatch(ctx, T.w0, rng));
  // the root flare of an oak is still there
  if (m.butt && m.butt.length) {
    m.butt.forEach((L, i) => {
      steps.push(() => {
        const rb = ribbon(L.pts, L.w, seed + 600 + i, 0.2);
        fillBand(ctx, rb.L, rb.R, pal.fill, 0.97, 0.5, 0.3);
        const [a, b] = lateral(rb, 0.1, 1.0);
        fillBand(ctx, a, b, pal.shade, 0.55, 0.4, 0.3);
        edges(ctx, rb, 1.1, SEP, seed + 610 + i, 0.88);
      });
    });
  }
  // broken limbs on the standing part: the biggest ones, cut short
  const wide = sp === 'birch' ? 1.7 : sp === 'pine' ? 1.5 : 1;
  const stubs = m.limbs
    .filter((L) => L.pts.length > 3 && L.w0 >= 1.2 && (L.depth || 1) <= 1 && L.pts[0].y > topY - 6 && L.pts[0].y < -T.w0 * 0.8)
    .sort((a, b) => b.w0 - a.w0)
    .slice(0, 3 + (rng() < 0.4 ? 1 : 0));
  stubs.forEach((L, i) => {
    const k = Math.max(4, Math.round(L.pts.length * (sp === 'oak' ? 0.16 + 0.2 * rng() : 0.1 + 0.14 * rng())));
    steps.push(() => limbStub(ctx, L, k, wide, 2.4, seed + 700 + i, rng, pal));
  });
  // the standing trunk
  steps.push(() => {
    const rb = ribbon(pts, ws, seed + 99, 0.4);
    hold.rb = rb;
    fillBand(ctx, rb.L, rb.R, pal.fill, 0.97, 0.6, 0.35);
    const [a, b] = lateral(rb, 0.15, 1.0);
    fillBand(ctx, a, b, pal.shade, 0.6, 0.5, 0.3);
    const [c, d] = lateral(rb, -1.0, -0.45);
    fillBand(ctx, c, d, pal.light, 0.42, 0.5, 0.3);
    // the lower trunk is darker (damp, rot), and the stem darkens under the break
    const [e, f] = lateral(rb, -1, 1);
    const cut = Math.max(3, Math.round(rb.n * 0.28));
    fillBand(ctx, e.slice(0, cut), f.slice(0, cut), '#1c140e', 0.24, 0.4, 0.3);
    const top = Math.max(2, Math.round(rb.n * 0.1));
    fillBand(ctx, e.slice(rb.n - top), f.slice(rb.n - top), '#1c140e', 0.2, 0.4, 0.3);
  });
  // bark texture
  steps.push(() => {
    const rb = hold.rb;
    ctx.save();
    clipRibbon(ctx, rb);
    if (sp === 'oak') {
      // deep dark furrows with pale ridges between them
      furrows(ctx, rb, rng, { count: Math.round(clamp(T.w0 * 0.7, 16, 80)), minLen: 14, maxLen: 55, wMin: 1, wMax: 2.7, color: pal.furrow, aLo: 0.55, aHi: 0.96, uLo: -0.92, uHi: 0.96, bias: 1.0, ticks: 0.12 });
      furrows(ctx, rb, rng, { count: Math.round(clamp(T.w0 * 0.35, 8, 40)), minLen: 10, maxLen: 38, wMin: 0.8, wMax: 1.5, color: pal.ridge, aLo: 0.22, aHi: 0.5, uLo: -0.9, uHi: 0.5 });
    } else if (sp === 'pine') {
      barkPlates(ctx, rb, rng, pal);
      furrows(ctx, rb, rng, { count: Math.round(clamp(T.w0 * 0.5, 6, 30)), minLen: 16, maxLen: 50, wMin: 0.6, wMax: 1.1, color: pal.furrow, aLo: 0.3, aHi: 0.6, bias: 1.0 });
    } else {
      // birch: a dark rough base, the horizontal lenticel dashes along the whole stem, a few long pale grains
      furrows(ctx, rb, rng, { count: 11, minLen: 5, maxLen: 14, wMin: 0.9, wMax: 1.9, color: pal.furrow, uLo: -0.8, uHi: 0.8, aLo: 0.5, aHi: 0.9, yFrom: 0, yTo: 0.2 });
      birchMarks(ctx, rb, rng, 1.3);
      birchMarks(ctx, rb, rng, 1.0);
      furrows(ctx, rb, rng, { count: Math.round(clamp(T.w0 * 0.5, 5, 22)), minLen: 12, maxLen: 40, wMin: 0.5, wMax: 0.9, color: '#8a8478', uLo: 0.1, uHi: 0.95, aLo: 0.3, aHi: 0.6 });
    }
    // long dry cracks along the grain
    furrows(ctx, rb, rng, { count: Math.round(clamp(T.w0 * 0.8, 4, 24)), minLen: 14, maxLen: 60, wMin: 0.5, wMax: 1.1, color: '#241a12', aLo: 0.3, aHi: 0.75, bias: 1.0, ticks: 0.1 });
    // bare wood where the bark came off
    const bare = sp === 'birch' ? 1 : 1 + (m.stage > 1 ? 1 : 0);
    for (let q = 0; q < bare; q++) {
      const f = rr(rng, 0.12, 0.75) * (rb.n - 1);
      const side = rng() < 0.5 ? -1 : 1;
      const c = ribAt(rb, f, side * rr(rng, 0.1, 0.5));
      const ry = rr(rng, 7, 17);
      const blob = blobPoly(c.x, c.y, Math.max(1.4, c.hw * rr(rng, 0.14, 0.28)), ry, seed + 800 + q, { n: 11, jitter: 0.4, rot: 0.05 * side });
      ctx.fillStyle = rgba(SNAG_BARE, 0.78);
      ctx.beginPath();
      tracePath(ctx, blob, true, false);
      ctx.fill();
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = rgba('#3b2c1f', 0.6);
      ctx.stroke();
      inkStroke(ctx, [{ x: c.x - c.hw * 0.1, y: c.y - ry * 0.8 }, { x: c.x + c.hw * 0.08 * side, y: c.y }, { x: c.x, y: c.y + ry * 0.8 }], { w: 0.8, color: '#3b2c1f', alpha: 0.7, taperStart: 0.3, taperEnd: 0.3, seed: 900 + q, step: 2 });
    }
    ctx.restore();
  });
  // a hollow and a bracket fungus on the stem
  steps.push(() => {
    const rb = hold.rb;
    const side = rng() < 0.5 ? -1 : 1;
    if (rng() < (sp === 'birch' ? 0.4 : 0.85)) {
      const p = ribAt(rb, rr(rng, 0.42, 0.72) * (rb.n - 1), side * rr(rng, 0.0, 0.25));
      const rx = Math.max(2, p.hw * rr(rng, 0.2, 0.3));
      const ry = rx * rr(rng, 1.4, 2.1);
      ctx.fillStyle = rgba(pal.light, 0.5);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 0.8, rx * 1.2, ry * 1.1, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(SNAG_DARK, 0.96);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(SEP, 0.9);
      ctx.stroke();
    }
    if (rng() < (sp === 'birch' ? 0.65 : 0.45)) {
      const f = rr(rng, 0.2, 0.5) * (rb.n - 1);
      const p = ribAt(rb, f, -side * 0.97);
      const w = Math.max(4, p.hw * rr(rng, 0.7, 1.05));
      const dir = -side; // out of the stem, on the side opposite the hollow
      const x = p.x;
      const y = p.y;
      ctx.beginPath();
      ctx.moveTo(x, y - w * 0.2);
      ctx.quadraticCurveTo(x + dir * w * 0.9, y - w * 0.3, x + dir * w * 1.05, y + w * 0.12);
      ctx.quadraticCurveTo(x + dir * w * 0.5, y + w * 0.36, x, y + w * 0.3);
      ctx.closePath();
      ctx.fillStyle = rgba(sp === 'birch' ? '#ddd1b4' : '#c8a46c', 0.97);
      ctx.fill();
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = rgba(SEP, 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + dir * w * 0.08, y + w * 0.3);
      ctx.quadraticCurveTo(x + dir * w * 0.55, y + w * 0.36, x + dir * w * 1.0, y + w * 0.14);
      ctx.strokeStyle = rgba('#5b3f26', 0.85);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      inkStroke(ctx, [{ x: x + dir * w * 0.1, y: y - w * 0.08 }, { x: x + dir * w * 0.6, y: y - w * 0.12 }, { x: x + dir * w * 0.95, y: y + w * 0.04 }], { w: 0.6, color: '#8c6d44', alpha: 0.7, taperStart: 0.2, taperEnd: 0.4, seed: 940, step: 2 });
    }
  });
  // strips of bark peeling away from the edges
  steps.push(() => {
    const rb = hold.rb;
    const count = (sp === 'birch' ? 5 : 2) + m.stage;
    for (let q = 0; q < count; q++) {
      const i = Math.floor(rr(rng, 0.08, 0.92) * (rb.n - 1));
      const side = rng() < 0.5 ? -1 : 1;
      const hw = rb.hw[i];
      if (hw < 1.6) continue;
      const bx = rb.C[i].x + rb.P[i].x * hw * side * 0.95;
      const by = rb.C[i].y;
      const len = rr(rng, 9, sp === 'birch' ? 26 : 20);
      const out = hw * 0.12 + rr(rng, 2, 4.5);
      ctx.beginPath();
      ctx.moveTo(bx, by - len * 0.5);
      ctx.quadraticCurveTo(bx + side * out * 1.1, by - len * 0.15, bx + side * out * 0.55, by + len * 0.5);
      ctx.quadraticCurveTo(bx + side * out * 0.15, by + len * 0.1, bx, by + len * 0.5);
      ctx.closePath();
      ctx.fillStyle = rgba(sp === 'birch' ? '#e3dbc7' : SNAG_PEEL, 0.94); // birch bark is pale paper outside and dark inside
      ctx.fill();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = rgba(SEP, 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx + side * 0.4, by - len * 0.3);
      ctx.quadraticCurveTo(bx + side * out * 0.6, by, bx + side * out * 0.3, by + len * 0.35);
      ctx.strokeStyle = rgba(sp === 'birch' ? SNAG_PEEL : pal.light, 0.6);
      ctx.stroke();
    }
    edges(ctx, rb, clamp(0.9 + T.w0 * 0.05, 1.1, 2.4), SEP, seed + 5, 0.9);
  });
  // the jagged break at the top: a dark hollow with pale spires of different heights standing around it
  steps.push(() => {
    const rb = hold.rb;
    const c = rb.C[rb.n - 1];
    const hw = rb.hw[rb.n - 1];
    const k = clamp(Math.round(hw * 0.7), 4, 7);
    const hts = snagSpires(hw, k, rng);
    const lean = rng() < 0.5 ? -1 : 1;
    // spires, shortest first, tallest last so it stands in front
    // the break is slanted: on one side it goes down the trunk, so the pale wood of the break shows there
    const low = hts.map((h, i) => Math.pow(lean > 0 ? 1 - (i + 0.5) / k : (i + 0.5) / k, 1.4));
    const tall = hts.indexOf(Math.max(...hts));
    for (let i = 0; i < k; i++) hts[i] *= lerp(1, 0.55, low[i]);
    const order = hts.map((h, i) => i).sort((a, b) => hts[a] - hts[b]);
    const x0s = hts.map((h, i) => c.x - hw + (2 * hw * (i + 0.5)) / k);
    for (const i of order) {
      const x0 = x0s[i];
      const sw = ((hw * 2) / k) * (i === tall ? 1.7 : 1);
      const h = hts[i];
      const base = c.y + 2 + low[i] * Math.min(hw * 0.9, 12);
      const tipx = x0 + lean * sw * rr(rng, 0.0, 0.5) + rr(rng, -0.3, 0.3) * sw;
      const left = { x: x0 - sw * 0.78, y: base };
      const right = { x: x0 + sw * 0.78, y: base };
      const tip = { x: tipx, y: c.y - h };
      const mid1 = { x: lerp(left.x, tip.x, 0.55) + rr(rng, -0.6, 0.6), y: lerp(left.y, tip.y, 0.55) };
      const mid2 = { x: lerp(right.x, tip.x, 0.5) + rr(rng, -0.6, 0.6), y: lerp(right.y, tip.y, 0.5) };
      ctx.beginPath();
      tracePath(ctx, [left, mid1, tip, mid2, right], true, false);
      ctx.fillStyle = rgba(SNAG_BARE, 0.98);
      ctx.fill();
      // the shaded right side of the spire
      ctx.beginPath();
      tracePath(ctx, [{ x: lerp(left.x, right.x, 0.5), y: base }, tip, mid2, right], true, false);
      ctx.fillStyle = rgba(SNAG_BARE_SHADE, 0.7);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(SEP, 0.92);
      ctx.lineJoin = 'round';
      ctx.stroke();
      // the grain of the wood, up the spire
      inkStroke(ctx, [{ x: lerp(x0, tip.x, 0.1), y: base - 1 }, { x: lerp(x0, tip.x, 0.55), y: lerp(base, tip.y, 0.5) }, { x: tip.x, y: tip.y + 1.5 }], { w: 0.6, color: '#3b2c1f', alpha: 0.65, taperStart: 0.2, taperEnd: 0.5, seed: 950 + i, step: 2 });
    }
    // the shadowed hollow of the break: dark between the walls, so the spires stand out of it
    const dk = [{ x: c.x - hw * 0.62, y: c.y + 3 + low[0] * Math.min(hw * 0.9, 12) * 0.6 }];
    for (let i = 0; i < k; i++) {
      const x = x0s[i];
      if (x < c.x - hw * 0.6 || x > c.x + hw * 0.6) continue;
      dk.push({ x: x - hw / k, y: c.y - hts[i] * 0.15 }, { x, y: c.y - hts[i] * rr(rng, 0.35, 0.6) });
    }
    dk.push({ x: c.x + hw * 0.62, y: c.y + 3 + low[k - 1] * Math.min(hw * 0.9, 12) * 0.6 });
    ctx.beginPath();
    tracePath(ctx, dk, true, false);
    ctx.fillStyle = rgba(SNAG_DARK, 0.9);
    ctx.fill();
  });
  steps.push(() => granulate(ctx, W, H, 0.12, 0.45));
  return steps;
}

export function paintTrunk(ctx, m, W, H) {
  for (const f of trunkSteps(ctx, m, W, H)) f();
}

export function paintCrown(ctx, m, v, W, H, season) {
  for (const f of crownSteps(ctx, m, v, W, H, season)) f();
}

export { lighten };

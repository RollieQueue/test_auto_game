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

export function palette(species, v) {
  const set = COLORS[species] || COLORS.oak;
  const t = smooth01(clamp(v, 0, 1));
  const out = {};
  for (const k of Object.keys(set.good)) out[k] = mix(set.sick[k], set.good[k], t);
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

function oakCrownSteps(ctx, m, vis, pal, v, W, H) {
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
    ctx.fillStyle = rgba(mix(pal.base, pal.lite, 0.12), 0.72);
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

function pineTuft(ctx, t, pal, rng, seed, v, sz) {
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
}

/**
 * Crown painting as an ordered list of steps (vitality v in 0..1; W, H = canvas size in device px for granulation).
 */
export function crownSteps(ctx, m, v, W, H) {
  const steps = [];
  const rng = mulberry(m.seed ^ 0x3c91 ^ (m.stage * 4421));
  const sp = m.species;
  const pal = palette(sp, v);
  const sz = 0.7 + 0.1 * m.stage;
  const sparse = 0.3 + 0.7 * v;

  if (sp === 'pine') {
    const keep = m.tufts.filter((t) => t.leader || t.k <= sparse + 0.04);
    keep.sort((a, b) => a.y - b.y);
    const seq = keep.filter((t) => !t.front).concat(keep.filter((t) => t.front));
    for (let i = 0; i < seq.length; i += 2) {
      const chunk = seq.slice(i, i + 2);
      steps.push(() => chunk.forEach((t, q) => pineTuft(ctx, t, pal, rng, m.seed + 7 * (i + q + 1), v, sz)));
    }
  } else {
    const vis = m.lobes
      .filter((l) => (l.ring === 1 && v > 0.25) || l.k <= sparse + 0.04 || l.ring < 0.3)
      .map((l) => {
        const dx = (l.x - m.cx) / (m.rx || 1);
        const droop = (1 - v) * (m.H * 0.05) * (0.3 + Math.abs(dx));
        const sc = 0.88 + 0.12 * v;
        return { ...l, y: l.y + droop, rx: l.rx * sc, ry: l.ry * (sc + (1 - v) * 0.1) };
      });
    vis.sort((a, b) => a.y - b.y);
    if (sp === 'oak') steps.push(...oakCrownSteps(ctx, m, vis, pal, v, W, H));
    else vis.forEach((l, idx) => steps.push(...birchLobeSteps(ctx, l, vis, pal, rng, m.seed + 13 * (idx + 1), v, sz)));
    if (sp === 'birch') {
      const fr = m.fringe || [];
      for (let i = 0; i < fr.length; i += 8) {
        const chunk = fr.slice(i, i + 8);
        steps.push(() =>
          chunk.forEach((f, q) => {
            if (rng() > 0.35 + 0.65 * sparse) return;
            const droopPts = f.pts.map((p, k) => ({ x: p.x, y: p.y + (1 - v) * 3 * k }));
            fringeStroke(ctx, { pts: droopPts }, pal, rng, m.seed + 900 + i + q, v, sz);
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

export function paintTrunk(ctx, m, W, H) {
  for (const f of trunkSteps(ctx, m, W, H)) f();
}

export function paintCrown(ctx, m, v, W, H) {
  for (const f of crownSteps(ctx, m, v, W, H)) f();
}

export { lighten };

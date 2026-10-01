// Painter for the fruit bodies: ink + watercolour, drawn in world units around the stipe base (0, 0), y up is negative.
// Pure drawing, no state: paintMushroom(ctx, kind, sub, g) draws one look at growth g (0..1).
// Used by mushrooms.js to fill the sprite cache; the gallery page uses it only through that cache.
import {
  PAL,
  mulberry,
  noise1,
  smooth01,
  mix,
  rgba,
  inkStroke,
  hatch,
  wash,
  blobPoly,
  clipTo,
} from './ink.js';

export const STEPS = 20;

const sm = (g, a, b) => smooth01((g - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------------------------------------------ species table */

// SH stipe height, ST/SB stipe half-width at top / base, RX cap half-width, CH dome height (all fully grown).
export const KINDS = [
  {
    name: 'porcini',
    SH: 34, ST: 7.2, SB: 13.5, bulbPow: 1.9, RX: 28, CH: 25, capPow: 2.55, rimDrop: 1.6, umbo: 0, bow: 1.4,
    capYoung: '#d9c59c', cap: '#8e5a33', capDark: '#4c2c18', capHi: '#c89562',
    stipe: '#ddc79b', stipeShade: '#8f7550', under: '#d3c685', underDark: '#7c6c3c', gillInk: '#6b5a30', pores: true,
    net: true, ruK: 0.27, ring: false, warts: 0, scales: false, volva: false, honey: false,
  },
  {
    name: 'agaric',
    SH: 50, ST: 4.6, SB: 7.6, bulbPow: 3.4, RX: 27, CH: 19, capPow: 2.25, rimDrop: 3.2, umbo: 0, bow: 1.0,
    capYoung: '#eadfc6', cap: '#a8362d', capDark: '#561612', capHi: '#d9684f',
    stipe: '#efe6d0', stipeShade: '#b5a688', under: '#e8dfc8', underDark: '#a39578', gillInk: '#7a6a50', pores: false,
    net: false, ring: true, ringS: 0.78, ringW: 1.1, warts: 22, wartCol: '#fff4da', scales: false, volva: true, honey: false,
  },
  {
    name: 'parasol',
    SH: 62, ST: 2.9, SB: 5.0, bulbPow: 5, RX: 29, CH: 11.5, capPow: 2.35, rimDrop: 4.6, umbo: 3.4, bow: 1.6,
    capYoung: '#dcc9a0', cap: '#c79a58', capDark: '#6a4524', capHi: '#e8c88e',
    stipe: '#e2cfa6', stipeShade: '#a8885a', under: '#e6dcc0', underDark: '#a89a78', gillInk: '#7e6c4c', pores: false,
    net: false, ring: true, ringS: 0.68, warts: 0, scales: true, scaleCol: '#6e4724', volva: false, honey: false, snake: true,
  },
  {
    name: 'honey',
    SH: 44, ST: 2.9, SB: 4.3, bulbPow: 4, RX: 17, CH: 12.5, capPow: 2.3, rimDrop: 2.4, umbo: 1.6, bow: 1.0,
    capYoung: '#dcc58f', cap: '#bd8a38', capDark: '#6c4618', capHi: '#e6bd6c',
    stipe: '#e6d2a4', stipeShade: '#a88a56', under: '#e2d2a6', underDark: '#9b8454', gillInk: '#78603a', pores: false,
    net: false, ring: true, ringS: 0.74, warts: 0, scales: false, scaleCol: '#5e3d14', volva: false, honey: true,
    members: [
      { bx: 0, lean: -0.05, size: 1.0, start: 0 },
      { bx: -10, lean: -0.32, size: 0.78, start: 0.12 },
      { bx: 10, lean: 0.38, size: 0.58, start: 0.26 },
    ],
  },
];

/* ------------------------------------------------------------------ geometry */

/** Growth-dependent proportions of one body. */
export function bodyState(K, gIn) {
  const g = clamp(gIn, 0, 1);
  const stipeG = Math.pow(sm(g, 0.0, 0.52), 0.85);
  const grow = sm(g, 0.06, 0.88);
  const open = sm(g, 0.36, 0.9);
  const gv = sm(g, 0.52, 0.88);
  const ripe = sm(g, 0.45, 1);
  const r0 = clamp(K.ST * 0.9, 2.5, 5);
  const sh = K.SH * (0.075 + 0.925 * stipeG);
  const rx = lerp(r0, K.RX, grow);
  const ch = lerp(rx * 1.1, K.CH * (0.42 + 0.58 * grow), open);
  const pw = lerp(2, K.capPow, open);
  const ru = rx * (K.ruK || 0.19) * gv;
  const rd = K.rimDrop * open * grow;
  const capY = -sh + 1.2;
  const stT = lerp(r0 * 0.8, K.ST, stipeG);
  const stB = lerp(r0 * 0.9, K.SB, stipeG);
  const topY = capY + Math.max(1.6, ru * 0.55);
  return { g, stipeG, grow, open, gv, ripe, sh, rx, ch, pw, ru, rd, capY, stT, stB, topY, ringAmt: K.ring ? sm(g, 0.56, 0.84) : 0 };
}

/** World-space extents (half width, height above base, depth below) of a mushroom of kind `kind` at growth g. */
export function extentOf(kind, g) {
  const K = KINDS[kind & 3];
  let w = 0;
  let up = 0;
  const one = (gi, bx, lean, size) => {
    const st = bodyState(K, gi);
    const h = (-st.capY + st.ch + K.umbo) * size;
    const hw = Math.max(st.rx, st.stB + 6, st.ringAmt * (st.stT * 2.2 + 3)) * size;
    const tipX = Math.abs(bx) + Math.sin(Math.abs(lean)) * h;
    w = Math.max(w, tipX + hw + 2);
    up = Math.max(up, h * Math.cos(lean) + 2);
  };
  if (K.members) {
    for (const m of K.members) {
      const gi = clamp((g - m.start) / (1 - m.start), 0, 1);
      if (g >= m.start) one(gi, m.bx, m.lean, m.size);
    }
    w = Math.max(w, 22);
  } else {
    one(g, 0, 0, 1);
    w = Math.max(w, st0(K, g) + 4);
  }
  return { w: w + 8, up: up + 8, down: 8 };
}
const st0 = (K, g) => bodyState(K, g).stB + 8;

/** Stipe centre line and outline for the current state. */
function stipeGeom(K, st, N = 12) {
  const hs = -st.topY; // length base -> top (positive)
  const bow = K.bow * clamp(hs / 40, 0.3, 1.4);
  const L = [];
  const R = [];
  const C = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const cx = bow * Math.sin(s * Math.PI * 0.85) * (1 - 0.4 * s);
    const y = st.topY * s;
    const hw = st.stT + (st.stB - st.stT) * Math.pow(1 - s, K.bulbPow) + 0.25 * noise1(i * 1.9 + K.SH) * (st.stipeG > 0.2 ? 1 : 0.3);
    L.push({ x: cx - hw, y });
    R.push({ x: cx + hw, y });
    C.push({ x: cx, y, hw });
  }
  return { L, R, C, tx: C[N].x, hs };
}
const atS = (sg, s) => {
  const N = sg.C.length - 1;
  const f = clamp(s, 0, 1) * N;
  const i = Math.min(N - 1, Math.floor(f));
  const t = f - i;
  const a = sg.C[i];
  const b = sg.C[i + 1];
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), hw: lerp(a.hw, b.hw, t) };
};

function domePoints(K, st, n = 40, seed = 0) {
  const pts = [];
  const e = 2 / st.pw;
  const so = (seed % 97) * 0.37;
  const asym = ((seed >> 3) & 1 ? 1 : -1) * 0.1;
  const amp = clamp(st.ch * 0.035, 0.1, 1.1);
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - (Math.PI * i) / n;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let x = st.rx * Math.sign(c) * Math.pow(Math.abs(c), e);
    let y = -st.ch * Math.pow(Math.abs(s), e);
    y += st.rd * Math.pow(Math.abs(x) / st.rx, 2.2);
    y -= K.umbo * st.open * Math.exp(-Math.pow(x / (st.rx * 0.24), 2));
    y += amp * Math.sin((Math.PI * i) / n) * noise1(i * 0.42 + so);
    x += st.rx * asym * (1 - (x / st.rx) * (x / st.rx));
    pts.push({ x, y });
  }
  return pts;
}

/* ------------------------------------------------------------------ pieces */

function paintGills(ctx, K, st, seed) {
  const { rx, rd, ru } = st;
  if (ru < 0.6) return;
  const m = 26;
  const arc = [];
  for (let j = 0; j <= m; j++) {
    const a = (Math.PI * j) / m;
    arc.push({ x: rx * Math.cos(a), y: rd + ru * Math.sin(a) });
  }
  const under = mix(K.under, K.underDark, 0.12);
  wash(ctx, arc, { color: under, alpha: 0.95, layers: 2, ragged: 0.2, edge: 0.3, edgeW: 0.5, seed });
  ctx.save();
  clipTo(ctx, arc);
  const gr = ctx.createLinearGradient(0, rd, 0, rd + ru);
  gr.addColorStop(0, rgba(K.underDark, 0.7));
  gr.addColorStop(1, rgba(K.underDark, 0.05));
  ctx.fillStyle = gr;
  ctx.fillRect(-rx - 1, rd - 1, rx * 2 + 2, ru + 2);
  if (K.pores) {
    const rng = mulberry(seed + 5);
    ctx.fillStyle = rgba(K.gillInk, 0.55);
    for (let i = 0; i < rx * 2.2; i++) {
      const a = rng() * Math.PI;
      const rr = Math.sqrt(rng());
      const x = Math.cos(a) * rx * rr;
      const y = rd + Math.sin(a) * ru * rr * 0.9 + 0.3;
      ctx.beginPath();
      ctx.arc(x, y, 0.28 + rng() * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const G = Math.max(7, Math.round(rx * 0.6));
    for (let i = 0; i < G; i++) {
      const a = (Math.PI * (i + 0.5)) / G;
      const x1 = rx * Math.cos(a) * 0.98;
      const y1 = rd + ru * Math.sin(a) * 0.98;
      inkStroke(ctx, [{ x: x1 * 0.12, y: rd + ru * 0.04 }, { x: x1, y: y1 }], {
        w: 0.42, color: K.gillInk, alpha: 0.55, taperStart: 0.05, taperEnd: 0.5, press: 0.2, tremor: 0.1, seed: seed + i, step: 1.5, smooth: false,
      });
    }
  }
  ctx.restore();
  inkStroke(ctx, arc, { w: 1.0, color: mix(PAL.sepia, K.capDark, 0.4), alpha: 0.9, taperStart: 0.1, taperEnd: 0.12, press: 0.3, tremor: 0.2, seed: seed + 3, step: 1.5 });
}

function paintStipe(ctx, K, st, sg, seed) {
  const poly = sg.L.concat(sg.R.slice().reverse());
  const stipeCol = mix(K.stipe, K.capYoung, 0.25 * (1 - st.ripe));
  wash(ctx, poly, { color: stipeCol, alpha: 0.9, layers: 3, ragged: 0.3, edge: 0.5, edgeW: 0.45, seed, rimColor: mix(stipeCol, K.stipeShade, 0.8) });
  const minX = Math.min(...sg.L.map((p) => p.x));
  const maxX = Math.max(...sg.R.map((p) => p.x));
  ctx.save();
  clipTo(ctx, poly);
  if (st.sh > 10) {
    const half = [];
    for (let i = 0; i < sg.R.length; i++) half.push(sg.R[i]);
    for (let i = sg.C.length - 1; i >= 0; i--) half.push({ x: sg.C[i].x - sg.C[i].hw * (0.1 + 0.25 * noise1(i * 1.3 + seed)), y: sg.C[i].y });
    wash(ctx, half, { color: mix(stipeCol, K.stipeShade, 0.6), alpha: 0.6, layers: 3, ragged: 0.8, edge: 0.7, edgeW: 0.5, seed: seed + 9, rimColor: K.stipeShade });
  }
  // light from the upper left: right side in shade, shade under the cap, darker toward the ground
  let gr = ctx.createLinearGradient(minX, 0, maxX, 0);
  gr.addColorStop(0, rgba('#fff6dc', 0.38));
  gr.addColorStop(0.35, rgba(K.stipeShade, 0));
  gr.addColorStop(1, rgba(K.stipeShade, 0.3));
  ctx.fillStyle = gr;
  ctx.fillRect(minX - 1, st.topY - 1, maxX - minX + 2, -st.topY + 3);
  const hs = -st.topY;
  gr = ctx.createLinearGradient(0, st.topY, 0, st.topY + Math.min(hs, 9 + st.ru));
  gr.addColorStop(0, rgba(K.capDark, st.gv > 0 ? 0.42 : 0.2));
  gr.addColorStop(1, rgba(K.capDark, 0));
  ctx.fillStyle = gr;
  ctx.fillRect(minX - 1, st.topY - 1, maxX - minX + 2, Math.min(hs, 9 + st.ru) + 1);
  // a few wet stains
  const rng = mulberry(seed + 11);
  for (let k = 0; k < 3 && hs > 12; k++) {
    const y = st.topY * (0.2 + 0.7 * rng());
    const p = atS(sg, y / st.topY);
    wash(ctx, blobPoly(p.x + (rng() - 0.5) * p.hw, y, p.hw * 0.7, 3 + rng() * 3, seed + k, { n: 9, jitter: 0.2 }), {
      color: k % 2 ? K.stipeShade : K.capHi, alpha: 0.13, layers: 1, ragged: 0.4, edge: 0.7, edgeW: 0.35, seed: seed + k,
    });
  }
  // fibres
  const dens = (x, y) => {
    const p = atS(sg, y / st.topY);
    return clamp(0.35 + 0.5 * ((x - p.x) / Math.max(0.5, p.hw)) + 0.15, 0.05, 0.95);
  };
  if (hs > 9) {
    hatch(ctx, poly, {
      angle: -Math.PI / 2 + 0.05, gap: K.SH > 55 ? 1.7 : 1.9, w: 0.42, color: mix(PAL.sepia, K.stipeShade, 0.5), alpha: 0.55, seed: seed + 21, lenVar: 0.7, density: dens,
    });
  }
  if (K.net && hs > 14) {
    for (const ang of [0.75, -0.75]) {
      hatch(ctx, poly, {
        angle: ang + 0.04, gap: 4.2, w: 0.5, color: '#fff3d4', alpha: 0.5, seed: seed + 61 + ang * 10, lenVar: 0.1,
        bounds: { x0: minX, x1: maxX, y0: st.topY, y1: st.topY * 0.3 },
        density: (x, y) => (y < st.topY * 0.3 ? 0.85 : 0) * st.stipeG,
      });
      hatch(ctx, poly, {
        angle: ang, gap: 4.4, w: 0.35, color: mix(PAL.sepia, K.cap, 0.3), alpha: 0.26, seed: seed + 31 + ang * 10, lenVar: 0.1,
        bounds: { x0: minX, x1: maxX, y0: st.topY, y1: st.topY * 0.3 },
        density: (x, y) => (y < st.topY * 0.3 ? 0.85 : 0) * st.stipeG,
      });
    }
  }
  if (K.snake && hs > 20) {
    for (let y = st.topY + 4; y < -4; y += 3.1) {
      const p = atS(sg, y / st.topY);
      inkStroke(ctx, [{ x: p.x - p.hw, y: y + 0.4 }, { x: p.x - p.hw * 0.2, y: y - 0.4 + noise1(y) * 0.5 }, { x: p.x + p.hw, y: y + 0.2 }], {
        w: 0.55, color: K.scaleCol, alpha: 0.32 * st.ripe, taperStart: 0.3, taperEnd: 0.3, seed: seed + y, step: 1.5, tremor: 0.15,
      });
    }
  }
  ctx.restore();
  // ink edges: left lighter, right heavier
  const inkC = mix(PAL.sepia, K.stipeShade, 0.3);
  const thick = clamp(st.stT * 0.22, 0.6, 1.5);
  inkStroke(ctx, sg.L.slice().reverse(), { w: thick * 0.85, color: inkC, alpha: 0.9, taperStart: 0.12, taperEnd: 0.3, press: 0.35, tremor: 0.3, seed: seed + 41, step: 1.8 });
  inkStroke(ctx, sg.R, { w: thick * 1.15, color: inkC, alpha: 0.95, taperStart: 0.25, taperEnd: 0.12, press: 0.4, tremor: 0.3, seed: seed + 43, step: 1.8 });
}

function paintRing(ctx, K, st, sg, seed) {
  if (st.ringAmt < 0.02) return;
  const p = atS(sg, K.ringS);
  const a = st.ringAmt;
  const hw = p.hw;
  const out = (hw * 1.5 + 1.2 + hw * 0.9 * a) * (0.45 + 0.55 * a) * (K.ringW || 1);
  const drop = 2.4 + (K.ringW ? 6 : 3.2) * a;
  const y0 = p.y;
  const mid = hw + (out - hw) * 0.5;
  const pts = [
    { x: p.x - hw - 0.2, y: y0 - 0.5 },
    { x: p.x, y: y0 - 1.0 },
    { x: p.x + hw + 0.2, y: y0 - 0.5 },
    { x: p.x + mid, y: y0 + drop * 0.5 },
    { x: p.x + out, y: y0 + drop * 1.15 },
    { x: p.x + out * 0.55, y: y0 + drop * 0.95 },
    { x: p.x + out * 0.1, y: y0 + drop * 0.82 },
    { x: p.x - out * 0.4, y: y0 + drop * 0.95 },
    { x: p.x - out, y: y0 + drop * 1.12 },
    { x: p.x - mid, y: y0 + drop * 0.5 },
  ];
  const col = mix(K.name === 'agaric' ? '#f6eedb' : K.stipe, '#fff6dc', 0.35);
  wash(ctx, pts, { color: col, alpha: 0.96, layers: 2, ragged: 0.3, edge: 0.5, edgeW: 0.4, seed: seed + 51, smooth: true, rimColor: K.stipeShade });
  ctx.save();
  clipTo(ctx, pts);
  const gr = ctx.createLinearGradient(p.x - out, 0, p.x + out, 0);
  gr.addColorStop(0, rgba('#fff6dc', 0.25));
  gr.addColorStop(0.5, rgba(K.stipeShade, 0.1));
  gr.addColorStop(1, rgba(K.stipeShade, 0.65));
  ctx.fillStyle = gr;
  ctx.fillRect(p.x - out - 1, y0 - 2, out * 2 + 2, drop * 2 + 3);
  const gv = ctx.createLinearGradient(0, y0 - 1, 0, y0 + drop * 0.7);
  gv.addColorStop(0, rgba(K.stipeShade, 0.5));
  gv.addColorStop(1, rgba(K.stipeShade, 0));
  ctx.fillStyle = gv;
  ctx.fillRect(p.x - out - 1, y0 - 2, out * 2 + 2, drop * 0.9 + 2);
  ctx.restore();
  const rng = mulberry(seed + 52);
  const n = Math.round(4 + out * 0.4);
  for (let i = 0; i < n; i++) {
    const f = -0.9 + 1.8 * (i / (n - 1));
    const x = p.x + f * out * 0.92 + (rng() - 0.5) * 0.6;
    const yh = y0 + drop * (1.12 - 0.3 * (1 - Math.abs(f)) * 1.0) - 0.2;
    inkStroke(ctx, [{ x: p.x + f * hw * 0.8, y: y0 + 0.2 }, { x: p.x + (x - p.x) * 0.6, y: y0 + (yh - y0) * 0.5 }, { x, y: yh }], {
      w: 0.38, color: PAL.sepia, alpha: 0.38 * a, taperStart: 0.1, taperEnd: 0.5, seed: seed + i, step: 1.2, tremor: 0.1,
    });
  }
  const ink = mix(PAL.sepia, K.stipeShade, 0.25);
  inkStroke(ctx, [pts[9], pts[8], pts[7], pts[6], pts[5], pts[4], pts[3]], { w: 0.95, color: ink, alpha: 0.92, taperStart: 0.1, taperEnd: 0.15, press: 0.3, seed: seed + 53, step: 1.2 });
  inkStroke(ctx, [pts[0], pts[9]], { w: 0.6, color: ink, alpha: 0.7, taperStart: 0.1, taperEnd: 0.1, seed: seed + 54, step: 1.2 });
  inkStroke(ctx, [pts[2], pts[3]], { w: 0.7, color: ink, alpha: 0.8, taperStart: 0.1, taperEnd: 0.1, seed: seed + 55, step: 1.2 });
}

function paintVolva(ctx, K, st, sg, seed) {
  if (!K.volva) return;
  const k = sm(st.g, 0.1, 0.5);
  const rng = mulberry(seed + 61);
  for (let i = 0; i < 3; i++) {
    const s = 0.05 + i * 0.075;
    const p = atS(sg, s);
    const w = p.hw * (1.38 - i * 0.08);
    const y = p.y;
    const col = '#f1e8d2';
    const pts = [
      { x: p.x - w, y: y - 0.2 },
      { x: p.x - w * 0.5, y: y - 1.2 - rng() * 0.5 },
      { x: p.x + w * 0.5, y: y - 1.2 - rng() * 0.5 },
      { x: p.x + w, y: y - 0.2 },
      { x: p.x + w * 0.7, y: y + 1.4 },
      { x: p.x, y: y + 1.9 + k * 0.4 },
      { x: p.x - w * 0.7, y: y + 1.4 },
    ];
    wash(ctx, pts, { color: col, alpha: 0.92 * (0.4 + 0.6 * k), layers: 2, ragged: 0.25, edge: 0.4, edgeW: 0.3, seed: seed + 62 + i, rimColor: K.stipeShade });
    inkStroke(ctx, [pts[4], pts[5], pts[6]].reverse(), { w: 0.7, color: PAL.sepia, alpha: 0.6 * (0.4 + 0.6 * k), taperStart: 0.2, taperEnd: 0.2, seed: seed + i, step: 1.2 });
  }
}

const wartCache = new Map();
function wartList(seed, n) {
  const key = seed * 100 + n;
  let l = wartCache.get(key);
  if (!l) {
    const rng = mulberry(seed + 71);
    l = [];
    for (let i = 0; i < n; i++) l.push({ u: (rng() * 2 - 1) * 0.93, f: rng(), r: 0.7 + rng() * 1.3, j: rng() });
    wartCache.set(key, l);
  }
  return l;
}

function paintDome(ctx, K, st, seed) {
  const top = domePoints(K, st, 40, seed);
  const { rx, rd, ch } = st;
  const N = top.length - 1;
  const chord = [0.5, 0, -0.5].map((f) => ({ x: rx * f, y: rd }));
  const poly = top.concat(chord);
  const capNow = mix(K.capYoung, K.cap, st.ripe);
  const light = mix(capNow, K.capHi, 0.5);
  const dark = mix(capNow, K.capDark, 0.55);
  const topY = -ch - K.umbo;
  const big = rx > 8;
  const rim = (c) => mix(c, K.capDark, 0.7);
  // glaze 1: pale underpainting of the whole dome
  wash(ctx, poly, { color: light, alpha: 0.92, layers: 3, ragged: 0.4, edge: 0.55, edgeW: 0.7, seed, rimColor: rim(capNow) });
  ctx.save();
  clipTo(ctx, poly);
  // glaze 2: the body colour, shifted to the right so the lit left stays pale
  const g2 = poly.map((p) => ({ x: p.x * 0.95 + rx * 0.12, y: rd + (p.y - rd) * 0.9 }));
  wash(ctx, g2, { color: capNow, alpha: 0.78, layers: 3, ragged: big ? 1.1 : 0.5, edge: 0.7, edgeW: 0.8, seed: seed + 3, rimColor: rim(capNow) });
  // glaze 3: shadow crescent on the lower right
  if (big) {
    const a0 = Math.round(N * 0.4);
    const outer = top.slice(a0);
    const inner = [];
    for (let i = N; i > a0; i--) {
      const p = top[i];
      const t = Math.pow((i - a0) / (N - a0), 0.7);
      inner.push({ x: p.x + (p.x * 0.78 - rx * 0.08 - p.x) * t, y: p.y + (rd + (p.y - rd) * 0.74 - p.y) * t });
    }
    wash(ctx, outer.concat(inner), { color: dark, alpha: 0.62, layers: 3, ragged: 1.0, edge: 0.8, edgeW: 0.7, seed: seed + 5, rimColor: K.capDark });
  }
  // soft mottling: pigment settling unevenly (wet-in-wet blooms without hard edges)
  if (big) {
    const rm = mulberry(seed + 17);
    const nm = Math.round(clamp(rx / 5.5, 2, 5));
    for (let k = 0; k < nm; k++) {
      const cx = rx * (rm() * 1.6 - 0.8);
      const cy = rd - ch * (0.12 + 0.7 * rm());
      const rr = rx * (0.16 + 0.2 * rm());
      const col = k % 2 ? K.capDark : K.capHi;
      const bl = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      bl.addColorStop(0, rgba(col, k % 2 ? 0.26 : 0.3));
      bl.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = bl;
      ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
    }
  }
  // darker under the rim
  let gr = ctx.createLinearGradient(0, rd - ch * 0.3, 0, rd + 0.5);
  gr.addColorStop(0, rgba(K.capDark, 0));
  gr.addColorStop(1, rgba(K.capDark, 0.34));
  ctx.fillStyle = gr;
  ctx.fillRect(-rx - 1, rd - ch * 0.4, rx * 2 + 2, ch * 0.4 + 2);
  // soft lifted highlight (paper showing through)
  gr = ctx.createRadialGradient(-rx * 0.38, -ch * 0.66, 0, -rx * 0.38, -ch * 0.66, rx * 0.46);
  gr.addColorStop(0, rgba('#fff6dc', 0.62 * st.ripe + 0.2));
  gr.addColorStop(1, rgba('#fff6dc', 0));
  ctx.fillStyle = gr;
  ctx.fillRect(-rx, topY, rx * 2, ch + K.umbo + rd);
  // surface character
  const sc = rx / K.RX;
  if (K.warts) {
    const n = Math.round(K.warts * clamp(sc * sc * 1.3, 0.1, 1));
    const list = wartList(seed & 0xff, K.warts);
    for (let i = 0; i < Math.min(n, list.length); i++) {
      const w = list[i];
      const cu = Math.sqrt(Math.max(0, 1 - w.u * w.u));
      const t = 0.07 + w.f * 0.86 * cu;
      const x = w.u * rx * 0.97;
      const y = rd - (t * (ch + K.umbo)) * 0.98;
      const r = w.r * (0.55 + 0.6 * cu) * clamp(sc * 1.1, 0.5, 1.1);
      const sq = 0.45 + 0.55 * cu;
      ctx.fillStyle = rgba(K.capDark, 0.4);
      ctx.beginPath();
      ctx.ellipse(x + r * 0.3 * sq, y + r * 0.36, r * sq, r * 0.85, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(K.wartCol, 0.96);
      ctx.beginPath();
      ctx.ellipse(x, y, r * sq, r * 0.82, 0.2, 0, Math.PI * 2);
      ctx.fill();
      if (r > 1) {
        ctx.fillStyle = rgba('#8d7658', 0.4);
        ctx.beginPath();
        ctx.ellipse(x + r * 0.25 * sq, y + r * 0.3, r * sq * 0.6, r * 0.4, 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  if (K.scales) {
    const r2 = mulberry(seed + 91);
    if (st.open > 0.25) {
      const ux = 0;
      const uy = -ch - K.umbo * 0.45;
      gr = ctx.createRadialGradient(ux, uy, 0, ux, uy, rx * 0.3);
      gr.addColorStop(0, rgba(K.scaleCol, 0.85 * st.open));
      gr.addColorStop(0.6, rgba(K.scaleCol, 0.5 * st.open));
      gr.addColorStop(1, rgba(K.scaleCol, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(ux - rx * 0.32, uy - rx * 0.3, rx * 0.64, rx * 0.6);
    }
    const n = Math.round(60 * clamp(sc, 0.15, 1));
    for (let i = 0; i < n; i++) {
      const u = (r2() * 2 - 1) * 0.93;
      const cu = Math.sqrt(Math.max(0, 1 - u * u));
      const t = 0.08 + r2() * 0.84 * cu;
      const x = u * rx;
      const y = rd - t * (ch + K.umbo);
      const len = (1.4 + r2() * 2.6) * (0.45 + 0.55 * cu) * clamp(sc * 1.2, 0.4, 1.1);
      const tilt = u * 0.55 - 0.08;
      inkStroke(ctx, [{ x: x - len * Math.cos(tilt), y: y - len * Math.sin(tilt) * 0.5 }, { x: x + len * Math.cos(tilt), y: y + len * Math.sin(tilt) * 0.5 + 0.35 }], {
        w: 0.95, color: K.scaleCol, alpha: (0.5 + 0.3 * r2()) * st.ripe, taperStart: 0.3, taperEnd: 0.4, seed: seed + i, step: 1, smooth: false, tremor: 0.12,
      });
    }
  }
  if (K.honey) {
    const r2 = mulberry(seed + 93);
    ctx.fillStyle = rgba(K.scaleCol, 0.65 * st.ripe);
    for (let i = 0; i < 34 * clamp(sc, 0.2, 1); i++) {
      const a = r2() * Math.PI * 2;
      const rr = Math.sqrt(r2()) * rx * 0.55;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, -ch * 0.8 + Math.sin(a) * rr * 0.3, 0.3 + r2() * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (K.pores) {
    const r2 = mulberry(seed + 95);
    ctx.fillStyle = rgba(K.capDark, 0.3);
    for (let i = 0; i < rx * 2.6; i++) {
      ctx.beginPath();
      ctx.arc((r2() * 2 - 1) * rx * 0.9, -r2() * ch * 0.9 + rd, 0.22 + r2() * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // radial streaks of pigment toward the rim
  if (big) {
    const r3 = mulberry(seed + 97);
    for (let i = 0; i < rx * 0.7; i++) {
      const u = (r3() * 2 - 1) * 0.92;
      const x = u * rx;
      const y0 = rd - r3() * 1.5;
      const y1 = y0 - ch * (0.15 + 0.3 * r3()) * Math.sqrt(Math.max(0, 1 - u * u));
      inkStroke(ctx, [{ x: x * 0.97, y: y1 }, { x, y: y0 }], { w: 0.5, color: K.capDark, alpha: 0.2, taperStart: 0.6, taperEnd: 0.1, seed: seed + i, step: 1.5, smooth: false, tremor: 0.1 });
    }
  }
  ctx.restore();
  // contour hatching following the dome on its shaded side
  if (big) {
    const c0 = { x: rx * 0.05, y: rd };
    const ink = mix(PAL.sepia, K.capDark, 0.5);
    for (let k = 0; k < 4; k++) {
      const f = 1 - 0.055 * (k + 1);
      const a = Math.round(N * (0.58 + 0.03 * k));
      const b = N - Math.round(1 + k * 1.2);
      const pts = [];
      for (let i = a; i <= b; i++) pts.push({ x: c0.x + (top[i].x - c0.x) * f, y: c0.y + (top[i].y - c0.y) * f });
      inkStroke(ctx, pts, { w: 0.5, color: ink, alpha: 0.55 - 0.08 * k, taperStart: 0.4, taperEnd: 0.4, press: 0.3, tremor: 0.2, seed: seed + 120 + k, step: 1.4 });
    }
    // short hatches across the rim shadow
    const r4 = mulberry(seed + 131);
    for (let i = 0; i < rx * 0.5; i++) {
      const j = Math.round(N * (0.55 + 0.45 * r4()));
      const p = top[Math.min(N, j)];
      const len = 1.6 + r4() * 2.8;
      inkStroke(ctx, [{ x: p.x - len * 0.55, y: p.y + len * 0.35 }, { x: p.x - len * 0.9 - 0.5, y: p.y + len * 1.1 }], {
        w: 0.4, color: ink, alpha: 0.4, taperStart: 0.2, taperEnd: 0.6, seed: seed + 200 + i, step: 1, smooth: false, tremor: 0.1,
      });
    }
  }
  // outline: thin on the lit left, heavy on the shaded right, plus a sketchy second line
  const ink = mix(PAL.sepia, K.capDark, 0.4);
  const w = clamp(rx * 0.06, 0.8, 1.7);
  const mid = Math.round(N * 0.5);
  inkStroke(ctx, top.slice(0, mid + 2), { w: w * 0.8, color: ink, alpha: 0.92, taperStart: 0.08, taperEnd: 0.1, press: 0.4, tremor: 0.28, seed: seed + 111, step: 1.6 });
  inkStroke(ctx, top.slice(mid), { w: w * 1.25, color: ink, alpha: 0.97, taperStart: 0.1, taperEnd: 0.1, press: 0.35, tremor: 0.28, seed: seed + 112, step: 1.6 });
  if (rx > 9) {
    const off = top.slice(Math.round(N * 0.1), Math.round(N * 0.42)).map((p) => ({ x: p.x + 0.55, y: p.y + 0.7 }));
    inkStroke(ctx, off, { w: 0.4, color: ink, alpha: 0.4, taperStart: 0.4, taperEnd: 0.5, seed: seed + 113, step: 1.6 });
  }
  const bow = st.ru < 0.6 ? 0.7 : 0.2;
  inkStroke(ctx, [{ x: -rx * 0.98, y: rd }, { x: 0, y: rd + bow }, { x: rx * 0.98, y: rd }], { w: 0.7, color: ink, alpha: 0.6, taperStart: 0.25, taperEnd: 0.25, seed: seed + 115, step: 1.4 });
}

/* ------------------------------------------------------------------ ground */

const GRASS = ['#6b7a34', '#566629', '#7d8a3e', '#4a5a26', '#5c4a2c'];

function blade(ctx, x0, h, dx, seed, w = 0.95, a = 0.9) {
  const col = GRASS[(seed & 0xff) % GRASS.length];
  inkStroke(ctx, [{ x: x0, y: 1.2 }, { x: x0 + dx * 0.35, y: -h * 0.55 }, { x: x0 + dx, y: -h }], {
    w, color: mix(col, PAL.sepia, 0.25), alpha: a, taperStart: 0.08, taperEnd: 0.7, press: 0.3, tremor: 0.15, seed, step: 1.3,
  });
}

function groundBack(ctx, spread, seed) {
  const rng = mulberry(seed + 201);
  wash(ctx, blobPoly(0.5, 0.9, spread * 1.15 + 1, 1.9, seed + 1, { n: 12, jitter: 0.12 }), {
    color: '#2b1e14', alpha: 0.5, layers: 2, ragged: 0.35, edge: 0.2, edgeW: 0.3, seed: seed + 2,
  });
  // moss tuft
  const side = rng() < 0.5 ? -1 : 1;
  const mx = side * (spread * 0.62 + rng() * 2);
  wash(ctx, blobPoly(mx, -0.3, 4 + rng() * 2.5, 2.2, seed + 3, { n: 10, jitter: 0.3 }), {
    color: '#7e8a3a', alpha: 0.6, layers: 2, ragged: 0.5, edge: 0.6, edgeW: 0.45, seed: seed + 3,
  });
  ctx.fillStyle = rgba('#3f4a1c', 0.6);
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.arc(mx + (rng() - 0.5) * 8, -0.6 - rng() * 2, 0.3 + rng() * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 6; i++) {
    const s = rng() < 0.5 ? -1 : 1;
    blade(ctx, s * (spread * 0.3 + rng() * spread * 0.85), 7 + rng() * 9, s * (1 + rng() * 5) * (rng() < 0.3 ? -1 : 1), seed * 7 + i, 0.85, 0.85);
  }
}

function groundFront(ctx, K, st, spread, seed) {
  const rng = mulberry(seed + 301);
  for (let i = 0; i < 5; i++) {
    const s = rng() < 0.5 ? -1 : 1;
    blade(ctx, s * (spread * 0.15 + rng() * spread * 0.8), 3.5 + rng() * 6, s * (0.8 + rng() * 3.4), seed * 13 + i, 0.8, 0.9);
  }
  // soil mound over a young button
  const m = 1 - sm(st.g, 0.04, 0.34);
  if (m > 0.02) {
    const w = (st.stB + 3.5) * (0.8 + 0.4 * m);
    const h = 1.2 + 3.6 * m;
    const pts = [
      { x: -w, y: 1.5 },
      { x: -w * 0.7, y: -h * 0.5 },
      { x: -w * 0.25, y: -h * 0.95 },
      { x: w * 0.2, y: -h },
      { x: w * 0.65, y: -h * 0.55 },
      { x: w, y: 1.5 },
      { x: 0, y: 2.6 },
    ];
    wash(ctx, pts, { color: '#4a3424', alpha: 0.92, layers: 3, ragged: 0.5, edge: 0.5, edgeW: 0.5, seed: seed + 5 });
    ctx.fillStyle = rgba('#2a1c12', 0.7);
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.arc((rng() * 2 - 1) * w * 1.1, -rng() * h * 0.8 + (i > 8 ? 1.5 : 0), 0.3 + rng() * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = rgba('#8a6a48', 0.7);
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc((rng() * 2 - 1) * w * 0.9, -rng() * h * 0.9, 0.25 + rng() * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    inkStroke(ctx, [pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]], { w: 0.8, color: PAL.sepia, alpha: 0.8, taperStart: 0.2, taperEnd: 0.3, seed: seed + 7, step: 1.3 });
  }
}

/* ------------------------------------------------------------------ one body / the whole thing */

/**
 * Paint a mushroom of look `kind` (0..3), sub-variant `sub` (0 | 1) at growth g, base at (0, 0).
 * Transform of ctx: world units.
 */
export function paintMushroom(ctx, kind, sub, g) {
  const K = KINDS[kind & 3];
  const seed = 1000 + (kind & 3) * 97 + sub * 31;
  ctx.save();
  // gills are drawn in cap-local space: do the translate inside paintBody
  if (K.members) {
    groundBack(ctx, 20, seed);
    const order = [2, 0, 1];
    let st0v = null;
    for (const i of order) {
      const m = K.members[i];
      if (g < m.start) continue;
      const gi = clamp((g - m.start) / (1 - m.start), 0, 1);
      ctx.save();
      ctx.translate(m.bx, 0);
      ctx.rotate(m.lean);
      ctx.scale(m.size, m.size);
      const st = paintBodyLocal(ctx, K, gi, seed + i * 13);
      if (i === 0) st0v = st;
      ctx.restore();
    }
    groundFront(ctx, K, st0v || bodyState(K, g), 20, seed);
  } else {
    const st = bodyState(K, g);
    const spread = st.stB + 6;
    groundBack(ctx, spread, seed);
    paintBodyLocal(ctx, K, g, seed);
    groundFront(ctx, K, st, spread, seed);
  }
  ctx.restore();
}

// Gills need the cap-local translate, so the body painter is split from the ground code.
function paintBodyLocal(ctx, K, g, seed) {
  const st = bodyState(K, g);
  const sg = stipeGeom(K, st);
  ctx.save();
  ctx.translate(sg.tx, st.capY);
  paintGills(ctx, K, st, seed);
  ctx.restore();
  paintStipe(ctx, K, st, sg, seed);
  paintRing(ctx, K, st, sg, seed);
  paintVolva(ctx, K, st, sg, seed);
  ctx.save();
  ctx.translate(sg.tx, st.capY);
  paintDome(ctx, K, st, seed);
  ctx.restore();
  return st;
}


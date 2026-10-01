// Tree skeletons: pure geometry (no canvas). One model per (species, stage, seed) in tree-local units:
// origin at the trunk base, x to the right, y UP IS NEGATIVE. Painting lives in trees-paint.js.
import { mulberry, catmull } from './ink.js';
import { resample } from '../core/geom.js';

export const STAGE_H = [70, 140, 205, 255];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rr = (rng, a, b) => a + (b - a) * rng();

/** Smooth a control polyline into a limb with per-point widths. */
export function makeLimb(ctrl, w0, w1, o = {}) {
  const { step = 3, pow = 0.85, flare = 0, flareLen = 26 } = o;
  const path = resample(catmull(ctrl, 6), step);
  const n = path.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const total = cum[n - 1] || 1;
  const w = [];
  for (let i = 0; i < n; i++) {
    let ww = lerp(w0, w1, Math.pow(cum[i] / total, pow));
    if (flare) ww *= 1 + flare * Math.exp(-cum[i] / flareLen);
    w.push(ww);
  }
  return { pts: path, w, len: total, w0, w1 };
}

const pointAt = (limb, s) => limb.pts[clamp(Math.round(s * (limb.pts.length - 1)), 0, limb.pts.length - 1)];

/** Control points from a to b with an elbow: perpendicular offset `bow` (fraction of length) at the middle. */
function arc(a, b, bow, rng, n = 3) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const ctrl = [{ x: a.x, y: a.y }];
  for (let i = 1; i < n; i++) {
    const s = i / n;
    const k = Math.sin(Math.PI * s) * (bow + (rng() - 0.5) * 0.12) * len;
    ctrl.push({ x: lerp(a.x, b.x, s) + nx * k, y: lerp(a.y, b.y, s) + ny * k });
  }
  ctrl.push({ x: b.x, y: b.y });
  return ctrl;
}

function lobe(x, y, r, rng, o = {}) {
  const { sx = 1.18, sy = 0.95 } = o;
  return { x, y, rx: r * sx, ry: r * sy, rot: (rng() - 0.5) * 0.5, k: rng(), ring: o.ring ?? 0.5 };
}

/* ------------------------------------------------------------------ oak */

function oakModel(stage, rng) {
  const th = [0, 62, 90, 114][stage];
  const w0 = [0, 10, 18, 27][stage];
  const cy = [0, -92, -132, -166][stage];
  const rx = [0, 70, 108, 142][stage];
  const ry = [0, 44, 62, 76][stage];
  const lr = [0, 24, 33, 38][stage];
  const nl = [0, 11, 17, 24][stage];
  const lean = rr(rng, -0.5, 0.5);

  const trunk = makeLimb(
    [
      { x: 0, y: 3 },
      { x: lean * 5, y: -th * 0.3 },
      { x: lean * 10 + rr(rng, -4, 4), y: -th * 0.65 },
      { x: lean * 13, y: -th },
    ],
    w0,
    w0 * 0.62,
    { flare: 0.55, flareLen: 22, step: 3 },
  );
  const tx = lean * 13;
  const ccx = tx * 0.4 + rr(rng, -0.05, 0.05) * rx;

  // lobes: silhouette ring, underside, interior
  const lobes = [];
  const m = Math.round(nl * 0.5);
  for (let i = 0; i < m; i++) {
    const th2 = Math.PI - 0.32 + (i / (m - 1)) * (Math.PI + 0.64) + rr(rng, -0.12, 0.12);
    const k = rr(rng, 0.74, 0.86);
    const ring = 1;
    lobes.push(lobe(ccx + Math.cos(th2) * rx * k, cy + Math.sin(th2) * ry * k * (Math.sin(th2) > 0 ? 0.72 : 1), lr * rr(rng, 0.62, 1.12), rng, { ring }));
  }
  for (let i = 0; i < 4; i++) {
    const u = (i < 2 ? -1 : 1) * rr(rng, 0.45, 0.8);
    lobes.push(lobe(ccx + u * rx, cy + ry * rr(rng, 0.4, 0.62), lr * rr(rng, 0.62, 0.9), rng, { ring: 0.8 }));
  }
  const nsat = [0, 5, 8, 11][stage];
  for (let i = 0; i < nsat; i++) {
    const a = Math.PI * (1.02 + 0.96 * rng());
    lobes.push(lobe(ccx + Math.cos(a) * rx * rr(rng, 0.9, 1.02), cy + Math.sin(a) * ry * rr(rng, 0.88, 1.0), lr * rr(rng, 0.36, 0.55), rng, { ring: 1.1 }));
  }
  const inner = nl - m - 4;
  for (let i = 0; i < inner; i++) {
    let best = null;
    let bestD = -1;
    for (let c = 0; c < 10; c++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * 0.62;
      const x = ccx + Math.cos(a) * rx * d;
      let y = cy + Math.sin(a) * ry * d * (Math.sin(a) > 0 ? 0.7 : 1) - ry * 0.06;
      if (Math.abs(x - ccx) < rx * 0.5) y = Math.min(y, cy + ry * 0.08);
      let md = 1e9;
      for (const l of lobes) md = Math.min(md, Math.hypot(l.x - x, l.y - y));
      if (md > bestD) {
        bestD = md;
        best = { x, y, d };
      }
    }
    lobes.push(lobe(best.x, best.y, lr * rr(rng, 0.92, 1.18), rng, { ring: best.d }));
  }

  // limbs from the top of the trunk to the lower lobes
  const limbs = [];
  const nMain = [0, 3, 4, 5][stage];
  const lower = lobes.filter((l) => l.y > cy - ry * 0.25).sort((a, b) => a.x - b.x);
  const used = new Set();
  const mains = [];
  for (let i = 0; i < nMain; i++) {
    const wantX = ccx + (-0.78 + (1.56 * i) / (nMain - 1)) * rx;
    let best = null;
    for (const l of lower) {
      if (used.has(l)) continue;
      if (!best || Math.abs(l.x - wantX) < Math.abs(best.x - wantX)) best = l;
    }
    if (!best) break;
    used.add(best);
    const start = { x: tx + rr(rng, -w0 * 0.12, w0 * 0.12), y: -th + 8 + rr(rng, 0, 0.16 * th) };
    const end = { x: lerp(best.x, start.x, 0.1), y: lerp(best.y, start.y, 0.1) };
    const dir = best.x > tx ? 1 : -1;
    const wt = trunk.w[trunk.w.length - 1];
    const L = makeLimb(arc(start, end, dir * -0.14, rng), wt * rr(rng, 0.52, 0.72), 2.4, { pow: 0.7, flare: 0.25, flareLen: 14 });
    L.depth = 1;
    limbs.push(L);
    mains.push(L);
  }
  const subTargets = lobes.filter((l) => !used.has(l));
  for (const L of mains) {
    const end = L.pts[L.pts.length - 1];
    const cand = subTargets
      .map((l) => ({ l, d: Math.hypot(l.x - end.x, l.y - end.y) + (l.y > end.y ? 30 : 0) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    const nsub = stage >= 2 ? 2 : 1;
    for (let j = 0; j < nsub && j < cand.length; j++) {
      const start = pointAt(L, rr(rng, 0.42, 0.78));
      const sidx = L.pts.indexOf(start);
      const tgt = cand[(j + (rng() < 0.4 ? 1 : 0)) % cand.length].l;
      const end2 = { x: lerp(tgt.x, start.x, 0.12), y: lerp(tgt.y, start.y, 0.12) };
      const sw = L.w[sidx] * 0.58;
      const S = makeLimb(arc(start, end2, rr(rng, -0.2, 0.2), rng), sw, 0.8, { pow: 0.7 });
      S.depth = 2;
      limbs.push(S);
      if (stage >= 3 || (stage === 2 && j === 0)) {
        for (let q = 0; q < 2; q++) {
          const p0 = pointAt(S, rr(rng, 0.55, 0.9));
          const ang = Math.atan2(end2.y - start.y, end2.x - start.x) + rr(rng, -0.9, 0.9);
          const ln = rr(rng, 12, 24);
          const T = makeLimb(arc(p0, { x: p0.x + Math.cos(ang) * ln, y: p0.y + Math.sin(ang) * ln }, rr(rng, -0.2, 0.2), rng, 2), 1.1, 0.35, { pow: 1 });
          T.depth = 3;
          limbs.push(T);
        }
      }
    }
  }

  // buttresses
  const butt = [];
  for (const side of [-1, 1]) {
    const bw = w0 * 0.5;
    butt.push(makeLimb([{ x: side * w0 * 0.25, y: -w0 * 0.9 }, { x: side * w0 * 0.62, y: -w0 * 0.25 }, { x: side * w0 * (1.05 + rng() * 0.45), y: 3 }], bw * 0.5, 0.8, { step: 2.5 }));
  }

  return { trunk, limbs, butt, lobes, cx: ccx, cy, rx, ry, tips: [] };
}

/* ------------------------------------------------------------------ birch */

function birchModel(stage, rng) {
  const top = [0, -130, -196, -248][stage];
  const w0 = [0, 5, 8, 11.5][stage];
  const cy = [0, -92, -134, -168][stage];
  const rx = [0, 42, 62, 78][stage];
  const ry = [0, 46, 66, 82][stage];
  const lr = [0, 16, 22, 27][stage];
  const lean = rr(rng, -1, 1);
  const A = [0, 3, 5, 7][stage];

  const ctrl = [];
  const nseg = 7;
  for (let i = 0; i <= nseg; i++) {
    const s = i / nseg;
    ctrl.push({
      x: lean * 16 * Math.pow(s, 1.5) + Math.sin(s * 5 + rng()) * A * s * (0.4 + s) * (i % 2 ? 1 : 0.55),
      y: lerp(3, top, s),
    });
  }
  const trunk = makeLimb(ctrl, w0, 1.0, { flare: 0.4, flareLen: 18, pow: 1.1, step: 3 });
  const trunkAt = (y) => {
    let best = trunk.pts[0];
    let bi = 0;
    for (let i = 0; i < trunk.pts.length; i++) if (Math.abs(trunk.pts[i].y - y) < Math.abs(best.y - y)) { best = trunk.pts[i]; bi = i; }
    return { p: best, w: trunk.w[bi] };
  };
  const envW = (y) => {
    const u = (y - cy) / ry;
    return u > 1 ? rx * 0.25 : rx * Math.sqrt(Math.max(0.06, 1 - u * u));
  };

  const limbs = [];
  const lobes = [];
  const fringe = [];
  const nb = [0, 6, 9, 13][stage];
  const yLow = top * 0.36;
  for (let i = 0; i < nb; i++) {
    const s = (i + rr(rng, 0.1, 0.9)) / nb;
    const y = lerp(yLow, top * 0.9, s);
    const { p, w } = trunkAt(y);
    const side = i % 2 ? 1 : -1;
    const len = envW(y) * rr(rng, 0.78, 1.02);
    const rise = rr(rng, 0.12, 0.42);
    const mid = { x: p.x + side * len * 0.55, y: p.y - len * rise * 0.8 };
    const end = { x: p.x + side * len, y: p.y - len * rise * 0.3 + len * rr(rng, 0.0, 0.2) };
    const B = makeLimb([{ x: p.x, y: p.y }, mid, end], Math.max(1.2, w * 0.38), 0.55, { pow: 0.8 });
    B.depth = 1;
    limbs.push(B);
    // leaf lobes along the branch
    const nlob = stage === 1 ? 1 : 2;
    for (let j = 0; j < nlob; j++) {
      const q = pointAt(B, nlob === 1 ? 0.85 : 0.5 + j * 0.45);
      lobes.push(lobe(q.x + rr(rng, -4, 4), q.y + lr * 0.25 + rr(rng, -3, 5), lr * rr(rng, 0.8, 1.2), rng, { ring: 0.9, sx: 1.2, sy: 0.9 }));
    }
    // twigs hang from the tip
    const nt = stage === 1 ? 1 : 3;
    for (let j = 0; j < nt; j++) {
      const q = pointAt(B, rr(rng, 0.5, 1));
      const ln = rr(rng, 12, 28) * (0.55 + stage * 0.25);
      const d = side * rr(rng, -0.1, 0.35);
      fringe.push({ pts: [{ x: q.x, y: q.y }, { x: q.x + d * ln * 0.7, y: q.y + ln * 0.5 }, { x: q.x + d * ln * 0.6 + rr(rng, -3, 3), y: q.y + ln }] });
    }
  }
  // crown top
  const tp = trunk.pts[trunk.pts.length - 1];
  lobes.push(lobe(tp.x, tp.y + lr * 0.3, lr * 1.05, rng, { ring: 1 }));
  lobes.push(lobe(tp.x + rr(rng, -lr, lr) * 0.8, tp.y + lr * 1.1, lr * 0.9, rng, { ring: 0.9 }));
  // interior fill
  const want = [0, 8, 16, 24][stage];
  for (let c = 0; c < want * 6 && lobes.length < want + nb; c++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * 0.7;
    const x = tp.x * 0.5 + Math.cos(a) * rx * d;
    const y = cy + Math.sin(a) * ry * d;
    let md = 1e9;
    for (const l of lobes) md = Math.min(md, Math.hypot(l.x - x, l.y - y));
    if (md > lr * 0.9) lobes.push(lobe(x, y, lr * rr(rng, 0.8, 1.1), rng, { ring: d, sx: 1.2, sy: 0.9 }));
  }
  return { trunk, limbs, butt: [], lobes, fringe, cx: 0, cy, rx, ry, tips: [] };
}

/* ------------------------------------------------------------------ pine */

function pineModel(stage, rng) {
  const H = STAGE_H[stage] - 8;
  const bare = [6, 30, 74, 106][stage];
  const w0 = [2.6, 5.2, 8.6, 12][stage];
  const half = [20, 44, 66, 84][stage];
  const sp = [12, 14, 16, 18][stage];
  const lean = rr(rng, -1, 1);
  const bow = rr(rng, -1, 1);
  const ctrl = [];
  for (let i = 0; i <= 6; i++) {
    const s = i / 6;
    ctrl.push({ x: lean * 6 * s * s + bow * 5 * Math.sin(s * Math.PI) + rr(rng, -0.8, 0.8) * s, y: lerp(4, -H, s) });
  }
  const trunk = makeLimb(ctrl, w0, 0.7, { flare: 0.35, flareLen: 16, pow: 0.9, step: 3 });
  const xAt = (y) => {
    let best = trunk.pts[0];
    for (const p of trunk.pts) if (Math.abs(p.y - y) < Math.abs(best.y - y)) best = p;
    return best.x;
  };
  const limbs = [];
  const tufts = [];
  const sideBias = [rr(rng, 0.82, 1.18), rr(rng, 0.82, 1.18)];

  // stubs on the bare trunk
  if (bare > 20) {
    const ns = stage >= 2 ? 4 : 2;
    for (let i = 0; i < ns; i++) {
      const y = -rr(rng, 12, bare - 6);
      const side = rng() < 0.5 ? -1 : 1;
      const x = xAt(y);
      const ln = rr(rng, 6, 12) * (0.6 + stage * 0.2);
      const S = makeLimb([{ x, y }, { x: x + side * ln * 0.6, y: y - ln * 0.15 }, { x: x + side * ln, y: y + ln * 0.1 }], 2.2, 0.9, { pow: 1, step: 2.5 });
      S.depth = 3;
      limbs.push(S);
    }
  }

  const yTop = -(bare);
  const yApex = -H;
  const span = yTop - yApex;
  let y = yTop;
  let tier = 0;
  while (y > yApex + 10) {
    const f = (yTop - y) / span; // 0 bottom .. 1 top
    const Lmax = half * Math.pow(1 - f, 0.82) + 6;
    for (const side of [-1, 1]) {
      if (rng() < 0.05 && tier > 0) continue;
      const nBr = rng() < 0.55 ? 2 : 1;
      for (let b = 0; b < nBr; b++) {
        const yy = y + rr(rng, -sp * 0.28, sp * 0.28) + b * rr(rng, 5, 9);
        const x0 = xAt(yy);
        const L = Lmax * sideBias[side > 0 ? 1 : 0] * rr(rng, 0.55, 1.18) * (b ? 0.72 : 1);
        const droop = lerp(0.16, -0.12, f) * L;
        const mid = { x: x0 + side * L * 0.5, y: yy + droop * 0.55 };
        const end = { x: x0 + side * L, y: yy + droop - L * 0.05 * (1 - f) + (f > 0.3 ? -L * 0.08 : 0) };
        const B = makeLimb([{ x: x0, y: yy }, mid, end], Math.max(1.0, w0 * 0.2 * (1 - f * 0.6)), 0.5, { pow: 0.8 });
        B.depth = 1;
        limbs.push(B);
        // tufts along the branch
        const nT = Math.max(2, Math.round(L / 10));
        for (let j = 0; j < nT; j++) {
          const s = 0.14 + (0.86 * (j + rng() * 0.5)) / nT;
          const q = pointAt(B, Math.min(1, s));
          const q2 = pointAt(B, Math.min(1, s + 0.06));
          const ang = Math.atan2(q2.y - q.y, q2.x - q.x) || (side > 0 ? 0 : Math.PI);
          const r = rr(rng, 7, 10.5) * (0.5 + 0.55 * stage / 3) * (1 - s * 0.22) + 1;
          tufts.push({ x: q.x, y: q.y + 1.5, ang, r, f, k: rng(), s });
          if (stage >= 1 && s > 0.45 && rng() < 0.55) tufts.push({ x: q.x + rr(rng, -3, 3), y: q.y + r * 1.05, ang: ang + (side > 0 ? 0.35 : -0.35), r: r * 0.78, f, k: rng(), s, hang: true });
        }
      }
    }
    // tuft in front of the trunk
    if (tier > 0 && rng() < 0.7) {
      const x0 = xAt(y);
      tufts.push({ x: x0 + rr(rng, -half * 0.12, half * 0.12) * (1 - f), y: y - 2, ang: rr(rng, -1.2, 1.2) + Math.PI / 2, r: rr(rng, 8, 12) * (0.5 + 0.5 * stage / 3) * (1 - f * 0.5), f, k: rng(), s: 0, front: true });
    }
    y -= sp * rr(rng, 0.78, 1.2);
    tier++;
  }
  // leader
  const ap = trunk.pts[trunk.pts.length - 1];
  tufts.push({ x: ap.x, y: ap.y + 6, ang: -Math.PI / 2, r: 6 + stage * 1.4, f: 1, k: 0.5, s: 0, front: true, leader: true });
  return { trunk, limbs, butt: [], lobes: [], tufts, cx: 0, cy: -(bare + H) / 2, rx: half, ry: (H - bare) / 2, tips: [] };
}

/* ------------------------------------------------------------------ sapling (oak / birch) */

function saplingModel(species, rng) {
  const H = 64;
  const lean = rr(rng, -1, 1) * 5;
  const w0 = species === 'oak' ? 3.8 : 2.6;
  const trunk = makeLimb(
    [
      { x: 0, y: 2 },
      { x: lean * 0.4, y: -H * 0.35 },
      { x: lean * 0.8 + rr(rng, -2, 2), y: -H * 0.7 },
      { x: lean, y: -H },
    ],
    w0,
    0.9,
    { flare: 0.4, flareLen: 10, pow: 0.9, step: 2.5 },
  );
  const limbs = [];
  const lobes = [];
  const fringe = [];
  const nb = 5;
  for (let i = 0; i < nb; i++) {
    const s = 0.28 + (0.62 * (i + rng() * 0.4)) / nb;
    const p = trunk.pts[Math.round(s * (trunk.pts.length - 1))];
    const side = i % 2 ? 1 : -1;
    const ln = rr(rng, 14, 24) * (1 - s * 0.35);
    const ang = -Math.PI / 2 + side * rr(rng, 0.7, 1.15);
    const end = { x: p.x + Math.cos(ang) * ln, y: p.y + Math.sin(ang) * ln };
    const B = makeLimb(arc(p, end, side * 0.1, rng, 2), 1.3, 0.5, { pow: 0.9, step: 2 });
    B.depth = 1;
    limbs.push(B);
    lobes.push(lobe(end.x, end.y - 1, species === 'oak' ? rr(rng, 10, 14) : rr(rng, 8, 11), rng, { ring: 1 }));
    if (species === 'birch') fringe.push({ pts: [{ x: end.x, y: end.y }, { x: end.x + side * 2, y: end.y + 7 }, { x: end.x + side * 3, y: end.y + 13 }] });
  }
  const tp = trunk.pts[trunk.pts.length - 1];
  lobes.push(lobe(tp.x, tp.y - 2, species === 'oak' ? 15 : 11, rng, { ring: 1 }));
  return { trunk, limbs, butt: [], lobes, fringe, cx: lean * 0.6, cy: -H * 0.62, rx: 28, ry: 28, tips: [] };
}

/* ------------------------------------------------------------------ entry */

function bboxOf(m, species) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x, y, rx, ry = rx) => {
    if (x - rx < x0) x0 = x - rx;
    if (x + rx > x1) x1 = x + rx;
    if (y - ry < y0) y0 = y - ry;
    if (y + ry > y1) y1 = y + ry;
  };
  const wmax = m.trunk.w[0];
  add(0, 0, wmax * 1.5, 6);
  for (const p of m.trunk.pts) add(p.x, p.y, 3);
  for (const L of m.limbs) for (const p of L.pts) add(p.x, p.y, 2);
  for (const l of m.lobes) add(l.x, l.y, Math.max(l.rx, l.ry) * 1.12);
  for (const t of m.tufts || []) add(t.x, t.y, t.r * 2.2);
  for (const f of m.fringe || []) for (const p of f.pts) add(p.x, p.y, 4);
  if (!Number.isFinite(x0)) {
    x0 = -20;
    x1 = 20;
    y0 = -STAGE_H[0];
    y1 = 4;
  }
  return { x0, y0, x1, y1 };
}

export function buildModel(species, stage, seed) {
  const sp = species === 'oak' || species === 'pine' ? species : 'birch';
  const st = clamp(Math.round(stage) || 0, 0, 3);
  const rng = mulberry((seed | 0) ^ (st * 7919 + 13));
  let m;
  if (sp === 'pine') m = pineModel(st, rng);
  else if (st === 0) m = saplingModel(sp, rng);
  else if (sp === 'oak') m = oakModel(st, rng);
  else m = birchModel(st, rng);
  m.species = sp;
  m.stage = st;
  m.seed = seed | 0;
  m.bbox = bboxOf(m, sp);
  m.H = STAGE_H[st];
  return m;
}

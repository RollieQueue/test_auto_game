// Underground "found curiosities": small naturalist's specimen plates lying in dark soil.
// Each DRAWERS[type](ctx, seed, size) paints one specimen centred on (0, 0), upright, in the caller's units
// (world units). It is the seam where an illustrated PNG sprite can replace the procedural drawing later.
// Style: pale gouache body (so it pops from the dark soil), a thin pale halo, dark sepia ink outline,
// a watercolor shade crescent on the lower-right (light from the upper left), hatching on the shadow side, a glint.
import { inkStroke, inkOutline, hatch, stipple, blobPoly, raggedPoly, tracePath, boundsOf, darken, rgba, mulberry, noise1 } from './ink.js';
import { hash32 } from '../core/rng.js';
import { getSprite, levelFor } from './sprites.js';

export const DECOR_TYPES = ['acorn', 'leaf', 'snail', 'beetle', 'seed', 'twig', 'pebble', 'bone', 'shell', 'potsherd', 'ammonite'];

/** Nominal width (world units) of each specimen at scale 1. */
export const DECOR_SIZE = { acorn: 26, leaf: 40, snail: 34, beetle: 30, seed: 18, twig: 54, pebble: 26, bone: 46, shell: 34, potsherd: 36, ammonite: 46 };

/** Half-extents [rx, ry] of the soft contact shadow (in the specimen's own frame). */
const SHADOW = {
  acorn: [10, 15], leaf: [13, 21], snail: [19, 14], beetle: [14, 18], seed: [11, 11], twig: [29, 15],
  pebble: [14, 11.5], bone: [25, 6.5], shell: [17, 14], potsherd: [19, 15], ammonite: [24, 24],
};

const LIGHT = { x: -0.6, y: -0.8 }; // direction towards the light, in the specimen's frame
const LINE = '#2a1b13';
const GLINT = '#fffaea';
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ------------------------------------------------------------------ helpers */

/** Transform local points: scale, rotate, translate. */
function xf(pts, x, y, a = 0, s = 1) {
  const c = Math.cos(a) * s;
  const si = Math.sin(a) * s;
  return pts.map((p) => ({ x: x + p.x * c - p.y * si, y: y + p.x * si + p.y * c }));
}

function pathOf(ctx, poly, smooth) {
  ctx.beginPath();
  tracePath(ctx, poly, true, smooth);
}

/** Shade band: the part of the polygon not covered by itself shifted towards the light. */
function crescent(ctx, poly, b, k, color, alpha, seed, smooth) {
  const sh = raggedPoly(poly.map((p) => ({ x: p.x + LIGHT.x * k, y: p.y + LIGHT.y * k })), 0.7, seed, { step: 4 });
  ctx.beginPath();
  ctx.rect(b.x0 - 8, b.y0 - 8, b.x1 - b.x0 + 16, b.y1 - b.y0 + 16);
  tracePath(ctx, sh, true, smooth);
  ctx.fillStyle = rgba(color, alpha);
  ctx.fill('evenodd');
}

/**
 * Paint one opaque-ish gouache body: halo, base fill, `inside(ctx, b)` details (clipped), shade crescents,
 * rim, hatching on the shadow side, then the ink outline.
 * o: { base, shade, deep, line, seed, k, lw, smooth, halo, haloA, hatchA, hatchAng, hatchGap, outline, inside, after }
 */
function paint(ctx, poly, o) {
  const {
    base,
    shade: sh = darken(base, 0.3),
    deep = darken(base, 0.5),
    line = LINE,
    seed = 1,
    k = 3,
    lw = 1.5,
    smooth = true,
    halo = '#f3dfb4',
    haloA = 0.2,
    hatchA = 0.5,
    hatchAng = 0.9,
    hatchGap = 2.3,
    outline = true,
    wobble = 0.35,
    inside,
    after,
  } = o;
  if (wobble > 0) poly = raggedPoly(poly, wobble, seed + 77, { step: 5 });
  const b = boundsOf(poly);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const R = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2 || 1;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (haloA > 0) {
    pathOf(ctx, poly, smooth);
    ctx.lineWidth = lw + 2.2;
    ctx.strokeStyle = rgba(halo, haloA);
    ctx.stroke();
  }
  pathOf(ctx, poly, smooth);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.save();
  pathOf(ctx, poly, smooth);
  ctx.clip();
  if (inside) inside(ctx, b);
  crescent(ctx, poly, b, k, sh, 0.62, seed + 1, smooth);
  crescent(ctx, poly, b, k * 0.42, deep, 0.5, seed + 2, smooth);
  pathOf(ctx, poly, smooth);
  ctx.lineWidth = 3;
  ctx.strokeStyle = rgba(deep, 0.32);
  ctx.stroke();
  if (hatchA > 0) {
    hatch(ctx, poly, {
      angle: hatchAng,
      gap: hatchGap,
      w: 0.55,
      color: line,
      alpha: hatchA,
      seed: seed + 3,
      lenVar: 0.1,
      bounds: b,
      density: (x, y) => {
        const d = ((x - cx) * -LIGHT.x + (y - cy) * -LIGHT.y) / R;
        return clamp01((d - 0.2) * 1.6);
      },
    });
  }
  ctx.restore();
  if (after) after(ctx, b);
  if (outline) {
    inkOutline(ctx, poly, { w: lw, color: line, alpha: 0.95, seed: seed + 4, smooth, press: 0.5, tremor: 0.4 });
    if (lw >= 1.3) {
      // a second, thinner and slightly displaced pass: the pen going over the contour again
      inkOutline(ctx, raggedPoly(poly, 0.55, seed + 9, { step: 5 }), { w: lw * 0.4, color: line, alpha: 0.5, seed: seed + 8, smooth, press: 0.5, tremor: 0.5, taperStart: 0.3, taperEnd: 0.3 });
    }
  }
  ctx.restore();
}

/** A short tapered pale highlight stroke. */
function glint(ctx, x, y, len, ang, w = 1.5, alpha = 0.85) {
  const dx = Math.cos(ang) * len * 0.5;
  const dy = Math.sin(ang) * len * 0.5;
  inkStroke(ctx, [{ x: x - dx, y: y - dy }, { x, y }, { x: x + dx, y: y + dy }], { w, color: GLINT, alpha, taperStart: 0.4, taperEnd: 0.6, tremor: 0.15, step: 1.5, seed: 3 });
}

/** A limb/stalk: pale under-stroke for contrast on the soil, then a dark ink stroke. */
function limb(ctx, pts, w, seed, o = {}) {
  const { color = LINE, halo = '#e9d2a0', haloA = 0.18, taperStart = 0.08, taperEnd = 0.5 } = o;
  inkStroke(ctx, pts, { w: w + 1.8, color: halo, alpha: haloA, taperStart, taperEnd, tremor: 0.15, seed, step: 1.5 });
  inkStroke(ctx, pts, { w, color, alpha: 0.95, taperStart, taperEnd, tremor: 0.25, seed: seed + 1, step: 1.5 });
}

/** Wrap a nominal-units drawer into DRAWERS form: (ctx, seed, size). */
function specimen(nominal, fn) {
  return (ctx, seed, size = nominal) => {
    ctx.save();
    const s = size / nominal;
    if (s !== 1) ctx.scale(s, s);
    fn(ctx, mulberry(seed), seed >>> 0);
    ctx.restore();
  };
}

const jit = (rng, a) => (rng() - 0.5) * 2 * a;

/* ------------------------------------------------------------------ drawers */

const DRAWERS = {
  /* ---- acorn: nut with a cross-hatched cup ---- */
  acorn: specimen(26, (ctx, rng, seed) => {
    const nut = [];
    const left = [];
    const right = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const y = -3 + 17.5 * t;
      const hw = 8.3 * Math.pow(1 - Math.pow(t, 2.2), 0.6);
      left.push({ x: -hw - 0.35 * noise1(i * 0.9 + seed), y });
      right.push({ x: hw + 0.35 * noise1(i * 0.9 + seed + 7), y });
    }
    nut.push(...left, ...right.reverse().slice(1));
    // stub on top, behind the cup
    limb(ctx, [{ x: 0, y: -11 }, { x: 0.8, y: -14 }, { x: 1.6, y: -16.6 }], 2.4, seed, { color: '#4a3220', taperStart: 0.02, taperEnd: 0.2 });
    paint(ctx, nut, {
      base: '#d29a58', shade: '#9a5f2e', deep: '#5e3418', seed, k: 3.6,
      inside: (c) => {
        for (let i = -1; i <= 1; i++) {
          inkStroke(c, [{ x: i * 3.2, y: -1 }, { x: i * 3.6 + jit(rng, 0.5), y: 5 }, { x: i * 1.2, y: 12 }], { w: 0.8, color: '#6a3c1a', alpha: 0.45, seed: seed + i, tremor: 0.2 });
        }
      },
    });
    inkStroke(ctx, [{ x: 0, y: 13.2 }, { x: 0.5, y: 15.2 }, { x: 0.8, y: 17 }], { w: 1.8, color: '#4a2a14', taperStart: 0.02, taperEnd: 0.5, seed });
    glint(ctx, -3.8, 4.5, 8, 1.75, 1.7);
    // cup
    const cup = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      cup.push({ x: 10 * Math.cos(a), y: -3.6 - 9.4 * Math.sin(a) });
    }
    for (let i = 1; i < 10; i++) {
      const x = -10 + (20 * i) / 10;
      cup.push({ x, y: -3.6 + 2.1 * Math.sqrt(Math.max(0, 1 - (x / 10) * (x / 10))) });
    }
    paint(ctx, cup, {
      base: '#a98450', shade: '#6e5230', deep: '#3d2a18', seed: seed + 9, k: 3.2, hatchA: 0.2,
      inside: (c, b) => {
        // overlapping scales: rows of little ink arcs
        const rows = 5;
        for (let r = 0; r < rows; r++) {
          const y = b.y0 + 3.2 + r * 2.9;
          const off = (r % 2) * 1.7;
          for (let x = b.x0 + 1.2 + off; x < b.x1; x += 3.4) {
            inkStroke(c, [{ x: x - 1.5, y: y - 0.5 }, { x, y: y + 1.1 }, { x: x + 1.5, y: y - 0.5 }], { w: 0.7, color: '#2a1b13', alpha: 0.6, seed: seed + r * 13 + x, tremor: 0.1, step: 1 });
          }
        }
        stipple(c, cup, { count: 26, color: '#e9cc8f', alpha: 0.5, rMax: 0.7, seed });
      },
    });
    glint(ctx, -5, -9.4, 7, 2.6, 1.5, 0.75);
  }),

  /* ---- leaf: fallen lobed oak leaf with skeleton veins ---- */
  leaf: specimen(40, (ctx, rng, seed) => {
    const lobes = 3 + ((rng() * 2) | 0);
    const phL = rng();
    const phR = rng();
    const tornT = 0.55 + rng() * 0.2;
    const tornSide = rng() < 0.5 ? -1 : 1;
    const cx = (t) => 3.4 * Math.sin(Math.PI * t) * (seed % 2 ? 1 : -1);
    const yAt = (t) => 19 - 38 * t;
    const hw = (t, side) => {
      const env = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.85) * 13.2;
      const lobe = 0.36 + 0.64 * Math.pow(Math.abs(Math.sin(Math.PI * (t * lobes + (side < 0 ? phL : phR)))), 0.55);
      let w = env * lobe;
      if (side === tornSide && t > tornT && t < tornT + 0.11) w *= 0.28 + 0.4 * Math.abs(Math.sin((t - tornT) * 60));
      return w;
    };
    const N = 52;
    const poly = [];
    for (let i = 0; i <= N; i++) { const t = i / N; poly.push({ x: cx(t) - hw(t, -1), y: yAt(t) }); }
    for (let i = N - 1; i > 0; i--) { const t = i / N; poly.push({ x: cx(t) + hw(t, 1), y: yAt(t) }); }
    const russet = ['#a8502a', '#b5652b', '#8f4426'][seed % 3];
    const ochre = ['#d6a042', '#cf9640', '#dba84c'][(seed >>> 2) % 3];
    // stem
    limb(ctx, [{ x: cx(0), y: 18.5 }, { x: cx(0) - 0.7, y: 22 }, { x: cx(0) - 1.5, y: 24.5 }], 2.1, seed, { color: '#4a2f1c', taperStart: 0.01, taperEnd: 0.3 });
    const holes = [{ t: 0.3 + rng() * 0.2, s: rng() < 0.5 ? -1 : 1 }, { t: 0.62 + rng() * 0.15, s: rng() < 0.5 ? -1 : 1 }];
    paint(ctx, poly, {
      base: ochre, shade: '#a8662a', deep: '#5a2c18', seed, k: 3.2, smooth: false, lw: 1.4, hatchA: 0.38, hatchGap: 2.6,
      inside: (c, b) => {
        // autumn colour blotches
        for (let i = 0; i < 6; i++) {
          const t = 0.1 + rng() * 0.8;
          const s = rng() < 0.5 ? -1 : 1;
          const px = cx(t) + s * hw(t, s) * (0.5 + rng() * 0.5);
          const blob = blobPoly(px, yAt(t), 3 + rng() * 4, 2.5 + rng() * 3, seed + i * 5, { n: 9, jitter: 0.3 });
          c.beginPath(); tracePath(c, raggedPoly(blob, 1.2, seed + i), true, true);
          c.fillStyle = rgba(russet, 0.42); c.fill();
        }
        c.beginPath(); tracePath(c, blobPoly(cx(0.1), yAt(0.1), 5, 4, seed, { n: 9, jitter: 0.3 }), true, true);
        c.fillStyle = 'rgba(138,138,60,0.45)'; c.fill();
        // holes eaten out of the blade
        for (const h of holes) {
          const hx = cx(h.t) + h.s * hw(h.t, h.s) * 0.45;
          c.beginPath(); c.ellipse(hx, yAt(h.t), 1.6 + rng(), 1.2 + rng() * 0.8, rng() * 3, 0, Math.PI * 2);
          c.fillStyle = '#2d221b'; c.fill();
          c.lineWidth = 0.8; c.strokeStyle = rgba(LINE, 0.9); c.stroke();
        }
        // curled edge: a darker band along one side
        const band = [];
        for (let i = 6; i < 36; i++) { const t = i / N; band.push({ x: cx(t) + hw(t, 1) * 0.9, y: yAt(t) }); }
        inkStroke(c, band, { w: 2.4, color: russet, alpha: 0.55, taperStart: 0.3, taperEnd: 0.3, seed });
        // skeleton veins
        const rib = [];
        for (let i = 0; i <= 24; i++) { const t = (i / 24) * 0.97; rib.push({ x: cx(t), y: yAt(t) }); }
        inkStroke(c, rib, { w: 2, color: '#4a2f1c', alpha: 0.9, taperStart: 0.02, taperEnd: 0.9, seed: seed + 3, tremor: 0.2 });
        inkStroke(c, rib.map((p) => ({ x: p.x - 0.6, y: p.y })), { w: 0.7, color: '#f1d9a0', alpha: 0.45, taperStart: 0.05, taperEnd: 0.9, seed: seed + 4, tremor: 0.1 });
        for (const side of [-1, 1]) {
          const ph = side < 0 ? phL : phR;
          for (let li = 0; li < lobes + 1; li++) {
            const t = (li + 0.5 - ph) / lobes;
            if (t < 0.1 || t > 0.9) continue;
            const w = hw(t, side);
            if (w < 2.2) continue;
            const t0 = Math.max(0.03, t - 0.08);
            inkStroke(c, [{ x: cx(t0), y: yAt(t0) }, { x: cx(t0) + side * w * 0.5, y: yAt(t0) - w * 0.38 }, { x: cx(t) + side * w * 0.9, y: yAt(t) - 0.5 }], {
              w: 1.2, color: '#4a2f1c', alpha: 0.85, taperStart: 0.05, taperEnd: 0.8, seed: seed + li * 3 + side, tremor: 0.2,
            });
          }
        }
      },
    });
    glint(ctx, cx(0.55) - 4, yAt(0.55) - 1, 6, 1.9, 1.4, 0.55);
  }),

  /* ---- snail: striped spiral shell with a soft body ---- */
  snail: specimen(34, (ctx, rng, seed) => {
    const bodyPts = [
      { x: 18, y: 10.5 }, { x: 8, y: 12 }, { x: -4, y: 12.2 }, { x: -13, y: 11.5 }, { x: -18.5, y: 9 },
      { x: -19, y: 4.5 }, { x: -16, y: 0.5 }, { x: -10, y: -1.5 }, { x: 0, y: -1 }, { x: 10, y: 3 },
    ];
    // eye stalks and tentacles behind the head
    limb(ctx, [{ x: -16, y: 2 }, { x: -19.5, y: -4 }, { x: -21.5, y: -9 }], 1.5, seed, { taperEnd: 0.2, color: '#6a5a44' });
    limb(ctx, [{ x: -13, y: 0 }, { x: -14.5, y: -5 }, { x: -15.5, y: -10 }], 1.5, seed + 5, { taperEnd: 0.2, color: '#6a5a44' });
    for (const [ex, ey] of [[-21.7, -9.4], [-15.7, -10.4]]) {
      ctx.beginPath(); ctx.arc(ex, ey, 1.5, 0, Math.PI * 2); ctx.fillStyle = '#2a1b13'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex - 0.4, ey - 0.4, 0.5, 0, Math.PI * 2); ctx.fillStyle = GLINT; ctx.fill();
    }
    paint(ctx, bodyPts, {
      base: '#d6c8a6', shade: '#a69373', deep: '#6a5a40', seed, k: 3, hatchA: 0.4,
      inside: (c, b) => {
        stipple(c, bodyPts, { count: 40, color: '#5a4a34', alpha: 0.55, rMax: 0.75, seed });
        stipple(c, bodyPts, { count: 16, color: '#fff2d2', alpha: 0.6, rMax: 0.7, seed: seed + 2 });
      },
    });
    glint(ctx, -9, 5, 7, 0.1, 1.4, 0.6);
    // shell
    const sx = 3.5;
    const sy = -4.5;
    const SR = 12.5;
    const shell = blobPoly(sx, sy, SR, SR * 0.96, seed, { n: 14, jitter: 0.04, rot: rng() * 3 });
    const turns = 3;
    const spiral = (th, f = 1) => {
      const r = 1.2 * Math.exp(0.133 * th) * f;
      return { x: sx + 0.6 + r * Math.cos(th + 0.5), y: sy + 0.4 + r * Math.sin(th + 0.5) };
    };
    paint(ctx, shell, {
      base: '#e1c88e', shade: '#b0834a', deep: '#6d4528', seed: seed + 3, k: 4.4, hatchA: 0.34, hatchGap: 2.1, lw: 1.6,
      inside: (c) => {
        // dark spiral stripes, one per whorl, thickening outwards
        for (let tn = 0; tn < turns; tn++) {
          const pts = [];
          for (let a = 0; a <= 2 * Math.PI + 0.1; a += 0.3) pts.push(spiral(tn * 2 * Math.PI + a, 0.8));
          inkStroke(c, pts, { w: 0.9 + tn * 1.15, color: '#7b4a26', alpha: 0.62, taperStart: 0.2, taperEnd: 0.2, seed: seed + tn, smooth: true });
        }
        // suture lines between whorls
        const pts = [];
        for (let a = 0; a <= turns * 2 * Math.PI; a += 0.3) pts.push(spiral(a));
        inkStroke(c, pts, { w: 1, color: '#2a1b13', alpha: 0.8, taperStart: 0.1, taperEnd: 0.1, seed, tremor: 0.15 });
        stipple(c, shell, { count: 18, color: '#fff0cc', alpha: 0.5, rMax: 0.6, seed });
      },
    });
    glint(ctx, sx - 5.5, sy - 6, 8, 2.5, 1.7, 0.8);
  }),

  /* ---- beetle: dorsal view with glossy elytra, legs and antennae ---- */
  beetle: specimen(30, (ctx, rng, seed) => {
    const P = [
      { base: '#5d9468', shade: '#2f5a42', deep: '#173326', pro: '#8a7a3a' },
      { base: '#b0792f', shade: '#7a4a1e', deep: '#432612', pro: '#c8934a' },
      { base: '#4f6fa6', shade: '#2d3f72', deep: '#1a2147', pro: '#6a7fb0' },
    ][seed % 3];
    // legs: three pairs, jointed
    const legs = [
      [[4.5, -7], [10.5, -11], [14, -7.5]],
      [[6.5, -1.5], [13, -3.5], [15.5, 2]],
      [[6, 4], [11, 9.5], [11.5, 15.5]],
    ];
    for (const s of [-1, 1]) {
      for (let i = 0; i < legs.length; i++) {
        limb(ctx, legs[i].map(([x, y]) => ({ x: x * s, y: y + jit(rng, 0.4) })), 1.5, seed + i * 7 + s, { color: '#33221a', taperEnd: 0.35 });
      }
      limb(ctx, [{ x: 1.4 * s, y: -15 }, { x: 4.5 * s, y: -19.5 }, { x: 7 * s, y: -23 }], 1.0, seed + 40 + s, { taperEnd: 0.3 });
      ctx.beginPath(); ctx.arc(7.3 * s, -23.4, 0.9, 0, Math.PI * 2); ctx.fillStyle = LINE; ctx.fill();
    }
    // head
    paint(ctx, blobPoly(0, -13.6, 3.6, 3, seed, { n: 10, jitter: 0.05 }), { base: P.pro, shade: P.shade, deep: P.deep, seed: seed + 1, k: 1.6, lw: 1.2, hatchA: 0.3 });
    // elytra
    const ely = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const rr = 1 + 0.05 * Math.sin(a * 2 + 1);
      ely.push({ x: 8.6 * Math.cos(a) * rr * (Math.sin(a) > 0 ? 0.92 : 1), y: 3.4 + 12.2 * Math.sin(a) * (Math.sin(a) > 0 ? 1.04 : 0.9) });
    }
    // pronotum
    paint(ctx, [{ x: -6.2, y: -7.6 }, { x: -3, y: -11 }, { x: 3, y: -11 }, { x: 6.2, y: -7.6 }, { x: 7, y: -4.8 }, { x: -7, y: -4.8 }], {
      base: P.pro, shade: P.shade, deep: P.deep, seed: seed + 2, k: 2, lw: 1.3, hatchA: 0.3,
    });
    paint(ctx, ely, {
      base: P.base, shade: P.shade, deep: P.deep, seed: seed + 3, k: 3.4, lw: 1.6, hatchA: 0.45, hatchGap: 2,
      inside: (c) => {
        // striae along the elytra and the centre suture
        for (let i = -3; i <= 3; i++) {
          const x = i * 2.3;
          const bow = (1 - Math.abs(i) / 4.5) * 0.9;
          inkStroke(c, [{ x: x * 0.8, y: -4 }, { x: x * 1.02 + bow, y: 4 }, { x: x * 0.6, y: 12.5 }], {
            w: i === 0 ? 1.1 : 0.7, color: i === 0 ? LINE : P.deep, alpha: i === 0 ? 0.85 : 0.5, taperStart: 0.1, taperEnd: 0.4, seed: seed + i, tremor: 0.12,
          });
        }
      },
    });
    glint(ctx, -4.2, 0, 10, 1.7, 1.9, 0.85);
    glint(ctx, 3.6, -1.5, 5, 1.7, 1.2, 0.5);
    // dividing line between pronotum and elytra
    inkStroke(ctx, [{ x: -7, y: -4.6 }, { x: 0, y: -3.6 }, { x: 7, y: -4.6 }], { w: 1.2, color: LINE, alpha: 0.9, seed, taperStart: 0.1, taperEnd: 0.1 });
  }),

  /* ---- seed: a winged maple key (pair of samaras) ---- */
  seed: specimen(16, (ctx, rng, seed) => {
    const wing = (ang, s) => {
      // local frame: u along the wing (0 at the nutlet), leading edge is the straight side
      const L = 16;
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        pts.push({ x: u * L, y: -0.9 * s });
      }
      for (let i = 10; i >= 0; i--) {
        const u = i / 10;
        const w = 0.8 + 5.6 * Math.pow(u, 0.55) * Math.pow(1 - u, 0.5) * 1.9 / 1.9;
        pts.push({ x: u * L, y: 0.9 * s + w * s });
      }
      return xf(pts, 0, 7.5, ang, 1);
    };
    const A1 = -Math.PI / 2 - 0.62;
    const A2 = -Math.PI / 2 + 0.62;
    for (const [ang, s] of [[A1, -1], [A2, 1]]) {
      const poly = wing(ang, s);
      paint(ctx, poly, {
        base: '#e3cf9c', shade: '#b79a62', deep: '#7a6032', seed: seed + (s > 0 ? 7 : 0), k: 1.6, lw: 1.2, smooth: false, hatchA: 0.2, haloA: 0.3,
        inside: (c) => {
          // fan of veins from the nutlet
          for (let i = 0; i < 6; i++) {
            const a = ang + s * (0.05 + i * 0.1);
            const L = 4 + i * 1.6;
            inkStroke(c, [{ x: 0, y: 7.5 }, { x: Math.cos(a) * L * 0.5, y: 7.5 + Math.sin(a) * L * 0.5 }, { x: Math.cos(a) * (L + 6), y: 7.5 + Math.sin(a) * (L + 6) }], {
              w: 0.7, color: '#6a4a24', alpha: 0.55, taperStart: 0.05, taperEnd: 0.6, seed: seed + i, tremor: 0.1,
            });
          }
        },
      });
    }
    for (const s of [-1, 1]) {
      paint(ctx, blobPoly(2.1 * s, 8.6, 3.1, 3.7, seed + s, { n: 9, jitter: 0.06 }), {
        base: '#b99a58', shade: '#7e6130', deep: '#46341a', seed: seed + 11, k: 1.4, lw: 1.2, hatchA: 0.35,
        inside: (c) => { inkStroke(c, [{ x: 1.9 * s - 1, y: 6 }, { x: 1.9 * s - 1.2, y: 9 }, { x: 1.9 * s - 0.4, y: 11 }], { w: 0.6, color: '#46341a', alpha: 0.5, seed }); },
      });
    }
    glint(ctx, -2.2, 7.2, 3.2, 1.7, 1.1, 0.8);
  }),

  /* ---- twig: forked, barky, with buds and a cut end ---- */
  twig: specimen(54, (ctx, rng, seed) => {
    const ribbon = (pts, w0, w1, sd) => {
      const c = [];
      for (let i = 0; i < pts.length - 1; i++) {
        for (let j = 0; j < 6; j++) {
          const t = j / 6;
          c.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t });
        }
      }
      c.push(pts[pts.length - 1]);
      const L = [];
      const R = [];
      for (let i = 0; i < c.length; i++) {
        const a = c[Math.max(0, i - 1)];
        const b = c[Math.min(c.length - 1, i + 1)];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        const t = i / (c.length - 1);
        const h = (w0 + (w1 - w0) * t) * (1 + 0.1 * noise1(i * 0.5 + sd));
        L.push({ x: c[i].x - (dy / l) * h, y: c[i].y + (dx / l) * h });
        R.push({ x: c[i].x + (dy / l) * h, y: c[i].y - (dx / l) * h });
      }
      return { poly: L.concat(R.reverse()), c };
    };
    const mainPts = catmullPts([{ x: -26.5, y: 8 }, { x: -10, y: 4.2 }, { x: 6, y: -0.5 }, { x: 18, y: -5 }, { x: 27, y: -8.5 }]);
    const forkPts = catmullPts([{ x: -4, y: 2.2 }, { x: 3, y: -7 }, { x: 8.5, y: -15 }, { x: 11, y: -22.5 }]);
    const main = ribbon(mainPts, 2.9, 1.5, seed);
    const fork = ribbon(forkPts, 1.9, 0.7, seed + 9);
    const bark = (r, sd, ang) => ({
      base: '#b79a6c', shade: '#74533a', deep: '#41301e', seed: sd, k: 2.4, lw: 1.3, smooth: false, hatchAng: ang, hatchGap: 1.9, hatchA: 0.5,
      inside: (c, b) => {
        // lengthwise bark furrows and pale lenticels
        for (let i = 0; i < 20; i++) {
          const p = r.c[(rng() * (r.c.length - 3)) | 0];
          const p2 = r.c[Math.min(r.c.length - 1, (r.c.indexOf(p) + 3))];
          const nx = p.x + jit(rng, 1.1);
          const ny = p.y + jit(rng, 1.1);
          inkStroke(c, [{ x: nx, y: ny }, { x: nx + (p2.x - p.x) * 0.9, y: ny + (p2.y - p.y) * 0.9 }], { w: 0.8, color: i % 2 ? '#f1ddb0' : '#33231a', alpha: i % 2 ? 0.55 : 0.5, seed: seed + i, tremor: 0.1, step: 1.2 });
        }
      },
    });
    // fork is painted first so the main stem overlaps its root
    paint(ctx, fork.poly, bark(fork, seed + 5, -1.15));
    paint(ctx, main.poly, bark(main, seed + 6, -0.25));
    // cut end: pale wood with growth rings
    const a0 = Math.atan2(mainPts[3].y - mainPts[0].y, mainPts[3].x - mainPts[0].x);
    ctx.save();
    ctx.translate(mainPts[0].x, mainPts[0].y);
    ctx.rotate(a0);
    paint(ctx, blobPoly(0, 0, 1.9, 3.1, seed, { n: 10, jitter: 0.04 }), {
      base: '#ecd7a6', shade: '#c0a06c', deep: '#7a5c36', seed: seed + 2, k: 1, lw: 1.1, hatchA: 0, haloA: 0.2,
      inside: (c) => { c.beginPath(); c.ellipse(0, 0, 0.9, 1.7, 0, 0, Math.PI * 2); c.lineWidth = 0.55; c.strokeStyle = rgba('#6a4a28', 0.8); c.stroke(); },
    });
    ctx.restore();
    // buds: pairs of little pointed scales, plus terminal buds
    const bud = (x, y, ang, s = 1) => {
      const poly = xf([{ x: -2.1, y: 0 }, { x: -0.6, y: -1.5 }, { x: 1.6, y: -1.1 }, { x: 3.4, y: 0 }, { x: 1.6, y: 1.1 }, { x: -0.6, y: 1.5 }], x, y, ang, s);
      paint(ctx, poly, { base: '#a55a3a', shade: '#6a2f1c', deep: '#3a1a10', seed: seed + (x | 0), k: 1, lw: 1, hatchA: 0, haloA: 0.25, smooth: true, wobble: 0 });
    };
    const at = (r, t) => r.c[Math.round(t * (r.c.length - 1))];
    for (const t of [0.35, 0.62, 0.8]) { const p = at(main, t); bud(p.x - 0.5, p.y - 3.3, -1.1, 0.9); }
    for (const t of [0.5, 0.72]) { const p = at(fork, t); bud(p.x + 2.4, p.y - 0.8, -0.5, 0.85); }
    const tf = fork.c[fork.c.length - 1];
    bud(tf.x + 0.5, tf.y - 1.4, -1.4, 1.1);
    const tm = main.c[main.c.length - 1];
    bud(tm.x + 1.4, tm.y - 0.6, -0.5, 1.15);
    glint(ctx, -14, 2.4, 9, -0.2, 1.4, 0.5);
  }),

  /* ---- pebble: rounded, speckled, with a quartz vein ---- */
  pebble: specimen(26, (ctx, rng, seed) => {
    const poly = blobPoly(0, 0.5, 12.8, 10.2, seed, { n: 13, jitter: 0.13, rot: rng() * 0.6 - 0.3 });
    paint(ctx, poly, {
      base: '#a7a69e', shade: '#6a6c78', deep: '#40445a', seed, k: 3.6, lw: 1.6, hatchA: 0.42, hatchAng: 0.55, hatchGap: 2.4,
      inside: (c, b) => {
        // mottled tone
        for (let i = 0; i < 5; i++) {
          c.beginPath();
          tracePath(c, raggedPoly(blobPoly(jit(rng, 8), jit(rng, 6), 3 + rng() * 4, 2 + rng() * 3, seed + i, { n: 8, jitter: 0.3 }), 1, seed + i), true, true);
          c.fillStyle = rgba(i % 2 ? '#c4b79a' : '#7e8088', 0.38);
          c.fill();
        }
        // quartz vein
        inkStroke(c, [{ x: -13, y: 1 + jit(rng, 3) }, { x: -3, y: -2 }, { x: 5, y: 3 }, { x: 14, y: -1 + jit(rng, 3) }], { w: 2.6, color: '#f3ecdb', alpha: 0.8, taperStart: 0.15, taperEnd: 0.15, seed: seed + 3, tremor: 0.5, press: 0.5 });
        stipple(c, poly, { count: 38, color: '#2e2a30', alpha: 0.7, rMax: 0.9, seed });
        stipple(c, poly, { count: 26, color: '#fbf5e4', alpha: 0.7, rMax: 0.8, seed: seed + 5 });
      },
    });
    glint(ctx, -5.5, -4.8, 6, 2.3, 1.8, 0.75);
  }),

  /* ---- bone: small animal bone with a knob pair at each end ---- */
  bone: specimen(46, (ctx, rng, seed) => {
    const knobs = [
      { cx: -19.6, cy: -4.4, r: 4.1 }, { cx: -19.6, cy: 4.4, r: 4.1 },
      { cx: 19.8, cy: -4.2, r: 3.9 }, { cx: 19.8, cy: 4.2, r: 3.9 },
    ];
    const shaft = (x) => 2.7 + 1.4 * Math.pow(Math.abs(x) / 23, 3) + 0.3 * noise1(x * 0.15 + seed);
    const top = (x) => {
      let h = shaft(x);
      for (const k of knobs) {
        if (k.cy > 0) continue;
        const d = x - k.cx;
        if (Math.abs(d) < k.r) h = Math.max(h, -k.cy + Math.sqrt(k.r * k.r - d * d));
      }
      return h;
    };
    const poly = [];
    for (let x = -24; x <= 24; x += 0.8) poly.push({ x, y: -top(x) });
    for (let x = 24; x >= -24; x -= 0.8) poly.push({ x, y: top(x) });
    paint(ctx, poly, {
      base: '#ebe0c4', shade: '#b8a67c', deep: '#7c6a46', seed, k: 2.8, lw: 1.5, smooth: false, hatchA: 0.42, hatchAng: 1.1, hatchGap: 2,
      inside: (c) => {
        // joint cleft lines and pores
        for (const sx of [-1, 1]) {
          inkStroke(c, [{ x: sx * 15.2, y: -0.8 }, { x: sx * 17.6, y: 0 }, { x: sx * 21, y: 0.3 }], { w: 1, color: '#5a4a30', alpha: 0.8, taperStart: 0.1, taperEnd: 0.6, seed: seed + sx });
        }
        for (const k of knobs) {
          c.beginPath(); c.arc(k.cx + (k.cx < 0 ? 0.6 : -0.6), k.cy + (k.cy < 0 ? 0.5 : -0.5), k.r * 0.55, 0.3, 4.4);
          c.lineWidth = 0.7; c.strokeStyle = rgba('#7c6a46', 0.5); c.stroke();
        }
        stipple(c, poly, { count: 40, color: '#6a5a3c', alpha: 0.55, rMax: 0.7, seed });
        // faint cracks
        inkStroke(c, [{ x: -6 + jit(rng, 3), y: -2.2 }, { x: -3, y: 0.5 }, { x: -4, y: 2.4 }], { w: 0.6, color: '#5a4a30', alpha: 0.55, seed: seed + 8 });
      },
    });
    glint(ctx, -6, -2, 16, 0.02, 1.5, 0.8);
    glint(ctx, -20.5, -6.2, 3.5, 0.8, 1.2, 0.8);
    glint(ctx, 18.8, -5.8, 3.2, 0.7, 1.2, 0.7);
  }),

  /* ---- shell: ribbed scallop, pearly ---- */
  shell: specimen(34, (ctx, rng, seed) => {
    const hx = 0;
    const hy = 11.5;
    const R = 24;
    const span = 0.82; // half-angle of the fan
    const ribs = 11;
    const poly = [{ x: -10, y: 12.5 }, { x: -7.2, y: 8.6 }, { x: -3, y: 9 }];
    const N = 44;
    for (let i = 0; i <= N; i++) {
      const a = -Math.PI / 2 - span + (2 * span * i) / N;
      const k = Math.abs(Math.sin((i / N) * ribs * Math.PI));
      const r = R * (0.9 + 0.1 * Math.pow(k, 0.5)) * (1 - 0.1 * Math.pow(Math.abs(i / N - 0.5) * 2, 3)) + 0.3 * noise1(i * 0.6 + seed);
      poly.push({ x: hx + r * Math.cos(a), y: hy + r * Math.sin(a) });
    }
    poly.push({ x: 3, y: 9 }, { x: 7.2, y: 8.6 }, { x: 10, y: 12.5 }, { x: 4, y: 14 }, { x: -4, y: 14 });
    const rim = '#ba8e9e';
    paint(ctx, poly, {
      base: '#ecd5c8', shade: '#bf9aa2', deep: '#7c5868', seed, k: 3.6, lw: 1.5, smooth: false, hatchA: 0.34, hatchGap: 2.2, hatchAng: 1.2,
      inside: (c) => {
        // alternating lilac/peach wedges give the pearly banding
        for (let i = 0; i < ribs; i += 2) {
          const a0 = -Math.PI / 2 - span + (2 * span * i) / ribs;
          const a1 = -Math.PI / 2 - span + (2 * span * (i + 1)) / ribs;
          c.beginPath(); c.moveTo(hx, hy); c.arc(hx, hy, R * 1.1, a0, a1); c.closePath();
          c.fillStyle = rgba(rim, 0.34); c.fill();
        }
        // growth arcs
        for (let g = 0; g < 4; g++) {
          const rr = 8 + g * 4.4 + jit(rng, 0.3);
          c.beginPath(); c.arc(hx, hy, rr, -Math.PI / 2 - span, -Math.PI / 2 + span);
          c.lineWidth = 0.6; c.strokeStyle = rgba('#7c5868', 0.3); c.stroke();
        }
        // radial ribs: dark ink with a pale ridge beside each
        for (let i = 0; i <= ribs; i++) {
          const a = -Math.PI / 2 - span + (2 * span * i) / ribs;
          const r1 = R * 0.96;
          const p0 = { x: hx + 2 * Math.cos(a), y: hy + 2 * Math.sin(a) };
          const p1 = { x: hx + r1 * 0.55 * Math.cos(a + 0.01), y: hy + r1 * 0.55 * Math.sin(a + 0.01) };
          const p2 = { x: hx + r1 * Math.cos(a), y: hy + r1 * Math.sin(a) };
          inkStroke(c, [{ x: p0.x - 0.5, y: p0.y }, { x: p1.x - 0.5, y: p1.y }, { x: p2.x - 0.5, y: p2.y }], { w: 0.9, color: '#fff3e6', alpha: 0.7, taperStart: 0.05, taperEnd: 0.5, seed: seed + i, tremor: 0.1 });
          inkStroke(c, [p0, p1, p2], { w: 1.0, color: '#5a3848', alpha: 0.65, taperStart: 0.05, taperEnd: 0.45, seed: seed + i + 20, tremor: 0.12 });
        }
        // umbo
        c.beginPath(); c.ellipse(hx, hy - 0.5, 3.4, 2.4, 0, 0, Math.PI * 2); c.fillStyle = rgba('#8a5a70', 0.4); c.fill();
      },
    });
    glint(ctx, -6, -3, 10, -1.25, 1.8, 0.75);
    glint(ctx, 5, -6, 6, -1.7, 1.2, 0.5);
  }),

  /* ---- potsherd: terracotta shard with a painted band and zigzag ---- */
  potsherd: specimen(36, (ctx, rng, seed) => {
    const base = [
      [-17, -2], [-12, -10], [-3, -13.5], [6, -11.5], [15, -9], [18, 0], [12, 7.5], [13, 13], [3, 12], [-5, 14], [-11, 8], [-18, 6],
    ];
    const poly = base.map(([x, y], i) => ({ x: x + jit(rng, 1.3), y: y + jit(rng, 1.3) + (i === 4 ? 0.5 : 0) }));
    const ang = -0.2 + jit(rng, 0.25);
    const slip = '#e3cfa6';
    const dark = '#3a2118';
    paint(ctx, poly, {
      base: '#bc6140', shade: '#8a3f28', deep: '#4e2216', seed, k: 3.4, lw: 1.5, smooth: false, hatchA: 0.38, hatchGap: 2.2, hatchAng: 0.6,
      inside: (c) => {
        c.save();
        c.rotate(ang);
        // soot/uneven firing
        for (let i = 0; i < 4; i++) {
          c.beginPath(); tracePath(c, blobPoly(jit(rng, 14), jit(rng, 10), 4 + rng() * 5, 3 + rng() * 3, seed + i, { n: 8, jitter: 0.3 }), true, true);
          c.fillStyle = rgba(i % 2 ? '#d98a5c' : '#7a3322', 0.3); c.fill();
        }
        // cream slip band with painted border lines
        const bandY0 = -4.4;
        const bandY1 = 4.8;
        const curve = (y) => (x) => y + 0.012 * x * x;
        c.beginPath();
        for (let x = -24; x <= 24; x += 4) c.lineTo(x, curve(bandY0)(x));
        for (let x = 24; x >= -24; x -= 4) c.lineTo(x, curve(bandY1)(x));
        c.closePath();
        c.fillStyle = rgba(slip, 0.96); c.fill();
        for (const by of [bandY0, bandY1]) {
          const pts = []; for (let x = -24; x <= 24; x += 4) pts.push({ x, y: curve(by)(x) });
          inkStroke(c, pts, { w: 1.5, color: dark, alpha: 0.95, taperStart: 0.02, taperEnd: 0.02, seed: seed + by, tremor: 0.3 });
        }
        // zigzag
        const zz = [];
        for (let i = 0; i <= 12; i++) { const x = -24 + i * 4; zz.push({ x, y: curve(0.2)(x) + (i % 2 ? 2.4 : -2.4) }); }
        inkStroke(c, zz, { w: 1.5, color: '#7a2a1c', alpha: 0.95, smooth: false, taperStart: 0.02, taperEnd: 0.02, seed: seed + 9, tremor: 0.25, step: 1.5 });
        // dots below the band, a thin line above
        for (let x = -22; x < 24; x += 4.2) {
          c.beginPath(); c.arc(x + jit(rng, 0.4), curve(8.6)(x) + jit(rng, 0.3), 0.95, 0, Math.PI * 2); c.fillStyle = rgba(dark, 0.85); c.fill();
        }
        const up = []; for (let x = -24; x <= 24; x += 4) up.push({ x, y: curve(-8.2)(x) });
        inkStroke(c, up, { w: 0.9, color: dark, alpha: 0.75, seed: seed + 5, tremor: 0.3 });
        c.restore();
        stipple(c, poly, { count: 30, color: '#f0c9a0', alpha: 0.45, rMax: 0.7, seed });
      },
      after: (c) => {
        // broken edge shows the pale fired core
        pathOf(c, poly, false);
        c.lineWidth = 2.4; c.strokeStyle = rgba('#e8b690', 0.85); c.lineJoin = 'round'; c.stroke();
      },
    });
    glint(ctx, -9, -9, 7, 0.25, 1.4, 0.55);
  }),

  /* ---- ammonite: ribbed logarithmic spiral fossil ---- */
  ammonite: specimen(46, (ctx, rng, seed) => {
    const turns = 3.15;
    const TH = turns * 2 * Math.PI;
    const g = 2.15; // growth per whorl
    const R = 22.3;
    const b = Math.log(g) / (2 * Math.PI);
    const r0 = R / Math.exp(b * TH);
    const rAt = (th) => r0 * Math.exp(b * th);
    const rot0 = rng() * 0.8 - 0.4;
    const P = (th, f = 1) => ({ x: rAt(th) * f * Math.cos(th + rot0), y: rAt(th) * f * Math.sin(th + rot0) });
    // outline = the last whorl, closed by the aperture step
    const poly = [];
    for (let th = TH - 2 * Math.PI; th <= TH; th += 0.12) poly.push(P(th));
    poly.push(P(TH));
    paint(ctx, poly, {
      base: '#c8b68a', shade: '#8f7c58', deep: '#554530', seed, k: 4.4, lw: 1.7, smooth: true, hatchA: 0.36, hatchGap: 2.2, hatchAng: 0.8,
      inside: (c) => {
        // grey mineral mottling
        for (let i = 0; i < 6; i++) {
          c.beginPath(); tracePath(c, raggedPoly(blobPoly(jit(rng, 14), jit(rng, 14), 3 + rng() * 5, 3 + rng() * 4, seed + i, { n: 8, jitter: 0.3 }), 1, seed + i), true, true);
          c.fillStyle = rgba(i % 2 ? '#9a9890' : '#d8c898', 0.34); c.fill();
        }
        // ribs: each whorl is the band between r(th - 2pi) and r(th)
        for (let th = 1.2 * Math.PI; th < TH - 0.02; th += 0.17 + 0.03 * Math.sin(th)) {
          const f0 = 1 / g;
          const a = P(th - 0.1, 0.5 * (1 + f0) * 0.0 + f0 * 1.08);
          const m = P(th - 0.02, 0.5 * (1 + f0));
          const e = P(th, 0.97);
          // relief: a pale ridge, then the dark furrow beside it
          inkStroke(c, [{ x: a.x - 0.4, y: a.y - 0.5 }, { x: m.x - 0.4, y: m.y - 0.5 }, { x: e.x - 0.4, y: e.y - 0.5 }], { w: 0.9, color: '#f6e8c0', alpha: 0.55, taperStart: 0.15, taperEnd: 0.3, tremor: 0.1, seed: (th * 9) | 0, step: 1.5 });
          inkStroke(c, [a, m, e], { w: 0.95, color: '#4a3a26', alpha: 0.75, taperStart: 0.15, taperEnd: 0.3, tremor: 0.12, seed: ((th * 9) | 0) + 5, step: 1.5 });
        }
        // suture lines between whorls
        const sp = [];
        for (let th = 0.35 * Math.PI; th <= TH; th += 0.18) sp.push(P(th));
        inkStroke(c, sp, { w: 1.3, color: '#33261a', alpha: 0.85, taperStart: 0.04, taperEnd: 0.02, seed, tremor: 0.2 });
        // central eye
        c.beginPath(); c.arc(P(0).x, P(0).y, 1.4, 0, Math.PI * 2); c.fillStyle = rgba('#33261a', 0.7); c.fill();
        stipple(c, poly, { count: 40, color: '#33261a', alpha: 0.45, rMax: 0.7, seed });
      },
    });
    glint(ctx, -8, -10, 10, 2.2, 1.8, 0.6);
  }),
};

export { DRAWERS };

/** Catmull-Rom through a few control points, as plain points (local helper, smoother centre-lines). */
function catmullPts(pts) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    for (let j = 0; j < 4; j++) {
      const t = j / 4;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[n - 1]);
  return out;
}

/* ------------------------------------------------------------------ public */

/** Soft contact shadow, offset away from the light, drawn in the item's rotated frame. */
function contactShadow(ctx, type, sc, rot) {
  const [rx, ry] = SHADOW[type] || SHADOW.pebble;
  ctx.save();
  ctx.translate(2.4 * sc, 3.6 * sc); // world-space offset: the light is always upper-left
  ctx.rotate(rot);
  ctx.scale(rx * sc * 1.12, ry * sc * 1.12);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(6,3,3,0.62)');
  g.addColorStop(0.55, 'rgba(6,3,3,0.42)');
  g.addColorStop(1, 'rgba(6,3,3,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Illustrated specimens are drawn a little larger than the manifest's world size: they lie on dark soil and read small. */
const SPECIMEN_BOOST = 1.3;

/** Types whose illustration rests on the soil (anchor at the bottom): they only tilt a little. */
const UPRIGHT = new Set(['snail']);

/**
 * An illustrated specimen (assets/art, group 'decor'): a soft pale «label» behind it and a thin light rim, so the
 * ink cut-out does not drown in dark soil. Returns false when the type has no image (the caller draws it by hand).
 * o.px = device pixels per world unit of the current transform (picks a pre-filtered copy of the image).
 */
function drawSpecimen(ctx, decor, type, seed, px) {
  const hv = hash32(seed, decor.id ?? 0, 'sprite');
  const sp = getSprite('decor', type, hv);
  if (!sp) return false;
  const sc = decor.scale || 1;
  const k = (sp.worldSize * sc * SPECIMEN_BOOST) / sp.h; // world units per image pixel
  const rot = UPRIGHT.has(type) ? Math.max(-0.4, Math.min(0.4, Math.sin(decor.rot || 0) * 0.4)) : decor.rot || 0;
  const dw = sp.w * k;
  const dh = sp.h * k;
  const cx = (sp.w / 2 - sp.anchor.x) * k; // image centre relative to the resting point
  const cy = (sp.h / 2 - sp.anchor.y) * k;
  const lv = levelFor(sp, dh * (px || 1));
  ctx.save();
  ctx.translate(decor.x || 0, decor.y || 0);
  ctx.rotate(rot);
  if (hv & 1) ctx.scale(-1, 1);
  // a small dark seat so the piece lies in the soil
  const sr = Math.max(dw, dh) * 0.5;
  const seat = ctx.createRadialGradient(cx + 1.5 * sc, cy + 2.5 * sc, 0, cx + 1.5 * sc, cy + 2.5 * sc, sr);
  seat.addColorStop(0, 'rgba(6,3,3,0.5)');
  seat.addColorStop(1, 'rgba(6,3,3,0)');
  ctx.fillStyle = seat;
  ctx.beginPath();
  ctx.arc(cx + 1.5 * sc, cy + 2.5 * sc, sr, 0, Math.PI * 2);
  ctx.fill();
  // the specimen label: pale parchment wash behind the piece
  const lr = Math.max(dw, dh) * 0.62;
  const lab = ctx.createRadialGradient(cx, cy, 0, cx, cy, lr);
  lab.addColorStop(0, 'rgba(243,232,204,0.38)');
  lab.addColorStop(0.65, 'rgba(236,222,190,0.19)');
  lab.addColorStop(1, 'rgba(236,222,190,0)');
  ctx.fillStyle = lab;
  ctx.beginPath();
  ctx.ellipse(cx, cy, lr * (dw >= dh ? 1 : 0.8), lr * (dw >= dh ? 0.8 : 1), 0, 0, Math.PI * 2);
  ctx.fill();
  // thin light rim: the cut-out's own shadow, blurred and pale (the blur is in device pixels)
  ctx.shadowColor = 'rgba(250,240,214,0.95)';
  ctx.shadowBlur = Math.max(1.5, (px || 1) * 1.4);
  const dx = -sp.anchor.x * k;
  const dy = -sp.anchor.y * k;
  ctx.drawImage(lv.src, dx, dy, dw, dh);
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.drawImage(lv.src, dx, dy, dw, dh);
  ctx.restore();
  return true;
}

/**
 * Draw one world.decor item. ctx has a world-unit transform.
 * decor: { id, type, x, y, rot, scale }; o: { seed = 0 (the world seed, so the same world paints the same plates),
 * px = device pixels per world unit }. An illustration is used when the manifest has one for the type, else the
 * hand-drawn specimen below.
 */
export function drawDecor(ctx, decor, o = {}) {
  const { seed = 0 } = o;
  const type = DRAWERS[decor.type] ? decor.type : 'pebble';
  try {
    if (decor.type !== undefined && drawSpecimen(ctx, decor, decor.type, seed, o.px)) return;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('decor sprite failed for', decor && decor.type, e);
  }
  const sc = decor.scale || 1;
  const rot = decor.rot || 0;
  ctx.save();
  try {
    ctx.translate(decor.x || 0, decor.y || 0);
    contactShadow(ctx, type, sc, rot);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    DRAWERS[type](ctx, hash32(seed, decor.id ?? 0, type), DECOR_SIZE[type]);
  } catch (e) {
    // a broken specimen must never take the whole scene down
    if (typeof console !== 'undefined') console.warn('drawDecor failed for', decor && decor.type, e);
  }
  ctx.restore();
}

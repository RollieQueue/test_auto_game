// Static terrain painter: sky wash, soil horizons as watercolor, texture and ink, rocks, ground vegetation.
// Everything here is painted once into the cached world layer (world units, ctx already transformed).
import {
  PAL,
  blobPoly,
  clipTo,
  darken,
  hatch,
  inkDashed,
  inkOutline,
  inkStroke,
  lighten,
  mix,
  mulberry,
  noise1,
  rgb,
  rgba,
  seedOf,
  smooth01,
  stipple,
  subSeed,
  tracePath,
  wash,
  raggedPoly,
} from './ink.js';
import { sampleProfile } from '../world/query.js';

const PAPER_RGB = rgb(PAL.paper);
/** The multiply colour that, painted on paper, gives the wanted final colour. */
const paperMul = (final) => {
  const [r, g, b] = rgb(final);
  const h = (v, p) => Math.min(255, Math.round((v / p) * 255)).toString(16).padStart(2, '0');
  return `#${h(r, PAPER_RGB[0])}${h(g, PAPER_RGB[1])}${h(b, PAPER_RGB[2])}`;
};

/** Final (on paper) colours of the horizons, by id; unknown ids fall back to the world's own colour. */
const BANDS = {
  litter: { final: '#9a7248', accents: ['#b07a46', '#74502e', '#947c42', '#835a36'] },
  humus: { final: '#654835', accents: ['#775238', '#54392d', '#684c30', '#5a4533'] },
  loam: { final: '#86643f', accents: ['#9a6e44', '#6a5240', '#8a6234', '#755c48'] },
  clay: { final: '#9a6848', accents: ['#ae6c40', '#765a6a', '#a06440', '#85583f'] },
  gravel: { final: '#4a5472', accents: ['#5a6078', '#3c4664', '#625c74', '#44587c'] },
};

export function paintTerrain(ctx, world, ext, hooks = {}) {
  const hs = world.horizons;
  const step = world.step;
  const seed = world.seed;
  const rng = mulberry(subSeed(seed, 'terrain'));
  const topY = (i, x) => sampleProfile(hs[i].top, step, x);
  const botY = (i, x) => (i + 1 < hs.length ? topY(i + 1, x) : ext.y1 + 90);
  const gY = (x) => topY(0, x);
  const x0 = ext.x0 - 70;
  const x1 = ext.x1 + 70;
  const profile = (yAt, dy = 0) => {
    const pts = [];
    const s0 = Math.floor(x0 / step) * step;
    for (let x = s0; x <= x1 + step; x += step) pts.push({ x, y: yAt(x) + dy });
    return pts;
  };
  const groundMin = Math.min(...world.ground);

  paintSky(ctx, world, ext, groundMin, profile, gY, rng);

  /* ---- soil bands: base wash, then mottling ---- */
  const bandPoly = (i) => {
    const top = profile((x) => topY(i, x));
    const bot = profile((x) => botY(i, x), i + 1 < hs.length ? 5 : 0).reverse();
    return top.concat(bot);
  };
  const polys = hs.map((_, i) => bandPoly(i));
  const finals = hs.map((h) => (BANDS[h.id] || { final: h.color, accents: [h.color] }));

  ctx.save();
  hs.forEach((h, i) => {
    const b = finals[i];
    // Wash only the wet edge once heavily, then the body in a looser stroke.
    wash(ctx, polys[i], { color: paperMul(b.final), alpha: 0.95, layers: 3, ragged: i === 0 ? 1.6 : 3.2, edge: 0.7, edgeW: 2, seed: seed + i * 101, comp: 'multiply' });
  });
  ctx.restore();

  // Mottled blooms inside each band: darker/warmer/cooler pools of pigment.
  hs.forEach((h, i) => {
    const b = finals[i];
    let height = 0;
    for (let x = 0; x <= world.width; x += 160) height += botY(i, x) - topY(i, x);
    height /= Math.ceil(world.width / 160) + 1;
    const area = Math.min(height, 700) * (ext.x1 - ext.x0);
    const count = Math.round(area / 5200);
    for (let k = 0; k < count; k++) {
      const x = ext.x0 + rng() * (ext.x1 - ext.x0);
      const ty = topY(i, x);
      const by = botY(i, x);
      const bh = Math.min(by - ty, 800);
      const ry = Math.min(14 + rng() * 55, bh * 0.38);
      if (ry < 5) continue;
      const y = ty + ry + rng() * Math.max(1, bh - ry * 2);
      const rx = 40 + rng() * 130;
      const acc = b.accents[Math.floor(rng() * b.accents.length)];
      const blob = blobPoly(x, y, rx, ry, seed + k * 13 + i, { n: 12, jitter: 0.3, rot: (rng() - 0.5) * 0.3 });
      wash(ctx, blob, { color: paperMul(acc), alpha: 0.15 + rng() * 0.22, layers: 2, ragged: 3, edge: 0.45, edgeW: 1.6, seed: seed + k, comp: 'multiply' });
    }
  });

  // Depth: a deepening indigo veil.
  ctx.save();
  const dg = ctx.createLinearGradient(0, groundMin + 40, 0, ext.y1);
  dg.addColorStop(0, 'rgba(255,255,255,1)');
  dg.addColorStop(0.55, 'rgba(218,216,232,1)');
  dg.addColorStop(1, 'rgba(168,172,208,1)');
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = dg;
  ctx.fillRect(ext.x0, groundMin + 40, ext.x1 - ext.x0, ext.y1 - groundMin);
  ctx.restore();

  paintSoilTexture(ctx, world, ext, { topY, botY, finals, polys, hooks, rng });

  // Wavy inked boundaries between horizons: a dark broken pen line with a pale dotted echo.
  for (let i = 1; i < hs.length; i++) {
    const pts = profile((x) => topY(i, x), 1.5);
    inkDashed(ctx, pts, { w: 1.3, color: '#150c07', alpha: 0.42, dash: 16, gap: 5, seed: seed + i * 7, taperStart: 0.3, taperEnd: 0.3 });
    inkDashed(ctx, profile((x) => topY(i, x), 4.5), { w: 0.9, color: '#d9c18c', alpha: 0.26, dash: 3, gap: 9, seed: seed + i * 11, taperStart: 0.5, taperEnd: 0.5, press: 0.1 });
  }

  paintRocks(ctx, world, seed);
  paintSurface(ctx, world, ext, { gY, profile, rng, seed });
  paintMarginalia(ctx, world, ext, { topY, botY, gY, unit: hooks.cssUnit || 1 });
}

/* ------------------------------------------------------------------------- sky */

function paintSky(ctx, world, ext, groundMin, profile, gY, rng) {
  const seed = world.seed;
  const w = ext.x1 - ext.x0;
  ctx.save();
  // Pale cool wash fading down toward a warm haze at the horizon.
  const g = ctx.createLinearGradient(0, ext.y0, 0, groundMin + 6);
  g.addColorStop(0, 'rgba(190,208,220,0.13)');
  g.addColorStop(0.62, 'rgba(226,230,226,0.05)');
  g.addColorStop(1, 'rgba(250,220,160,0.14)');
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = g;
  ctx.fillRect(ext.x0, ext.y0, w, groundMin + 6 - ext.y0);
  ctx.restore();

  // Horizontal wash streaks.
  for (let k = 0; k < 9; k++) {
    const cx = ext.x0 + rng() * w;
    const cy = ext.y0 + 20 + rng() * (groundMin - ext.y0 - 40);
    const blob = blobPoly(cx, cy, 160 + rng() * 380, 9 + rng() * 20, seed + 40 + k, { n: 12, jitter: 0.25 });
    wash(ctx, blob, { color: k % 3 === 0 ? '#f0d9a8' : '#c4d4de', alpha: 0.05 + rng() * 0.05, layers: 2, ragged: 4, edge: 0.5, seed: seed + k, comp: 'multiply' });
  }

  // (clouds are live sprites drifting in ambient.js)

  // Distant tree-lines: two hazy ranges of crowns, far one bluer.
  const far = [];
  const near = [];
  const s0 = Math.floor((ext.x0 - 70) / 8) * 8;
  const so = seedOf(seed);
  for (let x = s0; x <= ext.x1 + 70; x += 8) {
    const gx = gY(x);
    const bump = (n, f, a) => Math.max(0, noise1(x * f + so + n)) * a;
    far.push({ x, y: gx - 26 - bump(1, 0.012, 34) - bump(2, 0.05, 12) - 6 * Math.abs(Math.sin(x * 0.09 + so)) });
    near.push({ x, y: gx - 12 - bump(5, 0.02, 20) - bump(6, 0.07, 8) - 4 * Math.abs(Math.sin(x * 0.13 + so)) });
  }
  const closeTo = (arr, bottom) => arr.concat([{ x: arr[arr.length - 1].x, y: bottom }, { x: arr[0].x, y: bottom }]);
  wash(ctx, closeTo(far, groundMin + 30), { color: '#b4c4c0', alpha: 0.24, layers: 3, ragged: 1.6, edge: 0.4, edgeW: 1.2, seed: seed + 71, comp: 'multiply', smooth: false });
  wash(ctx, closeTo(near, groundMin + 30), { color: '#a8bc94', alpha: 0.26, layers: 3, ragged: 1.8, edge: 0.5, edgeW: 1.2, seed: seed + 72, comp: 'multiply', smooth: false });
}

/* ------------------------------------------------------------------- soil texture */

function paintSoilTexture(ctx, world, ext, { topY, botY, finals, hooks, rng }) {
  const hs = world.horizons;
  const seed = world.seed;
  const W = ext.x1 - ext.x0;
  const avoid = hooks.avoid || (() => false);
  const inBand = (i, margin = 3) => {
    for (let t = 0; t < 8; t++) {
      const x = ext.x0 + rng() * W;
      const ty = topY(i, x) + margin;
      const by = botY(i, x) - margin;
      if (by - ty < 4) continue;
      return { x, y: ty + rng() * (by - ty), ty, by };
    }
    return null;
  };

  hs.forEach((h, i) => {
    let height = 0;
    for (let x = 0; x <= world.width; x += 160) height += Math.min(botY(i, x), world.height + 40) - topY(i, x);
    height /= Math.ceil(world.width / 160) + 1;
    const area = height * W;
    const grav = h.id === 'gravel';
    const clay = h.id === 'clay';
    const lit = h.id === 'litter';

    // Sand and mineral grains (light), pigment specks (dark).
    ctx.save();
    const sandN = Math.round(area / (grav ? 140 : lit ? 260 : 330));
    for (let k = 0; k < sandN; k++) {
      const p = inBand(i);
      if (!p) continue;
      const r = 0.35 + rng() * rng() * (grav ? 1.7 : 1.2);
      ctx.fillStyle = rgba(rng() < 0.7 ? '#d6bd88' : '#f2e4bd', 0.16 + rng() * 0.3);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * 0.75, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const darkN = Math.round(area / 260);
    for (let k = 0; k < darkN; k++) {
      const p = inBand(i);
      if (!p) continue;
      const r = 0.4 + rng() * rng() * 1.5;
      ctx.fillStyle = rgba('#0f0905', 0.2 + rng() * 0.35);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * 0.8, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Shading patches hatched in ink.
    const patches = Math.round(area / (grav ? 52000 : 36000));
    for (let k = 0; k < patches; k++) {
      const p = inBand(i, 8);
      if (!p) continue;
      const rx = 30 + rng() * 70;
      const ry = Math.min(12 + rng() * 26, (p.by - p.ty) * 0.4);
      if (ry < 6) continue;
      const blob = blobPoly(p.x, p.y, rx, ry, seed + k * 5 + i, { n: 10, jitter: 0.3, rot: (rng() - 0.5) * 0.5 });
      hatch(ctx, blob, { angle: 0.75 + (rng() - 0.5) * 0.4, gap: 4 + rng() * 2, w: 0.7, color: '#0c0603', alpha: 0.22 + rng() * 0.12, seed: seed + k, lenVar: 0.5 });
    }

    // Pebbles.
    const pebN = Math.round(area / (grav ? 3600 : clay ? 15000 : lit ? 22000 : 16000));
    for (let k = 0; k < pebN; k++) {
      const p = inBand(i, 4);
      if (!p || avoid(p.x, p.y, 26)) continue;
      const rx = (grav ? 4 : 2) + rng() * (grav ? 9 : 3.6);
      pebble(ctx, p.x, p.y, rx, rx * (0.6 + rng() * 0.3), seed + k * 3 + i, rng, h.id);
    }

    // Layer-specific marks.
    if (lit || h.id === 'humus') {
      const fibN = Math.round(area / (lit ? 520 : 1500));
      for (let k = 0; k < fibN; k++) {
        const p = inBand(i, 2);
        if (!p) continue;
        const len = 9 + rng() * 26;
        const a = (rng() - 0.5) * 1.6 + (rng() < 0.2 ? Math.PI / 2 : 0);
        const bend = (rng() - 0.5) * len * 0.5;
        inkStroke(
          ctx,
          [
            { x: p.x, y: p.y },
            { x: p.x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y: p.y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend },
            { x: p.x + Math.cos(a) * len, y: p.y + Math.sin(a) * len },
          ],
          { w: 0.7 + rng() * 0.6, color: rng() < 0.6 ? '#a98456' : '#c9a66a', alpha: 0.28 + rng() * 0.25, seed: seed + k, taperStart: 0.1, taperEnd: 0.7, tremor: 0.4 },
        );
      }
    }
    if (lit) {
      const leafN = Math.round(W / 38);
      for (let k = 0; k < leafN; k++) {
        const x = ext.x0 + rng() * W;
        const ty = topY(0, x);
        const y = ty + 4 + rng() * Math.max(2, Math.min(botY(0, x) - ty - 7, 20));
        litterLeaf(ctx, x, y, 8 + rng() * 11, (rng() - 0.5) * 1.1, seed + k, rng);
      }
    }
    if (clay || h.id === 'loam') {
      const strN = Math.round(area / 9500);
      for (let k = 0; k < strN; k++) {
        const p = inBand(i, 6);
        if (!p) continue;
        const len = 50 + rng() * 120;
        const pts = [];
        for (let s = 0; s <= 5; s++) pts.push({ x: p.x + (s / 5) * len, y: p.y + noise1(s * 1.3 + k) * 5 + (s / 5) * (rng() - 0.5) * 8 });
        inkStroke(ctx, pts, { w: 1.1 + rng() * 1.4, color: clay ? '#d9a574' : '#cdb287', alpha: 0.09 + rng() * 0.1, seed: seed + k, taperStart: 0.4, taperEnd: 0.5, tremor: 0.6 });
      }
      const crackN = Math.round(area / 28000);
      for (let k = 0; k < crackN; k++) {
        const p = inBand(i, 10);
        if (!p) continue;
        crack(ctx, p.x, p.y, 16 + rng() * 26, seed + k * 7, rng);
      }
    }
    if (grav) {
      const bigN = Math.round(area / 9000);
      for (let k = 0; k < bigN; k++) {
        const p = inBand(i, 6);
        if (!p || avoid(p.x, p.y, 40)) continue;
        const rx = 6 + rng() * 11;
        pebble(ctx, p.x, p.y, rx, rx * (0.55 + rng() * 0.25), seed + k * 11, rng, 'gravel');
      }
    }
  });
}

function pebble(ctx, x, y, rx, ry, seed, rng, band) {
  const tone = band === 'gravel' ? ['#8c8a8e', '#a39a8c', '#78808c'] : band === 'clay' ? ['#a08672', '#8d7765', '#b09a80'] : ['#8f8068', '#7a6c58', '#9a8a70'];
  const col = tone[Math.floor(rng() * tone.length)];
  const rot = rng() * Math.PI;
  const body = blobPoly(x, y, rx, ry, seed, { n: 8, jitter: 0.24, rot });
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, body, true, true);
  ctx.fillStyle = rgba(col, band === 'gravel' ? 0.72 : 0.6);
  ctx.fill();
  // shadow crescent lower right, highlight upper left
  ctx.clip();
  ctx.fillStyle = rgba('#1a120c', 0.38);
  ctx.beginPath();
  ctx.ellipse(x + rx * 0.35, y + ry * 0.4, rx * 0.95, ry * 0.8, rot, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba('#fff4d8', 0.35);
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.35, y - ry * 0.4, rx * 0.35, ry * 0.25, rot, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, body, true, true);
  ctx.lineWidth = rx > 6 ? 1.1 : 0.8;
  ctx.strokeStyle = rgba('#120a05', 0.8);
  ctx.stroke();
  ctx.restore();
}

function litterLeaf(ctx, x, y, len, rot, seed, rng) {
  const cols = ['#a0642c', '#b88a3c', '#7d5a2a', '#8d7a3a', '#6e4a26'];
  const col = cols[Math.floor(rng() * cols.length)];
  const w = len * (0.22 + rng() * 0.1);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.quadraticCurveTo(-len * 0.1, -w * 1.5, len / 2, 0);
  ctx.quadraticCurveTo(-len * 0.1, w * 1.3, -len / 2, 0);
  ctx.fillStyle = rgba(col, 0.78);
  ctx.fill();
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = rgba('#1a0f08', 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.lineTo(len / 2, 0);
  ctx.strokeStyle = rgba('#2a1a0e', 0.6);
  ctx.stroke();
  ctx.restore();
}

function crack(ctx, x, y, len, seed, rng) {
  const pts = [{ x, y }];
  let a = rng() * Math.PI * 2;
  for (let s = 0; s < 4; s++) {
    a += (rng() - 0.5) * 1.1;
    const p = pts[pts.length - 1];
    pts.push({ x: p.x + Math.cos(a) * len * 0.25, y: p.y + Math.sin(a) * len * 0.25 });
  }
  inkStroke(ctx, pts, { w: 1, color: '#0c0603', alpha: 0.55, seed, taperStart: 0.1, taperEnd: 0.8, smooth: false, tremor: 0.4 });
  if (rng() < 0.6) {
    const m = pts[2];
    const b = a + (rng() < 0.5 ? 1 : -1) * 0.9;
    inkStroke(ctx, [m, { x: m.x + Math.cos(b) * len * 0.22, y: m.y + Math.sin(b) * len * 0.22 }], { w: 0.7, color: '#0c0603', alpha: 0.45, seed: seed + 1, taperStart: 0.1, taperEnd: 0.9, tremor: 0.3 });
  }
}


/* ------------------------------------------------------------------ marginalia */

const SERIF = '"Old Standard TT", "Palatino Linotype", Georgia, serif';

/** A naturalist's plate details: a depth ruler on the left edge and the names of the horizons on the right. */
function paintMarginalia(ctx, world, ext, { topY, botY, gY, unit }) {
  const u = unit; // world units per css pixel
  ctx.save();
  ctx.textBaseline = 'middle';
  // ruler: ticks every 5 cm of depth (10 units = 1 cm), numerals every 10 cm, measured from the surface at the left edge
  const g0 = gY(0);
  const rx = ext.x0 + 14 * u;
  const bottom = Math.min(ext.y1, world.height);
  const ruler = (c, a, w) => {
    ctx.strokeStyle = rgba(c, a);
    ctx.lineWidth = w * u;
    ctx.beginPath();
    for (let d = 0; g0 + d * 10 < bottom - 12 * u; d += 5) {
      const y = g0 + d * 10;
      const len = (d % 10 === 0 ? 11 : 6) * u;
      ctx.moveTo(rx, y);
      ctx.lineTo(rx + len, y);
    }
    ctx.moveTo(rx, g0);
    ctx.lineTo(rx, Math.floor((bottom - g0 - 12 * u) / 50) * 50 + g0);
    ctx.stroke();
  };
  ruler('#0e0804', 0.45, 2.4);
  ruler('#f1dfb6', 0.6, 1.1);
  ctx.font = `italic ${11 * u}px ${SERIF}`;
  ctx.textAlign = 'left';
  for (let d = 10; g0 + d * 10 < bottom - 14 * u; d += 10) {
    const y = g0 + d * 10;
    ctx.fillStyle = rgba('#0e0804', 0.5);
    ctx.fillText(String(d), rx + 15 * u + u, y + u);
    ctx.fillStyle = rgba('#f1dfb6', 0.72);
    ctx.fillText(String(d), rx + 15 * u, y);
  }
  ctx.fillStyle = rgba('#f1dfb6', 0.7);
  ctx.fillText('см', rx + 15 * u, g0 + 10 * u * 0.2 - 1);

  // horizon names, right-aligned along the right edge, each under its boundary
  ctx.font = `italic ${15 * u}px ${SERIF}`;
  ctx.textAlign = 'right';
  const x = ext.x1 - 16 * u;
  world.horizons.forEach((h, i) => {
    const ty = topY(i, x);
    const by = Math.min(botY(i, x), ext.y1);
    const y = Math.min(ty + Math.max(15 * u, (by - ty) * 0.18), by - 12 * u);
    ctx.fillStyle = rgba('#0e0804', 0.55);
    ctx.fillText(h.name, x + u, y + u);
    ctx.fillStyle = rgba('#f1dfb6', 0.8);
    ctx.fillText(h.name, x, y);
  });
  ctx.restore();
}

/* ------------------------------------------------------------------------- rocks */

function paintRocks(ctx, world, seed) {
  for (const r of world.rocks || []) paintRock(ctx, r, seed);
}

export function paintRock(ctx, rock, seed) {
  const poly = rock.poly;
  const cx = rock.x;
  const cy = rock.y;
  const s0 = subSeed(seed, 'rock', rock.id);
  const rr = mulberry(s0);
  const R = Math.max(rock.maxX - rock.minX, rock.maxY - rock.minY) / 2;
  const body = raggedPoly(poly, 1.2, s0, { step: 7 });
  const path = (c) => tracePath(c, body, true, true);

  // Contact shadow in the soil, and a pale rim light so the rock stands out of the dark.
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  wash(ctx, blobPoly(cx + R * 0.12, cy + R * 0.16, (rock.maxX - rock.minX) / 2 + 10, (rock.maxY - rock.minY) / 2 + 9, s0, { n: 12, jitter: 0.1 }), { color: '#3a2c2a', alpha: 0.5, layers: 3, ragged: 3, edge: 0, seed: s0 });
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  path(ctx);
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba('#e6cfa0', 0.3);
  ctx.stroke();
  ctx.restore();

  // Body: warm-grey wash, lit from the upper left, shaded lower right.
  ctx.save();
  ctx.beginPath();
  path(ctx);
  ctx.fillStyle = '#8a8170';
  ctx.fill();
  ctx.clip();
  const grad = ctx.createLinearGradient(rock.minX, rock.minY, rock.maxX, rock.maxY);
  grad.addColorStop(0, 'rgba(250,236,196,0.7)');
  grad.addColorStop(0.38, 'rgba(200,186,156,0.0)');
  grad.addColorStop(0.75, 'rgba(70,62,96,0.35)');
  grad.addColorStop(1, 'rgba(40,36,76,0.7)');
  ctx.fillStyle = grad;
  ctx.fillRect(rock.minX - 4, rock.minY - 4, rock.maxX - rock.minX + 8, rock.maxY - rock.minY + 8);
  // mottled pigment
  for (let k = 0; k < 7; k++) {
    const bx = cx + (rr() - 0.5) * R * 1.4;
    const by = cy + (rr() - 0.5) * R * 0.7;
    wash(ctx, blobPoly(bx, by, R * (0.18 + rr() * 0.25), R * (0.1 + rr() * 0.14), s0 + k, { n: 9, jitter: 0.3 }), { color: rr() < 0.5 ? '#615c66' : '#a99f88', alpha: 0.2 + rr() * 0.15, layers: 2, ragged: 2, edge: 0.4, seed: s0 + k });
  }
  // lichen
  for (let k = 0; k < 2; k++) {
    const a = -Math.PI / 2 + (rr() - 0.5) * 2;
    wash(ctx, blobPoly(cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.28, R * 0.12, R * 0.06, s0 + 50 + k, { n: 8, jitter: 0.3 }), { color: '#8fa04e', alpha: 0.35, layers: 2, ragged: 1.5, edge: 0.5, seed: s0 + 90 + k });
  }
  // shadow hatching on the lower right (light comes from the upper left), dense toward the rim
  const rx = (rock.maxX - rock.minX) / 2;
  const ry = (rock.maxY - rock.minY) / 2;
  const rho = (x, y) => Math.hypot((x - cx) / rx, (y - cy) / ry);
  const shadeAt = (x, y) => ((x - cx) / rx) * 0.6 + ((y - cy) / ry) * 0.8;
  hatch(ctx, poly, {
    angle: 0.85,
    gap: 3.1,
    w: 0.8,
    color: '#1b1420',
    alpha: 0.62,
    seed: s0 + 3,
    lenVar: 0.15,
    density: (x, y) => smooth01((shadeAt(x, y) - 0.0) / 0.9) * (0.4 + 0.6 * smooth01((rho(x, y) - 0.3) / 0.6)),
  });
  hatch(ctx, poly, {
    angle: -0.6,
    gap: 4.2,
    w: 0.65,
    color: '#1b1420',
    alpha: 0.45,
    seed: s0 + 4,
    lenVar: 0.15,
    density: (x, y) => smooth01((shadeAt(x, y) - 0.5) / 0.6),
  });
  stipple(ctx, poly, { count: Math.round(R * 2.2), rMin: 0.35, rMax: 0.9, color: '#1c1410', alpha: 0.5, seed: s0 + 5, density: (x, y) => 0.25 + smooth01((x - cx) / R + (y - cy) / R) * 0.75 });
  stipple(ctx, poly, { count: Math.round(R * 1.1), rMin: 0.3, rMax: 0.8, color: '#f6ead0', alpha: 0.45, seed: s0 + 6, density: (x, y) => smooth01(1 - ((x - cx) / R + (y - cy) / R) * 0.9 - 0.2) });
  // a couple of cracks
  for (let k = 0; k < 2; k++) crack(ctx, cx + (rr() - 0.5) * R, cy + (rr() - 0.5) * R * 0.5, R * (0.3 + rr() * 0.3), s0 + 70 + k, rr);
  ctx.restore();

  // Ink: confident outline plus an inner dashed contour.
  inkOutline(ctx, body, { w: 2.5, color: '#150e09', seed: s0 + 8, press: 0.5, tremor: 0.5, step: 3 });
  const inner = body.map((p) => ({ x: cx + (p.x - cx) * 0.88, y: cy + (p.y - cy) * 0.86 }));
  inkDashed(ctx, inner.concat([inner[0], inner[1]]), { w: 0.9, color: '#150e09', alpha: 0.55, dash: 7, gap: 5, seed: s0 + 9 });
}

/* ---------------------------------------------------------------------- surface */

function paintSurface(ctx, world, ext, { gY, profile, rng, seed }) {
  const W = ext.x1 - ext.x0;
  const s0 = Math.floor((ext.x0 - 20) / 4) * 4;

  // Soft green-brown wash along the surface, ragged on top.
  const top = [];
  const bot = [];
  for (let x = s0; x <= ext.x1 + 20; x += 8) {
    top.push({ x, y: gY(x) - 5 - 4 * Math.abs(noise1(x * 0.07 + seedOf(seed))) });
    bot.push({ x, y: gY(x) + 9 });
  }
  const strip = top.concat(bot.reverse());
  wash(ctx, strip, { color: '#7d8c4a', alpha: 0.4, layers: 3, ragged: 2, edge: 0.4, edgeW: 1, seed: seed + 301, smooth: false });

  // Moss cushions.
  const mossN = Math.round(W / 70);
  for (let k = 0; k < mossN; k++) {
    const x = ext.x0 + rng() * W;
    moss(ctx, x, gY(x) + 1, 12 + rng() * 26, 3.5 + rng() * 5, seed + k * 3, rng);
  }

  // Ground line in ink, in broken sections.
  const line = [];
  for (let x = s0; x <= ext.x1 + 20; x += 8) line.push({ x, y: gY(x) });
  for (let i = 0; i < line.length - 1; i += 14) {
    const seg = line.slice(i, Math.min(line.length, i + 16));
    if (seg.length > 1) inkStroke(ctx, seg, { w: 2.6, color: '#2a1d14', seed: seed + i, taperStart: 0.1, taperEnd: 0.25, press: 0.5, tremor: 0.5, step: 4 });
  }

  // Grass tufts, ferns, tiny flowers.
  const tufts = Math.round(W / 12);
  for (let k = 0; k < tufts; k++) {
    const x = ext.x0 + rng() * W;
    tuft(ctx, x, gY(x) + 1, 8 + rng() * rng() * 30 + rng() * 8, seed + k * 5, rng);
  }
  const ferns = Math.round(W / 190);
  for (let k = 0; k < ferns; k++) {
    const x = ext.x0 + rng() * W;
    fern(ctx, x, gY(x) + 1, 24 + rng() * 22, rng() < 0.5 ? -1 : 1, seed + k * 17, rng);
  }
  const flowers = Math.round(W / 160);
  const FL = ['#e8c24a', '#f4f0e0', '#9a8fd0', '#d96a5a'];
  for (let k = 0; k < flowers; k++) {
    const x = ext.x0 + rng() * W;
    flower(ctx, x, gY(x) + 1, 12 + rng() * 14, FL[Math.floor(rng() * FL.length)], seed + k * 23, rng);
  }
}

function moss(ctx, x, y, rx, ry, seed, rng) {
  const pts = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    pts.push({ x: x + Math.cos(a) * rx, y: y + Math.sin(a) * ry * (0.75 + 0.4 * noise1(i * 1.7 + seed)) });
  }
  pts.push({ x: x + rx, y: y + 2 }, { x: x - rx, y: y + 2 });
  wash(ctx, pts, { color: rng() < 0.5 ? '#6f9a45' : '#86a64a', alpha: 0.7, layers: 3, ragged: 1.1, edge: 0.8, edgeW: 1, seed });
  stipple(ctx, pts, { count: Math.round(rx * 1.3), rMin: 0.3, rMax: 0.75, color: '#1f3314', alpha: 0.55, seed: seed + 1 });
  stipple(ctx, pts, { count: Math.round(rx * 0.8), rMin: 0.3, rMax: 0.7, color: '#d6e08a', alpha: 0.6, seed: seed + 2 });
}

const BLADE_INK = ['#2b3a1f', '#38492a', '#44572e', '#233019', '#4e5e2a'];
function tuft(ctx, x, y, h, seed, rng) {
  const n = 4 + Math.floor(rng() * 5);
  // watercolor under the tuft
  wash(ctx, blobPoly(x, y - h * 0.35, h * 0.55, h * 0.42, seed, { n: 8, jitter: 0.3 }), { color: rng() < 0.5 ? '#9db45a' : '#7fa04a', alpha: 0.28, layers: 2, ragged: 1.5, edge: 0.3, edgeW: 0.8, seed });
  for (let i = 0; i < n; i++) {
    const lean = (i - (n - 1) / 2) * (h * 0.14) + (rng() - 0.5) * h * 0.25;
    const bh = h * (0.55 + rng() * 0.5);
    const bx = x + (rng() - 0.5) * 6;
    inkStroke(
      ctx,
      [
        { x: bx, y },
        { x: bx + lean * 0.4, y: y - bh * 0.55 },
        { x: bx + lean + (rng() - 0.5) * 3, y: y - bh },
      ],
      { w: 1.1 + rng() * 0.8, color: BLADE_INK[Math.floor(rng() * BLADE_INK.length)], alpha: 0.88, seed: seed + i, taperStart: 0.05, taperEnd: 0.85, press: 0.2, tremor: 0.2, step: 3 },
    );
  }
}

function fern(ctx, x, y, size, dir, seed, rng) {
  const pts = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: x + dir * (t * t * size * 0.7 + t * size * 0.15), y: y - Math.sin(t * 1.5) * size * 0.95 });
  }
  wash(ctx, blobPoly(x + dir * size * 0.3, y - size * 0.45, size * 0.55, size * 0.5, seed, { n: 9, jitter: 0.25 }), { color: '#7ea04a', alpha: 0.3, layers: 2, ragged: 2, edge: 0.3, edgeW: 1, seed });
  inkStroke(ctx, pts, { w: 1.5, color: '#2f4020', alpha: 0.9, seed, taperStart: 0.05, taperEnd: 0.8, tremor: 0.2 });
  for (let i = 1; i < n; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const a = Math.atan2(q.y - p.y, q.x - p.x);
    const leaf = size * 0.34 * (1 - i / (n + 1)) + 2;
    for (const s of [-1, 1]) {
      const b = a + s * 1.15;
      inkStroke(
        ctx,
        [
          { x: p.x, y: p.y },
          { x: p.x + Math.cos(b) * leaf * 0.6 + Math.cos(a) * 1.5, y: p.y + Math.sin(b) * leaf * 0.6 + Math.sin(a) * 1.5 },
          { x: p.x + Math.cos(b - s * 0.25) * leaf, y: p.y + Math.sin(b - s * 0.25) * leaf },
        ],
        { w: 1.3, color: '#3a5226', alpha: 0.85, seed: seed + i * 2 + (s > 0 ? 1 : 0), taperStart: 0.05, taperEnd: 0.8, tremor: 0.15, step: 2 },
      );
    }
  }
}

function flower(ctx, x, y, h, color, seed, rng) {
  const lean = (rng() - 0.5) * 5;
  inkStroke(ctx, [{ x, y }, { x: x + lean * 0.5, y: y - h * 0.5 }, { x: x + lean, y: y - h }], { w: 0.9, color: '#3a4a26', alpha: 0.9, seed, taperEnd: 0.5, tremor: 0.15, step: 3 });
  const px = x + lean;
  const py = y - h;
  ctx.save();
  ctx.fillStyle = rgba(color, 0.92);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng();
    ctx.beginPath();
    ctx.ellipse(px + Math.cos(a) * 2.3, py + Math.sin(a) * 2.3, 1.9, 1.4, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = rgba('#7a4a14', 0.9);
  ctx.beginPath();
  ctx.arc(px, py, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = rgba('#2a1d14', 0.5);
  ctx.beginPath();
  ctx.arc(px, py, 3.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export { paperMul, mix, darken, clipTo };

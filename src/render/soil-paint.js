// Paints the per-biome soil look (world/biomes.js `look`, laid out by soil-look.js) into the world layer: sub-layers of the
// horizons, soft washes (damp patches, gley mottles, rust, podzol tongues, the fill of krotovinas) and, over the generic
// soil texture, the fine ink details (needles, pebbles, casts, channels, nodules, charcoal). Drawn once, in world units.
import { blobPoly, hatch, inkDashed, mulberry, noise1, rgba, seedOf, stipple, tracePath, wash } from './ink.js';

const SQ = (n) => n * n;

/**
 * Darker sub-layers of the horizons (look.layers[id].tones): a wash between two fractions of the band's thickness, with a
 * gently waving lower edge. env: { topY, botY, x0, x1, step, mul, seed }.
 */
export function paintTones(ctx, world, look, env) {
  for (const _ of paintTonesSteps(ctx, world, look, env));
}

// The three painters below also exist as generators (…Steps) that yield between washes and features: the world-layer
// painter spreads them over frames; the plain functions above and below simply run them to the end.
export function* paintTonesSteps(ctx, world, look, env) {
  const { topY, botY, x0, x1, step, mul, seed } = env;
  const hs = world.horizons;
  for (let i = 0; i < hs.length; i++) {
    const h = hs[i];
    const tones = look.layers && look.layers[h.id] && look.layers[h.id].tones;
    if (!tones) continue;
    const so = seedOf(seed + i * 31);
    for (let ti = 0; ti < tones.length; ti++) {
      const t = tones[ti];
      const top = [];
      const bot = [];
      const s0 = Math.floor(x0 / step) * step;
      for (let x = s0; x <= x1 + step; x += step) {
        const ty = topY(i, x);
        const bh = botY(i, x) - ty;
        const wave = (f, k) => (f <= 0 || f >= 1 ? f : f + 0.07 * noise1(x * 0.011 + so + k));
        top.push({ x, y: ty + bh * wave(t.from, ti * 3) + 1.5 });
        bot.push({ x, y: ty + bh * wave(t.to, ti * 3 + 1) + (t.to >= 1 ? 4 : 0) });
      }
      wash(ctx, top.concat(bot.reverse()), { color: mul(t.color), alpha: t.alpha, layers: 3, ragged: 3.2, edge: 0.25, edgeW: 1.6, seed: seed + i * 101 + ti * 13 + 5, comp: 'multiply' });
      yield;
    }
  }
}

/** Everything that goes under the depth veil and the texture: broad washes. */
export function paintUnder(ctx, feats, env) {
  for (const _ of paintUnderSteps(ctx, feats, env));
}

export function* paintUnderSteps(ctx, feats, env) {
  const { mul, avoid } = env;
  for (const f of feats) {
    switch (f.kind) {
      case 'damp':
        wash(ctx, blobPoly(f.x, f.y, f.rx, f.ry, f.seed, { n: 12, jitter: 0.3, rot: f.rot }), { color: mul('#6a5848'), alpha: f.alpha, layers: 2, ragged: 3, edge: 0.3, edgeW: 1.6, seed: f.seed, comp: 'multiply' });
        break;
      case 'gley':
        if (avoid(f.x, f.y, f.rx * 0.8)) break;
        wash(ctx, blobPoly(f.x, f.y, f.rx, f.ry, f.seed, { n: 12, jitter: 0.35, rot: f.rot }), { color: '#8ea6b4', alpha: f.alpha, layers: 3, ragged: 2.4, edge: 0.7, edgeW: 1.4, seed: f.seed, rimColor: '#4c6070' });
        break;
      case 'rust':
        if (avoid(f.x, f.y, f.rx)) break;
        wash(ctx, blobPoly(f.x, f.y, f.rx, f.ry, f.seed, { n: 9, jitter: 0.3, rot: f.rot }), { color: '#a85a20', alpha: f.alpha, layers: 2, ragged: 1.1, edge: 0.6, edgeW: 0.9, seed: f.seed, rimColor: '#6a3410' });
        break;
      case 'lens':
        // burnt, reddened soil under and about an old fire's charcoal
        if (avoid(f.x, f.y, f.w * 0.9)) break;
        wash(ctx, blobPoly(f.x, f.y + f.h, f.w * 0.62, f.h * 3.2, f.seed, { n: 12, jitter: 0.25, rot: f.rot }), { color: '#b0602c', alpha: 0.2, layers: 2, ragged: 2.5, edge: 0, seed: f.seed });
        break;
      case 'tongue':
        wash(ctx, tonguePoly(f), { color: mul('#7c3e1c'), alpha: 0.78, layers: 2, ragged: 1.6, edge: 0.4, edgeW: 1.2, seed: f.seed, comp: 'multiply' });
        break;
      case 'krot':
        if (avoid(f.x, f.y, Math.max(f.rx, f.ry))) break;
        // an old burrow filled with other soil: lighter in the dark humus, darker in the loam
        wash(ctx, blobPoly(f.x, f.y, f.rx, f.ry, f.seed, { n: 14, jitter: 0.12, rot: f.rot }), { color: f.fill === 'light' ? '#b89a68' : '#34281f', alpha: f.fill === 'light' ? 0.78 : 0.82, layers: 3, ragged: 1.6, edge: 0.55, edgeW: 1.4, seed: f.seed, rimColor: '#120a05' });
        break;
      default:
        break;
    }
    yield;
  }
}

function tonguePoly(f) {
  const left = [];
  const right = [];
  const so = seedOf(f.seed);
  const n = 7;
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    const w = f.w * 0.5 * (1 - 0.82 * t * t) * (1 + 0.25 * noise1(s * 1.9 + so));
    const cx = f.x + noise1(s * 0.8 + so + 3) * 3.2 * t;
    const y = f.y + f.len * t;
    left.push({ x: cx - w, y });
    right.push({ x: cx + w, y });
  }
  return left.concat(right.reverse());
}

/** Fine ink details, over the generic texture. env: { mul, avoid, look } */
export function paintDetails(ctx, feats, env) {
  for (const _ of paintDetailsSteps(ctx, feats, env));
}

export function* paintDetailsSteps(ctx, feats, env) {
  const { avoid } = env;
  for (const f of feats) {
    switch (f.kind) {
      case 'needle':
        needle(ctx, f);
        break;
      case 'stone':
        if (!avoid(f.x, f.y, f.rx + 4)) stone(ctx, f);
        break;
      case 'cast':
        if (!avoid(f.x, f.y, f.r + 4)) cast(ctx, f);
        break;
      case 'channel':
        channel(ctx, f);
        break;
      case 'rootchan':
        rootChannel(ctx, f);
        break;
      case 'krot':
        if (!avoid(f.x, f.y, Math.max(f.rx, f.ry))) krotOutline(ctx, f);
        break;
      case 'nodule':
        if (!avoid(f.x, f.y, 4)) nodule(ctx, f);
        break;
      case 'lens':
        if (!avoid(f.x, f.y, f.w * 0.9)) lens(ctx, f);
        break;
      default:
        break;
    }
    yield;
  }
}

const NEEDLE = ['#6e4a26', '#a47c3c', '#c4a45e'];

function needle(ctx, f) {
  const c = Math.cos(f.a);
  const s = Math.sin(f.a);
  const hx = (f.len / 2) * c;
  const hy = (f.len / 2) * s;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(NEEDLE[f.tone], 0.8);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(f.x - hx, f.y - hy);
  ctx.lineTo(f.x + hx, f.y + hy);
  if (f.pair) {
    // pine needles grow in twos from one sheath
    const a2 = f.a + 0.14;
    ctx.moveTo(f.x - hx, f.y - hy);
    ctx.lineTo(f.x - hx + Math.cos(a2) * f.len, f.y - hy + Math.sin(a2) * f.len);
  }
  ctx.stroke();
  ctx.restore();
}

/** A pebble: angular (flint, quartz) or rounded, with a shadow side, a highlight and an ink contour. */
function stone(ctx, f) {
  const rng = mulberry(f.seed);
  const n = f.angular ? 5 + Math.floor(rng() * 3) : 9;
  const pts = [];
  const a0 = rng() * 6.28;
  for (let i = 0; i < n; i++) {
    const a = a0 + ((i + (f.angular ? (rng() - 0.5) * 0.5 : 0)) / n) * Math.PI * 2;
    const m = f.angular ? 0.72 + rng() * 0.45 : 0.9 + rng() * 0.2;
    const x = Math.cos(a) * f.rx * m;
    const y = Math.sin(a) * f.ry * m;
    pts.push({ x: f.x + x * Math.cos(f.rot) - y * Math.sin(f.rot), y: f.y + x * Math.sin(f.rot) + y * Math.cos(f.rot) });
  }
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, pts, true, !f.angular);
  ctx.fillStyle = rgba(f.tone, 0.92);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = rgba('#1a120c', 0.3);
  ctx.beginPath();
  ctx.ellipse(f.x + f.rx * 0.4, f.y + f.ry * 0.45, f.rx * 0.95, f.ry * 0.8, f.rot, 0, Math.PI * 2);
  ctx.fill();
  if (f.glint) {
    // quartz catches the light
    ctx.fillStyle = rgba('#ffffff', 0.7);
    ctx.beginPath();
    ctx.ellipse(f.x - f.rx * 0.32, f.y - f.ry * 0.38, f.rx * 0.32, f.ry * 0.2, f.rot, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, pts, true, !f.angular);
  ctx.lineWidth = f.rx > 6 ? 1 : 0.75;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba('#120a05', 0.78);
  ctx.stroke();
  ctx.restore();
}

/** A worm cast: a small heap of crumbs. */
function cast(ctx, f) {
  const rng = mulberry(f.seed);
  ctx.save();
  for (let i = 0; i < f.n; i++) {
    const a = Math.PI + rng() * Math.PI;
    const d = rng() * f.r;
    const x = f.x + Math.cos(a) * d * 1.2;
    const y = f.y + Math.sin(a) * d * 0.55 + f.r * 0.3;
    const r = f.r * (0.28 + rng() * 0.22);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(rng() < 0.5 ? '#7a6048' : '#6a5240', 0.9);
    ctx.fill();
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = rgba('#140c07', 0.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = rgba('#d6bd88', 0.45);
    ctx.fill();
  }
  ctx.restore();
}

/** A worm channel: a thin tube, a dark wall around a paler lining. */
function channel(ctx, f) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  path(ctx, f.pts);
  ctx.lineWidth = f.w + 1.6;
  ctx.strokeStyle = rgba('#120a06', 0.55);
  ctx.stroke();
  path(ctx, f.pts);
  ctx.lineWidth = f.w;
  ctx.strokeStyle = rgba('#9a7c5a', 0.7);
  ctx.stroke();
  ctx.restore();
}

/** A root channel in wet soil: rust inside, a bluish-grey halo of reduced iron around it. */
function rootChannel(ctx, f) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  path(ctx, f.pts);
  ctx.lineWidth = 4.2;
  ctx.strokeStyle = rgba('#8ea6b4', 0.4);
  ctx.stroke();
  path(ctx, f.pts);
  ctx.lineWidth = f.w;
  ctx.strokeStyle = rgba('#b8631c', 0.85);
  ctx.stroke();
  ctx.restore();
}

function path(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

/** The contour and crumb texture of a krotovina (its fill is a wash, see paintUnder). */
function krotOutline(ctx, f) {
  const poly = blobPoly(f.x, f.y, f.rx, f.ry, f.seed, { n: 14, jitter: 0.12, rot: f.rot });
  inkDashed(ctx, poly.concat([poly[0], poly[1]]), { w: 1.2, color: '#120a05', alpha: 0.7, dash: 9, gap: 4, seed: f.seed + 3, taperStart: 0.2, taperEnd: 0.2 });
  const light = f.fill === 'light';
  stipple(ctx, poly, { count: Math.round(f.rx * 1.6), rMin: 0.4, rMax: 1.1, color: light ? '#2a1d14' : '#d6bd88', alpha: light ? 0.5 : 0.55, seed: f.seed + 5 });
  hatch(ctx, poly, { angle: 0.8, gap: 5, w: 0.6, color: '#0c0603', alpha: light ? 0.16 : 0.1, seed: f.seed + 7, lenVar: 0.5 });
}

/** A small white carbonate nodule («белоглазка»). */
function nodule(ctx, f) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(f.x + f.rx * 0.25, f.y + f.ry * 0.3, f.rx, f.ry, f.rot, 0, Math.PI * 2);
  ctx.fillStyle = rgba('#1a120c', 0.3);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(f.x, f.y, f.rx, f.ry, f.rot, 0, Math.PI * 2);
  ctx.fillStyle = rgba('#f6f1e2', 0.96);
  ctx.fill();
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = rgba('#3a2c20', 0.55);
  ctx.stroke();
  ctx.restore();
}

/** A charcoal lens: a thin, flat black streak of an old fire, with a few charred chips about it. */
function lens(ctx, f) {
  const rng = mulberry(f.seed);
  const n = 12;
  const top = [];
  const bot = [];
  const so = seedOf(f.seed);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const prof = Math.pow(Math.max(0, 1 - SQ(2 * u - 1)), 0.55);
    const x = (u - 0.5) * f.w;
    const hh = (f.h / 2) * prof * (0.8 + 0.4 * noise1(i * 1.3 + so));
    top.push({ x, y: -hh });
    bot.push({ x, y: hh * (0.9 + 0.3 * noise1(i * 0.9 + so + 4)) });
  }
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  const place = (p) => ({ x: f.x + p.x * c - p.y * s, y: f.y + p.x * s + p.y * c });
  const poly = top.concat(bot.reverse()).map(place);
  ctx.save();
  // a soft grey smudge of ash round the black
  ctx.lineJoin = 'round';
  ctx.beginPath();
  tracePath(ctx, poly, true, true);
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = rgba('#b4a890', 0.3);
  ctx.stroke();
  ctx.fillStyle = rgba('#120d0a', 0.92);
  ctx.fill();
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = rgba('#000000', 0.7);
  ctx.stroke();
  for (const ch of f.chips) {
    const p = place({ x: ch.dx, y: ch.dy });
    const a = rng() * 6;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(a) * ch.r, p.y + Math.sin(a) * ch.r);
    for (let k = 1; k < 4; k++) {
      const aa = a + (k / 4) * Math.PI * 2 + (rng() - 0.5) * 0.7;
      const rr = ch.r * (0.55 + rng() * 0.6);
      ctx.lineTo(p.x + Math.cos(aa) * rr, p.y + Math.sin(aa) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = rgba('#150f0b', 0.88);
    ctx.fill();
  }
  ctx.restore();
}


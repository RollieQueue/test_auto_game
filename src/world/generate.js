// Deterministic world generation: a cross-section of a forest glade. Pure data, no DOM.
import { WORLD_W, WORLD_H, PROFILE_STEP } from '../config.js';
import { createRng, fbm1, hash32, makeNoise1D } from '../core/rng.js';
import { dist, pointInPolygon, polygonBounds } from '../core/geom.js';
import { sampleProfile } from './query.js';

/** Soil horizons, top to bottom. depth: units below the ground surface; cost: sugar per unit of hypha. */
export const HORIZONS = [
  { id: 'litter', name: 'Лесная подстилка', depth: 0, cost: 0.1, color: '#6b5238' },
  { id: 'humus', name: 'Гумус', depth: 26, cost: 0.14, color: '#3f2c20' },
  { id: 'loam', name: 'Суглинок', depth: 170, cost: 0.22, color: '#5a4433' },
  { id: 'clay', name: 'Глина', depth: 390, cost: 0.34, color: '#7a5a44' },
  { id: 'gravel', name: 'Галечник', depth: 620, cost: 0.5, color: '#56524d' },
];
const HORIZON_WAVE = [0, 7, 24, 30, 26];

export const TREE_SPECIES = {
  birch: { name: 'Берёза', spread: 250, taproot: 150, laterals: 6, gravity: 0.016 },
  oak: { name: 'Дуб', spread: 290, taproot: 430, laterals: 7, gravity: 0.03 },
  pine: { name: 'Сосна', spread: 210, taproot: 360, laterals: 5, gravity: 0.026 },
};

const DECOR_SHALLOW = ['acorn', 'leaf', 'snail', 'beetle', 'seed', 'twig', 'acorn', 'leaf'];
const DECOR_DEEP = ['pebble', 'bone', 'shell', 'potsherd', 'pebble'];
const DECOR_BOTTOM = ['pebble', 'ammonite', 'pebble'];

export function generateWorld(seed) {
  const rng = createRng(seed);
  const cols = Math.ceil(WORLD_W / PROFILE_STEP) + 1;

  // Ground surface: gentle rolling line around y = 292.
  const gNoise = makeNoise1D(hash32(seed, 'ground'));
  const ground = [];
  for (let i = 0; i < cols; i++) {
    const x = i * PROFILE_STEP;
    ground.push(292 + 24 * fbm1(gNoise, x / 520, 3) + 4 * gNoise(x / 55 + 97));
  }
  const groundAt = (x) => sampleProfile(ground, PROFILE_STEP, x);

  // Horizon boundaries follow the ground with their own waves, strictly ordered.
  const horizons = HORIZONS.map((h, i) => {
    const hn = makeNoise1D(hash32(seed, 'horizon', i));
    const top = ground.map((gy, k) =>
      i === 0 ? gy : gy + h.depth + HORIZON_WAVE[i] * fbm1(hn, (k * PROFILE_STEP) / 300, 3),
    );
    return { ...h, top };
  });
  for (let i = 1; i < horizons.length; i++) {
    const prev = horizons[i - 1].top;
    const cur = horizons[i].top;
    for (let k = 0; k < cols; k++) cur[k] = Math.max(cur[k], prev[k] + 10);
  }
  const depthAt = (x, y) => y - groundAt(x);

  // Where the spore germinated.
  const ox = 900 + rng.range(-40, 40);
  const origin = { x: ox, y: groundAt(ox) + 64 };

  // Trees: fixed composition, seeded variation.
  const treeDefs = [
    { species: 'birch', x: 470 + rng.range(-30, 30), stage: 1 },
    { species: 'oak', x: 1250 + rng.range(-30, 30), stage: 2 },
    { species: 'pine', x: 1665 + rng.range(-25, 25), stage: 0 },
  ];

  // Rocks: flattened noisy ellipses, bigger deeper down; kept clear of trunks and the origin.
  const rocks = [];
  for (let attempt = 0; attempt < 80 && rocks.length < 9; attempt++) {
    const x = rng.range(70, WORLD_W - 70);
    const depth = rng.range(150, 760);
    const y = groundAt(x) + depth;
    if (y > WORLD_H - 40) continue;
    const r = 24 + (depth / 760) * rng.range(30, 70);
    if (treeDefs.some((t) => Math.abs(t.x - x) < r + 60 && depth < 260)) continue;
    if (dist(x, y, origin.x, origin.y) < r + 110) continue;
    if (rocks.some((o) => dist(x, y, o.x, o.y) < r + o.r + 40)) continue;
    const rx = r * rng.range(1.0, 1.45);
    const ry = r * rng.range(0.55, 0.85);
    const rot = rng.range(-0.35, 0.35);
    const n = rng.int(9, 13);
    const poly = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.range(-0.18, 0.18);
      const m = rng.range(0.82, 1.1);
      const px = Math.cos(a) * rx * m;
      const py = Math.sin(a) * ry * m;
      poly.push({
        x: x + px * Math.cos(rot) - py * Math.sin(rot),
        y: y + px * Math.sin(rot) + py * Math.cos(rot),
      });
    }
    rocks.push({ id: rocks.length, x, y, r, poly, ...polygonBounds(poly) });
  }
  const inRock = (x, y, margin = 0) =>
    rocks.some(
      (o) =>
        x >= o.minX - margin &&
        x <= o.maxX + margin &&
        y >= o.minY - margin &&
        y <= o.maxY + margin &&
        (margin === 0 ? pointInPolygon(x, y, o.poly) : dist(x, y, o.x, o.y) < o.r * 1.45 + margin),
    );

  // Trees with root systems generated for the final stage; each root knows when it appears.
  const trees = treeDefs.map((def, id) => {
    const baseY = groundAt(def.x);
    const { roots, tips } = growRoots(rng.fork(`roots${id}`), def.species, def.x, baseY, groundAt, inRock);
    return {
      id,
      species: def.species,
      name: TREE_SPECIES[def.species].name,
      x: def.x,
      baseY,
      stage: def.stage,
      growth: 0,
      health: 0.5,
      linked: false,
      crownSeed: hash32(seed, 'crown', id),
      roots,
      tips,
    };
  });
  const nearRoots = (x, y, d) =>
    trees.some((t) => t.roots.some((r) => r.points.some((p) => Math.abs(p.x - x) < d && Math.abs(p.y - y) < d)));

  // Deposits: water pockets and mineral veins placed away from rocks, roots, the origin and each other.
  const deposits = [];
  const freeSpot = (x, y, clearance) =>
    y < WORLD_H - clearance &&
    x > clearance &&
    x < WORLD_W - clearance &&
    !inRock(x, y, clearance) &&
    dist(x, y, origin.x, origin.y) > clearance + 90 &&
    !deposits.some((d) => dist(x, y, d.x, d.y) < clearance + d.size + 60) &&
    !nearRoots(x, y, clearance * 0.6);

  const water = [];
  const waterDepths = [
    [70, 170],
    [70, 190],
    [220, 420],
    [240, 440],
    [470, 650],
  ];
  const side = rng.chance(0.5) ? 1 : -1; // the nearest pocket and nitrogen vein lie on opposite sides of the spore
  for (const [d0, d1] of waterDepths) {
    for (let attempt = 0; attempt < 200; attempt++) {
      // Winnability: the first pocket is always a short reach from the spore (inside the starting sugar budget).
      const x = water.length === 0 ? origin.x + (attempt % 2 ? side : -side) * rng.range(150, 320 + attempt / 2) : rng.range(80, WORLD_W - 80);
      const y = groundAt(x) + rng.range(d0, d1);
      const rx = rng.range(38, 68);
      if (!freeSpot(x, y, rx)) continue;
      const deep = depthAt(x, y) > 300;
      const max = Math.round(deep ? rng.range(120, 160) : rng.range(90, 130));
      water.push({ id: water.length, x, y, rx, ry: rx * rng.range(0.42, 0.55), amount: max, max, regen: deep ? 0.3 : 0.6 });
      deposits.push({ x, y, size: rx });
      break;
    }
  }

  const minerals = [];
  const mineralPlan = [
    ['nitrogen', 40, 190],
    ['nitrogen', 40, 210],
    ['phosphorus', 260, 520],
    ['phosphorus', 300, 640],
    ['phosphorus', 420, 720],
  ];
  for (const [kind, d0, d1] of mineralPlan) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = minerals.length === 0 ? origin.x + (attempt % 2 ? -side : side) * rng.range(130, 300 + attempt / 2) : rng.range(80, WORLD_W - 80);
      const y = groundAt(x) + rng.range(d0, d1);
      const r = rng.range(16, 26);
      if (!freeSpot(x, y, r + 14)) continue;
      const max = Math.round(rng.range(50, 100));
      minerals.push({ id: minerals.length, x, y, r, amount: max, max, kind });
      deposits.push({ x, y, size: r });
      break;
    }
  }

  // Decorative curiosities for the naturalist's eye.
  const decor = [];
  for (let attempt = 0; attempt < 200 && decor.length < 18; attempt++) {
    const x = rng.range(30, WORLD_W - 30);
    const depth = rng.range(8, WORLD_H - groundAt(x) - 20);
    const y = groundAt(x) + depth;
    if (inRock(x, y, 12)) continue;
    if (deposits.some((d) => dist(x, y, d.x, d.y) < d.size + 34)) continue;
    if (decor.some((d) => dist(x, y, d.x, d.y) < 70)) continue;
    if (dist(x, y, origin.x, origin.y) < 60) continue;
    const pool = depth < 170 ? DECOR_SHALLOW : depth < 620 ? DECOR_DEEP : DECOR_BOTTOM;
    decor.push({ id: decor.length, type: rng.pick(pool), x, y, rot: rng.range(-Math.PI, Math.PI), scale: rng.range(0.8, 1.25) });
  }

  return {
    seed,
    width: WORLD_W,
    height: WORLD_H,
    step: PROFILE_STEP,
    ground,
    horizons,
    rocks,
    water,
    minerals,
    trees,
    decor,
    origin,
  };
}

/**
 * Root system for a tree at its final stage. The taproot is split into four chained pieces
 * (one per stage); laterals appear in pairs per stage; sub-branches appear one stage later.
 */
function growRoots(rng, species, x0, y0, groundAt, inRock) {
  const sp = TREE_SPECIES[species];
  const roots = [];
  const tips = [];
  const STEP = 10;

  const trace = (sx, sy, angle, length, gravity) => {
    const pts = [{ x: sx, y: sy }];
    let a = angle;
    let x = sx;
    let y = sy;
    const steps = Math.max(2, Math.round(length / STEP));
    for (let s = 0; s < steps; s++) {
      a += rng.range(-0.16, 0.16);
      a += (Math.PI / 2 - a) * gravity;
      const nx = x + Math.cos(a) * STEP;
      const ny = y + Math.sin(a) * STEP;
      if (ny > WORLD_H - 24 || nx < 12 || nx > WORLD_W - 12) break;
      if (ny < groundAt(nx) + 8) {
        a += a < Math.PI / 2 ? 0.35 : -0.35;
        continue;
      }
      if (inRock(nx, ny)) {
        a += rng.chance(0.5) ? 0.55 : -0.55;
        continue;
      }
      x = nx;
      y = ny;
      pts.push({ x, y });
    }
    return pts;
  };

  const addRoot = (pts, width, minStage) => {
    if (pts.length < 3) return null;
    const root = { points: pts, width, minStage };
    roots.push(root);
    const end = pts[pts.length - 1];
    tips.push({ x: end.x, y: end.y, minStage });
    return root;
  };

  const branch = (parent, count, lengthScale, width, minStage) => {
    for (let b = 0; b < count; b++) {
      const pts = parent.points;
      const idx = Math.min(pts.length - 2, Math.floor(pts.length * rng.range(0.3, 0.8)));
      const p = pts[idx];
      const q = pts[idx + 1];
      const base = Math.atan2(q.y - p.y, q.x - p.x);
      const turn = (rng.chance(0.5) ? 1 : -1) * rng.range(0.45, 0.95);
      const len = sp.spread * lengthScale * rng.range(0.7, 1.1);
      addRoot(trace(p.x, p.y, base + turn, len, sp.gravity * 1.4), width, Math.min(3, minStage));
    }
  };

  // Taproot in four stage pieces.
  let tx = x0;
  let ty = y0 + 4;
  let ta = Math.PI / 2 + rng.range(-0.12, 0.12);
  const shares = [0.4, 0.25, 0.2, 0.15];
  for (let stage = 0; stage < 4; stage++) {
    const pts = trace(tx, ty, ta, sp.taproot * shares[stage], 0.05);
    const root = addRoot(pts, 7 - stage * 1.3, stage);
    if (!root) break;
    const end = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    tx = end.x;
    ty = end.y;
    ta = Math.atan2(end.y - prev.y, end.x - prev.x);
    if (stage < 3) branch(root, 1, 0.35, 2.2, stage + 1);
  }

  // Lateral roots, alternating sides, two per stage.
  for (let i = 0; i < sp.laterals; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const minStage = Math.min(3, Math.floor(i / 2));
    const down = rng.range(0.22, 0.7);
    const angle = side > 0 ? down : Math.PI - down;
    const len = sp.spread * rng.range(0.65, 1.0) * (1 - minStage * 0.08);
    const sy = y0 + rng.range(6, 26);
    const root = addRoot(trace(x0 + side * rng.range(2, 10), sy, angle, len, sp.gravity), 4.6 - minStage * 0.7, minStage);
    if (root) branch(root, rng.int(1, 2), 0.42, 2.4 - minStage * 0.3, minStage + 1);
  }

  return { roots, tips };
}

// Deterministic world generation: a cross-section of a forest glade. Pure data, no DOM.
// Every seed makes a different glade: a biome (species, soil, rocks, water), a ground shape, 2-5 trees spread over
// the width, and a spore somewhere between them. A build that is not fair to a new player is rebuilt (see fairness.js).
import { WORLD_W, WORLD_H, PROFILE_STEP } from '../config.js';
import { createRng, fbm1, hash32, makeNoise1D } from '../core/rng.js';
import { clamp, dist, distToPolyline, pointInPolygon, polygonBounds } from '../core/geom.js';
import { groundYAt, sampleProfile } from './query.js';
import { BIOMES, BIOME_IDS, gladeName, pickWeighted } from './biomes.js';
import { FAIR, FAIR_V2, FAIR_V3, STUMP, checkFairness, openingModeOf, stumpSpotProblem } from './fairness.js';

/** Soil horizons, top to bottom. depth: units below the ground surface (nominal; worlds scale it per biome); cost: sugar per unit of hypha. */
export const HORIZONS = [
  { id: 'litter', name: 'Лесная подстилка', depth: 0, cost: 0.1, color: '#6b5238' },
  { id: 'humus', name: 'Гумус', depth: 26, cost: 0.14, color: '#3f2c20' },
  { id: 'loam', name: 'Суглинок', depth: 170, cost: 0.22, color: '#5a4433' },
  { id: 'clay', name: 'Глина', depth: 390, cost: 0.34, color: '#7a5a44' },
  { id: 'gravel', name: 'Галечник', depth: 620, cost: 0.5, color: '#56524d' },
];
const HORIZON_WAVE = [0, 7, 24, 30, 26];
/** Thinnest a horizon may be at its nominal depth. */
const MIN_THICKNESS = [0, 14, 60, 90, 90];

export const TREE_SPECIES = {
  birch: { name: 'Берёза', spread: 250, taproot: 150, laterals: 6, gravity: 0.016 },
  oak: { name: 'Дуб', spread: 290, taproot: 430, laterals: 7, gravity: 0.03 },
  pine: { name: 'Сосна', spread: 210, taproot: 360, laterals: 5, gravity: 0.026 },
};

/** Half-width of a full-grown crown (rendered size), used to space trunks. */
export const CROWN_HALF = { birch: 125, oak: 175, pine: 135 };
/** Trunks stay inside this band; the HUD cards (world x < 306 and > 1560, top) may cover only the edge of a crown. */
export const TREE_X = [340, 1500];
export const trunkRange = (species) => [306 + 0.6 * CROWN_HALF[species], 1560 - 0.6 * CROWN_HALF[species]];
export const MIN_TRUNK_GAP = 190;
/** The spore's x band (clear of the edges) and the farthest it may lie from the nearest trunk. */
const SPORE_X = [FAIR.edge, WORLD_W - FAIR.edge];
const SPORE_MAX_GAP = 420;
const SPORE_MAX_GAP_V2 = 600; // v2 glades keep a wide clearing around the spore, so the nearest trunk may lie farther

/** Mean ground level and the band the surface stays in (hills leave room for crowns, hollows for the soil). */
const GROUND_Y = 298;
const GROUND_BAND = [262, 362];

const DECOR_BOTTOM = ['pebble', 'ammonite', 'pebble'];
const DEEP_KINDS = ['pebble', 'bone', 'shell', 'potsherd'];
const PHOSPHORUS_BANDS = [[260, 520], [300, 640], [420, 720], [280, 560], [380, 700], [320, 600]];

/** A flattened, noisy ellipse around (x, y): 9-13 corners (the draws are part of the world's seed, keep their order). */
function rockOutline(rng, x, y, rx, ry, rot) {
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
  return poly;
}

/**
 * Generator versions. 1: the glades of every game before «старт с задачкой» (a root tip may lie right at the spore); their
 * saves rebuild with exactly these rules. 2: the nearest root tip is 160-250 u away, stumps always stand in sight (see
 * fairness.js FAIR_V2). 3: the second step of the opening is a decision: on about half of the seeds the first tree plus the
 * starter water or the first mineral fits the purse but not both (fairness.js FAIR_V3); the other half is roomy. A new game
 * uses GEN; a save without a `gen` is a v1 save, and every save keeps the generator it was made with.
 */
export const GEN = 3;
export const GENERATIONS = [1, 2, 3];

const ATTEMPTS = { 1: 40, 2: 160, 3: 320 };

/**
 * The whole glade for a seed: the first fair build among deterministic attempts. When none is fair, v1 plays the last build
 * (as it always did); v2 the one with the fewest problems, and carries `fallback`, the list of the rules it breaks, so the reason is on record.
 */
export function generateWorld(seed, gen = GEN) {
  if (!GENERATIONS.includes(gen)) throw new RangeError(`unknown world generator ${gen}`);
  let world = null;
  let best = null;
  for (let attempt = 0; attempt < ATTEMPTS[gen]; attempt++) {
    world = buildWorld(seed, attempt, gen);
    const fair = checkFairness(world);
    if (fair.ok) return world;
    if (!best || fair.problems.length < best.problems.length) best = { world, problems: fair.problems };
  }
  if (gen < 2) return world;
  // v2 and v3 fell short on every attempt: the best one plays (stumps in the whole bands when none stands in sight), with the reasons on record
  best.world.fallback = [...best.problems];
  if (!best.world.stumps.length) {
    best.world.stumps = placeStumps(best.world, true);
    best.world.fallback.push('stumps beyond the seen bands');
  }
  return best.world;
}

/** Biome, ground kind and name of a seed (cheap: no layout), with the identity generator advanced past the name's two draws. */
function gladeIdentity(seed) {
  const idRng = createRng(hash32(seed, 'identity'));
  const biome = BIOMES[BIOME_IDS[idRng.int(0, BIOME_IDS.length - 1)]];
  const terrain = pickWeighted(idRng, biome.ground);
  // The name has its own generator; the two draws it used to take from idRng stay, so the ground and soil of every seed are unchanged.
  idRng.next();
  idRng.next();
  const name = gladeName(createRng(hash32(seed, 'name')), biome, terrain);
  return { idRng, biome, terrain, name };
}

/** The name of the glade of `seed`, without generating it (the title page names a saved glade with it). */
export function gladeNameOf(seed) {
  return gladeIdentity(seed).name;
}

/** One attempt: the glade's identity (biome, ground, soil, name) depends on the seed alone, the layout also on `attempt` (and, from v2 on, on the generator version). */
export function buildWorld(seed, attempt = 0, gen = GEN) {
  const rng = createRng(attempt === 0 ? seed : hash32(seed, 'attempt', attempt));
  const cols = Math.ceil(WORLD_W / PROFILE_STEP) + 1;

  // --- Identity: biome, ground shape, soil depths, name.
  const { idRng, biome, terrain, name } = gladeIdentity(seed);
  const shape = makeShape(idRng, terrain);
  const jitter = biome.id === 'mixed' ? 0.12 : 0.08;
  const nominal = biome.depths.map((d, i) => (i === 0 ? 0 : d * idRng.range(1 - jitter, 1 + jitter)));
  for (let i = 1; i < nominal.length; i++) nominal[i] = Math.max(nominal[i], nominal[i - 1] + MIN_THICKNESS[i]);
  const waveScale = biome.waveScale * idRng.range(0.7, 1.3);

  // Ground surface around y = 298, shaped by the terrain kind.
  const gNoise = makeNoise1D(hash32(seed, 'ground'));
  const ground = [];
  for (let i = 0; i < cols; i++) {
    const x = i * PROFILE_STEP;
    const y = GROUND_Y + shape.offset(x) + shape.noise * fbm1(gNoise, x / 520, 3) + 3.5 * gNoise(x / 55 + 97);
    ground.push(clamp(y, GROUND_BAND[0], GROUND_BAND[1]));
  }
  const groundAt = (x) => sampleProfile(ground, PROFILE_STEP, x);

  // Horizon boundaries follow the ground with their own waves, strictly ordered.
  const horizons = HORIZONS.map((h, i) => {
    const hn = makeNoise1D(hash32(seed, 'horizon', i));
    const depth = Math.round(nominal[i]);
    const top = ground.map((gy, k) =>
      i === 0 ? gy : gy + depth + HORIZON_WAVE[i] * waveScale * fbm1(hn, (k * PROFILE_STEP) / 300, 3),
    );
    return { ...h, depth, top };
  });
  for (let i = 1; i < horizons.length; i++) {
    const prev = horizons[i - 1].top;
    const cur = horizons[i].top;
    for (let k = 0; k < cols; k++) cur[k] = Math.max(cur[k], prev[k] + 10);
  }
  const depthAt = (x, y) => y - groundAt(x);
  const offRavine = (x, margin) => shape.ravine === null || Math.abs(x - shape.ravine) > margin;

  // --- Trunks: species and positions spread over the width.
  const { defs: treeDefs, clearing } = layoutTrees(rng, biome, (x) => offRavine(x, 125), (x) => offRavine(x, 130), gen);

  // Stages: young glades; at most one tree starts full-grown.
  for (const t of treeDefs) t.stage = pickWeighted(rng, [[0, 0.35], [1, 0.4], [2, 0.25]]);
  if (rng.chance(0.14)) rng.pick(treeDefs).stage = 3;

  // Rocks: flattened noisy ellipses, bigger deeper down; kept clear of trunks and (v1) the origin.
  const placeRocks = (origin) => {
    const rocks = [];
    const rockCount = rng.int(biome.rocks.count[0], biome.rocks.count[1]);
    const [rockMin, rockMax] = biome.rocks.depth;
    for (let tries = 0; tries < 140 && rocks.length < rockCount; tries++) {
      const x = rng.range(70, WORLD_W - 70);
      const depth = rng.range(rockMin, rockMax);
      const y = groundAt(x) + depth;
      if (y > WORLD_H - 40) continue;
      const r = (24 + (depth / 760) * rng.range(30, 70)) * biome.rocks.size;
      if (treeDefs.some((t) => Math.abs(t.x - x) < r + 60 && depth < 260)) continue;
      if (origin && dist(x, y, origin.x, origin.y) < r + 110) continue;
      if (rocks.some((o) => dist(x, y, o.x, o.y) < r + o.r + 40)) continue;
      const rx = r * rng.range(1.0, 1.45);
      const ry = r * rng.range(0.55, 0.85);
      const rot = rng.range(-0.35, 0.35);
      const poly = rockOutline(rng, x, y, rx, ry, rot);
      rocks.push({ id: rocks.length, x, y, r, poly, ...polygonBounds(poly) });
    }
    return rocks;
  };
  const rockTester = (rocks) => (x, y, margin = 0) =>
    rocks.some(
      (o) =>
        x >= o.minX - margin &&
        x <= o.maxX + margin &&
        y >= o.minY - margin &&
        y <= o.maxY + margin &&
        (margin === 0 ? pointInPolygon(x, y, o.poly) : dist(x, y, o.x, o.y) < o.r * 1.45 + margin),
    );

  // Trees with root systems generated for the final stage; each root knows when it appears.
  const growTrees = (inRock) =>
    treeDefs.map((def, id) => {
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
        // the honey fungus' view of the tree (the sim owns these): infection 0..1, the player's mantle 0..1, lost = a snag
        infection: 0,
        mantle: 0,
        lost: false,
      };
    });

  // Where the spore germinated: between the trunks, not under one, away from the edges, with a growing tree in reach.
  let origin;
  let rocks;
  let trees;
  if (gen >= 2) {
    // v2 reads the real roots: the rocks come first (clear of the spore by the spot it takes), then the roots, then the spore.
    rocks = placeRocks(null);
    trees = growTrees(rockTester(rocks));
    // ...and a stump keeps its seat in sight (the honey fungus needs one): the spore leaves room for a seen spot 260 u away
    const seats = stumpSeats({ width: WORLD_W, ground, step: PROFILE_STEP, trees: treeDefs, origin: { x: -1e6, y: -1e6 } });
    origin = pickOriginV2(rng, treeDefs, trees, rocks, seats, groundAt, (x) => offRavine(x, 130), clearing);
  } else {
    // (Roots are sketched without rocks here; rocks keep clear of the spore, so the real roots end up the same.)
    const sketch = treeDefs.map((def, id) => ({
      stage: def.stage,
      tips: growRoots(rng.fork(`roots${id}`), def.species, def.x, groundAt(def.x), groundAt, () => false).tips,
    }));
    origin = pickOrigin(rng, treeDefs, sketch, groundAt, (x) => offRavine(x, 130), clearing);
    rocks = placeRocks(origin);
    trees = growTrees(rockTester(rocks));
  }
  const inRock = rockTester(rocks);
  const nearRoots = (x, y, d) =>
    trees.some((t) => t.roots.some((r) => r.points.some((p) => Math.abs(p.x - x) < d && Math.abs(p.y - y) < d)));
  // v2: in some glades a boulder lies on the way to the nearest tip, so the first drag has a side to choose
  if (gen >= 2) {
    const boulder = placeBoulder(rng.fork('boulder'), biome, origin, trees, rocks, groundAt);
    if (boulder) rocks.push(boulder);
  }

  // Deposits: water pockets and mineral veins placed away from rocks, roots, the origin and each other.
  const deposits = [];
  const freeSpot = (x, y, clearance, relax) =>
    y < WORLD_H - clearance &&
    x > clearance &&
    x < WORLD_W - clearance &&
    !inRock(x, y, clearance) &&
    dist(x, y, origin.x, origin.y) > clearance + 90 &&
    !deposits.some((d) => dist(x, y, d.x, d.y) < clearance + d.size + 60) &&
    (relax || !nearRoots(x, y, clearance * 0.6));

  // Winnability: the first water pocket and the first nitrogen vein are a short reach from the spore, on opposite sides.
  const side = rng.chance(0.5) ? 1 : -1;
  // v3: a roomy glade keeps the starter pocket and the first mineral near the spore (the three fit the purse), a tight one lays them out like v2
  const opening = gen >= 3 ? openingModeOf(seed) : null;
  const roomy = opening === 'roomy';
  const [waterNear, waterFar] = roomy ? FAIR_V3.roomyPlace : gen >= 2 ? FAIR_V2.waterPlace : [150, 290]; // how far to the side of the spore the starter pocket is tried
  const [mineralNear, mineralFar] = roomy ? FAIR_V3.roomyPlace : gen >= 2 ? FAIR_V2.mineralPlace : [130, 280];
  const water = [];
  for (const [d0, d1] of biome.water.plan) {
    for (let tries = 0; tries < 500; tries++) {
      const relax = tries > 250;
      const first = water.length === 0;
      const x = first ? origin.x + (tries % 2 ? side : -side) * rng.range(waterNear, waterFar) : rng.range(80, WORLD_W - 80);
      const y = groundAt(x) + rng.range(d0, d1);
      const rx = rng.range(38, 68) * biome.water.size;
      if (first && dist(x, y, origin.x, origin.y) > (gen >= 2 ? FAIR_V2.waterDist - 5 : 285)) continue;
      if (!freeSpot(x, y, rx, relax)) continue;
      const deep = depthAt(x, y) > 300;
      const max = Math.round(deep ? rng.range(120, 160) : rng.range(90, 130));
      const regen = (deep ? 0.3 : 0.6) * biome.water.regen;
      water.push({ id: water.length, x, y, rx, ry: rx * rng.range(0.42, 0.55), amount: max, max, regen });
      deposits.push({ x, y, size: rx });
      break;
    }
  }

  const minerals = [];
  let phosphorusSeen = 0;
  for (const kind of biome.minerals) {
    const [d0, d1] = kind === 'nitrogen' ? [40, 190] : PHOSPHORUS_BANDS[phosphorusSeen++ % PHOSPHORUS_BANDS.length];
    const first = minerals.length === 0;
    for (let tries = 0; tries < 500; tries++) {
      const relax = tries > 250;
      const x = first ? origin.x + (tries % 2 ? -side : side) * rng.range(mineralNear, mineralFar) : rng.range(80, WORLD_W - 80);
      const y = groundAt(x) + rng.range(d0, first ? 160 : d1);
      const r = rng.range(16, 26);
      if (first && dist(x, y, origin.x, origin.y) > (gen >= 2 ? FAIR_V2.nitrogenDist - 20 : 300)) continue;
      if (!freeSpot(x, y, r + 14, relax)) continue;
      const max = Math.round(rng.range(50, 100) * biome.mineralScale[kind]);
      minerals.push({ id: minerals.length, x, y, r, amount: max, max, kind });
      deposits.push({ x, y, size: r });
      break;
    }
  }

  // Decorative curiosities for the naturalist's eye: rarer the deeper they lie. Every glade hides at least one
  // of each common deep kind (found in the soil between the humus and the gravel), so there is always something to find.
  const decor = [];
  const deepIds = new Set();
  const missing = new Set(DEEP_KINDS);
  for (let tries = 0; tries < 200 && decor.length < 18; tries++) {
    const x = rng.range(30, WORLD_W - 30);
    const depth = rng.range(8, WORLD_H - groundAt(x) - 20);
    const y = groundAt(x) + depth;
    if (inRock(x, y, 12)) continue;
    if (deposits.some((d) => dist(x, y, d.x, d.y) < d.size + 34)) continue;
    if (decor.some((d) => dist(x, y, d.x, d.y) < 70)) continue;
    if (dist(x, y, origin.x, origin.y) < 60) continue;
    const isDeep = depth >= 170 && depth < 620;
    const pool = depth < 170 ? biome.decor.shallow : isDeep ? biome.decor.deep : DECOR_BOTTOM;
    const type = isDeep && missing.size && rng.chance(0.5) ? rng.pick([...missing]) : rng.pick(pool);
    missing.delete(type);
    if (isDeep) deepIds.add(decor.length);
    decor.push({ id: decor.length, type, x, y, rot: rng.range(-Math.PI, Math.PI), scale: rng.range(0.8, 1.25) });
  }
  for (const kind of missing) {
    // too few deep finds came up: retag one whose kind is repeated
    const repeated = decor.filter((c) => deepIds.has(c.id) && decor.filter((o) => o.type === c.type).length > 1);
    if (repeated.length) rng.pick(repeated).type = kind;
  }

  const world = {
    seed,
    biome: biome.id,
    name,
    terrain,
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
    stumps: [],
  };
  world.stumps = placeStumps(world, gen < 2);
  world.gen = gen;
  if (opening) world.opening = opening; // v3 only: what kind of opening fairness.js judges
  return world;
}

/** How often a v2 glade has a boulder between the spore and the nearest root tip. Stony soil has one more often. */
const BOULDER_CHANCE = { birch: 0.4, oak: 0.45, pine: 0.7, mixed: 0.55 };
/** Clear soil kept between a boulder's outline and the spore (its ring of hyphae reaches 30 u), the root tip, and any root. */
const BOULDER_GAP = { spore: 62, tip: 46, root: 14 };

/** Distance from (x, y) to the outline of a polygon; 0 inside it. */
const outlineDist = (x, y, poly) => (pointInPolygon(x, y, poly) ? 0 : distToPolyline(x, y, [...poly, poly[0]]));

/**
 * A boulder on the way from the spore to the nearest root tip of a growing tree: the straight drag to that tip is shut, a
 * hypha goes over or under it (or the player turns to the other tree). It lies 35-70 % of the way, as large as a
 * mid-sized rock of the biome, and leaves BOULDER_GAP of soil around the spore, the tip and every root. Own rng, so the rest of
 * the glade does not depend on whether one is placed. Returns the rock (with the next id) or null.
 */
function placeBoulder(rng, biome, origin, trees, rocks, groundAt) {
  if (!rng.chance(BOULDER_CHANCE[biome.id] ?? 0.5)) return null;
  let tip = null;
  for (const t of trees) {
    if (t.stage >= 3) continue;
    for (const p of t.tips) {
      if (p.minStage > t.stage) continue;
      const d = dist(origin.x, origin.y, p.x, p.y);
      if (!tip || d < tip.d) tip = { x: p.x, y: p.y, d };
    }
  }
  if (!tip) return null;
  const roots = trees.flatMap((t) => t.roots.flatMap((r) => r.points));
  for (let tries = 0; tries < 40; tries++) {
    const along = rng.range(0.35, 0.7);
    const r = rng.range(28, 40) * biome.rocks.size;
    const rx = r * rng.range(1.15, 1.45);
    const ry = r * rng.range(0.65, 0.85);
    const x = origin.x + (tip.x - origin.x) * along + rng.range(-8, 8);
    const y = origin.y + (tip.y - origin.y) * along + rng.range(-8, 8);
    const rot = rng.range(-0.3, 0.3);
    if (y - ry * 1.2 < groundAt(x) + 24 || y + ry * 1.2 > WORLD_H - 40) continue;
    if (trees.some((t) => Math.abs(t.x - x) < r + 60 && y - groundAt(x) < 260)) continue;
    if (rocks.some((o) => dist(x, y, o.x, o.y) < r + o.r + 40)) continue;
    const poly = rockOutline(rng, x, y, rx, ry, rot);
    if (outlineDist(origin.x, origin.y, poly) < BOULDER_GAP.spore || outlineDist(tip.x, tip.y, poly) < BOULDER_GAP.tip) continue;
    const bounds = polygonBounds(poly);
    const near = roots.filter((p) => p.x > bounds.minX - 40 && p.x < bounds.maxX + 40 && p.y > bounds.minY - 40 && p.y < bounds.maxY + 40);
    if (near.some((p) => outlineDist(p.x, p.y, poly) < BOULDER_GAP.root)) continue;
    return { id: rocks.length, x, y, r, poly, ...bounds, boulder: true };
  }
  return null;
}

/**
 * 1-2 old stumps near the left and/or right glade edges. Drawn from their own rng after the world is complete, so
 * nothing else about a seed changes; every candidate is checked with the same rules the tests use (stumpSpotProblem).
 */
function placeStumps(world, wide) {
  const rng = createRng(hash32(world.seed, 'stumps'));
  const order = rng.chance(0.5) ? [0, 1] : [1, 0];
  const want = rng.chance(0.4) ? 2 : 1;
  const stumps = [];
  const tryBand = (b, band) => {
    const [x0, x1] = band[b];
    let x = null;
    for (let tries = 0; tries < 40 && x === null; tries++) {
      const cx = rng.range(x0, x1);
      if (!stumpSpotProblem(world, cx)) x = cx;
    }
    // no luck: scan the band from its inner end outwards for the first valid spot
    if (b === 0) {
      for (let cx = x1; cx >= x0 && x === null; cx -= 6) if (!stumpSpotProblem(world, cx)) x = cx;
    } else {
      for (let cx = x0; cx <= x1 && x === null; cx += 6) if (!stumpSpotProblem(world, cx)) x = cx;
    }
    if (x === null) return;
    const r = rng.range(STUMP.r[0], STUMP.r[1]);
    stumps.push({ id: stumps.length, x, y: groundYAt(world, x), r });
  };
  // `want` is a wish; when the first band has no spot the loop simply goes on to the other one. Stumps go where no HUD
  // card hides them (STUMP.seen). In v1 a glade with no such spot (about a third of them: trunks and the spore fill the
  // rest) gets one in the whole bands, the right one first (the objectives card folds once the rival wakes; the resource
  // card on the left never does), then the left one, which always has a spot: the spore is 340+ from the edge.
  // From v2 on `wide` is false: such a glade fails its fairness check and is built again (pickOriginV2 leaves a seat).
  for (const b of order) if (stumps.length < want) tryBand(b, STUMP.seen);
  if (wide) for (const b of [1, 0]) if (!stumps.length) tryBand(b, STUMP.bands);
  return stumps.sort((a, c) => a.x - c.x).map((s, id) => ({ ...s, id }));
}

/**
 * The ground shape as an offset from the mean ground level plus the amplitude of the gentle noise laid over it.
 * `ravine` is the x of a narrow cut (or null) that trunks and the spore keep away from.
 */
function makeShape(rng, terrain) {
  const gauss = (x, c, s) => Math.exp(-(((x - c) / s) ** 2));
  switch (terrain) {
    case 'rolling': {
      const amp = rng.range(18, 26);
      const period = rng.range(560, 900);
      const phase = rng.range(0, Math.PI * 2);
      return { ravine: null, noise: 9, offset: (x) => amp * Math.sin((x / period) * Math.PI * 2 + phase) };
    }
    case 'slope': {
      const tilt = rng.range(24, 36) * (rng.chance(0.5) ? 1 : -1);
      return { ravine: null, noise: 8, offset: (x) => (tilt * (x - 960)) / 960 };
    }
    case 'hill': {
      const h = rng.range(28, 36);
      const c = rng.range(620, 1300);
      const s = rng.range(240, 360);
      return { ravine: null, noise: 8, offset: (x) => -h * gauss(x, c, s) };
    }
    case 'hollow': {
      const d = rng.range(34, 46);
      const c = rng.range(620, 1300);
      const s = rng.range(230, 340);
      return { ravine: null, noise: 8, offset: (x) => d * gauss(x, c, s) };
    }
    case 'ravine': {
      const d = rng.range(46, 58);
      const c = rng.range(560, 1360);
      const s = rng.range(60, 90);
      return { ravine: c, noise: 7, offset: (x) => d * gauss(x, c, s) };
    }
    default:
      return { ravine: null, noise: 6, offset: () => 0 };
  }
}

/** 2-5 trunks of seeded species, left to right, at least one crown-gap apart and spread over the band. */
function layoutTrees(rng, biome, xOk, sporeOk, gen) {
  const dom = biome.trees.dominant;
  let n = pickWeighted(rng, biome.trees.counts);
  for (let tries = 0; ; tries++) {
    if (tries > 0 && tries % 60 === 0 && n > 2) n--;
    const species = [];
    for (let i = 0; i < n; i++) species.push(pickWeighted(rng, biome.trees.weights));
    // «mostly birch»: the dominant species holds at least 60% of the trunks; a mixed forest has at least two species
    const want = dom ? Math.ceil(n * 0.6) : 0;
    for (let i = 0; i < n && species.filter((s) => s === dom).length < want; i++) species[i] = dom;
    if (!dom && species.every((s) => s === species[0])) {
      species[rng.int(0, n - 1)] = rng.pick(Object.keys(TREE_SPECIES).filter((s) => s !== species[0]));
    }
    for (let i = n - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [species[i], species[j]] = [species[j], species[i]];
    }
    let x0 = Math.max(TREE_X[0], trunkRange(species[0])[0]);
    let x1 = Math.min(TREE_X[1], trunkRange(species[n - 1])[1]);
    const gaps = [];
    for (let i = 1; i < n; i++) gaps.push(Math.max(MIN_TRUNK_GAP, 0.6 * (CROWN_HALF[species[i - 1]] + CROWN_HALF[species[i]])));
    // a clearing for the spore: before the first trunk, between two, or after the last, so it is not always at the edge
    const clearing = rng.int(0, n);
    // v2: the clearing is wide enough that no root of the nearest trunks lies within 160 u of a spore at its heart
    const half = gen >= 2 ? FAIR_V2.clearHalf : FAIR.trunkGap + 60;
    const room = gen >= 2 ? 2 * half : 2 * (FAIR.trunkGap + 20) + 20;
    if (clearing === 0) x0 = Math.max(x0, SPORE_X[0] + half);
    else if (clearing === n) x1 = Math.min(x1, SPORE_X[1] - half);
    else gaps[clearing - 1] = Math.max(gaps[clearing - 1], room);
    const slack = x1 - x0 - gaps.reduce((s, g) => s + g, 0);
    if (slack < 0) continue;
    // spread the free width over the n + 1 pieces
    const w = Array.from({ length: n + 1 }, () => 0.4 + rng.next());
    const wsum = w.reduce((s, v) => s + v, 0);
    let x = x0 + (slack * w[0]) / wsum;
    const defs = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) x += gaps[i - 1] + (slack * w[i]) / wsum;
      defs.push({ species: species[i], x, stage: 0 });
    }
    // the clearing is the stretch the layout made room for
    const k = clearing;
    const lo = k === 0 ? SPORE_X[0] : defs[k - 1].x + FAIR.trunkGap;
    const hi = k === n ? SPORE_X[1] : defs[k].x - FAIR.trunkGap;
    const found = { defs, clearing: [lo, hi] };
    if (tries > 120 || (defs.every((d) => xOk(d.x)) && clearSlots(defs, sporeOk, found.clearing, gen).length > 0)) return found;
  }
}

/**
 * Stretches of the surface where the spore may lie: at least a trunk-gap from every trunk, still near one,
 * clear of the edges. Returns [[x0, x1], ...] (each at least 40 u wide), scanned every 10 u.
 */
function sporeSlots(defs, ok, gen) {
  const maxGap = gen >= 2 ? SPORE_MAX_GAP_V2 : SPORE_MAX_GAP;
  const slots = [];
  let start = null;
  for (let x = SPORE_X[0]; x <= SPORE_X[1] + 10; x += 10) {
    const gap = Math.min(...defs.map((d) => Math.abs(d.x - x)));
    const good = x <= SPORE_X[1] && gap >= FAIR.trunkGap && gap <= maxGap && ok(x);
    if (good && start === null) start = x;
    if (!good && start !== null) {
      if (x - 10 - start >= 40) slots.push([start, x - 10]);
      start = null;
    }
  }
  return slots;
}

/** The spore slots that lie inside the clearing the layout made room for (clipped to it). */
function clearSlots(defs, ok, [lo, hi], gen) {
  return sporeSlots(defs, ok, gen)
    .map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)])
    .filter(([a, b]) => b - a >= 30);
}

/** Where a stump could stand in sight (the STUMP.seen bands, every 10 u) in `world` — before the spore is known: [{ x, y }]. */
function stumpSeats(world) {
  const seats = [];
  for (const [a, b] of STUMP.seen) {
    for (let x = a; x <= b; x += 10) if (!stumpSpotProblem(world, x)) seats.push({ x, y: groundYAt(world, x) });
  }
  return seats;
}

/**
 * The spore of generator v2: where the nearest active root tip lies 160-250 u away (aiming a little inside that band), clear of
 * every rock. Every x of the surface is tried (every 10 u); one of the spots in the layout's clearing is picked at random, else
 * any other. The nearest tip is a growing tree's, clearly nearer than a full-grown one's. When nothing fits, the best try goes on
 * and the fairness check sends the build back.
 */
function pickOriginV2(rng, treeDefs, trees, rocks, seats, groundAt, xOk, clearing) {
  const F = FAIR_V2;
  const lo = F.tipMin + 14;
  const hi = F.tipMax - 14;
  // the nearest active tip of each tree, nearest tree first: a fork is a second tree within 1.4 x + 20 u of the first
  const isFork = (x, y) => {
    const near = trees.map((t) => Math.min(...t.tips.filter((p) => p.minStage <= t.stage).map((p) => dist(x, y, p.x, p.y)))).sort((a, b) => a - b);
    return near.length > 1 && near[1] <= near[0] * 1.4 + 20;
  };
  const spots = [];
  let closest = null;
  for (let x = SPORE_X[0]; x <= SPORE_X[1]; x += 10) {
    if (!xOk(x) || treeDefs.some((d) => Math.abs(d.x - x) < F.trunkGap)) continue;
    const y = groundAt(x) + 64;
    if (rocks.some((o) => dist(x, y, o.x, o.y) < o.r + 110)) continue; // rocks keep clear of the spore
    if (!seats.some((p) => dist(x, y, p.x, p.y) >= STUMP.fromOrigin)) continue; // a stump still has a seat in sight
    let young = Infinity;
    let old = Infinity;
    for (const t of trees) {
      for (const tip of t.tips) {
        if (tip.minStage > t.stage) continue;
        const d = dist(x, y, tip.x, tip.y);
        if (t.stage >= 3) old = Math.min(old, d);
        else young = Math.min(young, d);
      }
    }
    const nearest = Math.min(young, old);
    const miss = nearest < lo ? lo - nearest : Math.max(0, nearest - hi);
    if (!closest || miss < closest.miss) closest = { x, y, miss };
    if (miss === 0 && young * 1.15 < old) spots.push({ x, y, fork: isFork(x, y) });
  }
  const inClearing = spots.filter((p) => p.x >= clearing[0] && p.x <= clearing[1]);
  const pool = inClearing.length ? inClearing : spots;
  if (pool.length) {
    // a fork (a second tree's tip not much farther than the first's: «which tree first?») is three times as likely
    const weight = pool.map((p) => (p.fork ? 3 : 1));
    let r = rng.next() * weight.reduce((sum, v) => sum + v, 0);
    let k = 0;
    while (k < pool.length - 1 && r >= weight[k]) r -= weight[k++];
    return { x: pool[k].x, y: pool[k].y };
  }
  return closest ? { x: closest.x, y: closest.y } : { x: clamp(treeDefs[0].x + 200, SPORE_X[0], SPORE_X[1]), y: groundAt(treeDefs[0].x + 200) + 64 };
}

/** The spore: in the clearing between trunks (or beside the outer ones), with a growing tree's root tip in reach but not touching. */
function pickOrigin(rng, treeDefs, sketch, groundAt, xOk, clearing) {
  let slots = clearSlots(treeDefs, xOk, clearing);
  if (!slots.length) slots = sporeSlots(treeDefs, xOk);
  if (!slots.length) {
    const x = clamp(treeDefs[0].x + 200, SPORE_X[0], SPORE_X[1]);
    return { x, y: groundAt(x) + 64 };
  }
  const weight = slots.map(([a, b]) => 100 + b - a);
  const total = weight.reduce((sum, v) => sum + v, 0);
  let fallback = null;
  for (let tries = 0; tries < 300; tries++) {
    let r = rng.next() * total;
    let k = 0;
    while (k < slots.length - 1 && r >= weight[k]) r -= weight[k++];
    const x = rng.range(slots[k][0], slots[k][1]);
    const y = groundAt(x) + 64;
    fallback ??= { x, y };
    let nearest = Infinity;
    let young = Infinity;
    let old = Infinity;
    for (const t of sketch) {
      for (const tip of t.tips) {
        if (tip.minStage > t.stage) continue;
        const d = dist(x, y, tip.x, tip.y);
        nearest = Math.min(nearest, d);
        if (t.stage >= 3) old = Math.min(old, d);
        else young = Math.min(young, d);
      }
    }
    if (nearest >= FAIR.tipMin + 8 && young <= FAIR.tipDist - 30 && young * 1.15 < old) return { x, y };
  }
  return fallback;
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

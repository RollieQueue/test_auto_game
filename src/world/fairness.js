// Fairness of a generated glade: the opening must be winnable on every seed. Pure functions over a World.
import { dist } from '../core/geom.js';
import { costAt, sampleProfile } from './query.js';
import { createRouter } from './route.js';

/** Limits, in world units and sugar (the player starts with 100 sugar; B.startSugar). */
export const FAIR = {
  edge: 340, // the spore keeps this far from the left and right edges
  trunkGap: 120, // ...and this far from any trunk
  waterDist: 300, // the starter pocket (water[0]) from the spore
  waterCost: 52, // straight-line sugar cost to reach it
  tipMin: 55, // ...but not handed over: no active root tip touching the spore ring (30 + link radius 18)
  tipDist: 290, // nearest active root tip
  tipCost: 52,
  nitrogenDist: 320, // the first mineral (always nitrogen)
  nitrogenCost: 58,
  sameTipMargin: 0.9, // a stage-3 tree must not be the cheapest link (it can no longer grow)
};

/**
 * Generator v2 («старт с задачкой»): the first root tip is NOT handed over. The nearest active tip lies 160-250 u from the
 * spore, and the opening is judged by real routes (cheapest hypha around rocks, at the horizon prices, times the growth
 * cost of the pressured economy) instead of straight lines. The purse is the sugar in hand at the start of a real game:
 * B.startSugar is 100, but the sugar cap of the pressured economy cuts it to ~70 on the first tick. A test pins `growCost`
 * and `purse` to the balance. The margins:
 *  - the first tree costs at most `treeShare` of the purse (60 %, 42 sugar: at least 28 are left after the first link),
 *  - the starter water at most `waterShare` of it (45 %),
 *  - the two together at most `openShare` (90 %, 63 sugar): a player who chose well still holds sugar for the mineral or a
 *    mushroom, and one who chose badly is never stuck.
 */
export const FAIR_V2 = {
  edge: FAIR.edge,
  trunkGap: FAIR.trunkGap,
  tipMin: 160,
  tipMax: 250,
  waterDist: 260, // the starter pocket (water[0]) from the spore: nearer than in v1 (300), the tree takes the larger share of the purse
  nitrogenDist: 290, // the first mineral (always nitrogen)
  sameTipMargin: FAIR.sameTipMargin,
  growCost: 1.15,
  purse: 70,
  treeShare: 0.6,
  waterShare: 0.45,
  openShare: 0.9,
  waterPlace: [110, 240], // generate.js: how far to the side of the spore the starter pocket and the first mineral are tried
  mineralPlace: [110, 250],
  clearHalf: 400, // generate.js: half the clearing laid out around the spore (no trunk within this of the heart of it)
  routeBox: 330, // the routes are searched this far around the spore
  tipLink: 14, // a route ends this near a root tip (the game links within 18)
};

/** Sugar for a straight hypha from (ax, ay) to (bx, by); Infinity when rock or the surface is in the way. */
export function straightCost(world, ax, ay, bx, by) {
  const len = dist(ax, ay, bx, by);
  const n = Math.max(1, Math.ceil(len / 6));
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const c = costAt(world, ax + (bx - ax) * t, ay + (by - ay) * t);
    if (!Number.isFinite(c)) return Infinity;
    sum += c * (len / n);
  }
  return sum;
}

/** Returns { ok, problems: string[], water, tip, nitrogen } (costs in sugar); `problems` is empty when fair. Judges by the limits of the world's generator version. */
export function checkFairness(world) {
  return (world.gen ?? 1) >= 2 ? checkFairnessV2(world) : checkFairnessV1(world);
}

/** The rules of generator v1, kept exactly: saves of v1 worlds are rebuilt with them. */
function checkFairnessV1(world) {
  const problems = [];
  const o = world.origin;
  if (!Number.isFinite(costAt(world, o.x, o.y))) problems.push('origin is not passable');
  if (o.x < FAIR.edge || o.x > world.width - FAIR.edge) problems.push('the spore sits at the edge');
  if (world.trees.some((t) => Math.abs(t.x - o.x) < FAIR.trunkGap)) problems.push('the spore sits under a trunk');

  const water = world.water[0];
  const waterCost = water ? straightCost(world, o.x, o.y, water.x, water.y) : Infinity;
  if (!water || dist(o.x, o.y, water.x, water.y) > FAIR.waterDist) problems.push('starter water pocket is far');
  if (!(waterCost <= FAIR.waterCost)) problems.push(`starter water costs ${waterCost.toFixed(0)}`);

  let best = { cost: Infinity, tree: null };
  let nearestTip = Infinity;
  let best3 = Infinity;
  for (const t of world.trees) {
    for (const tip of t.tips) {
      if (tip.minStage > t.stage) continue;
      nearestTip = Math.min(nearestTip, dist(o.x, o.y, tip.x, tip.y));
      if (dist(o.x, o.y, tip.x, tip.y) > FAIR.tipDist) continue;
      const c = straightCost(world, o.x, o.y, tip.x, tip.y);
      if (t.stage >= 3) best3 = Math.min(best3, c);
      else if (c < best.cost) best = { cost: c, tree: t };
    }
  }
  const tipCost = best.cost;
  if (nearestTip < FAIR.tipMin) problems.push(`a root tip lies ${nearestTip.toFixed(0)} from the spore`);
  if (!(tipCost <= FAIR.tipCost)) problems.push(`no growing tree is within reach (${tipCost.toFixed(0)})`);
  else if (best3 < tipCost / FAIR.sameTipMargin) problems.push('the cheapest tree to link is already full-grown');

  const n = world.minerals[0];
  const nitrogenCost = n ? straightCost(world, o.x, o.y, n.x, n.y) : Infinity;
  if (!n || n.kind !== 'nitrogen') problems.push('first mineral is not nitrogen');
  else if (dist(o.x, o.y, n.x, n.y) > FAIR.nitrogenDist) problems.push('first nitrogen is far');
  if (!(nitrogenCost <= FAIR.nitrogenCost)) problems.push(`first nitrogen costs ${nitrogenCost.toFixed(0)}`);

  return { ok: problems.length === 0, problems, water: waterCost, tip: tipCost, nitrogen: nitrogenCost };
}

/** Every active root tip (minStage reached) with its tree: [{ tree, index, x, y }]. */
export function activeTips(world) {
  const out = [];
  for (const t of world.trees) t.tips.forEach((tip, index) => (tip.minStage <= t.stage ? out.push({ tree: t, index, x: tip.x, y: tip.y }) : null));
  return out;
}

/**
 * The opening as a player meets it, in sugar at the glade's horizon prices and WITHOUT the growth-cost multiplier:
 * { trees: [{ id, stage, cost, length }] (the cheapest route to an active tip of each tree, cheapest first; trees no route
 * reaches are left out), water, nitrogen: { cost, length } | null for the starter pocket and the first mineral }.
 * Routes start at the spore and avoid rocks and the open air (src/world/route.js).
 */
export function openingRoutes(world) {
  const F = FAIR_V2;
  const o = world.origin;
  const router = createRouter(world, [o.x - F.routeBox, o.y - F.routeBox, o.x + F.routeBox, o.y + F.routeBox]);
  const tips = activeTips(world);
  const trees = [];
  for (const t of world.trees) {
    const mine = tips.filter((p) => p.tree === t);
    const r = router.cheapest(o.x, o.y, (x, y) => mine.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= F.tipLink ** 2));
    if (r) trees.push({ id: t.id, stage: t.stage, cost: r.cost, length: r.length, points: r.points });
  }
  trees.sort((a, b) => a.cost - b.cost);
  const w = world.water[0];
  const n = world.minerals[0];
  const water = w ? router.cheapest(o.x, o.y, (x, y) => ((x - w.x) / w.rx) ** 2 + ((y - w.y) / w.ry) ** 2 <= 0.6) : null;
  const nitrogen = n ? router.cheapest(o.x, o.y, (x, y) => dist(x, y, n.x, n.y) <= n.r * 0.7) : null;
  return { trees, water, nitrogen };
}

/** The rules of generator v2 (FAIR_V2): a first tree 160-250 u away, an opening that costs clearly less than the purse. */
function checkFairnessV2(world) {
  const F = FAIR_V2;
  const problems = [];
  const o = world.origin;
  const result = (extra = {}) => ({ ok: problems.length === 0, problems, water: Infinity, tip: Infinity, nitrogen: Infinity, ...extra });
  if (!Number.isFinite(costAt(world, o.x, o.y))) problems.push('origin is not passable');
  if (o.x < F.edge || o.x > world.width - F.edge) problems.push('the spore sits at the edge');
  if (world.trees.some((t) => Math.abs(t.x - o.x) < F.trunkGap)) problems.push('the spore sits under a trunk');

  const water = world.water[0];
  if (!water || dist(o.x, o.y, water.x, water.y) > F.waterDist) problems.push('starter water pocket is far');
  const n = world.minerals[0];
  if (!n || n.kind !== 'nitrogen') problems.push('first mineral is not nitrogen');
  else if (dist(o.x, o.y, n.x, n.y) > F.nitrogenDist) problems.push('first nitrogen is far');

  // the first tree is a walk away, not a hand-shake: the nearest active root tip lies 160-250 u from the spore
  let nearestTip = Infinity;
  for (const p of activeTips(world)) nearestTip = Math.min(nearestTip, dist(o.x, o.y, p.x, p.y));
  if (nearestTip < F.tipMin) problems.push(`a root tip lies ${nearestTip.toFixed(0)} from the spore`);
  else if (nearestTip > F.tipMax) problems.push(`the nearest root tip lies ${nearestTip.toFixed(0)} from the spore`);

  // stumps stay where no HUD card hides them
  const stumps = stumpProblems(world);
  if (stumps.length) problems.push(...stumps);
  else if (world.stumps.some((s) => !STUMP.seen.some(([a, b]) => s.x >= a && s.x <= b))) problems.push('a stump lies out of sight');
  if (problems.length) return result({ nearest: nearestTip });

  // routes (the dear part) only for a world that passed the cheap checks
  const routes = openingRoutes(world);
  const live = (r) => (r ? r.cost * F.growCost : Infinity);
  const growing = routes.trees.filter((r) => r.stage < 3);
  const first = growing[0];
  const full = routes.trees.find((r) => r.stage >= 3);
  const tree = live(first);
  const waterLive = live(routes.water);
  const nitrogenLive = live(routes.nitrogen);
  if (!first) problems.push('no growing tree can be reached');
  else if (!(tree <= F.treeShare * F.purse)) problems.push(`the first tree costs ${tree.toFixed(0)} sugar`);
  else if (full && full.cost < first.cost / F.sameTipMargin) problems.push('the cheapest tree to link is already full-grown');
  if (!(waterLive <= F.waterShare * F.purse)) problems.push(`the starter water costs ${waterLive.toFixed(0)} sugar`);
  else if (!(waterLive + tree <= F.openShare * F.purse)) problems.push(`the starter water and the first tree cost ${(waterLive + tree).toFixed(0)} together`);
  if (!(nitrogenLive <= F.purse * F.treeShare)) problems.push(`first nitrogen costs ${nitrogenLive.toFixed(0)}`);
  return result({ nearest: nearestTip, water: waterLive, tip: tree, nitrogen: nitrogenLive, routes });
}

/**
 * Old stumps (the honey fungus' starting points): 1-2 at the surface near the glade edges. These limits are NOT part of
 * checkFairness (a failing check would rebuild existing worlds); generate.js picks spots that satisfy them by construction
 * and tests call stumpProblems().
 */
export const STUMP = {
  count: [1, 2],
  r: [26, 34],
  bands: [[48, 700], [1220, 1872]], // left, right: x of the stump centre
  // Where a stump is not hidden by a HUD card: the resource card always covers world x < ~372 at the surface (at
  // 1280×720), the open objectives card covers x > ~1479 there (and ~1529 at 1600×900). generate.js places stumps here
  // and falls back to the whole bands only when no stump would fit at all.
  seen: [[420, 700], [1220, 1450]],
  edge: 40, // from the world's left and right edges
  fromOrigin: 260, // 2-D distance from the spore
  fromTrunk: 140, // horizontal distance from any trunk
  slopeSpan: 30, // |ground(x + span) - ground(x - span)| must stay within slopeMax: keeps stumps off ravine walls
  slopeMax: 24,
};

/** Why a stump centre at x is not allowed (a short string), or null when it is fine. Uses the ground, origin and trunks of `world`. */
export function stumpSpotProblem(world, x) {
  if (x < STUMP.edge || x > world.width - STUMP.edge) return 'stump near the world edge';
  const y = sampleProfile(world.ground, world.step, x);
  if (dist(x, y, world.origin.x, world.origin.y) < STUMP.fromOrigin) return 'stump near the spore';
  if (world.trees.some((t) => Math.abs(t.x - x) < STUMP.fromTrunk)) return 'stump near a trunk';
  const slope = Math.abs(sampleProfile(world.ground, world.step, x + STUMP.slopeSpan) - sampleProfile(world.ground, world.step, x - STUMP.slopeSpan));
  if (slope > STUMP.slopeMax) return 'stump on a slope';
  return null;
}

/** Problems of `world.stumps` (empty array = fine). */
export function stumpProblems(world) {
  const problems = [];
  const stumps = world.stumps;
  if (!Array.isArray(stumps) || stumps.length < STUMP.count[0] || stumps.length > STUMP.count[1]) {
    problems.push(`stump count ${Array.isArray(stumps) ? stumps.length : 'missing'}`);
    return problems;
  }
  stumps.forEach((s, i) => {
    if (s.id !== i) problems.push(`stump ${i} has id ${s.id}`);
    if (!(s.r >= STUMP.r[0] && s.r <= STUMP.r[1])) problems.push(`stump ${i} radius ${s.r}`);
    if (!STUMP.bands.some(([a, b]) => s.x >= a && s.x <= b)) problems.push(`stump ${i} outside the edge bands`);
    if (Math.abs(s.y - sampleProfile(world.ground, world.step, s.x)) > 1e-9) problems.push(`stump ${i} is not on the ground`);
    const why = stumpSpotProblem(world, s.x);
    if (why) problems.push(`stump ${i}: ${why}`);
  });
  if (stumps.length === 2 && STUMP.bands.every(([a, b]) => stumps.filter((s) => s.x >= a && s.x <= b).length === 1) === false) {
    problems.push('two stumps on the same side');
  }
  return problems;
}

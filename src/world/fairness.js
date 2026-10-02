// Fairness of a generated glade: the opening must be winnable on every seed. Pure functions over a World.
import { dist } from '../core/geom.js';
import { costAt, sampleProfile } from './query.js';

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

/** Returns { ok, problems: string[], water, tip, nitrogen } (costs in sugar); `problems` is empty when fair. */
export function checkFairness(world) {
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

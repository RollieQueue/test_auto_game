// «Старт с задачкой», generator 2: the first root tip is a walk away (160-250 u), the first route is a small choice, the opening
// stays affordable by the game's own prices, stumps stand in sight. (Generator 1 and the saves made on it: save-gen-compat.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEN, buildWorld, generateWorld } from '../src/world/generate.js';
import { FAIR_V2, STUMP, activeTips, checkFairness, openingRoutes, stumpProblems } from '../src/world/fairness.js';
import { rockAt } from '../src/world/query.js';
import { createState } from '../src/state.js';
import { B } from '../src/sim/balance.js';
import * as sim from '../src/sim/index.js';
import { pickHint } from '../src/ui/guide-logic.js';

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);
const worlds = new Map();
const worldOf = (seed) => {
  if (!worlds.has(seed)) worlds.set(seed, generateWorld(seed, 2));
  return worlds.get(seed);
};
const routesOf = new Map();
const opening = (seed) => {
  if (!routesOf.has(seed)) routesOf.set(seed, openingRoutes(worldOf(seed)));
  return routesOf.get(seed);
};
const DT = 1 / 60;

const nearestTipDist = (w) => Math.min(...activeTips(w).map((p) => Math.hypot(p.x - w.origin.x, p.y - w.origin.y)));
const quantile = (sorted, p) => sorted[Math.floor((sorted.length - 1) * p)];

/** A state of the real game: threats on (the pressured economy), one tick run so the sugar cap has cut the purse. */
function liveState(seed) {
  const state = createState(seed, 2);
  state.phase = 'playing';
  state.flags.threats = true;
  state.flags.seasons = true;
  sim.updateSim(state, DT);
  return state;
}

test('a glade carries the version of the generator it was made with (a new game takes the newest: world-gen3.test.mjs)', () => {
  assert.ok(GEN >= 2);
  assert.equal(createState(7, 2).world.gen, 2);
  assert.equal(generateWorld(7, 2).gen, 2);
  assert.equal(generateWorld(7, 1).gen, 1);
  assert.throws(() => generateWorld(7, GEN + 1), /unknown world generator/);
  assert.throws(() => createState(7, 0), /unknown world generator/);
});

test('generator 2 keeps what a seed is: biome, ground, soil horizons and name are the generator-1 ones', () => {
  for (const seed of [1, 7, 13, 23, 42, 99, 250]) {
    const a = generateWorld(seed, 1);
    const b = worldOf(seed);
    assert.deepEqual([b.biome, b.terrain, b.name], [a.biome, a.terrain, a.name]);
    assert.deepEqual(b.ground, a.ground);
    assert.deepEqual(b.horizons.map((h) => h.top), a.horizons.map((h) => h.top));
  }
});

test('the nearest active root tip lies 160-250 u from the spore on every seed 1..300 (min, median, max)', () => {
  const ds = SEEDS.map((s) => nearestTipDist(worldOf(s)));
  const sorted = [...ds].sort((a, b) => a - b);
  const stats = { min: sorted[0], p10: quantile(sorted, 0.1), median: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), max: sorted.at(-1) };
  console.log(`# nearest active root tip, seeds 1..300, generator 2: min ${stats.min.toFixed(1)}, p10 ${stats.p10.toFixed(1)}, median ${stats.median.toFixed(1)}, p90 ${stats.p90.toFixed(1)}, max ${stats.max.toFixed(1)} u`);
  assert.ok(stats.min >= 160, `min ${stats.min}`);
  assert.ok(stats.median >= 160 && stats.median <= 250, `median ${stats.median}`);
  assert.ok(stats.max <= 250, `max ${stats.max}`);
  assert.equal(FAIR_V2.tipMin, 160);
  assert.equal(FAIR_V2.tipMax, 250);
  // generator 1 handed the first tip over (the reason for generator 2)
  const old = SEEDS.map((s) => nearestTipDist(generateWorld(s, 1))).sort((a, b) => a - b);
  console.log(`# ... and generator 1: min ${old[0].toFixed(1)}, median ${quantile(old, 0.5).toFixed(1)}, max ${old.at(-1).toFixed(1)} u`);
  assert.ok(quantile(old, 0.5) < 160);
});

test('every seed 1..300 passes the fairness check on the first fair build, with no fallback on record', () => {
  for (const seed of SEEDS) {
    const w = worldOf(seed);
    const fair = checkFairness(w);
    assert.ok(fair.ok, `seed ${seed}: ${fair.problems.join('; ')}`);
    assert.equal(w.fallback, undefined, `seed ${seed}: fallback ${w.fallback}`);
  }
  // seeds far out, as a real new glade (a random seed up to 10^9) would have
  for (const seed of [31337, 99991, 123456789, 987654321, 555555555, 4242424]) {
    const w = generateWorld(seed, 2);
    assert.deepEqual(checkFairness(w).problems, [], `seed ${seed}`);
    assert.equal(w.fallback, undefined);
  }
});

test('the margins are the game’s own: growth cost and purse equal the balance, the opening costs clearly less than the start sugar', () => {
  assert.equal(FAIR_V2.growCost, B.hard.growCost);
  const state = liveState(7);
  assert.ok(Math.abs(state.res.sugar - FAIR_V2.purse) < 1, `the purse of a real game is ${state.res.sugar.toFixed(2)}, FAIR_V2.purse says ${FAIR_V2.purse}`);
  assert.ok(FAIR_V2.purse < B.startSugar, 'the sugar cap of the pressured economy cuts the nominal 100 sugar');
  // the shares: first tree 60 % of the purse, water 45 %, both 90 %
  assert.equal(FAIR_V2.treeShare * FAIR_V2.purse, 42);
  assert.ok(FAIR_V2.treeShare < 0.65 && FAIR_V2.openShare <= 0.9);
});

test('the first tree, the starter water and the first nitrogen are priced by the game itself (estimateGrowth) and stay inside the margins, seeds 1..300', () => {
  const treeCosts = [];
  const waterCosts = [];
  const worst = { sum: 0, drift: 0 };
  for (const seed of SEEDS) {
    const state = liveState(seed);
    const purse = state.res.sugar;
    const r = opening(seed);
    const first = r.trees.find((t) => t.stage < 3);
    assert.ok(first && r.water && r.nitrogen, `seed ${seed}: routes exist`);
    const plan = (route) => sim.estimateGrowth(state, state.net.originId, route.points);
    const tree = plan(first);
    const water = plan(r.water);
    const nitrogen = plan(r.nitrogen);
    for (const [name, p, route] of [['tree', tree, first], ['water', water, r.water], ['nitrogen', nitrogen, r.nitrogen]]) {
      assert.equal(p.blocked, null, `seed ${seed}: the ${name} route is open`);
      worst.drift = Math.max(worst.drift, Math.abs(p.cost - route.cost * B.hard.growCost) / (route.cost * B.hard.growCost));
    }
    // the game's price of the cheapest first tree: clearly less than the purse (60 %, so at least 28 sugar are left after the link)
    assert.ok(tree.cost <= FAIR_V2.treeShare * purse * 1.03, `seed ${seed}: the first tree costs ${tree.cost.toFixed(1)} of ${purse.toFixed(1)}`);
    assert.ok(water.cost <= FAIR_V2.waterShare * purse * 1.03, `seed ${seed}: the water costs ${water.cost.toFixed(1)}`);
    assert.ok(tree.cost + water.cost <= FAIR_V2.openShare * purse * 1.03, `seed ${seed}: water and tree cost ${(tree.cost + water.cost).toFixed(1)}`);
    assert.ok(nitrogen.cost <= FAIR_V2.treeShare * purse * 1.03, `seed ${seed}: the nitrogen costs ${nitrogen.cost.toFixed(1)}`);
    assert.ok(tree.affordable && water.affordable && nitrogen.affordable, `seed ${seed}: each is affordable with the purse in hand`);
    treeCosts.push(tree.cost);
    waterCosts.push(water.cost);
    worst.sum = Math.max(worst.sum, tree.cost + water.cost);
  }
  treeCosts.sort((a, b) => a - b);
  waterCosts.sort((a, b) => a - b);
  console.log(`# sugar of the first tree (estimateGrowth, purse 70): min ${treeCosts[0].toFixed(1)}, median ${quantile(treeCosts, 0.5).toFixed(1)}, max ${treeCosts.at(-1).toFixed(1)}; water: median ${quantile(waterCosts, 0.5).toFixed(1)}, max ${waterCosts.at(-1).toFixed(1)}; water + tree max ${worst.sum.toFixed(1)}; the planner and the game differ by at most ${(worst.drift * 100).toFixed(1)} %`);
  assert.ok(worst.drift < 0.15, 'the route cost the generator checks is the cost the game charges');
});

test('the opening plays: water, then the first tree, along the checked routes, links both and leaves sugar (60 glades, the real sim)', () => {
  let linked = 0;
  let leftMin = Infinity;
  for (const seed of SEEDS.filter((s) => s % 5 === 0)) {
    const state = liveState(seed);
    const purse = state.res.sugar;
    const r = opening(seed);
    const first = r.trees.find((t) => t.stage < 3);
    const step = (seconds) => {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        sim.updateSim(state, DT);
        state.time += DT;
        state.events.length = 0;
      }
    };
    assert.equal(sim.commandGrow(state, state.net.originId, r.water.points), true, `seed ${seed}: water drag accepted`);
    step(r.water.length / B.growSpeed + 1);
    assert.ok(state.net.links.some((l) => l.kind === 'water'), `seed ${seed}: water linked`);
    assert.equal(sim.commandGrow(state, state.net.originId, first.points), true, `seed ${seed}: tree drag accepted`);
    step(first.length / B.growSpeed + 1);
    assert.ok(state.net.links.some((l) => l.kind === 'tree'), `seed ${seed}: the tree is linked`);
    linked++;
    leftMin = Math.min(leftMin, state.res.sugar);
    assert.ok(state.res.sugar >= 0.08 * purse, `seed ${seed}: ${state.res.sugar.toFixed(1)} sugar left after water and tree`);
  }
  console.log(`# opening played on ${linked} glades: sugar left after water and the first tree, at least ${leftMin.toFixed(1)} of a purse of 70`);
});

test('stumps stand in sight: x <= 1450 on every seed 1..300, inside the seen bands, with no fallback on record', () => {
  let farRight = 0;
  for (const seed of SEEDS) {
    const w = worldOf(seed);
    assert.deepEqual(stumpProblems(w), [], `seed ${seed}`);
    assert.ok(w.stumps.length >= 1, `seed ${seed}: a stump`);
    for (const s of w.stumps) {
      assert.ok(s.x <= 1450, `seed ${seed}: a stump at x ${s.x}`);
      assert.ok(STUMP.seen.some(([a, b]) => s.x >= a && s.x <= b), `seed ${seed}: a stump at x ${s.x} lies out of sight`);
    }
    assert.equal(w.fallback, undefined);
    // generator 1 put a stump beyond 1450 in about a third of the glades: the reason for the rule
    if (generateWorld(seed, 1).stumps.some((s) => s.x > 1450)) farRight++;
  }
  console.log(`# generator 1 had a stump beyond x 1450 in ${farRight} of 300 glades, generator 2 in 0`);
  assert.ok(farRight > 30);
});

test('a fair glade does not fall back, and when a build is not fair the world says why (the reason is on record)', () => {
  // a glade whose layout cannot give a first tree 160-250 u away: the checker names it
  const w = buildWorld(1, 0, 2);
  const broken = { ...w, origin: { ...w.origin, x: w.trees[0].x + 130, y: w.trees[0].baseY + 64 } };
  const fair = checkFairness(broken);
  assert.equal(fair.ok, false);
  assert.ok(fair.problems.some((p) => /root tip lies/.test(p)), fair.problems.join('; '));
  // and a stump out of sight is a problem for a v2 glade (while v1 never asked)
  const stumpy = { ...w, stumps: [{ id: 0, x: 1600, y: w.ground[100], r: 30 }] };
  assert.ok(checkFairness(stumpy).problems.length > 0);
});

test('the first move is a choice: a boulder on the way, a second tree about as near, water about as dear as the tree', () => {
  let boulder = 0;
  let fork = 0;
  let waterTree = 0;
  let any = 0;
  const sides = { left: 0, middle: 0, right: 0 };
  for (const seed of SEEDS) {
    const w = worldOf(seed);
    const r = opening(seed);
    const growing = r.trees.filter((t) => t.stage < 3);
    const first = growing[0];
    const tip = first.points.at(-1);
    const o = w.origin;
    // the straight drag to the first tip is shut by a rock
    let shut = false;
    const len = Math.hypot(tip.x - o.x, tip.y - o.y);
    for (let d = 6; d < len && !shut; d += 6) shut = Boolean(rockAt(w, o.x + ((tip.x - o.x) * d) / len, o.y + ((tip.y - o.y) * d) / len));
    const isFork = growing.length > 1 && growing[1].cost <= 1.5 * first.cost;
    const isWater = Math.abs(r.water.cost - first.cost) / first.cost <= 0.4;
    if (shut) boulder++;
    if (isFork) fork++;
    if (isWater) waterTree++;
    if (shut || isFork || isWater) any++;
    sides[o.x < 700 ? 'left' : o.x > 1220 ? 'right' : 'middle']++;
    if (w.rocks.some((rock) => rock.boulder)) assert.ok(w.rocks.filter((rock) => rock.boulder).length === 1, 'at most one boulder');
  }
  console.log(`# the first move of 300 glades: a rock shuts the straight way to the first tip in ${boulder}, a second tree within 1.5 x the price in ${fork}, water within 40 % of the tree's price in ${waterTree}; at least one of the three in ${any}; spore at the left ${sides.left}, middle ${sides.middle}, right ${sides.right}`);
  assert.ok(boulder >= 60, `${boulder} glades with a rock in the way`);
  assert.ok(fork >= 40, `${fork} glades with two trees to choose from`);
  assert.ok(any >= 270, `${any} glades with a choice`);
  assert.ok(sides.left >= 40 && sides.middle >= 40 && sides.right >= 40, JSON.stringify(sides));
});

test('the boulder keeps clear of the spore, the tip and every root, and the cheapest route still goes around it', () => {
  let n = 0;
  for (const seed of SEEDS) {
    const w = worldOf(seed);
    const b = w.rocks.find((rock) => rock.boulder);
    if (!b) continue;
    n++;
    assert.equal(b.id, w.rocks.indexOf(b), 'ids follow the array');
    assert.equal(rockAt(w, w.origin.x, w.origin.y), null);
    for (const t of w.trees) {
      for (const root of t.roots) for (const p of root.points) assert.equal(rockAt(w, p.x, p.y), null, `seed ${seed}: a root runs through the boulder`);
    }
    assert.ok(opening(seed).trees[0].cost < Infinity);
  }
  assert.ok(n >= 60, `${n} boulders`);
});

test('the guide still makes sense: spore, then water, then the root tip, on the new distances (every 6th glade)', () => {
  for (const seed of SEEDS.filter((s) => s % 6 === 0)) {
    const state = liveState(seed);
    const w = state.world;
    const r = opening(seed);
    // nothing grown yet: the spore
    const h0 = pickHint(createState(seed, 2), null, 'grow');
    assert.equal(h0.id, 'spore');
    assert.ok(Math.hypot(h0.ring.x - w.origin.x, h0.ring.y - w.origin.y) < 1e-6);
    // a hypha is under way: the nearest pocket of water, which is a reach of the spore, not far across the glade
    assert.equal(sim.commandGrow(state, state.net.originId, r.water.points), true);
    const h1 = pickHint(state, null, 'grow');
    assert.equal(h1.id, 'water', `seed ${seed}: ${h1.id}`);
    const pocket = w.water.find((p) => p.x === h1.ring.x && p.y === h1.ring.y);
    assert.ok(pocket, 'the ring is on a pocket');
    assert.ok(Math.hypot(pocket.x - w.origin.x, pocket.y - w.origin.y) <= 330, `seed ${seed}: the pocket is ${Math.hypot(pocket.x - w.origin.x, pocket.y - w.origin.y).toFixed(0)} u away`);
    // water linked: the ring goes to an active root tip that the spore reaches
    for (let i = 0; i < Math.round((r.water.length / B.growSpeed + 1) / DT); i++) {
      sim.updateSim(state, DT);
      state.time += DT;
      state.events.length = 0;
    }
    assert.ok(state.net.links.some((l) => l.kind === 'water'), `seed ${seed}: water linked`);
    const h2 = pickHint(state, null, 'grow');
    assert.equal(h2.id, 'tree', `seed ${seed}: ${h2.id}`);
    const tip = activeTips(w).find((p) => p.x === h2.ring.x && p.y === h2.ring.y);
    assert.ok(tip, 'the ring is on an active root tip');
    assert.ok(r.trees.some((t) => t.id === tip.tree.id), 'a tip the planner reaches too');
    // not sent across the glade: a tip about as near the network as the nearest one (the purse of 70 pays for one link of this length, not for two)
    const alive = state.net.nodes.filter((n) => n.alive);
    const netDist = (p) => Math.min(...alive.map((n) => Math.hypot(n.x - p.x, n.y - p.y)));
    const nearestNet = Math.min(...activeTips(w).map(netDist));
    assert.ok(netDist(tip) <= nearestNet + 110 && netDist(tip) <= 300, `seed ${seed}: the hint points at a tip ${netDist(tip).toFixed(0)} u from the network, the nearest is ${nearestNet.toFixed(0)}`);
    assert.ok(/кончик|корн/i.test(h2.title + h2.text));
  }
});

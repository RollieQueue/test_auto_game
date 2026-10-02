// «Начало — выбор», generator 3: after the first tree the second step is a decision. On about half of the glades («tight») the
// tree plus the starter water or the tree plus the first mineral fits the purse, but the tree plus both does not; the other
// half («roomy») fits all three. Neither choice dead-ends the start. Generators 1 and 2 are untouched (hashes and saves:
// save-gen-compat.test.mjs, world-gen2.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEN, GENERATIONS, buildWorld, generateWorld } from '../src/world/generate.js';
import { FAIR_V2, FAIR_V3, checkFairness, openingModeOf, openingProblems, openingRoutes } from '../src/world/fairness.js';
import { createState } from '../src/state.js';
import { B } from '../src/sim/balance.js';
import { committedSugar } from '../src/sim/growth.js';
import * as sim from '../src/sim/index.js';

const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);
const worlds = new Map();
const worldOf = (seed) => {
  if (!worlds.has(seed)) worlds.set(seed, generateWorld(seed, 3));
  return worlds.get(seed);
};
const DT = 1 / 60;

/** The live costs (sugar) of the first growing tree, the starter water and the first mineral, as the generator prices them. */
function costsOf(w) {
  const r = openingRoutes(w);
  const tree = r.trees.find((t) => t.stage < 3);
  return { r, tree, T: tree.cost * FAIR_V3.growCost, W: r.water.cost * FAIR_V3.growCost, M: r.nitrogen.cost * FAIR_V3.growCost };
}

test('generator 3 is the newest, and the margins are the game’s own', () => {
  assert.equal(GEN, 3);
  assert.deepEqual(GENERATIONS, [1, 2, 3]);
  assert.equal(FAIR_V3.growCost, B.hard.growCost);
  assert.ok(FAIR_V3.pairMax < FAIR_V3.purse, 'the tree and one more fit with a margin');
  assert.ok(FAIR_V3.tripleMin > FAIR_V3.purse, 'the tree and both do not fit in the purse');
  assert.ok(FAIR_V3.roomyMax < FAIR_V3.tripleMin, 'a roomy opening is never a tight one');
  // a new game is a v3 glade; the other generators still build theirs
  assert.equal(createState(7).world.gen, 3);
  assert.equal(generateWorld(7).gen, 3);
  assert.equal(generateWorld(7, 2).gen, 2);
  assert.equal(generateWorld(7, 2).opening, undefined, 'a v2 glade has no opening kind');
  assert.throws(() => generateWorld(7, 4), /unknown world generator/);
});

test('the opening kind depends on the seed alone: about half of the glades are tight', () => {
  let tight = 0;
  for (const seed of SEEDS) {
    const w = worldOf(seed);
    assert.equal(w.opening, openingModeOf(seed), `seed ${seed}`);
    assert.equal(openingModeOf(seed), openingModeOf(seed));
    if (w.opening === 'tight') tight++;
  }
  assert.ok(tight >= 55 && tight <= 95, `${tight} tight glades of ${SEEDS.length}`);
  // the kind is not a draw of the glade: every attempt of a seed has the same one
  for (const seed of [3, 8, 21]) for (let attempt = 0; attempt < 3; attempt++) assert.equal(buildWorld(seed, attempt, 3).opening, openingModeOf(seed));
});

test('generator 3 keeps what a seed is: biome, ground, soil horizons and name are the generator-2 ones', () => {
  for (const seed of [1, 7, 13, 23, 42, 99, 150]) {
    const a = generateWorld(seed, 2);
    const b = worldOf(seed);
    assert.equal(b.biome, a.biome, `seed ${seed}`);
    assert.equal(b.name, a.name);
    assert.equal(b.terrain, a.terrain);
    assert.deepEqual(b.ground, a.ground);
    assert.deepEqual(b.horizons, a.horizons);
  }
});

test('every glade of seeds 1..150 is fair by its own rules, none falls back', () => {
  for (const seed of SEEDS) {
    const w = worldOf(seed);
    const fair = checkFairness(w);
    assert.deepEqual(fair.problems, [], `seed ${seed}`);
    assert.equal(w.fallback, undefined, `seed ${seed}: fallback ${w.fallback}`);
  }
  // seeds far out, as a real new glade (a random seed up to 10^9) would have
  for (const seed of [31337, 99991, 123456789, 987654321, 555555555, 4242424]) {
    const w = generateWorld(seed, 3);
    assert.deepEqual(checkFairness(w).problems, [], `seed ${seed}`);
    assert.equal(w.fallback, undefined);
  }
});

test('a tight glade is a decision: the tree plus the water, or the tree plus the mineral, but not the tree plus both', () => {
  let tight = 0;
  for (const seed of SEEDS) {
    const w = worldOf(seed);
    if (w.opening !== 'tight') continue;
    tight++;
    const { T, W, M } = costsOf(w);
    const why = `seed ${seed}: tree ${T.toFixed(1)}, water ${W.toFixed(1)}, mineral ${M.toFixed(1)}`;
    assert.ok(T + W <= FAIR_V3.purse - 6, `${why}: the tree and the water fit with a margin`);
    assert.ok(T + M <= FAIR_V3.purse - 6, `${why}: the tree and the mineral fit with a margin`);
    assert.ok(T + W + M >= FAIR_V3.purse + 6, `${why}: the tree and both do not fit`);
    assert.ok(T <= FAIR_V3.treeShare * FAIR_V3.purse && W <= FAIR_V3.waterShare * FAIR_V3.purse, why);
    assert.ok(M >= 12 && W >= 12, `${why}: neither is a gift`);
  }
  assert.ok(tight >= 55, `${tight} tight glades`);
});

test('a roomy glade keeps a generous opening: the tree, the water and the mineral all fit (give or take a few seconds of pay)', () => {
  let roomy = 0;
  for (const seed of SEEDS) {
    const w = worldOf(seed);
    if (w.opening !== 'roomy') continue;
    roomy++;
    const { T, W, M } = costsOf(w);
    assert.ok(T + W + M <= FAIR_V3.roomyMax, `seed ${seed}: ${(T + W + M).toFixed(1)}`);
  }
  assert.ok(roomy >= 55, `${roomy} roomy glades`);
});

test('openingProblems: the two kinds, and the knife edges', () => {
  assert.deepEqual(openingProblems('tight', 30, 25, 25), []);
  assert.equal(openingProblems('tight', 30, 25, 25).length, 0);
  assert.equal(openingProblems('tight', 30, 25, 18).length, 1, 'everything fits: no choice');
  assert.equal(openingProblems('tight', 40, 25, 25).length, 2, 'neither pair fits');
  assert.equal(openingProblems('tight', 30, 40, 25).length, 1, 'the water is out of reach');
  assert.deepEqual(openingProblems('roomy', 28, 18, 20), []);
  assert.equal(openingProblems('roomy', 30, 25, 25).length, 1, 'a roomy glade that is tight');
  assert.ok(openingProblems('tight', Infinity, 20, 20).length > 0);
});

test('v2 glades are judged as before: a v3 rule never touches them', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const w = generateWorld(seed, 2);
    assert.equal(checkFairness(w).ok, true);
    const { T, W } = costsOf(w);
    assert.ok(T + W <= FAIR_V2.openShare * FAIR_V2.purse, `seed ${seed}`);
  }
});

/** A state of the real game (threats and seasons on, the sugar cap has cut the purse), played with the opening's own routes. */
function liveState(seed) {
  const state = createState(seed, 3);
  state.phase = 'playing';
  state.flags.threats = true;
  state.flags.seasons = true;
  sim.updateSim(state, DT);
  return state;
}

test('both second steps play on in the real sim: the other one waits for pay, nothing starves, the tree pays on either alone', () => {
  const tightSeeds = SEEDS.filter((s) => worldOf(s).opening === 'tight').slice(0, 10);
  assert.equal(tightSeeds.length, 10);
  for (const seed of tightSeeds) {
    for (const order of [['water', 'mineral'], ['mineral', 'water']]) {
      const state = liveState(seed);
      const { r, tree } = costsOf(state.world);
      const target = { water: r.water, mineral: r.nitrogen };
      let starved = 0;
      const run = (seconds) => {
        for (let i = 0; i < Math.round(seconds / DT); i++) {
          sim.updateSim(state, DT);
          state.time += DT;
          for (const ev of state.events) if (ev.type === 'severed' && ev.cause === 'starved') starved++;
          state.events.length = 0;
        }
      };
      const free = () => state.res.sugar - committedSugar(state.net);
      const price = (t) => t.cost * FAIR_V3.growCost;
      const why = `seed ${seed} (${order.join(', ')})`;
      assert.equal(sim.commandGrow(state, state.net.originId, tree.points), true, `${why}: the tree`);
      // right after the tree is paid: one more pick fits, both do not
      const [first, second] = order;
      const left = free();
      assert.ok(left >= price(target[first]) + 0.5, `${why}: the first pick is affordable after the tree (${left.toFixed(1)} left)`);
      assert.ok(left < price(target[first]) + price(target[second]), `${why}: both are not (${left.toFixed(1)} left, ${(price(target[first]) + price(target[second])).toFixed(1)} needed)`);
      run(6);
      assert.ok(Object.values(state.sim.contacts).some((c) => c.length > 0), `${why}: the tree is linked`);
      assert.equal(sim.commandGrow(state, state.net.originId, target[first].points), true, `${why}: the first pick`);
      run(6);
      // it becomes affordable by itself, within a minute
      let waited = 0;
      while (free() < price(target[second]) + 0.5 && waited < 90) {
        run(1);
        waited++;
      }
      assert.ok(waited < 90, `${why}: the other one is affordable after ${waited} s`);
      assert.equal(sim.commandGrow(state, state.net.originId, target[second].points), true, `${why}: the other one`);
      run(60);
      assert.equal(starved, 0, `${why}: no dieback`);
      assert.ok(state.sim.income > 0.3, `${why}: the income is ${state.sim.income.toFixed(2)}`);
      assert.ok(state.net.links.some((l) => l.kind === 'water') && state.net.links.some((l) => l.kind === 'mineral'), `${why}: both linked`);
    }
  }
});

test('either pick alone keeps the tree paying and the sugar from starving for a long wait (tight glades)', () => {
  for (const seed of SEEDS.filter((s) => worldOf(s).opening === 'tight').slice(0, 6)) {
    for (const pick of ['water', 'mineral']) {
      const state = liveState(seed);
      const { r, tree } = costsOf(state.world);
      const target = { water: r.water, mineral: r.nitrogen }[pick];
      let starved = 0;
      let low = Infinity;
      const run = (seconds) => {
        for (let i = 0; i < Math.round(seconds / DT); i++) {
          sim.updateSim(state, DT);
          state.time += DT;
          for (const ev of state.events) if (ev.type === 'severed' && ev.cause === 'starved') starved++;
          state.events.length = 0;
          low = Math.min(low, state.res.sugar);
        }
      };
      assert.equal(sim.commandGrow(state, state.net.originId, tree.points), true);
      run(6);
      assert.equal(sim.commandGrow(state, state.net.originId, target.points), true);
      // 100 s of waiting (the first night is gentle): the tree pays, the sugar recovers
      run(100);
      const why = `seed ${seed}, ${pick} only`;
      assert.equal(starved, 0, why);
      assert.ok(state.sim.income > 0.3, `${why}: income ${state.sim.income.toFixed(2)}`);
      assert.ok(state.res.sugar > 25, `${why}: ${state.res.sugar.toFixed(1)} sugar after 100 s (lowest ${low.toFixed(1)})`);
    }
  }
});

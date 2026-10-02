// Playtest fixes: partial growth on a short purse, a gentle first night, biomes that differ in mechanics (not only looks),
// the glade's own page-2 observation, and a warning with a lead before every bite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { addNode } from '../src/sim/network.js';
import { B, biomeFx, nightFloor, treeFx } from '../src/sim/balance.js';
import { NEUTRAL_FX, clockAt, effectsFor, restoreTime } from '../src/sim/clock.js';
import { createObjectives, pageObjectives } from '../src/sim/objectives.js';
import { biteSecondsFor, spawnWormAt, stepThreats } from '../src/sim/threats.js';
import { BIOME_IDS } from '../src/world/biomes.js';
import { decodeState, encodeState } from '../src/persist-codec.js';

const DT = 1 / 60;
const YEAR = B.seasonSeconds * 4;
const evs = (events, type) => events.filter((e) => e.type === type);
/** One seed per biome (the generator is deterministic): birch 2, oak 1, pine 11, mixed 7. */
const SEED = { birch: 2, oak: 1, pine: 11, mixed: 7 };

function fresh(seed = 7, flags = {}) {
  const s = createState(seed, 2);
  s.phase = 'playing';
  Object.assign(s.flags, flags);
  return s;
}

function run(state, seconds) {
  const seen = [];
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    sim.updateSim(state, DT);
    state.time += DT;
    seen.push(...state.events);
    state.events.length = 0;
  }
  return seen;
}

/** Nodes every 16 u from node `from` to (x, y); returns the ids. */
function branch(s, from, x, y) {
  const ids = [];
  let prev = from;
  for (;;) {
    const p = s.net.nodes[prev];
    const d = Math.hypot(x - p.x, y - p.y);
    const k = Math.min(1, 16 / d);
    prev = addNode(s, p.x + (x - p.x) * k, p.y + (y - p.y) * k, prev).id;
    ids.push(prev);
    if (k >= 1) return ids;
  }
}

// ---- 1. a long drag on a short purse grows as far as the sugar goes ----------------------------------------------------

test('a drag the purse cannot pay in full grows its affordable first part and says so (the playtest: seed 42, 31 sugar, nitrogen)', () => {
  const s = fresh(42, { threats: true }); // threats make growing 15 % dearer: the path costs 35
  const n = s.world.minerals[0];
  s.res.sugar = 31;
  const plan = sim.estimateGrowth(s, s.net.originId, [{ x: n.x, y: n.y }]);
  assert.equal(plan.affordable, false);
  assert.ok(plan.affordableLength >= B.minGrowLength && plan.affordableLength < plan.length, `${plan.affordableLength} of ${plan.length}`);

  assert.equal(sim.commandGrow(s, s.net.originId, [{ x: n.x, y: n.y }]), true, 'a part is better than nothing');
  const warn = evs(s.events, 'insufficient');
  assert.equal(warn.length, 1);
  assert.equal(warn[0].partial, true);
  assert.equal(warn[0].want, Math.round(plan.length));
  assert.ok(warn[0].got >= B.minGrowLength && warn[0].got < warn[0].want);
  assert.equal(warn[0].got, Math.round(plan.affordableLength), 'lengths in world units');
  assert.equal(evs(s.events, 'grow-start').length, 1);
  const h = s.net.growing[0];
  assert.ok(Math.abs(warn[0].x - h.path.at(-1).x) < 1e-9 && Math.abs(warn[0].y - h.path.at(-1).y) < 1e-9, 'x, y at the new tip');
  assert.ok(Math.abs(h.total - warn[0].got) <= 0.51, `hypha ${h.total} u, event says ${warn[0].got}`);

  s.events.length = 0;
  const seen = run(s, 8);
  assert.equal(s.net.growing.length, 0, 'it grew to the end of the part');
  assert.equal(evs(seen, 'insufficient').length, 0, 'no second complaint when the sugar lasted');
  assert.equal(evs(seen, 'grow-end').length, 1);
  assert.ok(s.res.sugar >= 0 && s.res.sugar < 5, `the purse was spent: ${s.res.sugar}`);
});

test('a plain refusal is kept when not even a minimal step is affordable: no partial flag, event at the start node', () => {
  const s = fresh(42);
  const n = s.world.minerals[0];
  s.res.sugar = 0.2;
  assert.equal(sim.commandGrow(s, s.net.originId, [{ x: n.x, y: n.y }]), false);
  const ev = evs(s.events, 'insufficient');
  assert.equal(ev.length, 1);
  assert.deepEqual(Object.keys(ev[0]).sort(), ['type', 'x', 'y']);
  assert.equal(s.net.growing.length, 0);
});

test('a fully affordable drag is untouched: no insufficient event, the whole path grows', () => {
  const s = fresh(42);
  const n = s.world.minerals[0];
  s.res.sugar = 100;
  assert.ok(sim.commandGrow(s, s.net.originId, [{ x: n.x, y: n.y }]));
  assert.equal(evs(s.events, 'insufficient').length, 0);
  const plan = sim.estimateGrowth(s, s.net.originId, [{ x: n.x, y: n.y }]);
  assert.equal(plan.affordableLength, plan.length);
});

// ---- 2. a gentle first night ---------------------------------------------------------------------------------------------

test('the first nights pay almost like days; the floor eases back to photoFloor and stays there', () => {
  const noon = clockAt(20);
  const night = clockAt(70);
  assert.ok(night.daylight < 0.02 && noon.daylight > 0.9);
  const first = effectsFor(night, { kind: 'clear', intensity: 0 }, 70).pay;
  const later = effectsFor(night, { kind: 'clear', intensity: 0 }, YEAR + 70).pay;
  assert.ok(first >= B.seasons.spring.pay * B.firstLight.floor - 1e-9, `first night pays ${first}`);
  assert.ok(Math.abs(later - B.seasons.spring.pay * B.photoFloor) < 1e-9);
  assert.ok(B.photoFloor >= 0.4);
  let prev = Infinity;
  for (let t = 0; t <= B.firstLight.until + B.firstLight.fade + 50; t += 10) {
    const f = nightFloor(t);
    assert.ok(f <= prev + 1e-12, 'the floor never rises again');
    assert.ok(f >= B.photoFloor - 1e-12 && f <= B.firstLight.floor + 1e-12);
    prev = f;
  }
  assert.equal(nightFloor(B.firstLight.until + B.firstLight.fade), B.photoFloor);
  assert.equal(nightFloor(), B.photoFloor);
  // a new game meets its first dusk at B.newGameDusk (80 s, not the old 45 s) and the night after it is still gentle ...
  const D = B.newGameDusk;
  assert.ok(D >= 75 && D <= 90);
  assert.ok(clockAt(D - 1, D).daylight > 0.5 && clockAt(D + 20, D).daylight < 0.05);
  const firstNight = effectsFor(clockAt(D + 25, D), { kind: 'clear', intensity: 0 }, D + 25).pay;
  assert.ok(firstNight >= B.seasons.spring.pay * B.firstLight.floor - 1e-9, `the first night pays ${firstNight}`);
  // ... and a save restores the same effects at any time, for a new game and for an old save without the flag
  for (const t of [0, 70, 239, 300, 361, YEAR + 70]) {
    for (const old of [false, true]) {
      const s = fresh(7, { seasons: true });
      if (old) delete s.flags.firstDusk;
      s.sim.clock = t;
      restoreTime(s);
      assert.deepEqual(s.sim.fx, effectsFor(clockAt(t, s.flags.firstDusk), s.weather, t));
    }
  }
});

test('without seasons nothing of this applies (neutral effects at every time)', () => {
  const s = fresh(7);
  run(s, 3);
  assert.equal(s.sim.fx, NEUTRAL_FX);
});

// ---- 3. biomes differ in mechanics ----------------------------------------------------------------------------------------

test('the biome table: birch is wet and lively, pine dry and mineral, oak slow and rich, mixed balanced', () => {
  assert.deepEqual(Object.keys(B.biomes).sort(), [...BIOME_IDS].sort());
  const b = B.biomes;
  assert.ok(b.birch.worm > b.mixed.worm && b.mixed.worm > b.pine.worm, 'worms: birch > mixed > pine');
  assert.ok(b.birch.wormSpeed > b.mixed.wormSpeed && b.mixed.wormSpeed > b.pine.wormSpeed);
  assert.ok(b.birch.water > b.mixed.water && b.mixed.water > b.pine.water, 'water per link');
  assert.ok(b.pine.minerals > b.oak.minerals && b.oak.minerals > b.mixed.minerals && b.mixed.minerals > b.birch.minerals, 'minerals per link');
  assert.deepEqual(b.mixed, { worm: 1, wormSpeed: 1, water: 1, minerals: 1 });
  for (const id of BIOME_IDS) assert.equal(biomeFx(fresh(SEED[id]).world), b[id], `${id}: the sim reads the glade's own row`);
  assert.equal(SEED.birch && fresh(SEED.birch).world.biome, 'birch');
  assert.equal(biomeFx({ biome: 'nowhere' }), b.mixed);
});

test('species of tree: an oak is slow but an ancient one pays a fortune; birch is quick and thirsty; pine sips', () => {
  const at = (species, stage) => treeFx({ species, stage });
  assert.ok(at('oak', 3).pay > 1.4 && at('oak', 3).pay > at('birch', 3).pay * 1.5 && at('oak', 3).pay > at('pine', 3).pay * 1.3, 'ancient oak');
  assert.ok(at('oak', 0).grow < at('pine', 0).grow && at('pine', 0).grow < at('birch', 0).grow, 'growth speed');
  assert.ok(at('birch', 1).drinkW > at('oak', 1).drinkW && at('oak', 1).drinkW > at('pine', 1).drinkW, 'thirst');
  assert.deepEqual(treeFx({ species: 'baobab', stage: 2 }), { grow: 1, drinkW: 1, drinkM: 1, pay: 1 }, 'unknown species: neutral');

  // in the economy: the same tree, the same pool, only the species differs
  const paid = (species, stage) => {
    const s = fresh(7);
    const tree = s.world.trees[1];
    tree.species = species;
    tree.stage = stage;
    tree.health = 1;
    addNode(s, tree.tips.find((p) => p.minStage <= stage).x, tree.tips.find((p) => p.minStage <= stage).y, 0);
    s.res.water = s.res.minerals = s.cap.pool;
    s.res.sugar = 50;
    run(s, 0.3);
    return { sugar: s.sim.intake[tree.id].sugar, grown: tree.growth, water: s.sim.intake[tree.id].water };
  };
  const oak = paid('oak', 3);
  const birch = paid('birch', 3);
  assert.ok(Math.abs(oak.sugar / birch.sugar - treeFx({ species: 'oak', stage: 3 }).pay / treeFx({ species: 'birch', stage: 3 }).pay) < 1e-6);
  const slow = paid('oak', 1);
  const quick = paid('birch', 1);
  assert.ok(Math.abs(slow.grown / quick.grown - B.species.oak.grow / B.species.birch.grow) < 1e-6, 'growth follows the species');
  assert.ok(quick.water > slow.water, 'birch drinks more');
});

test('worms are livelier in a birch glade than under pines: the spawn clock runs at the biome rate', () => {
  const rate = (id) => {
    const s = fresh(SEED[id], { threats: true });
    s.sim.clock = B.wormGrace + 10;
    s.stats.hyphaeLength = 1000;
    s.sim.threat.spawnT = 1000;
    stepThreats(s, 1);
    return 1000 - s.sim.threat.spawnT;
  };
  const base = 1 + 1000 / B.wormLenRef;
  for (const id of BIOME_IDS) assert.ok(Math.abs(rate(id) - base * B.biomes[id].worm) < 1e-9, id);
  assert.ok(rate('birch') > rate('mixed') && rate('mixed') > rate('pine'));
});

test('water and minerals are drawn at the glade rate per link', () => {
  const drawn = (id) => {
    const s = fresh(SEED[id]);
    const water = s.world.water[0];
    const mineral = s.world.minerals[0];
    s.res.water = s.res.minerals = 0;
    s.cap.pool = 1000;
    s.sim.waterLinks[water.id].push(1);
    s.sim.mineralLinks[mineral.id].push(1);
    const w0 = water.amount;
    const m0 = mineral.amount;
    run(s, 1);
    return { water: w0 - water.amount + water.regen, mineral: m0 - mineral.amount };
  };
  for (const id of BIOME_IDS) {
    const d = drawn(id);
    assert.ok(Math.abs(d.water - B.waterPerLink * B.biomes[id].water) < 0.05, `${id} water ${d.water}`);
    assert.ok(Math.abs(d.mineral - B.mineralPerLink * B.biomes[id].minerals) < 0.01, `${id} minerals ${d.mineral}`);
  }
});

// ---- 4. the glade's own observation on page 3 -----------------------------------------------------------------------------

const GLADE_ID = { birch: 'gladeBirch', oak: 'gladeOak', pine: 'gladePine', mixed: 'gladeMixed' };

function pageTwo(id, extra = {}) {
  const s = fresh(SEED[id], { threats: true, ...extra });
  s.chapter = 3;
  s.objectives = createObjectives(3, Boolean(s.flags.seasons), s.world.biome);
  return s;
}
const done = (s) => s.objectives.filter((o) => o.done).map((o) => o.id);

test('page 3 has exactly one glade observation per biome, the first of the page, with its own text; page 2 has none', () => {
  const texts = new Set();
  for (const id of BIOME_IDS) {
    const page = pageObjectives(3, true, id);
    const glade = page.filter((o) => o.id.startsWith('glade'));
    assert.equal(glade.length, 1, id);
    assert.equal(glade[0].id, GLADE_ID[id]);
    assert.equal(page[0].id, GLADE_ID[id]);
    assert.ok(glade[0].text.length > 15);
    texts.add(glade[0].text);
    assert.equal(page.length, pageObjectives(3, true).length + 1);
    assert.equal(pageObjectives(1, true, id).length, 5, 'page 1 is the same everywhere');
    assert.equal(pageObjectives(2, true, id).length, 4, 'page 2 is the same everywhere');
    assert.ok(!pageObjectives(2, true, id).some((o) => o.id.startsWith('glade')));
    assert.equal(fresh(SEED[id], { threats: true }).world.biome, id);
  }
  assert.equal(texts.size, 4);
  assert.equal(pageObjectives(3, false).length, 3, 'no biome, no glade line');
});

test('the page turns with the glade line in place (page 1 -> 2 -> 3 in the sim, and a save keeps it)', () => {
  for (const id of BIOME_IDS) {
    const s = fresh(SEED[id], { threats: true });
    for (const o of s.objectives.slice(0, 4)) o.done = true;
    s.res.spores = B.sporesGoal;
    run(s, 0.1);
    assert.equal(s.chapter, 2);
    for (const o of s.objectives) o.done = true;
    run(s, 0.1);
    assert.equal(s.chapter, 3);
    assert.ok(s.objectives.some((o) => o.id === GLADE_ID[id]), id);
    s.objectives.find((o) => o.id === GLADE_ID[id]).done = true;
    const back = decodeState(encodeState(s));
    assert.deepEqual(back.objectives.map((o) => [o.id, o.done]), s.objectives.map((o) => [o.id, o.done]));
  }
});

test('birch: keep the pool at birchWater for holdSeconds in a row; a dip starts the count again', () => {
  const s = pageTwo('birch');
  s.stats.hyphaeLength = 3000; // roomy pool
  const keep = (seconds, water) => {
    for (let i = 0; i < seconds; i++) {
      s.res.water = water;
      run(s, 1);
    }
  };
  keep(B.glade.holdSeconds - 6, B.glade.birchWater + 10);
  assert.ok(!done(s).includes('gladeBirch') && s.sim.holdT > 10);
  keep(1, B.glade.birchWater - 20);
  assert.equal(s.sim.holdT, 0, 'a dip resets the count');
  keep(B.glade.holdSeconds - 6, B.glade.birchWater + 10);
  assert.ok(!done(s).includes('gladeBirch'));
  keep(8, B.glade.birchWater + 10);
  assert.ok(done(s).includes('gladeBirch'));
});

test('pine: two different phosphorus crystals linked (nitrogen and one crystal are not enough)', () => {
  const s = pageTwo('pine');
  const phos = s.world.minerals.filter((m) => m.kind === 'phosphorus');
  assert.ok(phos.length >= B.glade.pinePhosphorus + 1, 'pine glades are rich in phosphorus');
  branch(s, 0, s.world.minerals[0].x, s.world.minerals[0].y); // nitrogen
  run(s, 0.1);
  assert.ok(!done(s).includes('gladePine'));
  branch(s, 0, phos[0].x, phos[0].y);
  run(s, 0.1);
  assert.ok(!done(s).includes('gladePine'), 'one crystal');
  branch(s, 0, phos[1].x, phos[1].y);
  run(s, 0.1);
  assert.ok(done(s).includes('gladePine'));
});

test('oak: every oak of the glade grown to maturity (stage 2)', () => {
  const s = pageTwo('oak');
  const oaks = s.world.trees.filter((t) => t.species === 'oak');
  assert.ok(oaks.length >= 1);
  for (const t of s.world.trees) t.stage = t.species === 'oak' ? 1 : 3;
  run(s, 0.1);
  assert.ok(!done(s).includes('gladeOak'));
  for (const t of oaks.slice(1)) t.stage = 2;
  run(s, 0.1);
  assert.ok(oaks.length === 1 || !done(s).includes('gladeOak'), 'one young oak is left');
  oaks[0].stage = 2;
  run(s, 0.1);
  assert.ok(done(s).includes('gladeOak'));
});

test('mixed: a grown mushroom at the roots of a tree of every species', () => {
  const s = pageTwo('mixed');
  const species = [...new Set(s.world.trees.map((t) => t.species))];
  assert.ok(species.length >= 2);
  const grown = (id, x, mature = true) => ({ id, nodeId: 0, x, baseY: 300, mature, growth: 1, variant: 0, age: 99, spores: 0, burst: 0, burstT: 0 });
  const first = s.world.trees.find((t) => t.species === species[0]);
  s.mushrooms.push(grown(1, first.x + 30));
  run(s, 0.1);
  assert.ok(!done(s).includes('gladeMixed'), 'one species is not enough');
  const rest = species.slice(1).map((sp) => s.world.trees.find((t) => t.species === sp));
  rest.forEach((t, i) => s.mushrooms.push(grown(10 + i, t.x - B.glade.mixedReach - 40, true)));
  run(s, 0.1);
  assert.ok(!done(s).includes('gladeMixed'), 'too far from the roots');
  s.mushrooms.length = 1;
  rest.forEach((t, i) => s.mushrooms.push(grown(10 + i, t.x + B.glade.mixedReach - 10, i === 0 ? false : true)));
  run(s, 0.1);
  assert.ok(rest.length > 1 ? done(s).includes('gladeMixed') === false : true, 'a young mushroom does not count');
  s.mushrooms.forEach((m) => (m.mature = true));
  run(s, 0.1);
  assert.ok(done(s).includes('gladeMixed'));
});

// ---- 5. a warning with a lead before every bite -------------------------------------------------------------------------

function arena(seed = 7, n = 14) {
  const s = fresh(seed, { threats: true });
  const o = s.net.nodes[s.net.originId];
  const ids = branch(s, s.net.originId, o.x + 16 * n, o.y);
  s.time = 100; // all edges are old enough to bite
  return { s, ids };
}

/** A worm that stays where it is (it does not wander off before the test looks). */
function stillWorm(s, x, y, extra = {}) {
  const w = spawnWormAt(s, x, y);
  s.events.length = 0;
  Object.assign(w, { base: 0.001, life: 1e6, grazer: true, ...extra });
  return w;
}

test('the bite never starts before the warning had its lead: worm-sense, then B.biteLead seconds, then the bite', () => {
  const { s, ids } = arena();
  const target = s.net.nodes[ids[7]];
  const w = stillWorm(s, target.x, target.y + 2); // right at a hypha it has not smelled yet
  const seen = [];
  let senseAt = null;
  let biteAt = null;
  for (let i = 0; i < 10 * 60 && biteAt === null; i++) {
    sim.updateSim(s, DT);
    s.time += DT;
    for (const e of s.events) {
      if (e.type === 'worm-sense' && senseAt === null) senseAt = s.time;
      if (e.type === 'bite') biteAt = s.time;
      seen.push(e);
    }
    s.events.length = 0;
  }
  assert.ok(senseAt !== null && biteAt !== null);
  assert.ok(biteAt - senseAt >= B.biteLead - 1e-6, `lead ${(biteAt - senseAt).toFixed(2)} s`);
  assert.ok(biteAt - senseAt < B.biteLead + 0.6, 'and the bite comes right after it');
  const sense = evs(seen, 'worm-sense')[0];
  assert.deepEqual(Object.keys(sense).sort(), ['id', 'tx', 'ty', 'type', 'x', 'y'], 'the event shape is unchanged');
  assert.equal(sense.id, w.id);
});

test('a worm that was warned long ago (or is in an older save without senseAge) bites at once', () => {
  const { s, ids } = arena();
  const t = s.net.nodes[ids[7]];
  stillWorm(s, t.x, t.y + 2, { sensed: true }); // no senseAge: a save from before the lead existed
  assert.equal(evs(run(s, 0.4), 'bite').length, 1);
});

test('the first page chews slowly (a ring takes 2.5 s: there is time), later pages faster', () => {
  const s = fresh(7, { threats: true });
  assert.equal(biteSecondsFor(s), B.biteSecondsByChapter[0]);
  assert.ok(B.biteSecondsByChapter[0] >= 4.5 && B.biteSecondsByChapter[0] > B.trapGrowSeconds + B.biteLead - 1, 'chapter 1: ring + reaction fit into the bite');
  s.chapter = 2;
  assert.equal(biteSecondsFor(s), B.biteSecondsByChapter[1]);
  s.chapter = 3;
  assert.equal(biteSecondsFor(s), B.biteSecondsByChapter[2]);
  assert.ok(B.biteSecondsByChapter[0] > B.biteSecondsByChapter[1] && B.biteSecondsByChapter[1] > B.biteSecondsByChapter[2]);
  assert.equal(B.biteSeconds, B.biteSecondsByChapter[2]);
  const { s: a, ids } = arena();
  const t = a.net.nodes[ids[7]];
  const w = stillWorm(a, t.x, t.y + 2, { sensed: true, senseAge: -1e6 });
  run(a, 0.5);
  assert.equal(w.bite.dur, B.biteSecondsByChapter[0]);
});

test('a ring laid at the warning is armed long before a first-page bite ends', () => {
  const { s, ids } = arena();
  const t = s.net.nodes[ids[7]];
  const w = stillWorm(s, t.x, t.y + 2);
  const sense = () => s.events.some((e) => e.type === 'worm-sense');
  let at = null;
  for (let i = 0; i < 4 * 60 && at === null; i++) {
    sim.updateSim(s, DT);
    s.time += DT;
    if (sense()) at = s.time;
    s.events.length = 0;
  }
  assert.ok(at !== null, 'the warning came');
  const node = sim.pickNode(s, t.x, t.y, 30);
  assert.ok(sim.commandTrap(s, node), 'a player who reacts to the warning can lay the ring');
  const seen = run(s, B.biteLead + B.biteSecondsByChapter[0]);
  assert.equal(evs(seen, 'severed').length, 0, 'the hypha was saved');
  assert.equal(evs(seen, 'worm-caught').length, 1);
  assert.ok(!s.fauna.includes(w));
});

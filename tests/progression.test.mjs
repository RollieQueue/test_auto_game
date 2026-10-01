// Progression: the notebook's pages (chapters) with threats on, the tighter economy, and bot playthroughs through
// chapters 1 and 2 on three seeds (times and the sugar curve are printed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { addNode } from '../src/sim/network.js';
import { B } from '../src/sim/balance.js';
import { restoreTime } from '../src/sim/clock.js';
import { createObjectives, pageObjectives, CHAPTER_TITLES } from '../src/sim/objectives.js';
import { encodeState, decodeState } from '../src/persist-codec.js';
import { DT, playBot } from './bot.mjs';

const evs = (events, type) => events.filter((e) => e.type === type);

function fresh(seed = 7, flags = { threats: true }) {
  const s = createState(seed);
  s.phase = 'playing';
  Object.assign(s.flags, flags);
  return s;
}

function step(s, seconds = DT) {
  const seen = [];
  for (let i = 0, n = Math.max(1, Math.round(seconds / DT)); i < n; i++) {
    sim.updateSim(s, DT);
    s.time += DT;
    seen.push(...s.events);
    s.events.length = 0;
  }
  return seen;
}

const ids = (s) => s.objectives.map((o) => o.id);

/** Nodes every 16 u from node `from` to (x, y). */
function branch(s, from, x, y) {
  let prev = from;
  for (;;) {
    const p = s.net.nodes[prev];
    const d = Math.hypot(x - p.x, y - p.y);
    const k = Math.min(1, 16 / d);
    prev = addNode(s, p.x + (x - p.x) * k, p.y + (y - p.y) * k, prev).id;
    if (k >= 1) return prev;
  }
}

/** A big network and mature trees: the sugar caps leave room for a reserve. */
function roomy(s) {
  branch(s, 0, s.net.nodes[0].x + 1800, s.net.nodes[0].y);
  for (const t of s.world.trees) {
    t.stage = 3;
    t.linked = true;
  }
}

/** Makes every objective of the first page true at once. */
function finishPageOne(s) {
  for (const o of s.objectives.slice(0, 4)) o.done = true;
  s.res.spores = B.sporesGoal;
}

test('without threats the notebook is as it was: five observations, one closing event, no chapters', () => {
  const s = fresh(7, {});
  assert.deepEqual(ids(s), ['water', 'tree', 'mushroom', 'treeGrow', 'spores']);
  assert.equal(s.chapter, 1);
  finishPageOne(s);
  const seen = step(s);
  assert.deepEqual(evs(seen, 'all-objectives'), [{ type: 'all-objectives', chapter: 1 }]);
  assert.equal(evs(seen, 'chapter').length, 0);
  assert.equal(s.chapter, 1);
  assert.equal(s.flags.allObjectivesDone, true);
  assert.ok(!('pagesDone' in s.flags) && !('bookDone' in s.flags));
  assert.ok(s.objectives.every((o) => o.done));
  assert.equal(evs(step(s, 3), 'all-objectives').length, 0);
});

test('with threats, completing a page opens the next one: all-objectives, then chapter, in the same step', () => {
  const s = fresh();
  assert.equal(s.chapter, 1);
  finishPageOne(s);
  const seen = step(s);
  const order = seen.filter((e) => ['objective', 'all-objectives', 'chapter'].includes(e.type)).map((e) => e.type);
  assert.deepEqual(order, ['objective', 'all-objectives', 'chapter']);
  assert.deepEqual(evs(seen, 'all-objectives')[0], { type: 'all-objectives', chapter: 1 });
  assert.deepEqual(evs(seen, 'chapter')[0], { type: 'chapter', chapter: 2 });
  assert.equal(s.chapter, 2);
  assert.deepEqual(ids(s), ['allies', 'ancient', 'gravel', 'finds', 'worms', 'spores500']);
  assert.ok(s.objectives.every((o) => !o.done && typeof o.text === 'string' && o.text.length > 5));
  assert.equal(s.flags.allObjectivesDone, true, 'it keeps meaning «page 1 is complete»');
  assert.equal(s.flags.pagesDone, 1);
  assert.ok(!s.flags.bookDone);
  assert.equal(evs(step(s, 2), 'all-objectives').length, 0, 'and not again');
});

test('chapter 2: every observation can be ticked, one by one, and the page turns to chapter 3', () => {
  const s = fresh();
  finishPageOne(s);
  step(s);
  const done = () => s.objectives.filter((o) => o.done).map((o) => o.id);
  step(s, 1);
  assert.deepEqual(done(), []);
  // allies: every tree of the glade has a root-tip contact
  for (const t of s.world.trees) {
    const tip = t.tips.find((p) => p.minStage <= t.stage);
    branch(s, 0, tip.x, tip.y);
  }
  step(s);
  assert.ok(s.world.trees.every((t) => s.sim.contacts[t.id].length > 0));
  assert.deepEqual(done(), ['allies']);
  // ancient
  s.world.trees[1].stage = 3;
  step(s);
  assert.deepEqual(done(), ['allies', 'ancient']);
  // gravel: a hypha reaches the deepest horizon
  const o = s.net.nodes[0];
  const depth = s.world.horizons[s.world.horizons.length - 1].depth;
  branch(s, 0, o.x, o.y + (depth - (o.y - s.world.ground[Math.floor(o.x / s.world.step)])) + 4);
  step(s);
  assert.ok(done().includes('gravel'), 'maxDepth reached the gravel');
  // finds: kinds count, not items
  s.finds = { 0: { kind: 'bone', at: 1 }, 1: { kind: 'bone', at: 2 }, 2: { kind: 'shell', at: 3 }, 3: { kind: 'twig', at: 4 } };
  step(s);
  assert.ok(!done().includes('finds'), 'three kinds are not four');
  s.finds[4] = { kind: 'seed', at: 5 };
  step(s);
  assert.ok(done().includes('finds'));
  // worms
  s.sim.threat.caught = B.chapter2Worms - 1;
  step(s);
  assert.ok(!done().includes('worms'));
  s.sim.threat.caught = B.chapter2Worms;
  step(s);
  assert.ok(done().includes('worms'));
  // spores
  s.res.spores = B.chapter2Spores - 1;
  const before = step(s);
  assert.equal(evs(before, 'all-objectives').length, 0);
  s.res.spores = B.chapter2Spores;
  const seen = step(s);
  assert.deepEqual(evs(seen, 'all-objectives')[0], { type: 'all-objectives', chapter: 2 });
  assert.deepEqual(evs(seen, 'chapter')[0], { type: 'chapter', chapter: 3 });
  assert.equal(s.chapter, 3);
  assert.equal(s.flags.pagesDone, 2);
  assert.deepEqual(ids(s), ['reserve', 'mushrooms8', 'spores1500'], 'without seasons the first observation is a reserve of sugar');
});

test('chapter 3 closes the book; with seasons it asks for a winter survived with sugar in hand', () => {
  const plain = fresh();
  plain.chapter = 3;
  plain.objectives = createObjectives(3, false);
  plain.res.sugar = B.reserveSugar + 1;
  plain.res.spores = B.chapter3Spores;
  const grown = () => ({ nodeId: 0, x: 0, baseY: 0, mature: true, growth: 1, variant: 0, age: 99, spores: 0, burst: 0, burstT: 0 });
  for (let i = 0; i < B.chapter3Mushrooms - 1; i++) plain.mushrooms.push({ ...grown(), id: i });
  roomy(plain);
  let seen = step(plain);
  assert.ok(plain.objectives.filter((o) => o.done).length >= 2);
  assert.ok(!plain.flags.bookDone, 'seven mushrooms are not eight');
  plain.mushrooms.push({ ...grown(), id: 50 });
  plain.res.sugar = B.reserveSugar + 1;
  seen = step(plain);
  assert.deepEqual(evs(seen, 'all-objectives')[0], { type: 'all-objectives', chapter: 3 });
  assert.equal(evs(seen, 'chapter').length, 0, 'there is no chapter 4');
  assert.equal(plain.flags.bookDone, true);
  assert.equal(plain.flags.pagesDone, 3);
  assert.equal(plain.chapter, 3);
  assert.equal(evs(step(plain, 5), 'all-objectives').length, 0);

  const s = fresh(7, { threats: true, seasons: true });
  s.chapter = 3;
  s.objectives = createObjectives(3, true);
  roomy(s);
  assert.equal(s.objectives[0].id, 'winter');
  s.sim.clock = 2 * B.seasonSeconds;
  restoreTime(s);
  s.res.sugar = B.winterSugar + 50;
  step(s);
  assert.equal(s.objectives[0].done, false, 'a good stock in autumn is not a winter survived');
  s.sim.clock = 3 * B.seasonSeconds + 0.95 * B.seasonSeconds;
  restoreTime(s);
  s.res.sugar = B.winterSugar - 30;
  step(s);
  assert.equal(s.objectives[0].done, false, 'the winter ended with too little');
  s.res.sugar = B.winterSugar + 40;
  step(s);
  assert.equal(s.objectives[0].done, true);
  assert.deepEqual(pageObjectives(3, true).map((o) => o.id), ['winter', 'mushrooms8', 'spores1500']);
  assert.ok(CHAPTER_TITLES[1] && CHAPTER_TITLES[2] && CHAPTER_TITLES[3]);
});

test('the page and its ticks survive save and load; a save from before chapters loads as chapter 1', () => {
  const s = fresh();
  finishPageOne(s);
  step(s);
  s.sim.threat.caught = B.chapter2Worms;
  s.res.spores = 12;
  step(s);
  assert.deepEqual(s.objectives.filter((o) => o.done).map((o) => o.id), ['worms']);
  const payload = JSON.parse(JSON.stringify(encodeState(s)));
  const copy = decodeState(payload);
  assert.equal(copy.chapter, 2);
  assert.deepEqual(copy.objectives, s.objectives);
  assert.deepEqual(copy.flags, s.flags);
  const old = JSON.parse(JSON.stringify(encodeState(fresh(7, {}))));
  delete old.chapter;
  delete old.fauna;
  delete old.traps;
  const loaded = decodeState(old);
  assert.equal(loaded.chapter, 1);
  assert.deepEqual(loaded.fauna, []);
  assert.deepEqual(loaded.traps, []);
  assert.deepEqual(loaded.objectives.map((o) => o.id), ['water', 'tree', 'mushroom', 'treeGrow', 'spores']);
});

test('pressure: with threats on, mushrooms and hyphae cost more and a big network costs more per u; without, nothing changed', () => {
  const calm = fresh(7, {});
  const hard = fresh(7, { threats: true });
  assert.ok(sim.estimateGrowth(hard, 1, [{ x: hard.net.nodes[1].x - 100, y: hard.net.nodes[1].y }]).cost > sim.estimateGrowth(calm, 1, [{ x: calm.net.nodes[1].x - 100, y: calm.net.nodes[1].y }]).cost);
  const x = calm.net.nodes[0].x + 100;
  const spot = (s) => addNode(s, x, s.world.ground[Math.floor(x / s.world.step)] + 20, 0).id;
  calm.res.sugar = hard.res.sugar = 30;
  assert.equal(sim.canFruit(calm, spot(calm)), true, 'an ordinary mushroom costs 24');
  assert.equal(sim.canFruit(hard, spot(hard)), false, 'under pressure 30 sugar is not enough');
  assert.ok(B.hard.sugarCap < 1 && B.hard.upkeep >= 1);
  // a long network pays more upkeep per u
  const small = fresh(7, { threats: true });
  const big = fresh(7, { threats: true });
  const o = big.net.nodes[0];
  branch(big, 0, o.x + 1800, o.y);
  const upkeepPerLength = (s) => {
    s.res.sugar = 20;
    sim.updateSim(s, 1);
    return (s.sim.income - (s.res.sugar - 20)) / s.stats.hyphaeLength;
  };
  const ratio = upkeepPerLength(big) / upkeepPerLength(small);
  assert.ok(ratio > 1.2, `upkeep per u grows with the size of the network (x${ratio.toFixed(2)})`);
});

// ---- bot playthroughs ----------------------------------------------------------------------------------------------

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

for (const seed of [1, 7, 42]) {
  test(`bot with threats, seed ${seed}: chapter 1 in 8-15 minutes, chapter 2 within 30, sugar stays a constraint without ever sticking at zero`, () => {
    const { state, completedAt, stats } = playBot(seed, { maxSeconds: 1800, threats: true, untilChapter: 2, curve: true });
    const t1 = stats.chapterDone[1];
    const t2 = stats.chapterDone[2];
    const sugar = stats.curve.map((c) => c.sugar);
    const early = stats.curve.filter((c) => c.t <= 900).map((c) => c.sugar);
    const T = state.sim.threat;
    console.log(
      `# seed ${seed}: chapter 1 at ${(t1 / 60).toFixed(1)} min, chapter 2 at ${t2 === undefined ? 'never' : (t2 / 60).toFixed(1) + ' min'}; ` +
        `worms ${T.nextWorm}, bites ${T.bites}, cut ${T.severed} (${Math.round(T.lostLength)} u lost), caught ${T.caught}, rings ${stats.traps}; ` +
        `sugar max ${Math.max(...sugar)} median ${median(sugar)} (first 15 min: max ${Math.max(...early)} median ${median(early)}); max zero streak ${stats.maxZeroStreak.toFixed(1)} s`,
    );
    console.log(`#   sugar every 30 s: ${sugar.join(' ')}`);
    assert.equal(completedAt, t1, 'the first closing event is page 1');
    assert.ok(t1 >= 480 && t1 <= 900, `chapter 1 took ${t1} s`);
    assert.notEqual(t2, undefined, 'chapter 2 completed');
    assert.ok(t2 <= 1800, `chapter 2 took ${t2} s`);
    assert.equal(state.chapter, 3);
    assert.ok(Math.max(...early) < 200, 'sugar never piles up in the first 15 minutes');
    assert.ok(median(early) < 70, `typical stock in the first 15 minutes: ${median(early)}`);
    assert.ok(stats.maxZeroStreak < 15, `sugar stuck at zero for ${stats.maxZeroStreak} s`);
    assert.ok(T.nextWorm >= 3 && T.caught >= B.chapter2Worms, 'worms came and the rings caught them');
  });
}

test('a player who never lays a ring still gets through page 1 in 15 minutes: worms cost branches and mushrooms, not the game', () => {
  const { state, stats } = playBot(7, { maxSeconds: 900, threats: true, guard: false });
  const T = state.sim.threat;
  console.log(`# seed 7 without rings: chapter 1 at ${(stats.chapterDone[1] / 60).toFixed(1)} min; worms ${T.nextWorm}, cut ${T.severed} (${Math.round(T.lostLength)} u lost), mushrooms wilted ${stats.events['mushroom-wilted'] ?? 0}`);
  assert.ok(stats.chapterDone[1] <= 900, `${stats.chapterDone[1]}`);
  assert.ok(T.severed >= 2, 'worms did hurt');
  assert.equal(state.traps.length, 0);
  assert.ok(stats.maxZeroStreak < 15);
});

test('the default game (seasons and threats together): page 1 in 8-15 minutes, winter does not stick sugar at zero', () => {
  const { state, stats } = playBot(42, { maxSeconds: 900, threats: true, seasons: true, untilChapter: 1 });
  const t1 = stats.chapterDone[1];
  console.log(`# seed 42 with seasons: chapter 1 at ${(t1 / 60).toFixed(1)} min; worms ${state.sim.threat.nextWorm}, cut ${state.sim.threat.severed}, caught ${state.sim.threat.caught}`);
  assert.ok(t1 >= 480 && t1 <= 900, `${t1}`);
  assert.ok(stats.maxZeroStreak < 15);
  assert.equal(state.chapter, 2);
});

test('bot without threats still finishes page 1 in 4-15 minutes (the game as it was)', () => {
  const { completedAt, state, stats } = playBot(7, { maxSeconds: 900 });
  assert.ok(completedAt >= 240 && completedAt <= 900, `${completedAt}`);
  assert.equal(state.chapter, 1);
  assert.deepEqual(state.fauna, []);
  assert.equal(stats.rejected, 0);
});

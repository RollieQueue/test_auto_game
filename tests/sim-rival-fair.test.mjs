// The fairness of the honey-fungus rival (src/sim/rival.js): the first grips go where the player can answer, the wake time (and
// the sleep until spring), jittered grips, the grace after a barrier, the page-2 observation, the thick-cord event, and the
// fields that older saves lack. Expected numbers come from B (src/sim/balance.js), never from literals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { addNode } from '../src/sim/network.js';
import { B } from '../src/sim/balance.js';
import { clockAt } from '../src/sim/clock.js';
import { barrierCost, commandBarrier, createRival, spawnTipAt, stepRival } from '../src/sim/rival.js';
import { createObjectives, pageObjectives, stepObjectives } from '../src/sim/objectives.js';
import { STUMP, stumpProblems } from '../src/world/fairness.js';
import { costAt, groundYAt } from '../src/world/query.js';
import { decodeState, encodeState } from '../src/persist-codec.js';

const DT = 1 / 60;
const evs = (events, type) => events.filter((e) => e.type === type);

function fresh(seed = 7, flag = true) {
  const s = createState(seed, 2);
  s.phase = 'playing';
  s.flags.rival = flag;
  return s;
}

/** Runs the rival alone; returns the events (each copied with `at`, the state.time of the step). */
function stepR(state, seconds, dt = DT, each = null) {
  const seen = [];
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) {
    stepRival(state, dt);
    state.time += dt;
    for (const e of state.events) seen.push({ ...e, at: state.time });
    state.events.length = 0;
    if (each) each(state);
  }
  return seen;
}

/** An awake rival past its grip gate that makes no tips of its own. */
function quiet(state) {
  state.flags.rival ||= true;
  const r = (state.rival ??= createRival(state));
  Object.assign(r, { awake: true, age: 1000, spawnT: 1e9 });
  return r;
}

const nodeAt = (s, x, y) => addNode(s, x, y, -1).id;

/** A level stretch of open soil (260 u either way, 16 u up and down): { x, y }. */
function corridor(world) {
  const free = (x, y) => Number.isFinite(costAt(world, x, y)) && y - groundYAt(world, x) >= B.rivalDepthMin + 10;
  for (let xm = 300; xm <= world.width - 300; xm += 40) {
    for (let y = groundYAt(world, xm) + 30; y < world.height - 60; y += 20) {
      let ok = true;
      for (let x = xm - 260; x <= xm + 260 && ok; x += 10) for (let dy = -16; dy <= 16; dy += 8) if (!free(x, y + dy)) ok = false;
      if (ok) return { x: xm, y };
    }
  }
  throw new Error('no corridor');
}

/** A tree whose only root tip is at (x, y). */
function goalAt(s, x, y, treeId = 0) {
  const tree = s.world.trees[treeId];
  tree.tips = [{ x, y, minStage: 0 }];
  return tree;
}

/** A tip standing next to the root tip of tree 0 (`tree.linked` as given), the gate open: does it grip? */
function atRoot(linked) {
  const s = fresh(7);
  const { x, y } = corridor(s.world);
  const tree = goalAt(s, x + 100, y);
  tree.linked = linked;
  const r = quiet(s);
  const tip = spawnTipAt(s, x + 90, y, 0, tree.id);
  tip.retarget = Infinity;
  return { s, r, tree, tip, x, y };
}

// ---- fair first grips -----------------------------------------------------------------------------------------------------

test('a grip goes only where the player can answer: a linked tree, or a player node within B.rivalReach of the grip point', () => {
  {
    const { s, r, tip } = atRoot(false);
    const seen = stepR(s, 120);
    assert.equal(r.grip.length, 0, 'no player node anywhere near: no grip');
    assert.equal(evs(seen, 'rival-grip').length, 0);
    assert.ok(r.tips.includes(tip) && tip.speed === 0, 'the tip waits at the root');
    assert.equal(s.world.trees[0].infection ?? 0, 0);
  }
  {
    const { s, r, x, y } = atRoot(false);
    nodeAt(s, x + 100 + B.rivalReach + 40, y); // a node, but too far from the grip point
    stepR(s, 30);
    assert.equal(r.grip.length, 0, 'a node beyond B.rivalReach does not count');
  }
  {
    const { s, r, x, y } = atRoot(false);
    nodeAt(s, x + 100 + B.rivalReach - 20, y);
    const seen = stepR(s, 5);
    assert.equal(r.grip.length, 1, 'a node within reach: the rival grips');
    assert.equal(evs(seen, 'rival-grip').length, 1);
  }
  {
    const { s, r } = atRoot(true);
    stepR(s, 5);
    assert.equal(r.grip.length, 1, 'a linked tree is always answerable');
  }
});

test('a tip prefers the tree the player can answer for', () => {
  const s = fresh(7);
  const { x, y } = corridor(s.world);
  const [a, b] = s.world.trees;
  for (const t of s.world.trees) {
    t.stage = 1;
    t.species = 'birch';
    t.linked = false;
  }
  s.world.trees.slice(2).forEach((t) => (t.lost = true));
  goalAt(s, x - 60, y, a.id); // near the tip, and nobody of the player's is anywhere near it
  goalAt(s, x + 220, y, b.id); // farther, but a player node stands by it
  nodeAt(s, x + 250, y);
  const r = quiet(s);
  const tip = spawnTipAt(s, x, y, 0, null);
  stepR(s, 1);
  assert.equal(r.tips.length, 1);
  assert.equal(tip.target?.id, b.id, 'the tree the player can answer for wins over the nearer one');
  // with a node by the nearer tree as well, the nearer one is wanted again
  nodeAt(s, x - 90, y);
  tip.retarget = 0;
  tip.target = null;
  stepR(s, 1);
  assert.equal(tip.target?.id, a.id);
});

// ---- the wake ---------------------------------------------------------------------------------------------------------------

test('it wakes B.rivalWakeBy s into the game even in chapter 1, and B.rivalWakeDelay s into chapter 2 if that is earlier', () => {
  const s = fresh(7);
  s.time = B.rivalWakeBy - 2;
  assert.equal(stepR(s, 1).length, 0);
  assert.equal(s.rival.awake, false);
  const seen = stepR(s, 2);
  assert.equal(s.rival.awake, true);
  assert.equal(evs(seen, 'rival-wake').length, 1);
  assert.equal(s.chapter, 1);

  const t = fresh(13);
  t.time = 100;
  t.chapter = 2;
  const early = stepR(t, B.rivalWakeDelay + 1);
  assert.equal(evs(early, 'rival-wake').length, 1, 'chapter 2 + B.rivalWakeDelay is earlier than B.rivalWakeBy here');
  assert.ok(t.time < B.rivalWakeBy);
});

test('late in autumn and in winter (seasons on) it sleeps until spring, and says so once', () => {
  const at = (season, frac = 0) => {
    const s = fresh(7);
    s.flags.seasons = true;
    s.time = B.rivalWakeBy + 5;
    Object.assign(s.clock, clockAt(B.seasonSeconds * ['spring', 'summer', 'autumn', 'winter'].indexOf(season) + frac * B.seasonSeconds));
    return s;
  };
  // early autumn: no reason to wait
  {
    const s = at('autumn', B.rivalLateAutumn - 0.1);
    assert.equal(evs(stepR(s, 1), 'rival-wake').length, 1);
    assert.equal(s.rival.dormant, false);
  }
  for (const [season, frac] of [['autumn', B.rivalLateAutumn + 0.05], ['winter', 0.3]]) {
    const s = at(season, frac);
    assert.equal(s.clock.season, season);
    const seen = stepR(s, 30);
    assert.equal(s.rival.awake, false, `asleep in ${season}`);
    assert.equal(s.rival.dormant, true);
    const dormant = evs(seen, 'rival-dormant');
    assert.equal(dormant.length, 1, 'told once');
    const first = s.world.stumps[0];
    assert.deepEqual([dormant[0].x, dormant[0].y], [first.x, first.y], 'at the first stump');
    assert.equal(evs(seen, 'rival-wake').length, 0);
    assert.equal(s.rival.tips.length, 0);
    // spring comes: it wakes, once
    Object.assign(s.clock, clockAt(4 * B.seasonSeconds + 10));
    assert.equal(s.clock.season, 'spring');
    const spring = stepR(s, 1);
    assert.equal(s.rival.awake, true);
    assert.equal(s.rival.dormant, false);
    assert.equal(evs(spring, 'rival-wake').length, 1);
    assert.equal(evs(spring, 'rival-dormant').length, 0);
  }
  // without seasons there is no dormancy; the flag 'now' ignores it too
  const plain = fresh(7);
  plain.time = B.rivalWakeBy + 5;
  Object.assign(plain.clock, clockAt(3 * B.seasonSeconds + 10));
  assert.equal(evs(stepR(plain, 1), 'rival-wake').length, 1);
  const now = at('winter', 0.5);
  now.flags.rival = 'now';
  assert.equal(evs(stepR(now, 1), 'rival-wake').length, 1);
});

// ---- jitter ---------------------------------------------------------------------------------------------------------------

test('every tip carries its own seeded delay (0..B.rivalGripJitter) on the grip gate: the first grips do not come in step', () => {
  const gates = (seed) => {
    const s = fresh(seed, 'now');
    stepR(s, 1);
    return s.rival.tips.map((t) => t.gripAt);
  };
  const all = [];
  for (const seed of [7, 13, 23, 42]) {
    const a = gates(seed);
    assert.deepEqual(gates(seed), a, `seed ${seed}: deterministic`);
    assert.ok(a.length >= 2);
    for (const g of a) assert.ok(g >= B.rivalGripAfter && g <= B.rivalGripAfter + B.rivalGripJitter, `gate ${g}`);
    all.push(...a);
  }
  assert.ok(new Set(all.map((g) => g.toFixed(3))).size > all.length / 2, 'the gates differ');
});

// ---- the first quarter of the rot is slow -----------------------------------------------------------------------------------

test('infection runs at B.rivalEarlyRate until 25 %, then at the full rate', () => {
  const s = fresh(7);
  const r = quiet(s);
  const t = s.world.trees[0];
  const root = r.nodes.push({ id: r.nodes.length, x: t.x, y: t.baseY + 50, alive: true, born: 0 }) - 1;
  r.nodes.push({ id: r.nodes.length, x: t.x, y: t.baseY + 70, alive: true, born: 0 });
  r.edges.push({ id: 0, a: root, b: root + 1, w: 1.5, alive: true, born: 0, wither: 0 });
  r.grip.push({ treeId: 0, node: root + 1, x: t.x, y: t.baseY + 70, since: 0, tip: 0 });
  stepR(s, 10);
  const slow = t.infection / 10;
  assert.ok(Math.abs(slow - B.rivalEarlyRate / B.rivalInfectSeconds) < 1e-9);
  t.infection = 0.4;
  stepR(s, 10);
  assert.ok(Math.abs((t.infection - 0.4) / 10 - 1 / B.rivalInfectSeconds) < 1e-9);
});

// ---- the grace after a barrier --------------------------------------------------------------------------------------------

/** A rhizomorph line through the corridor with a grip of tree 0 in its middle, a player node under it and sugar for barriers. */
function gripScene() {
  const s = fresh(7);
  const r = quiet(s);
  const { x, y } = corridor(s.world);
  const ids = [];
  const add = (px, py, parent) => {
    const id = r.nodes.length;
    r.nodes.push({ id, x: px, y: py, alive: true, born: s.time });
    if (parent !== null) r.edges.push({ id: r.edges.length, a: parent, b: id, w: 1.5, alive: true, born: s.time, wither: 0 });
    ids.push(id);
    return id;
  };
  let prev = add(x - 200, y, null);
  for (let px = x - 180; px <= x + 40; px += 20) prev = add(px, y, prev);
  const tree = goalAt(s, x + 40, y);
  r.grip.push({ treeId: tree.id, node: prev, x: x + 40, y, since: s.time, tip: 0 });
  r.ver++;
  const barrierNode = nodeAt(s, x, y);
  s.res.sugar = 200;
  return { s, r, tree, x, y, barrierNode };
}

test('a barrier that frees a tree: the rhizomorphs retreat when it ends, and leave the tree alone for B.rivalGrace s', () => {
  const { s, r, tree, barrierNode } = gripScene();
  assert.equal(commandBarrier(s, barrierNode), true);
  const seen = stepR(s, B.barrierWither + 2);
  assert.equal(evs(seen, 'tree-freed').length, 1);
  assert.equal(r.stats.freedTrees, 1);
  assert.deepEqual(r.freedIds, [tree.id]);
  const until = r.grace[tree.id];
  assert.ok(until > s.time + B.rivalGrace, 'the grace runs from the end of the barrier, not from the release');
  assert.equal(r.retreats.length, 1);
  assert.equal(evs(seen, 'rival-retreat').length, 0, 'not while the barrier stands');

  const rest = stepR(s, B.barrierDur);
  const gone = evs(rest, 'barrier-gone');
  const back = evs(rest, 'rival-retreat');
  assert.equal(gone.length, 1);
  assert.equal(back.length, 1, 'one rival-retreat');
  assert.equal(back[0].treeId, tree.id);
  assert.ok(Number.isFinite(back[0].x) && Number.isFinite(back[0].y));
  assert.ok(Math.abs(back[0].at - gone[0].at) < 0.1, 'when the barrier ends');
  assert.equal(r.retreats.length, 0);
  assert.ok(Math.abs(until - (gone[0].at + B.rivalGrace)) < 0.2, 'grace = barrier end + B.rivalGrace');
});

test('during the grace no tip goes for the freed tree (it holds still), after it the tree is a target again', () => {
  const s = fresh(7);
  const { x, y } = corridor(s.world);
  s.world.trees.slice(1).forEach((t) => (t.lost = true));
  const tree = goalAt(s, x + 200, y);
  nodeAt(s, x + 220, y); // answerable
  const r = quiet(s);
  r.grace[tree.id] = s.time + 20;
  const tip = spawnTipAt(s, x, y, 0, tree.id);
  stepR(s, 10);
  assert.equal(tip.target, null, 'it gave up the tree');
  assert.equal(tip.speed, 0, 'and holds still');
  assert.ok(Math.abs(tip.x - x) < 1);
  assert.ok(r.tips.includes(tip), 'it does not die while the grace lasts');
  stepR(s, 12);
  assert.equal(tip.target?.id, tree.id, 'the grace is over: the tree is wanted again');
  stepR(s, 5);
  assert.ok(tip.x > x + 5, 'and it goes');
});

// ---- the thick cord ---------------------------------------------------------------------------------------------------------

test('a tip turned away from a thick cord says rival-turn, at most once per B.rivalTurnGap; a thin hypha says nothing', () => {
  const wall = (w) => {
    const s = fresh(7);
    const { x, y } = corridor(s.world);
    const top = groundYAt(s.world, x);
    const bottom = s.world.height - 2;
    const n = Math.ceil((bottom - top) / 16);
    const first = s.net.edges.length;
    let prev = nodeAt(s, x, top);
    for (let i = 1; i <= n; i++) prev = addNode(s, x, top + ((bottom - top) * i) / n, prev).id;
    for (let i = first; i < s.net.edges.length; i++) s.net.edges[i].w = w;
    const goal = goalAt(s, x + 160, y);
    const r = quiet(s);
    const tip = spawnTipAt(s, x - 70, y, 0, goal.id);
    tip.retarget = Infinity;
    nodeAt(s, x + 190, y);
    return { s, r, tip };
  };
  const thick = wall(B.rivalBlockW + 0.4);
  const seen = stepR(thick.s, 70);
  const turns = evs(seen, 'rival-turn');
  assert.ok(turns.length >= 1, 'a thick cord ahead: the tip turns away and says so');
  assert.ok(turns.length <= Math.ceil(70 / B.rivalTurnGap) + 1);
  for (let i = 1; i < turns.length; i++) assert.ok(turns[i].at - turns[i - 1].at >= B.rivalTurnGap - 0.1, 'spaced by B.rivalTurnGap');
  for (const e of turns) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
  const thin = wall(1);
  assert.equal(evs(stepR(thin.s, 70), 'rival-turn').length, 0, 'a thin hypha is no wall');
});

// ---- the page-2 observation, the price, the save --------------------------------------------------------------------------

test('rivalCut: freeing B.rivalCutFreed trees or cutting B.rivalCutGoal segments completes it, one barrier does not', () => {
  const s = fresh(7);
  s.chapter = 2;
  s.objectives = createObjectives(2, false, s.world.biome, true);
  const r = quiet(s);
  const done = () => s.objectives.find((o) => o.id === 'rivalCut').done;
  const text = pageObjectives(2, false, null, true).find((o) => o.id === 'rivalCut').text;
  assert.ok(text.includes(String(B.rivalCutFreed)) && text.includes(String(B.rivalCutGoal)), text);
  r.stats.freedTrees = B.rivalCutFreed - 1;
  r.stats.cut = B.rivalCutGoal - 1;
  stepObjectives(s);
  assert.equal(done(), false);
  r.stats.freedTrees = B.rivalCutFreed;
  stepObjectives(s);
  assert.equal(done(), true);
  s.objectives = createObjectives(2, false, s.world.biome, true);
  r.stats.freedTrees = 0;
  r.stats.cut = B.rivalCutGoal;
  stepObjectives(s);
  assert.equal(done(), true);
});

test('trees freed by barriers are counted once each: one tree is not enough, two different trees complete the observation', () => {
  assert.equal(B.rivalCutFreed, 2);
  const { s, r, tree, barrierNode } = gripScene();
  s.chapter = 2;
  s.objectives = createObjectives(2, false, s.world.biome, true);
  const done = () => s.objectives.find((o) => o.id === 'rivalCut').done;
  commandBarrier(s, barrierNode);
  stepR(s, B.barrierWither + 2);
  assert.equal(r.stats.freedTrees, 1);
  stepObjectives(s);
  assert.equal(done(), false, 'one tree freed is not enough');
  // the same tree gripped and freed again is still one tree
  const node = r.nodes.length;
  r.nodes.push({ id: node, x: tree.tips[0].x, y: tree.tips[0].y, alive: true, born: s.time });
  r.edges.push({ id: r.edges.length, a: 0, b: node, w: 1.5, alive: false, born: s.time, wither: 1 }); // its edge is already dead
  r.grip.push({ treeId: tree.id, node, x: tree.tips[0].x, y: tree.tips[0].y, since: s.time, tip: 0 });
  stepR(s, 1);
  assert.equal(r.grip.length, 0, 'the dead edge let go');
  assert.equal(r.stats.freedTrees, 1, 'still one tree');
  assert.deepEqual(r.freedIds, [tree.id]);
  // a second tree
  const other = s.world.trees.find((t) => t.id !== tree.id);
  const node2 = r.nodes.length;
  r.nodes.push({ id: node2, x: other.x, y: other.baseY + 60, alive: true, born: s.time });
  r.edges.push({ id: r.edges.length, a: 0, b: node2, w: 1.5, alive: false, born: s.time, wither: 1 });
  r.grip.push({ treeId: other.id, node: node2, x: other.x, y: other.baseY + 60, since: s.time, tip: 0 });
  stepR(s, 1);
  assert.equal(r.stats.freedTrees, 2);
  stepObjectives(s);
  assert.equal(done(), true, 'two different trees');
});

test('the barrier price steps by B.barrierCostStep for every barrier standing (and the step is 10)', () => {
  assert.equal(B.barrierCostStep, 10);
  const s = fresh(7);
  quiet(s);
  const { x, y } = corridor(s.world);
  const ids = [0, 1, 2].map((i) => nodeAt(s, x - 200 + 200 * i, y + 40 * (i % 2)));
  s.res.sugar = 1000;
  ids.forEach((id, i) => {
    assert.equal(barrierCost(s), B.barrierCost + B.barrierCostStep * i);
    assert.equal(commandBarrier(s, id), true);
  });
});

test('rival fields added later round-trip through a save, and a save without them plays on with their defaults', () => {
  const s = fresh(7, 'now');
  s.flags.seasons = true;
  stepR(s, 5);
  s.rival.grace = { 0: s.time + 30 };
  s.rival.retreats = [{ treeId: 0, at: s.time + 10, x: 100, y: 200 }];
  s.rival.freedIds = [0];
  s.rival.stats.freedTrees = 1;
  s.rival.dormant = false;
  const payload = JSON.parse(JSON.stringify(encodeState(s)));
  const back = decodeState(payload);
  assert.deepEqual(back.rival.grace, s.rival.grace);
  assert.deepEqual(back.rival.retreats, s.rival.retreats);
  assert.deepEqual(back.rival.freedIds, [0]);
  assert.equal(back.rival.stats.freedTrees, 1);
  assert.ok(back.rival.tips.every((t) => Number.isFinite(t.gripAt)));

  // an older save: none of those fields (and tips without gripAt)
  const old = JSON.parse(JSON.stringify(encodeState(s)));
  for (const k of ['grace', 'retreats', 'freedIds', 'dormant', 'turnT']) delete old.rival[k];
  delete old.rival.stats.freedTrees;
  for (const t of old.rival.tips) delete t.gripAt;
  const loaded = decodeState(old);
  loaded.phase = 'playing';
  loaded.flags.rival = 'now';
  assert.doesNotThrow(() => stepR(loaded, 30));
  assert.deepEqual(loaded.rival.grace, {});
  assert.deepEqual(loaded.rival.freedIds, []);
  assert.equal(loaded.rival.stats.freedTrees, 0);
  assert.equal(loaded.rival.dormant, false);
  for (const t of loaded.rival.tips) assert.ok(Number.isFinite(t.best) && Number.isFinite(t.dir));
});

// ---- stumps -----------------------------------------------------------------------------------------------------------------

test('stumps stand where no card hides them when there is room: x <= 1450 on the right, a spot in the right band otherwise', () => {
  assert.ok(STUMP.seen.every(([a, b]) => b <= 1450 || a < 1450), 'the strict bands end at x 1450 on the right');
  assert.ok(Math.max(...STUMP.seen.map(([, b]) => b)) <= 1450);
  let seenCount = 0;
  let fallback = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const world = createState(seed).world;
    assert.deepEqual(stumpProblems(world), [], `seed ${seed}`);
    assert.ok(world.stumps.length >= 1, `seed ${seed}: at least one stump`);
    const inSeen = (st) => STUMP.seen.some(([a, b]) => st.x >= a && st.x <= b);
    if (world.stumps.every(inSeen)) seenCount++;
    else {
      fallback++;
      // a glade with no spot in the open parts puts its stump in the right band (the objectives card folds when the rival wakes)
      assert.ok(world.stumps.every((st) => inSeen(st) || st.x >= STUMP.bands[1][0]), `seed ${seed}: the fallback stump is on the right`);
    }
  }
  assert.ok(seenCount > fallback, `most glades (${seenCount} of ${seenCount + fallback}) keep the stump in view`);
});

test('the whole game, played by the sim alone, wakes the rival by B.rivalWakeBy even in chapter 1', () => {
  const s = fresh(7);
  let woke = null;
  for (let i = 0; i < (B.rivalWakeBy + 5) * 10 && woke === null; i++) {
    sim.updateSim(s, 0.1);
    s.time += 0.1;
    if (evs(s.events, 'rival-wake').length) woke = s.time;
    s.events.length = 0;
  }
  assert.ok(woke !== null && woke <= B.rivalWakeBy + 0.2 && woke >= B.rivalWakeBy - 0.2, `woke at ${woke}`);
  assert.equal(s.chapter, 1);
});

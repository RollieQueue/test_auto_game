// The honey-fungus rival (state.flags.rival, src/sim/rival.js): waking, rhizomorph growth and thick cords that block it, grips, rot and
// lost trees, the mantle, the barrier tool and its denials, autumn clusters, caps, saving and loading, stump placement, the notebook
// observations and the pointer input of the barrier tool. Expected numbers come from B (src/sim/balance.js), never from literals.
// (World stumps and the hand-built save round trip are in rival-world-persist.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { addNode, severBranch } from '../src/sim/network.js';
import { B } from '../src/sim/balance.js';
import { clockAt } from '../src/sim/clock.js';
import { barrierCost, barrierDenial, canBarrier, commandBarrier, createRival, liveSegments, pickBarrierNode, spawnTipAt, stepRival } from '../src/sim/rival.js';
import { createObjectives, pageObjectives, stepObjectives } from '../src/sim/objectives.js';
import { generateWorld } from '../src/world/generate.js';
import { stumpProblems } from '../src/world/fairness.js';
import { costAt, groundYAt } from '../src/world/query.js';
import { decodeState, encodeState } from '../src/persist-codec.js';
import { attachInput } from '../src/input/pointer.js';
import { playBot } from './bot.mjs';

const DT = 1 / 60;
const evs = (events, type) => events.filter((e) => e.type === type);
const RIVAL_EVENTS = new Set(['rival-wake', 'rival-tip', 'rival-grip', 'tree-infected', 'tree-freed', 'tree-lost', 'rival-cut', 'rival-fruit', 'barrier-placed', 'barrier-denied', 'barrier-gone']);
const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);
const clone = (v) => JSON.parse(JSON.stringify(v));
/** Seconds one grip (rate 1, bare tree, season 1) needs to rot a tree from 0 to `to`: the first quarter runs at B.rivalEarlyRate. */
const rotSeconds = (to) => ((Math.min(to, 0.25) / B.rivalEarlyRate + Math.max(0, to - 0.25)) * B.rivalInfectSeconds);

/** A new game in play with the rival flag (true: wakes with chapter 2; 'now': at once). */
function fresh(seed = 7, flag = true) {
  const s = createState(seed);
  s.phase = 'playing';
  s.flags.rival = flag;
  return s;
}

/** Runs the whole game (sim.updateSim); returns the events, each copied with `at` (game time of the step). */
function run(state, seconds, dt = DT) {
  const seen = [];
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) {
    sim.updateSim(state, dt);
    state.time += dt;
    for (const e of state.events) seen.push({ ...e, at: state.time });
    state.events.length = 0;
  }
  return seen;
}

/** Runs the rival alone (the clock, the economy and the trees' mantle stay as they are); `each(state)` is called after every step. */
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

/** An awake rival past its grip gate that makes no tips of its own: only what a test puts in it happens. */
function quiet(state) {
  state.flags.rival ||= true;
  const r = (state.rival ??= createRival(state));
  Object.assign(r, { awake: true, age: 1000, spawnT: 1e9 });
  return r;
}

/** Hand-built rhizomorph data (plain arrays, as the sim keeps them). */
function rhizoRoot(state, r, x, y) {
  r.nodes.push({ id: r.nodes.length, x, y, alive: true, born: state.time });
  r.ver++;
  return r.nodes.length - 1;
}
function rhizoSeg(state, r, a, x, y, w = 1.5) {
  const b = rhizoRoot(state, r, x, y);
  r.edges.push({ id: r.edges.length, a, b, w, alive: true, born: state.time, wither: 0 });
  return b;
}
/** A straight rhizomorph from (x0, y) to (x1, y), a node every `gap` u; returns the node ids (the first is the root). */
function rhizoLine(state, r, x0, x1, y, gap = 20) {
  const ids = [rhizoRoot(state, r, x0, y)];
  for (let x = x0 + gap; x <= x1 + 1e-9; x += gap) ids.push(rhizoSeg(state, r, ids[ids.length - 1], x, y));
  return ids;
}
/** A grip of the rival on `treeId` at the end of a one-segment rhizomorph; nothing is steering it. */
function gripOn(state, treeId, w = 1.5) {
  const r = quiet(state);
  const t = state.world.trees[treeId];
  const root = rhizoRoot(state, r, t.x, t.baseY + 50);
  const node = rhizoSeg(state, r, root, t.x, t.baseY + 70, w);
  const g = { treeId, node, x: t.x, y: t.baseY + 70, since: state.time, tip: 0 };
  r.grip.push(g);
  return g;
}

/** A level stretch of open soil, 260 u either way and 16 u up and down: { x, y }. The first match of a fixed scan (deterministic). */
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

/** A player node of its own at (x, y) (parent -1). */
const nodeAt = (s, x, y) => addNode(s, x, y, -1).id;

/** A tree whose only root tip is at (x, y): the goal of a hand-placed rhizomorph tip. */
function goalAt(s, x, y, treeId = 0) {
  const tree = s.world.trees[treeId];
  tree.tips = [{ x, y, minStage: 0 }];
  return tree;
}

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a.x + dx * t - px, a.y + dy * t - py);
}

/** The straight hand-built scene most barrier tests use: a rhizomorph line through a corridor, a player node in its middle. */
function lineScene(seed = 7) {
  const s = fresh(seed);
  const r = quiet(s);
  const { x, y } = corridor(s.world);
  const ids = rhizoLine(s, r, x - 240, x + 240, y, 20);
  const barrierNode = nodeAt(s, x, y);
  s.res.sugar = 100;
  // classify the edges by their distance to the barrier's centre; boundary cases (within 2 u of r) belong to neither
  const R = B.barrierRadius;
  const inside = [];
  const left = [];
  const right = [];
  for (const e of r.edges) {
    const d = distToSegment(x, y, r.nodes[e.a], r.nodes[e.b]);
    if (d <= R - 2) inside.push(e);
    else if (d >= R + 2) (r.nodes[e.b].x < x ? left : right).push(e);
  }
  return { s, r, ids, x, y, barrierNode, inside, left, right };
}

// ---- 1. waking ----------------------------------------------------------------------------------------------------------

test('without the flag the rival does not exist: no state, no events, no barrier', () => {
  for (const flag of [undefined, false]) {
    const s = createState(7);
    s.phase = 'playing';
    s.flags.rival = flag;
    s.chapter = 2;
    const seen = run(s, B.rivalWakeDelay + 20, 0.1);
    assert.equal(s.rival, null);
    assert.deepEqual(seen.filter((e) => RIVAL_EVENTS.has(e.type)), []);
    assert.equal(barrierDenial(s, s.net.originId), 'off');
    assert.equal(canBarrier(s, s.net.originId), false);
    assert.equal(commandBarrier(s, s.net.originId), false);
    assert.deepEqual(s.events, [], 'no denial event either');
    assert.deepEqual(s.barriers, []);
  }
});

test('with the flag the rival sleeps through chapter 1, and wakes B.rivalWakeDelay s into chapter 2 with one rival-wake', () => {
  const s = fresh(7);
  const seen = run(s, 200, 0.1);
  assert.ok(s.rival && !s.rival.awake, 'it exists, asleep');
  assert.equal(s.rival.wait, 0, 'chapter 1 does not count');
  assert.deepEqual(seen.filter((e) => RIVAL_EVENTS.has(e.type)), []);
  assert.equal(barrierDenial(s, s.net.originId), 'off', 'no barrier while it sleeps');
  assert.equal(commandBarrier(s, s.net.originId), false);
  assert.deepEqual(s.events, []);

  s.chapter = 2;
  const dt = 0.25; // exactly representable: the wait is a plain multiple
  let steps = 0;
  const wake = [];
  while (!s.rival.awake && steps < 100000) {
    stepRival(s, dt);
    s.time += dt;
    steps++;
    wake.push(...evs(s.events, 'rival-wake'));
    if (!s.rival.awake) assert.equal(s.events.length, 0);
  }
  assert.ok(s.rival.awake);
  assert.ok(steps * dt >= B.rivalWakeDelay && (steps - 1) * dt < B.rivalWakeDelay, `woke after ${steps * dt} s`);
  assert.equal(wake.length, 1, 'one rival-wake');
  const stump = s.world.stumps.find((st) => st.id === wake[0].stumpId);
  assert.ok(stump, 'at a stump of the world');
  assert.deepEqual([wake[0].x, wake[0].y], [stump.x, stump.y]);
  assert.equal(s.rival.tips.length, Math.min(B.rivalStartTips, B.rivalMaxTips));
  for (const tip of s.rival.tips) assert.ok(s.world.stumps.some((st) => Math.hypot(tip.x - st.x, tip.y - st.y - 14) <= B.rivalSpeed[1] * dt + 1e-6), 'tips start at the stump');
  s.events.length = 0;
  assert.equal(evs(stepR(s, 60), 'rival-wake').length, 0, 'and it wakes only once');
});

test("the flag 'now' wakes the rival at the first step, in any chapter", () => {
  const s = fresh(7, 'now');
  assert.equal(s.chapter, 1);
  stepRival(s, DT);
  assert.equal(s.rival.awake, true);
  assert.equal(evs(s.events, 'rival-wake').length, 1);
  assert.equal(s.rival.tips.length, Math.min(B.rivalStartTips, B.rivalMaxTips));
  assert.equal(barrierDenial(s, s.net.originId), null, 'a barrier is allowed from now on');
});

// ---- 2. determinism ---------------------------------------------------------------------------------------------------

function scripted(seed) {
  const s = fresh(seed, 'now');
  s.flags.seasons = true;
  const o = s.net.nodes[s.net.originId];
  const tree = s.world.trees.reduce((a, b) => (Math.abs(b.x - o.x) < Math.abs(a.x - o.x) ? b : a));
  const tip = tree.tips.find((p) => p.minStage <= tree.stage);
  s.res.sugar = 100;
  sim.commandGrow(s, s.net.originId, [{ x: tip.x, y: tip.y }]);
  run(s, 380);
  s.res.sugar = Math.max(s.res.sugar, 100);
  sim.commandBarrier(s, s.net.originId);
  run(s, 20);
  return s;
}
const fingerprint = (s) => JSON.stringify({ rival: s.rival, barriers: s.barriers, trees: s.world.trees.map((t) => [t.infection, t.mantle, t.lost]) });

test('determinism: the same seed and commands replay the rival, the barriers and the trees exactly; another seed differs', () => {
  const a = scripted(7);
  const b = scripted(7);
  assert.ok(a.rival.nodes.length > 10, 'something grew');
  assert.ok(a.barriers.length === 1, 'the barrier command was accepted');
  assert.equal(fingerprint(a), fingerprint(b));
  assert.equal(JSON.stringify(a.res), JSON.stringify(b.res));
  assert.notEqual(fingerprint(scripted(8)), fingerprint(a));
});

// ---- 3. thick cords block ---------------------------------------------------------------------------------------------

/** A vertical wall of player nodes across the corridor from the surface to the floor of the world, edges of width `w`. */
function wallScene(w, seed = 7) {
  const s = fresh(seed);
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
  tip.retarget = Infinity; // keep the goal behind the wall
  return { s, r, x, y, tip };
}

function throughWall(w) {
  const { s, r, x } = wallScene(w);
  let maxX = -Infinity;
  const seen = stepR(s, B.rivalNoProgress + 100, DT, () => {
    for (const t of r.tips) maxX = Math.max(maxX, t.x);
  });
  return { s, r, x, maxX, seen };
}

test('a thin hypha does not stop a rhizomorph: it crosses and grips the tree behind', () => {
  assert.ok(B.rivalBlockW > 1, 'the test needs a plain hypha (w 1) to be thinner than a blocking cord');
  for (const w of [1, B.rivalBlockW - 0.01]) {
    const { s, r, x, maxX, seen } = throughWall(w);
    assert.ok(maxX > x + 40, `w ${w}: the tip crossed the wall (max x ${maxX.toFixed(0)}, wall ${x.toFixed(0)})`);
    assert.equal(r.grip.length, 1);
    assert.equal(evs(seen, 'rival-grip').length, 1);
    assert.ok(s.world.trees[0].infection > 0);
  }
});

test('a thick cord (width >= B.rivalBlockW) stops it: the tip never crosses, runs along the wall and gives up', () => {
  for (const w of [B.rivalBlockW, B.rivalBlockW + 0.8]) {
    const { r, x, maxX, seen } = throughWall(w);
    assert.ok(maxX > x - 45, `w ${w}: the tip did come up to the wall (max x ${maxX.toFixed(0)})`);
    assert.ok(maxX < x, `w ${w}: it never crossed (max x ${maxX.toFixed(0)}, wall ${x.toFixed(0)})`);
    assert.equal(r.grip.length, 0);
    assert.equal(evs(seen, 'rival-grip').length, 0);
    assert.equal(r.tips.length, 0, 'a tip that cannot get nearer its tree gives up');
    for (const n of r.nodes) assert.ok(n.x < x, 'no rhizomorph node beyond the wall');
  }
});

// ---- 4. grip, infection, loss -----------------------------------------------------------------------------------------

test('a tip at its root tip waits for the grip gate, grips, and the tree rots through 25 / 50 / 75 % to a lost tree', () => {
  const s = fresh(7);
  const { x, y } = corridor(s.world);
  const tree = goalAt(s, x + 100, y);
  const r = quiet(s);
  r.age = 0;
  const tip = spawnTipAt(s, x + 40, y, 0, tree.id);
  tip.retarget = Infinity;
  assert.ok(tip.gripAt >= B.rivalGripAfter && tip.gripAt <= B.rivalGripAfter + B.rivalGripJitter, 'the gate carries a seeded jitter');
  nodeAt(s, x + 160, y); // the grip needs a player node near it (see the fairness tests)
  const early = stepR(s, B.rivalGripAfter - 1);
  assert.equal(r.grip.length, 0, 'no grip before the gate');
  assert.equal(evs(early, 'rival-grip').length, 0);
  assert.ok(r.tips.includes(tip), 'the tip waits');
  assert.ok(Math.hypot(tip.x - (x + 100), tip.y - y) <= B.rivalGripRadius, 'at the root tip');
  assert.equal(tip.speed, 0);
  assert.equal(tree.infection, 0);

  const seen = stepR(s, B.rivalGripJitter + 3 + rotSeconds(1) + 5);
  const grips = evs(seen, 'rival-grip');
  assert.equal(grips.length, 1);
  assert.deepEqual([grips[0].treeId, grips[0].x, grips[0].y], [tree.id, x + 100, y]);
  near(grips[0].at, tip.gripAt, 1, 'at the tip own gate (state.time and rival.age run together here)');
  assert.equal(r.tips.includes(tip), false, 'the tip became a grip');
  assert.equal(r.stats.grips, 1);

  const levels = evs(seen, 'tree-infected');
  assert.deepEqual(levels.map((e) => e.level), [0.25, 0.5, 0.75], 'each level once, in order');
  assert.ok(levels.every((e) => e.treeId === tree.id));
  levels.forEach((e) => near(e.at - grips[0].at, rotSeconds(e.level), 1, `level ${e.level}`));
  const lost = evs(seen, 'tree-lost');
  assert.equal(lost.length, 1);
  assert.deepEqual([lost[0].treeId, lost[0].x, lost[0].y], [tree.id, tree.x, tree.baseY]);
  near(lost[0].at - grips[0].at, rotSeconds(1), 1, 'time to lose a tree');
  assert.ok(lost[0].at - grips[0].at >= 3.5 * 60 - 1, 'a bare tree with one grip in season 1 takes at least 3.5 minutes to lose');
  const order = seen.filter((e) => ['rival-grip', 'tree-infected', 'tree-lost'].includes(e.type)).map((e) => e.type);
  assert.deepEqual(order, ['rival-grip', 'tree-infected', 'tree-infected', 'tree-infected', 'tree-lost']);
  assert.equal(tree.lost, true);
  assert.equal(tree.infection, 1);
  assert.equal(r.grip.filter((g) => g.treeId === tree.id).length, 0, 'its grips are dropped');
  assert.equal(evs(seen, 'tree-freed').length, 0, 'a lost tree is not «freed»');
  assert.equal(r.stats.lost, 1);
  assert.equal(r.stats.freed, 0);

  // the base of the lost tree is a new source of rhizomorphs (they start there once the next tip is due)
  let fromTree = null;
  for (let i = 0; i < 60 && !fromTree; i++) {
    r.spawnT = 0;
    r.emptyT = B.rivalRegrow; // the old twig may have withered by now: a rival cut back completely sends its tips at once
    r.tips.length = 0;
    stepR(s, DT);
    fromTree = r.src.find((rec) => rec.key === `t${tree.id}`) ?? null;
  }
  assert.ok(fromTree, 'a tip started from the lost tree');
  const root = r.nodes[fromTree.node];
  near(root.x, tree.x, 1e-6);
  near(root.y, tree.baseY + 14, 1e-6);
  assert.ok(r.tips.some((t) => t.node === root.id), 'a tip sits on the tree base node');
});

test('the last living tree is never rotted beyond B.rivalLastTree', () => {
  const s = fresh(7);
  s.world.trees[0].lost = true;
  s.world.trees[0].infection = 1;
  gripOn(s, 1);
  const seen = stepR(s, 1.5 * rotSeconds(1));
  const t = s.world.trees[1];
  near(t.infection, B.rivalLastTree, 1e-9, 'infection');
  assert.equal(t.lost, false);
  assert.equal(evs(seen, 'tree-lost').length, 0);
  assert.deepEqual(evs(seen, 'tree-infected').map((e) => e.level), [0.25, 0.5, 0.75]);
});

test('a tree nobody holds heals, faster under a mantle; a second grip adds only B.rivalExtraGrip of the rate', () => {
  const drop = (mantle) => {
    const s = fresh(7);
    quiet(s);
    const t = s.world.trees[0];
    t.infection = 0.8;
    t.mantle = mantle;
    stepR(s, 60, DT, (st) => (st.rival.tips.length = 0)); // nobody may reach it (a stump can stand close to the tree)
    return 0.8 - t.infection;
  };
  near(drop(0), 60 / B.rivalHealSeconds, 1e-9, 'heal');
  near(drop(1), (60 * (1 + B.rivalHealMantle)) / B.rivalHealSeconds, 1e-9, 'heal with a mantle');
  const rot = (grips) => {
    const s = fresh(7);
    for (let i = 0; i < grips; i++) gripOn(s, 0);
    stepR(s, 20);
    return s.world.trees[0].infection;
  };
  near(rot(1), (20 * B.rivalEarlyRate) / B.rivalInfectSeconds, 1e-9, 'one grip');
  near(rot(2), (20 * B.rivalEarlyRate * (1 + B.rivalExtraGrip)) / B.rivalInfectSeconds, 1e-9, 'two grips');
});

test('seasons: winter freezes the tips (no speed, no new nodes), summer slows them, and the rot follows B.rivalInfectSeason', () => {
  const seasonAt = (s, name) => {
    s.flags.seasons = true;
    Object.assign(s.clock, clockAt(B.seasonSeconds * ['spring', 'summer', 'autumn', 'winter'].indexOf(name) + 10));
    assert.equal(s.clock.season, name);
  };
  const tipRun = (name) => {
    const s = fresh(7);
    const { x, y } = corridor(s.world);
    const tree = goalAt(s, x + 250, y);
    const r = quiet(s);
    const tip = spawnTipAt(s, x - 200, y, 0, tree.id);
    tip.retarget = Infinity;
    seasonAt(s, name);
    const nodes = r.nodes.length;
    const x0 = tip.x;
    stepR(s, 10);
    return { r, tip, moved: tip.x - x0, grown: r.nodes.length - nodes };
  };
  const winter = tipRun('winter');
  assert.equal(winter.tip.speed, 0);
  assert.deepEqual([winter.moved, winter.grown], [0, 0]);
  for (const name of ['spring', 'summer', 'autumn']) {
    const run1 = tipRun(name);
    near(run1.tip.speed, run1.tip.base * B.rivalSeason[name], 1e-9, `speed in ${name}`);
    assert.ok(run1.moved > 0 && run1.grown >= 1, `it grows in ${name}`);
  }
  for (const name of ['spring', 'summer', 'autumn', 'winter']) {
    const s = fresh(7);
    gripOn(s, 0);
    seasonAt(s, name);
    stepR(s, 20);
    near(s.world.trees[0].infection, (20 * B.rivalInfectSeason[name] * B.rivalEarlyRate) / B.rivalInfectSeconds, 1e-9, `rot in ${name}`);
  }
});

// ---- 5. the mantle ----------------------------------------------------------------------------------------------------

test('the mantle slows the rot by (1 - B.mantleProtect * mantle)', () => {
  const rotted = (mantle) => {
    const s = fresh(7);
    gripOn(s, 0);
    s.world.trees[0].mantle = mantle; // the economy is not running: it stays
    stepR(s, 30);
    return s.world.trees[0].infection;
  };
  const bare = rotted(0);
  near(bare, (30 * B.rivalEarlyRate) / B.rivalInfectSeconds, 1e-9, 'bare tree');
  near(rotted(1), bare * (1 - B.mantleProtect), 1e-9, 'full mantle');
  near(rotted(0.5), bare * (1 - B.mantleProtect * 0.5), 1e-9, 'half a mantle');
});

/** A game where the pine (tree 1) is linked to the spore by a thin hypha and fed from a full pool. */
function linkedPine(flag) {
  const s = fresh(7, flag);
  const tree = s.world.trees[1];
  const tip = tree.tips.find((p) => p.minStage <= tree.stage);
  let prev = s.net.originId;
  for (;;) {
    const p = s.net.nodes[prev];
    const d = Math.hypot(tip.x - p.x, tip.y - p.y);
    const k = Math.min(1, 16 / d);
    prev = addNode(s, p.x + (tip.x - p.x) * k, p.y + (tip.y - p.y) * k, prev).id;
    if (k >= 1) break;
  }
  assert.ok(s.sim.contacts[tree.id].length > 0, 'linked');
  return { s, tree };
}
const feed = (s, seconds) => {
  for (let i = 0; i < seconds; i++) {
    s.res.water = s.cap.pool;
    s.res.minerals = s.cap.pool;
    run(s, 1);
  }
};

test('economy: a fed, linked tree builds a mantle towards (fed share x contact factor) and loses it once unlinked', () => {
  const { s, tree } = linkedPine(true);
  assert.equal(tree.mantle, 0);
  const marks = [];
  for (let i = 0; i < 6; i++) {
    feed(s, 10);
    marks.push(tree.mantle);
  }
  assert.ok(marks.every((m, i) => m > (marks[i - 1] ?? 0)), `it rises: ${marks}`);
  feed(s, 5 * B.mantleTau);
  const contacts = s.sim.contacts[tree.id].length;
  const want = B.treeContactFactor[Math.min(contacts, B.treeContactFactor.length) - 1];
  near(tree.mantle, want, 0.03, 'mantle after a long time');
  assert.equal(s.world.trees[0].mantle, 0, 'an unlinked tree has none');

  // cut the hypha: the tree is unlinked and the mantle fades with time constant B.mantleTau
  const edge = s.sim.parentEdge[s.sim.contacts[tree.id][0]];
  let e = edge;
  while (s.net.edges[e].a !== s.net.originId && s.net.nodes[s.net.edges[e].a].parent >= 0) e = s.sim.parentEdge[s.net.edges[e].a];
  assert.ok(severBranch(s, e));
  assert.equal(tree.linked, false);
  const before = tree.mantle;
  const fade = [];
  for (let i = 0; i < 4; i++) {
    run(s, B.mantleTau / 4);
    fade.push(tree.mantle);
  }
  assert.ok(fade.every((m, i) => m < (fade[i - 1] ?? before)), `it falls: ${fade}`);
  near(tree.mantle / before, Math.exp(-1), 0.02, 'one time constant later');
});

test('without the rival flag the economy leaves tree.mantle alone', () => {
  const { s, tree } = linkedPine(false);
  feed(s, 90);
  assert.ok(s.sim.income > 0 && tree.health > 0.5, 'the tree was fed and paying');
  assert.equal(tree.mantle ?? 0, 0);
  assert.equal(s.rival, null);
});

test('economy: a rotted tree pays less (B.rivalPayCut), a lost tree neither pays nor drinks', () => {
  const measure = (infection, lost) => {
    const { s, tree } = linkedPine(true);
    tree.infection = infection;
    tree.lost = lost;
    const pool = B.poolBase + B.poolPerLength * s.stats.hyphaeLength; // a full pool
    s.res.water = pool;
    s.res.minerals = pool;
    run(s, 3);
    return { pool, income: s.sim.income, water: s.res.water, sugarPaid: s.sim.intake[tree.id].sugar };
  };
  const healthy = measure(0, false);
  const half = measure(0.5, false);
  const gone = measure(1, true);
  assert.ok(healthy.water < healthy.pool, 'a healthy tree drinks');
  assert.ok(half.income < healthy.income, 'a half-rotted tree pays less');
  near((half.income - gone.income) / (healthy.income - gone.income), 1 - B.rivalPayCut * 0.5, 0.02, 'pay at 50 % infection');
  assert.equal(gone.water, gone.pool, 'a lost tree drinks nothing');
  assert.equal(gone.sugarPaid, 0);
  assert.ok(gone.income < half.income);
});

// ---- 6. the barrier ---------------------------------------------------------------------------------------------------

test('barrier: edges inside r wither and die, beyond-the-cut edges wither as orphans, the rest is untouched', () => {
  const { s, r, x, y, barrierNode, inside, left, right } = lineScene();
  s.events.length = 0;
  assert.ok(inside.length >= 4 && left.length >= 4 && right.length >= 4, 'a scene with edges on every side');
  const sick = left[left.length - 1]; // an outside edge that has started to wither: it recovers
  sick.wither = 0.6;
  r.hot = true;
  const sugar = s.res.sugar;
  const cost = barrierCost(s);
  assert.equal(cost, B.barrierCost);
  assert.equal(commandBarrier(s, barrierNode), true);
  assert.equal(s.res.sugar, sugar - cost, 'the cost is paid');
  assert.deepEqual(evs(s.events, 'barrier-placed').map(({ type, id, x: bx, y: by }) => ({ type, id, x: bx, y: by })), [{ type: 'barrier-placed', id: 0, x, y }]);
  assert.deepEqual(s.barriers.map(({ id, nodeId, x: bx, y: by, r: br, t, dur }) => ({ id, nodeId, x: bx, y: by, r: br, t, dur })), [
    { id: 0, nodeId: barrierNode, x, y, r: B.barrierRadius, t: 0, dur: B.barrierDur },
  ]);
  s.events.length = 0;

  const ver = r.ver;
  const t1 = B.barrierWither - 0.5;
  stepR(s, t1);
  assert.equal(r.ver, ver, 'wither alone never bumps ver');
  for (const e of inside) {
    assert.ok(e.alive);
    near(e.wither, t1 / B.barrierWither, 0.02, 'wither inside');
  }
  for (const e of [...left, ...right]) if (e !== sick) assert.equal(e.wither, 0, 'outside is untouched');
  near(sick.wither, 0.6 - t1 / (2 * B.barrierWither), 0.02, 'an outside edge recovers');
  assert.equal(r.stats.cut, 0);

  const seen = stepR(s, 1);
  for (const e of inside) assert.equal(e.alive, false, 'inside edges died');
  assert.ok(r.nodes[inside[0].b].alive === false);
  const dead = r.edges.filter((e) => !e.alive);
  assert.ok(dead.length >= inside.length);
  assert.equal(r.ver, ver + dead.length, 'ver bumps once per dead edge');
  const cuts = evs(seen, 'rival-cut');
  assert.ok(cuts.length >= 1);
  assert.equal(cuts.reduce((n, e) => n + e.edges, 0), dead.length, 'rival-cut counts the edges');
  assert.equal(r.stats.cut, dead.length);
  assert.ok(cuts.every((e) => Number.isFinite(e.x) && Number.isFinite(e.y) && Math.hypot(e.x - x, e.y - y) <= B.barrierRadius + 10));
  for (const e of left) if (e !== sick) assert.ok(e.alive && e.wither === 0);

  // beyond the cut nothing feeds the rhizomorph any more: it withers as orphans
  const orphans = right.filter((e) => e.alive);
  assert.ok(orphans.length >= 4);
  stepR(s, 2);
  for (const e of orphans) near(e.wither, (s.time - cuts[0].at + DT) / B.rivalOrphanSeconds, 0.05, 'orphan wither');
  const more = stepR(s, B.rivalOrphanSeconds);
  for (const e of right) assert.equal(e.alive, false, 'everything beyond the cut is gone');
  assert.equal(r.stats.cut, dead.length + orphans.length, 'orphans beyond a cut count as cut');
  assert.equal(evs(more, 'rival-cut').reduce((n, e) => n + e.edges, 0), orphans.length);
  for (const e of left) assert.ok(e.alive, 'the source side stands');
  assert.equal(sick.wither, 0, 'recovered');
  assert.equal(liveSegments(r), r.edges.filter((e) => e.alive).length, 'liveSegments follows the kills');
});

test('barrier: a grip whose edge died is released (tree-freed), grips outside stay', () => {
  const { s, r, ids, barrierNode } = lineScene();
  const at = (i) => ({ x: r.nodes[ids[i]].x, y: r.nodes[ids[i]].y });
  const mid = ids[12]; // under the barrier
  const far = ids[24]; // beyond it
  const home = ids[2]; // on the source side
  const grips = [
    { treeId: 0, node: mid, ...at(12), since: 0, tip: 0 },
    { treeId: 1, node: far, ...at(24), since: 0, tip: 1 },
    { treeId: 0, node: home, ...at(2), since: 0, tip: 2 },
  ];
  r.grip.push(...grips);
  assert.equal(commandBarrier(s, barrierNode), true);
  s.events.length = 0;
  const seen = stepR(s, B.barrierWither + B.rivalOrphanSeconds + 3);
  const freed = evs(seen, 'tree-freed');
  assert.equal(freed.length, 2);
  assert.deepEqual([freed[0].treeId, freed[0].x, freed[0].y], [0, grips[0].x, grips[0].y], 'the grip under the barrier goes first');
  assert.deepEqual([freed[1].treeId, freed[1].x, freed[1].y], [1, grips[1].x, grips[1].y], 'then the one beyond, when its edge withered');
  assert.ok(freed[1].at - freed[0].at >= B.rivalOrphanSeconds - 1);
  assert.deepEqual(r.grip.map((g) => g.node), [home]);
  assert.equal(r.stats.freed, 2);
  // a tree that was rotting stops rotting when freed and starts to heal
  const t1 = s.world.trees[1];
  assert.ok(t1.infection >= 0 && t1.infection < 0.2);
});

test('barrier: tips inside r die (stats.killed), tips outside live on', () => {
  const { s, r, x, y, barrierNode } = lineScene();
  const goal = goalAt(s, x + 3000, y);
  const inTip = spawnTipAt(s, x + 30, y + 10, 0, goal.id);
  const outTip = spawnTipAt(s, x - 230, y + 10, 0, goal.id);
  inTip.retarget = outTip.retarget = Infinity;
  commandBarrier(s, barrierNode);
  stepR(s, DT);
  assert.deepEqual(r.tips, [outTip]);
  assert.equal(r.stats.killed, 1);
});

test('barrier: ends at t >= B.barrierDur with barrier-gone, is removed, and the price falls back', () => {
  const { s, x, y, barrierNode } = lineScene();
  const other = nodeAt(s, x + 3 * B.barrierRadius, y); // far enough not to be crowded
  assert.equal(commandBarrier(s, barrierNode), true);
  const first = s.barriers[0];
  assert.equal(barrierCost(s), B.barrierCost + B.barrierCostStep, 'a barrier stands: the next one costs more');
  s.events.length = 0;
  const seen = stepR(s, B.barrierDur - 1);
  assert.equal(s.barriers.length, 1);
  assert.equal(evs(seen, 'barrier-gone').length, 0);
  assert.ok(first.t < first.dur);
  const rest = stepR(s, 1.5);
  const gone = evs(rest, 'barrier-gone');
  assert.equal(gone.length, 1);
  assert.equal(gone[0].id, first.id);
  near(gone[0].at, B.barrierDur, 2 * DT, 'time of barrier-gone'); // the scene's clock started at the placement
  assert.deepEqual(s.barriers, []);
  assert.equal(barrierCost(s), B.barrierCost);
  assert.equal(commandBarrier(s, other), true);
  assert.equal(s.barriers[0].id, first.id + 1, 'ids go on counting');
});

test('barrier: the price grows by B.barrierCostStep with every barrier standing, and is taken from the sugar', () => {
  const { s, x, y } = lineScene();
  const spots = Array.from({ length: B.barrierMax }, (_, i) => nodeAt(s, x - 200 + 200 * i, y + 80 * (i % 2)));
  s.res.sugar = 1000;
  spots.forEach((id, i) => {
    const want = B.barrierCost + B.barrierCostStep * i;
    assert.equal(barrierCost(s), want);
    const before = s.res.sugar;
    assert.equal(commandBarrier(s, id), true);
    assert.equal(s.res.sugar, before - want);
  });
  assert.equal(s.barriers.length, B.barrierMax);
});

// ---- 7. denials -------------------------------------------------------------------------------------------------------

function denied(s, id) {
  const n = s.net.nodes[id];
  const sugar = s.res.sugar;
  const count = s.barriers.length;
  s.events.length = 0;
  const reason = barrierDenial(s, id);
  assert.equal(canBarrier(s, id), false);
  assert.equal(commandBarrier(s, id), false);
  const want = [{ type: 'barrier-denied', reason, x: n.x, y: n.y }];
  if (reason === 'sugar') want.push({ type: 'insufficient', x: n.x, y: n.y });
  assert.deepEqual(s.events, want);
  assert.equal(s.res.sugar, sugar, 'nothing is spent');
  assert.equal(s.barriers.length, count);
  s.events.length = 0;
  return reason;
}

test('barrier denials: off, dead, max, crowded, sugar: each with its event, nothing spent', () => {
  const { s, r, x, y } = lineScene();
  const a = nodeAt(s, x - 200, y + 60);
  const b = nodeAt(s, x, y + 60);
  const c = nodeAt(s, x + 200, y + 60);
  const d = nodeAt(s, x + 400, y + 60);
  s.events.length = 0; // the hand-placed nodes made link events
  // off: the rival sleeps
  r.awake = false;
  assert.equal(barrierDenial(s, a), 'off');
  assert.equal(commandBarrier(s, a), false);
  assert.deepEqual(s.events, [], 'off has no event');
  r.awake = true;
  assert.equal(barrierDenial(s, a), null);
  assert.equal(canBarrier(s, a), true);
  // sugar
  s.res.sugar = barrierCost(s) - 0.01;
  assert.equal(denied(s, a), 'sugar');
  s.res.sugar = barrierCost(s);
  assert.equal(barrierDenial(s, a), null, 'exactly the price is enough');
  // dead
  const tail = nodeAt(s, x - 200, y + 100); // child of nothing: make a pair, cut it
  const child = addNode(s, x - 200, y + 120, tail).id;
  severBranch(s, s.sim.parentEdge[child]);
  assert.equal(s.net.nodes[child].alive, false);
  assert.equal(denied(s, child), 'dead');
  assert.equal(barrierDenial(s, 999999), 'dead', 'an unknown node counts as dead');
  assert.equal(commandBarrier(s, 999999), false);
  assert.deepEqual(s.events, [], 'and has no event: there is no place to show it');
  // crowded
  s.res.sugar = 1000;
  assert.equal(commandBarrier(s, b), true);
  s.events.length = 0;
  const nearB = nodeAt(s, x + B.barrierRadius - 5, y + 60);
  assert.equal(denied(s, nearB), 'crowded');
  assert.equal(denied(s, b), 'crowded', 'the node under a barrier is crowded too');
  assert.equal(barrierDenial(s, nodeAt(s, x + B.barrierRadius + 5, y + 60)), null, 'just beyond r is free');
  // max
  while (s.barriers.length < B.barrierMax) assert.equal(commandBarrier(s, [a, c, d][s.barriers.length - 1]), true);
  const e = nodeAt(s, x - 400, y + 60);
  assert.equal(denied(s, e), 'max');
});

test('barrier denials come in the order dead > max > crowded > sugar', () => {
  const { s, x, y } = lineScene();
  s.res.sugar = 1000;
  const spots = Array.from({ length: B.barrierMax }, (_, i) => nodeAt(s, x - 400 + 200 * i, y + 60));
  for (const id of spots) assert.equal(commandBarrier(s, id), true);
  const crowded = nodeAt(s, spots.length ? s.net.nodes[spots[0]].x + 10 : x, y + 60);
  const free = nodeAt(s, x + 600, y + 60);
  s.res.sugar = 0;
  assert.equal(barrierDenial(s, crowded), 'max', 'max before crowded and sugar');
  assert.equal(barrierDenial(s, free), 'max', 'max before sugar');
  const pair = addNode(s, s.net.nodes[free].x, s.net.nodes[free].y + 20, free).id;
  severBranch(s, s.sim.parentEdge[pair]);
  assert.equal(barrierDenial(s, pair), 'dead', 'dead before max');
  s.barriers.pop();
  assert.equal(barrierDenial(s, crowded), 'crowded', 'crowded before sugar');
  assert.equal(barrierDenial(s, free), 'sugar');
  s.res.sugar = 1000;
  assert.equal(barrierDenial(s, free), null);
});

test('pickBarrierNode: the nearest node that may take a barrier, else the nearest of any kind, else null', () => {
  const { s, x, y } = lineScene();
  const R = B.barrierRadius;
  const placed = nodeAt(s, x, y + 200);
  s.res.sugar = 1000;
  assert.equal(commandBarrier(s, placed), true);
  const crowded = nodeAt(s, x + R - 5, y + 200); // under the barrier
  const free = nodeAt(s, x + R + 5, y + 200); // 10 u from it, but beyond r
  assert.equal(barrierDenial(s, crowded), 'crowded');
  assert.equal(barrierDenial(s, free), null);
  assert.equal(pickBarrierNode(s, x + R - 5, y + 200), free, 'the one that may beats a nearer one that may not');
  // out of reach (44 u) of every node that may, the nearest node of any kind answers, so the player sees why it is denied
  assert.equal(pickBarrierNode(s, x + 30, y + 250), placed, 'the nearest of any kind');
  assert.equal(pickBarrierNode(s, x, y + 200 + 50), placed, 'fallback reaches a little further than the default radius');
  assert.equal(pickBarrierNode(s, x, y + 200 + 60, 20), placed, 'radius 20 + 40');
  assert.equal(pickBarrierNode(s, x, y + 200 + 70, 20), null, 'beyond that nothing');
  assert.equal(pickBarrierNode(s, x - 1500, y), null);
});

// ---- 8. saving --------------------------------------------------------------------------------------------------------

/** A state really played by the bot (passively: no barriers), the first of a few seeds that has everything a save must carry. */
function playedState() {
  for (const seed of [31, 53, 30, 39, 43, 42, 23, 1, 2, 3, 7]) { // (31 and 53 are the glades of generator 2 that fit within 700 s)
    const { state } = playBot(seed, { rival: 'now', seasons: true, barrier: false, maxSeconds: 700 });
    const r = state.rival;
    const trees = state.world.trees;
    if (state.clock.season === 'autumn' && r.tips.length > 0 && r.grip.length > 0 && r.clusters.length > 0 && trees.some((t) => t.lost) && trees.some((t) => t.mantle > 0 && t.infection > 0)) {
      return state;
    }
  }
  throw new Error('no seed gave a state with tips, a grip, clusters, a lost tree and a mantle');
}

const snapshot = (s) => clone({ rival: s.rival, barriers: s.barriers, trees: s.world.trees.map((t) => [t.stage, t.growth, t.health, t.linked, t.infection, t.mantle, t.lost]), res: s.res, time: s.time });

test('save and load: a played state (rival, grips, clusters, a lost tree, a barrier) comes back equal and goes on identically', () => {
  const orig = playedState();
  const r = orig.rival;
  // a barrier on a rival node away from the tips, run a little so edges are mid-wither (and the barrier is mid-life)
  const away = r.nodes.find((n) => n.alive && r.tips.every((t) => Math.hypot(t.x - n.x, t.y - n.y) > B.barrierRadius + 20)) ?? r.nodes.find((n) => n.alive);
  orig.res.sugar = Math.max(orig.res.sugar, 100);
  assert.equal(commandBarrier(orig, nodeAt(orig, away.x, away.y)), true);
  run(orig, 1.5);
  assert.ok(r.edges.some((e) => e.alive && e.wither > 0 && e.wither < 1), 'some edges are withering');
  assert.ok(r.tips.length > 0 && r.grip.length > 0 && r.clusters.length > 0 && r.spores > 0 && r.stats.grips > 0);
  assert.equal(orig.barriers.length, 1);

  const copy = decodeState(clone(encodeState(orig)));
  assert.deepEqual(snapshot(copy), snapshot(orig), 'the loaded state equals the saved one');
  assert.deepEqual(clone(copy.rival), clone(orig.rival));
  assert.deepEqual(copy.barriers, orig.barriers);
  copy.world.trees.forEach((t, i) => {
    const o = orig.world.trees[i];
    assert.deepEqual([t.infection, t.mantle, t.lost], [o.infection, o.mantle, o.lost]);
  });

  // go on with both, with the same inputs
  const play = (s) => {
    const seen = run(s, 20);
    s.res.sugar = Math.max(s.res.sugar, 100);
    sim.commandBarrier(s, s.net.originId);
    return [...seen, ...run(s, 40)];
  };
  const seenOrig = play(orig);
  const seenCopy = play(copy);
  assert.deepEqual(seenCopy, seenOrig, 'the same events');
  assert.deepEqual(snapshot(copy), snapshot(orig), 'the same state after 60 s');
  assert.ok(seenOrig.length > 0);
});

test('a save from before the rival (no rival, no barriers, trees with 4 numbers) loads and plays on', () => {
  const s = fresh(7, 'now');
  run(s, 30);
  const payload = clone(encodeState(s));
  delete payload.rival;
  delete payload.barriers;
  payload.trees = payload.trees.map((row) => row.slice(0, 4));
  const old = decodeState(payload);
  assert.equal(old.rival, null);
  assert.deepEqual(old.barriers, []);
  for (const t of old.world.trees) assert.deepEqual([t.infection, t.mantle, t.lost], [0, 0, false]);
  assert.doesNotThrow(() => run(old, 5));
  assert.equal(old.rival.awake, true, 'the flag is saved: the rival is created and wakes');
});

// ---- 9. stumps --------------------------------------------------------------------------------------------------------

test('stumps (seeds 1..400): 1-2, far from the spore and from trunks, on the ground, deterministic, and a rhizomorph can start there', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const w = generateWorld(seed);
    assert.deepEqual(w.stumps, generateWorld(seed).stumps, `seed ${seed} is deterministic`);
    assert.deepEqual(stumpProblems(w), [], `seed ${seed}`);
    assert.ok(w.stumps.length >= 1 && w.stumps.length <= 2, `seed ${seed}: ${w.stumps.length} stumps`);
    for (const s of w.stumps) {
      assert.ok(Math.hypot(s.x - w.origin.x, s.y - w.origin.y) >= 260, `seed ${seed}: from the spore`);
      assert.ok(w.trees.every((t) => Math.abs(t.x - s.x) >= 140), `seed ${seed}: from the trunks`);
      near(s.y, groundYAt(w, s.x), 1e-9, `seed ${seed}: on the ground line`);
      // the rhizomorph root (14 u under the stump) must be soil a tip may occupy, or the stump would never send anything out
      const rootY = s.y + 14;
      assert.ok(Number.isFinite(costAt(w, s.x, rootY)) && rootY - groundYAt(w, s.x) >= B.rivalDepthMin - 1, `seed ${seed}: open soil at the stump`);
    }
  }
});

// ---- 10. caps, rates, regrowth, twigs ---------------------------------------------------------------------------------

test('long runs (6 seeds, 600 s): caps hold, rival-tip at most once a second, every node in open soil, no NaN', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = fresh(seed, 'now');
    for (const t of s.world.trees) nodeAt(s, t.tips[0].x + 30, t.tips[0].y); // a player on every tree: the rival may grip any
    const tipAt = [];
    let maxTips = 0;
    let maxLive = 0;
    for (let i = 0; i < 600 * 60; i++) {
      sim.updateSim(s, DT);
      s.time += DT;
      for (const e of s.events) if (e.type === 'rival-tip') tipAt.push(s.time);
      s.events.length = 0;
      maxTips = Math.max(maxTips, s.rival.tips.length);
      maxLive = Math.max(maxLive, liveSegments(s.rival));
    }
    const r = s.rival;
    assert.ok(maxTips >= 1 && maxTips <= B.rivalMaxTips, `seed ${seed}: tips ${maxTips}`);
    assert.ok(maxLive > 20 && maxLive <= B.rivalMaxSegments, `seed ${seed}: alive edges ${maxLive}`);
    assert.ok(tipAt.length > 5, `seed ${seed}: it grows`);
    for (let i = 1; i < tipAt.length; i++) assert.ok(tipAt[i] - tipAt[i - 1] >= 1 - 1e-6, `seed ${seed}: rival-tip events ${tipAt[i - 1]} and ${tipAt[i]}`);
    for (const n of r.nodes) {
      assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `seed ${seed}: node ${n.id} finite`);
      assert.ok(Number.isFinite(costAt(s.world, n.x, n.y)), `seed ${seed}: node ${n.id} is not in rock or air`);
      assert.ok(n.y - groundYAt(s.world, n.x) >= B.rivalDepthMin - 1 - 1e-6, `seed ${seed}: node ${n.id} is deep enough`);
    }
    for (const t of r.tips) for (const k of ['x', 'y', 'dir', 'speed']) assert.ok(Number.isFinite(t[k]), `seed ${seed}: tip ${k}`);
    for (const t of s.world.trees) {
      assert.ok(t.infection >= 0 && t.infection <= 1 && t.mantle >= 0 && t.mantle <= 1, `seed ${seed}: tree fields in range`);
    }
    assert.ok(Number.isFinite(r.spores));
  }
});

test('caps that bind: with small limits the rival never grows past them, not by a single segment', () => {
  const saved = { segs: B.rivalMaxSegments, tips: B.rivalMaxTips, total: B.rivalMaxTotal };
  try {
    B.rivalMaxSegments = 30;
    B.rivalMaxTips = 2;
    B.rivalMaxTotal = 60;
    const s = fresh(2, 'now');
    let maxTips = 0;
    let maxLive = 0;
    for (let i = 0; i < 400 * 60; i++) {
      sim.updateSim(s, DT);
      s.time += DT;
      s.events.length = 0;
      maxTips = Math.max(maxTips, s.rival.tips.length);
      maxLive = Math.max(maxLive, liveSegments(s.rival));
    }
    assert.ok(maxTips <= B.rivalMaxTips, `tips ${maxTips}`);
    assert.ok(maxLive >= 20, `it reached the cap: ${maxLive}`);
    assert.ok(maxLive <= B.rivalMaxSegments, `alive edges ${maxLive}`);
    assert.ok(s.rival.nodes.length <= B.rivalMaxTotal + B.rivalMaxTips, `nodes ${s.rival.nodes.length}`); // + the root nodes of the tips
  } finally {
    B.rivalMaxSegments = saved.segs;
    B.rivalMaxTips = saved.tips;
    B.rivalMaxTotal = saved.total;
  }
});

test('regrowth: cut right back it sends B.rivalStartTips tips from the stumps after B.rivalRegrow s of growing weather, not in winter', () => {
  const s = fresh(7);
  const r = quiet(s);
  const { x, y } = corridor(s.world);
  rhizoLine(s, r, x - 100, x + 100, y, 20); // all of it within the barrier's reach
  const barrierNode = nodeAt(s, x, y);
  s.flags.seasons = true;
  Object.assign(s.clock, clockAt(B.seasonSeconds * 3 + 10)); // winter
  const goal = goalAt(s, x + 3000, y);
  const tip = spawnTipAt(s, x + 20, y + 10, 0, goal.id);
  tip.retarget = Infinity;
  assert.equal(commandBarrier(s, barrierNode), true);
  let guard = 0;
  while ((liveSegments(r) > 0 || r.tips.length > 0) && guard++ < 60 * 40) stepR(s, DT);
  assert.equal(liveSegments(r), 0, 'every edge is gone');
  assert.equal(r.tips.length, 0);
  assert.ok(r.stats.cut > 0 && r.stats.killed === 1);
  stepR(s, 2 * B.rivalRegrow);
  assert.equal(r.tips.length, 0, 'winter: nothing comes back');
  assert.equal(r.emptyT, 0, 'and the wait does not run');

  Object.assign(s.clock, clockAt(10)); // spring
  stepR(s, B.rivalRegrow - 3);
  assert.equal(r.tips.length, 0, 'not before B.rivalRegrow s');
  let steps = 0;
  while (r.tips.length === 0 && steps++ < 60 * 10) stepR(s, DT);
  assert.equal(r.tips.length, Math.min(B.rivalStartTips, B.rivalMaxTips));
  near(steps * DT, 3, 1, 'it comes when the wait is over');
  for (const t of r.tips) assert.ok(s.world.stumps.some((st) => Math.hypot(t.x - st.x, t.y - st.y - 14) < 1e-6), 'from a stump');
});

test('dead-end twigs (no tip, no grip, nothing beyond) wither after B.rivalTwigAge, and that is not «cut by a barrier»', () => {
  const s = fresh(7);
  const r = quiet(s);
  const { x, y } = corridor(s.world);
  s.time = 0;
  rhizoLine(s, r, x - 100, x - 60, y, 20); // root + two edges
  const held = rhizoLine(s, r, x + 60, x + 100, y, 20);
  r.grip.push({ treeId: 0, node: held[held.length - 1], x: x + 100, y, since: 0, tip: 0 }); // a grip serves its branch
  const young = stepR(s, B.rivalTwigAge - 20);
  assert.equal(liveSegments(r), 4, 'not before they are old enough');
  const old = stepR(s, 20 + 2 * (5 + B.rivalOrphanSeconds) + 4);
  assert.equal(r.edges.filter((e) => e.alive).length, 2, 'the twig is gone, the held branch stays');
  assert.ok(r.edges.slice(0, 2).every((e) => !e.alive));
  assert.ok(r.edges.slice(2).every((e) => e.alive && e.wither === 0));
  assert.equal(r.stats.cut, 0);
  assert.equal(evs([...young, ...old], 'rival-cut').length, 0);
  assert.equal(r.grip.length, 1);
});

// ---- 11. autumn clusters ----------------------------------------------------------------------------------------------

function inSeason(s, name) {
  s.flags.seasons = true;
  Object.assign(s.clock, clockAt(B.seasonSeconds * ['spring', 'summer', 'autumn', 'winter'].indexOf(name) + 10));
}

test('autumn clusters: one rival-fruit at a tree rotted past B.rivalFruitInfection, spores rise by n, none below it', () => {
  const s = fresh(7);
  const r = quiet(s);
  inSeason(s, 'autumn');
  const [low, high] = s.world.trees;
  const pin = () => {
    low.infection = B.rivalFruitInfection - 0.1;
    high.infection = B.rivalFruitInfection + 0.1;
  };
  pin();
  const seen = stepR(s, B.seasonSeconds - 20, DT, pin);
  const fruit = evs(seen, 'rival-fruit');
  assert.equal(fruit.length, 1, 'one per tree');
  assert.equal(fruit[0].treeId, high.id);
  assert.ok(fruit[0].n >= B.rivalFruit[0] && fruit[0].n <= B.rivalFruit[1]);
  assert.equal(r.clusters.length, 1);
  const cl = r.clusters[0];
  assert.deepEqual([cl.treeId, cl.n, cl.x, cl.y], [high.id, fruit[0].n, fruit[0].x, fruit[0].y]);
  assert.ok(Math.abs(cl.x - high.x) <= 36 + 1e-9);
  near(cl.y, groundYAt(s.world, cl.x), 1e-9, 'on the ground');
  assert.ok(cl.age > 0, 'it ages');
  assert.equal(r.spores, cl.n);
  assert.equal(evs(seen, 'rival-fruit').filter((e) => e.treeId === low.id).length, 0, 'nothing at the less rotted tree');
  // the first cold takes them
  inSeason(s, 'winter');
  stepR(s, 1, DT, pin);
  assert.deepEqual(r.clusters, []);
  assert.equal(r.spores, cl.n, 'the spores are kept');
});

test('clusters appear only in autumn and only with seasons on', () => {
  for (const name of ['spring', 'summer', 'winter', null]) {
    const s = fresh(7);
    const r = quiet(s);
    if (name) inSeason(s, name);
    else {
      Object.assign(s.clock, clockAt(B.seasonSeconds * 2 + 10)); // the clock says autumn, but the flag is off
      assert.equal(s.clock.season, 'autumn');
      assert.ok(!s.flags.seasons);
    }
    const pin = () => s.world.trees.forEach((t) => (t.infection = 0.8));
    pin();
    const seen = stepR(s, B.seasonSeconds - 20, DT, pin);
    assert.equal(evs(seen, 'rival-fruit').length, 0, `no fruit in ${name ?? 'a game without seasons'}`);
    assert.deepEqual(r.clusters, []);
    assert.equal(r.spores, 0);
  }
});

// ---- 12. the notebook -------------------------------------------------------------------------------------------------

test('objectives: page 2 gets rivalCut and page 3 rivalGuard only when the rival is asked for', () => {
  const ids = (list) => list.map((o) => o.id);
  for (const biome of [null, 'birch', 'oak', 'pine', 'mixed']) {
    for (const seasons of [false, true]) {
      const on = ids(pageObjectives(2, seasons, biome, true));
      assert.equal(on.filter((id) => id === 'rivalCut').length, 1, `page 2 ${biome} ${seasons}`);
      assert.ok(on.indexOf('rivalCut') < on.indexOf('spores500'));
      assert.ok(!ids(pageObjectives(2, seasons, biome)).includes('rivalCut'), 'absent without the 4th argument');
      assert.ok(!ids(pageObjectives(2, seasons, biome, false)).includes('rivalCut'));
    }
  }
  for (const seasons of [false, true]) {
    const on = ids(pageObjectives(3, seasons, null, true));
    assert.equal(on.filter((id) => id === 'rivalGuard').length, 1);
    assert.ok(on.indexOf('rivalGuard') < on.indexOf('spores1500'));
    assert.ok(!ids(pageObjectives(3, seasons)).includes('rivalGuard'));
  }
  assert.ok(!ids(pageObjectives(1, true, null, true)).some((id) => /rival/.test(id)), 'page 1 stays as it was');
  const made = createObjectives(2, false, 'birch', true);
  assert.ok(made.every((o) => o.done === false) && ids(made).includes('rivalCut'));
  assert.ok(pageObjectives(2, true, null, true).find((o) => o.id === 'rivalCut').text.length > 10);
});

test('objectives: the page that turns carries the rival observations when flags.rival is set', () => {
  for (const [flag, want] of [[true, true], [false, false]]) {
    const s = fresh(7, flag);
    s.flags.threats = true;
    for (const o of s.objectives.slice(0, 4)) o.done = true;
    s.res.spores = B.sporesGoal;
    run(s, 0.1);
    assert.equal(s.chapter, 2);
    assert.equal(s.objectives.some((o) => o.id === 'rivalCut'), want);
    for (const o of s.objectives) o.done = true;
    run(s, 0.1);
    assert.equal(s.chapter, 3);
    assert.equal(s.objectives.some((o) => o.id === 'rivalGuard'), want);
  }
});

test('objectives: rivalCut counts edges cut by barriers (not twig dieback), rivalGuard wants a mantle on every living tree', () => {
  const doneIds = (s) => s.objectives.filter((o) => o.done).map((o) => o.id);
  const { s, r, barrierNode } = lineScene();
  s.chapter = 2;
  s.objectives = createObjectives(2, false, s.world.biome, true);
  stepObjectives(s);
  assert.ok(!doneIds(s).includes('rivalCut'));
  // dieback of an old twig does not count
  const { x, y } = corridor(s.world);
  const born = -B.rivalTwigAge - 100;
  rhizoLine(s, r, x - 100, x - 60, y + 40, 20);
  r.edges.slice(-2).forEach((e) => (e.born = born));
  stepR(s, 2 * (5 + B.rivalOrphanSeconds) + 6);
  assert.equal(r.edges.slice(-2).filter((e) => e.alive).length, 0, 'the twig withered');
  assert.equal(r.stats.cut, 0);
  stepObjectives(s);
  assert.ok(!doneIds(s).includes('rivalCut'));
  // one barrier is no longer enough: it cuts a few segments and frees no tree
  commandBarrier(s, barrierNode);
  stepR(s, B.barrierWither + 1);
  assert.ok(r.stats.cut > 0 && r.stats.cut < B.rivalCutGoal, `one barrier cut ${r.stats.cut} segments`);
  stepObjectives(s);
  assert.ok(!doneIds(s).includes('rivalCut'), 'a single barrier does not finish the observation');
  // the goal itself: B.rivalCutFreed trees freed, or B.rivalCutGoal segments cut (either one)
  r.stats.cut = B.rivalCutGoal - 1;
  r.stats.freedTrees = B.rivalCutFreed - 1;
  stepObjectives(s);
  assert.ok(!doneIds(s).includes('rivalCut'));
  r.stats.cut = B.rivalCutGoal;
  s.events.length = 0;
  stepObjectives(s);
  assert.ok(doneIds(s).includes('rivalCut'), 'segments cut');
  assert.deepEqual(evs(s.events, 'objective').map((e) => e.id), ['rivalCut']);
  s.objectives = createObjectives(2, false, s.world.biome, true);
  r.stats.cut = 0;
  r.stats.freedTrees = B.rivalCutFreed;
  stepObjectives(s);
  assert.ok(doneIds(s).includes('rivalCut'), 'trees freed');
  s.objectives = createObjectives(2, false, s.world.biome, true);
  s.rival = null; // a game without a rival object has cut nothing
  stepObjectives(s);
  assert.ok(!doneIds(s).includes('rivalCut'));

  // chapter 3: rivalGuard
  const g = fresh(7);
  g.chapter = 3;
  g.objectives = createObjectives(3, false, null, true);
  const guard = () => {
    stepObjectives(g);
    return g.objectives.find((o) => o.id === 'rivalGuard').done;
  };
  g.world.trees.forEach((t) => (t.mantle = B.mantleGoal - 0.01));
  assert.equal(guard(), false);
  g.world.trees.forEach((t) => (t.mantle = B.mantleGoal));
  assert.equal(guard(), true);
  g.objectives = createObjectives(3, false, null, true);
  g.world.trees[0].mantle = 0;
  assert.equal(guard(), false, 'one bare tree spoils it');
  g.world.trees[0].lost = true;
  assert.equal(guard(), true, 'a lost tree is ignored');
  g.objectives = createObjectives(3, false, null, true);
  g.world.trees.forEach((t) => (t.lost = true));
  assert.equal(guard(), false, 'and with every tree lost there is nothing left to guard');
});

// ---- 13. pointer input ------------------------------------------------------------------------------------------------

function fakeCanvas() {
  const c = new EventTarget();
  c.captured = [];
  c.getBoundingClientRect = () => ({ left: 0, top: 0 });
  c.setPointerCapture = (id) => c.captured.push(id);
  c.fire = (type, px, py, extra = {}) => c.dispatchEvent(Object.assign(new Event(type), { clientX: px, clientY: py, button: 0, buttons: 0, pointerId: 1, ...extra }));
  return c;
}

test('pointer: the barrier tool shows the pick under the cursor, a click places the barrier, other tools leave barrierPick alone', () => {
  const s = fresh(7);
  quiet(s);
  const { x, y } = corridor(s.world);
  const node = nodeAt(s, x, y);
  s.res.sugar = 100;
  const canvas = fakeCanvas();
  const game = { state: s, view: { scale: 1, ox: 0, oy: 0 }, sim };
  const input = attachInput(canvas, game);
  s.ui.tool = 'barrier';

  canvas.fire('pointermove', x + 5, y - 3);
  assert.deepEqual(s.ui.barrierPick, { nodeId: node, x, y, r: B.barrierRadius, ok: true, reason: null, cost: barrierCost(s) });
  canvas.fire('pointermove', x + 500, y);
  assert.equal(s.ui.barrierPick, null, 'no node near');
  canvas.fire('pointermove', x, y);
  assert.ok(s.ui.barrierPick);
  canvas.fire('pointerleave', 0, 0);
  assert.equal(s.ui.barrierPick, null, 'gone with the pointer');
  canvas.fire('pointermove', x, y);
  s.phase = 'paused';
  canvas.fire('pointermove', x, y);
  assert.equal(s.ui.barrierPick, null, 'only while playing');
  s.phase = 'playing';
  s.res.sugar = 1;
  canvas.fire('pointermove', x, y);
  assert.deepEqual([s.ui.barrierPick.ok, s.ui.barrierPick.reason, s.ui.barrierPick.cost], [false, 'sugar', B.barrierCost]);
  s.rival.awake = false;
  canvas.fire('pointermove', x, y);
  assert.deepEqual([s.ui.barrierPick.ok, s.ui.barrierPick.reason], [false, 'off']);
  canvas.fire('pointerdown', x, y);
  assert.deepEqual(s.barriers, [], 'a denied click places nothing');
  s.rival.awake = true;
  s.res.sugar = 100;
  s.events.length = 0;

  canvas.fire('pointerdown', x + 4, y, { button: 2 });
  assert.deepEqual(s.barriers, [], 'only the left button');
  canvas.fire('pointerdown', x + 4, y);
  assert.equal(s.barriers.length, 1, 'the click placed a barrier');
  assert.equal(s.barriers[0].nodeId, node);
  assert.equal(s.res.sugar, 100 - B.barrierCost);
  assert.equal(evs(s.events, 'barrier-placed').length, 1);
  assert.equal(s.ui.drag, null, 'and started no drag');
  assert.deepEqual(canvas.captured, []);
  canvas.fire('pointermove', x, y);
  assert.equal(s.ui.barrierPick.reason, 'crowded', 'the node under the barrier is crowded');

  // the other tools: no barrier pick, and a press in 'grow' starts a drag as usual
  s.barriers.length = 0;
  for (const tool of ['grow', 'fruit', 'trap']) {
    s.ui.tool = tool;
    s.ui.barrierPick = null;
    canvas.fire('pointermove', x, y);
    assert.equal(s.ui.barrierPick, null, `tool ${tool}`);
  }
  s.ui.tool = 'grow';
  canvas.fire('pointerdown', x, y);
  assert.ok(s.ui.drag && s.ui.drag.from === node, 'grow starts a drag');
  assert.deepEqual(canvas.captured, [1]);
  assert.deepEqual(s.barriers, []);
  canvas.fire('pointerup', x, y);
  input.detach();
  canvas.fire('pointermove', x, y);
  assert.equal(s.ui.barrierPick, null, 'detached');
});

// «Опёнок: второе поведение и барьер как выбор» (src/sim/rival.js, growth.js, flows.js, economy.js):
//  1. a standing barrier freezes the player's hyphae inside its ring: nothing grows through it (estimateGrowth / commandGrow /
//     stepGrowth), nothing flows or thickens there, and a tree all of whose root contacts are inside pays nothing (treeBarred);
//  2. the raider: one new tip in B.rivalRaidEvery goes for the player's NETWORK, overgrows a thin hypha (it blackens and withers for
//     B.rivalRaidWither s, then is cut like a worm bite and the branch beyond dies), runs on towards the spore over thin edges, and is
//     stopped by a thick cord, a barrier, the hyphae round the spore or its reach; a barrier kills it and heals what it overgrew;
//  3. the raid state survives a save (state.rival.over, tip.raid), and the bots keep their balance: the passive one loses more.
// Expected numbers come from B (src/sim/balance.js), never from literals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { addNode } from '../src/sim/network.js';
import { cutEdge } from '../src/sim/threats.js';
import { B } from '../src/sim/balance.js';
import { estimateGrowth, commandGrow, stepGrowth } from '../src/sim/growth.js';
import { saprotrophSugar } from '../src/sim/economy.js';
import { barredNodes, barrierEffects, commandBarrier, createRival, inBarrier, raiders, spawnRaiderAt, stepRival, treeBarred } from '../src/sim/rival.js';
import { costAt, groundYAt } from '../src/world/query.js';
import { decodeState, encodeState } from '../src/persist-codec.js';
import { playBot } from './bot.mjs';

const DT = 1 / 60;
const evs = (events, type) => events.filter((e) => e.type === type);
const clone = (v) => JSON.parse(JSON.stringify(v));

function fresh(seed = 7, flag = true) {
  const s = createState(seed, 2);
  s.phase = 'playing';
  s.flags.rival = flag;
  return s;
}

/** An awake rival that makes no tips of its own: only what a test puts in it happens. */
function quiet(s) {
  s.flags.rival ||= true;
  const r = (s.rival ??= createRival(s));
  Object.assign(r, { awake: true, age: 1000, spawnT: 1e9 });
  return r;
}

/** Runs the whole game (sim.updateSim); returns the events, each with `at`. */
function run(s, seconds) {
  const seen = [];
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    sim.updateSim(s, DT);
    s.time += DT;
    for (const e of s.events) seen.push({ ...e, at: s.time });
    s.events.length = 0;
  }
  return seen;
}

/** Runs the rival alone (no economy, no flows). */
function stepR(s, seconds, each = null) {
  const seen = [];
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    stepRival(s, DT);
    s.time += DT;
    for (const e of s.events) seen.push({ ...e, at: s.time });
    s.events.length = 0;
    if (each) each(s);
  }
  return seen;
}

/** Runs `fn` with some B numbers changed, then puts them back. */
function withB(over, fn) {
  const old = {};
  for (const k of Object.keys(over)) old[k] = B[k];
  Object.assign(B, over);
  try {
    return fn();
  } finally {
    Object.assign(B, old);
  }
}

/** A level stretch of open soil, 260 u either way and 16 u up and down: { x, y } (the first match of a fixed scan). */
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

/** A thin hypha of the player along y: a root (parent -1) at x0, then `n` nodes `gap` u apart to the right, each the child of the last. */
function chain(s, x0, y, n, gap = 16) {
  const ids = [addNode(s, x0, y, -1).id];
  for (let k = 1; k <= n; k++) ids.push(addNode(s, x0 + k * gap, y, ids[k - 1]).id);
  return ids;
}

const edgeInto = (s, nodeId) => s.net.edges[s.sim.parentEdge[nodeId]];

/** The standard raid scene: a thin chain in a corridor (root at x-250, 13 nodes after it) and a raider 150 u to the right of its end. */
function raidScene(seed = 7) {
  const s = fresh(seed);
  const r = quiet(s);
  const { x, y } = corridor(s.world);
  const ids = chain(s, x - 250, y, 13);
  s.res.sugar = 100;
  const tip = spawnRaiderAt(s, s.net.nodes[ids[13]].x + 150, y, Math.PI);
  return { s, r, x, y, ids, tip };
}

// ---- 1. the barrier freezes what is inside ---------------------------------------------------------------------------------

/** A barrier on a node of a corridor, a free node 200 u to its right (outside the ring), and a free node 40 u to its right (inside). */
function barrierScene() {
  const s = fresh(7);
  quiet(s);
  const { x, y } = corridor(s.world);
  const centre = addNode(s, x, y, -1).id;
  const inner = addNode(s, x + 40, y, -1).id;
  const outer = addNode(s, x + 200, y, -1).id;
  s.res.sugar = 200;
  assert.equal(commandBarrier(s, centre), true);
  return { s, x, y, centre, inner, outer };
}

test('barrier: inBarrier / barredNodes follow the standing barriers (null when none stands)', () => {
  const { s, x, y, centre, inner, outer } = barrierScene();
  assert.equal(inBarrier(s, x + B.barrierRadius - 2, y), true);
  assert.equal(inBarrier(s, x + B.barrierRadius + 2, y), false);
  const bar = barredNodes(s);
  assert.ok(bar.has(centre) && bar.has(inner) && !bar.has(outer));
  const clean = fresh(7);
  assert.equal(barredNodes(clean), null);
});

test('growth: a drag from a node inside the ring is refused with the reason «barrier»; the preview says so', () => {
  const { s, x, y, inner } = barrierScene();
  const pts = [{ x: x + 70, y }, { x: x + 100, y }];
  const plan = estimateGrowth(s, inner, pts);
  assert.equal(plan.denied, 'barrier');
  assert.deepEqual(plan.points, []);
  assert.equal(plan.affordable, false);
  s.events.length = 0;
  assert.equal(commandGrow(s, inner, pts), false);
  const ev = evs(s.events, 'grow-denied');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].reason, 'barrier');
  assert.equal(s.net.growing.length, 0);
});

test('growth: a drag from outside is cut at the ring (blocked is the first point inside), and the part before it is grown', () => {
  const { s, x, y, outer } = barrierScene();
  const R = B.barrierRadius;
  const plan = estimateGrowth(s, outer, [{ x: x + 20, y }]);
  assert.equal(plan.denied, 'barrier');
  assert.ok(plan.blocked && Math.hypot(plan.blocked.x - x, plan.blocked.y - y) < R, 'blocked lies inside the ring');
  const last = plan.points[plan.points.length - 1];
  assert.ok(Math.hypot(last.x - x, last.y - y) >= R - 1e-6, 'the path ends outside the ring');
  assert.ok(plan.length > 100 && plan.length < 200 - R + B.pathStep + 1, `length ${plan.length}`);
  s.events.length = 0;
  assert.equal(commandGrow(s, outer, [{ x: x + 20, y }]), true);
  const ev = evs(s.events, 'grow-denied');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].partial, true);
  assert.equal(s.net.growing.length, 1);
  // a drag that stays outside is not denied at all
  const ok = estimateGrowth(s, outer, [{ x: x + 260, y }]);
  assert.equal(ok.denied, null);
});

test('growth: a hypha already growing stops where a barrier goes up over its tip; later the barrier ends and growth is free again', () => {
  const s = fresh(7);
  quiet(s);
  const { x, y } = corridor(s.world);
  const centre = addNode(s, x, y, -1).id;
  const outer = addNode(s, x + 220, y, -1).id;
  s.res.sugar = 200;
  assert.equal(commandGrow(s, outer, [{ x: x - 150, y }]), true);
  assert.equal(commandBarrier(s, centre), true);
  s.events.length = 0;
  const seen = [];
  for (let i = 0; i < 90 && s.net.growing.length > 0; i++) {
    stepGrowth(s, DT);
    seen.push(...s.events);
    s.events.length = 0;
  }
  assert.equal(s.net.growing.length, 0, 'the hypha stopped');
  assert.equal(evs(seen, 'grow-denied')[0].reason, 'barrier');
  const tipNode = s.net.nodes[s.net.nodes.length - 1];
  assert.ok(tipNode.x > x + B.barrierRadius - 20, `it stopped at the ring (x=${tipNode.x - x})`);
  // once the barrier is gone the same drag is allowed
  run(s, B.barrierDur + 2);
  assert.equal(s.barriers.length, 0);
  assert.equal(estimateGrowth(s, outer, [{ x: x - 150, y }]).denied, null);
});

/** A chain from the origin to the first reachable root tip of a tree (as sim-rival.test.mjs does): a linked tree. */
function linkedTree(flag = true, treeId = 1) {
  const s = fresh(7, flag);
  const tree = s.world.trees[treeId];
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
  return { s, tree, last: prev };
}
const feed = (s, seconds) => {
  const seen = [];
  for (let i = 0; i < seconds; i++) {
    s.res.water = s.cap.pool;
    s.res.minerals = s.cap.pool;
    seen.push(...run(s, 1));
  }
  return seen;
};

test('treeBarred: only when the tree has contacts and ALL of them lie inside barriers', () => {
  const { s, tree } = linkedTree();
  quiet(s);
  s.res.sugar = 200;
  assert.equal(treeBarred(s, tree), false, 'no barrier');
  const contact = s.sim.contacts[tree.id][0];
  assert.equal(commandBarrier(s, contact), true);
  assert.equal(treeBarred(s, tree), true, 'its only contact is inside');
  // a second contact outside the ring: not barred
  const p = s.net.nodes[contact];
  const far = addNode(s, p.x + B.barrierRadius + 60, p.y, -1).id;
  s.sim.contacts[tree.id].push(far);
  assert.equal(treeBarred(s, tree), false, 'one contact outside');
  s.sim.contacts[tree.id].length = 0;
  assert.equal(treeBarred(s, tree), false, 'no contacts: not linked, nothing to bar');
  // the other trees (no contacts) are not barred either
  for (const t of s.world.trees) if (t.id !== tree.id) assert.equal(treeBarred(s, t), false);
});

test('economy: a tree whose every contact is inside a barrier pays nothing for as long as it stands, and pays again after', () => {
  const { s, tree } = linkedTree();
  quiet(s);
  s.res.sugar = 200;
  feed(s, 20);
  const paying = s.sim.income;
  assert.ok(paying > saprotrophSugar(s) + 0.05, `the tree pays (${paying} over ${saprotrophSugar(s)})`);
  assert.equal(commandBarrier(s, s.sim.contacts[tree.id][0]), true);
  feed(s, 5);
  assert.ok(Math.abs(s.sim.income - saprotrophSugar(s)) < 1e-6, `income is the saprotroph trickle alone: ${s.sim.income}`);
  assert.equal(s.sim.intake[tree.id].sugar, 0);
  feed(s, B.barrierDur + 2);
  assert.equal(s.barriers.length, 0);
  feed(s, 10);
  assert.ok(s.sim.income > saprotrophSugar(s) + 0.05, 'the tree pays again');
});

test('economy: a frozen tree neither drinks nor grows and its mantle holds while the ring stands; feeding it moves no sugar', () => {
  const { s, tree } = linkedTree();
  quiet(s);
  s.res.sugar = 200;
  feed(s, 20);
  const g0 = tree.growth;
  feed(s, 5);
  assert.ok(tree.growth > g0 || tree.stage === 3, 'it grows while free');
  assert.equal(commandBarrier(s, s.sim.contacts[tree.id][0]), true);
  s.feed = { treeId: tree.id, rate: 0 };
  feed(s, 1);
  const before = { growth: tree.growth, stage: tree.stage, mantle: tree.mantle, health: tree.health };
  for (let i = 0; i < 5; i++) {
    s.res.sugar = s.cap.sugar; // a full pantry: an unfrozen fed tree would take B.feedRate sugar/s
    feed(s, 1);
  }
  assert.ok(s.barriers.length > 0, 'the ring still stands');
  assert.equal(s.sim.intake[tree.id].water, 0, 'it does not drink');
  assert.equal(s.sim.intake[tree.id].minerals, 0);
  assert.deepEqual({ growth: tree.growth, stage: tree.stage, mantle: tree.mantle, health: tree.health }, before, 'growth, mantle and health hold');
  assert.ok(s.feed && s.feed.rate < 1e-3, `no sugar fed into the frozen tree (rate ${s.feed && s.feed.rate})`);
});

test('flows: no flow crosses a barrier, and the edges inside do not thicken while the same edges do without it', () => {
  const widths = (s, ids) => ids.map((id) => edgeInto(s, id).w);
  const play = (withBarrier) => {
    const { s, tree, last } = linkedTree();
    quiet(s);
    s.res.sugar = 200;
    const contact = s.sim.contacts[tree.id][0];
    // the chain's nodes inside the ring that will be put on the contact
    const inside = [];
    const c = s.net.nodes[contact];
    for (const n of s.net.nodes) if (n.alive && n.parent >= 0 && Math.hypot(n.x - c.x, n.y - c.y) < B.barrierRadius - 5) inside.push(n.id);
    if (withBarrier) assert.equal(commandBarrier(s, contact), true);
    const crossings = [];
    for (let i = 0; i < 40; i++) {
      feed(s, 1);
      if (withBarrier) {
        const bar = barredNodes(s);
        for (const f of s.flows) if (f.path.some((id) => bar.has(id))) crossings.push(f);
      }
    }
    return { s, inside, last, crossings, w: widths(s, inside), flows: s.flows.length };
  };
  const free = play(false);
  const held = play(true);
  assert.ok(free.inside.length >= 3, 'a few nodes lie inside the ring');
  assert.ok(Math.max(...free.w) > 1.1, `without the barrier the busy hyphae thicken: ${free.w}`);
  assert.deepEqual(held.w, held.w.map(() => 1), 'inside the ring nothing thickens');
  assert.equal(held.crossings.length, 0, 'no flow crossed the ring');
  assert.ok(free.flows > 0);
});

test('barrierEffects: the trees a barrier on this node would stop paying, and how many nodes freeze', () => {
  const { s, tree } = linkedTree();
  quiet(s);
  const contact = s.sim.contacts[tree.id][0];
  const fx = barrierEffects(s, contact);
  assert.ok(fx.frozen >= 1);
  assert.deepEqual(fx.trees.map((t) => t.id), [tree.id]);
  assert.ok(fx.trees[0].pay > 0);
  // a node far from the contact freezes no tree
  assert.deepEqual(barrierEffects(s, s.net.originId).trees, []);
  // a tree that already stops paying is not listed again, a lost one never
  s.res.sugar = 200;
  commandBarrier(s, contact);
  assert.deepEqual(barrierEffects(s, contact).trees, []);
  tree.lost = true;
  assert.deepEqual(barrierEffects(s, s.net.originId).trees, []);
});

// ---- 2. the raider ---------------------------------------------------------------------------------------------------------

test('raider: stands B.rivalRaidLead s warning, then creeps to the thin hypha, overgrows it, runs towards the spore, and the cut follows B.rivalRaidWither s after the touch', () => {
  const { s, r, ids, tip } = raidScene();
  assert.equal(raiders(s).length, 1);
  assert.equal(tip.target, null);
  const seen = stepR(s, 90);
  const seek = evs(seen, 'rival-raid-seek');
  assert.equal(seek.length, 1, 'one warning');
  assert.ok(seek[0].at < 1, 'at once, from the source');
  const touch = evs(seen, 'rival-raid-touch');
  assert.equal(touch.length, 1);
  assert.ok(touch[0].at > B.rivalRaidLead, `it did not touch during the lead (${touch[0].at})`);
  assert.equal(touch[0].edge, s.sim.parentEdge[ids[13]], 'the nearest thin hypha: the far end of the chain');
  const end = evs(seen, 'rival-raid-end');
  assert.equal(end.length, 1);
  assert.equal(end[0].reason, 'reach');
  assert.equal(raiders(s).length, 0);
  // B.rivalRaidReach edges were overgrown, from the end towards the spore, and each was cut after B.rivalRaidWither s
  const over = r.stats.overgrown;
  assert.equal(over, B.rivalRaidReach);
  const cuts = seen.filter((e) => e.type === 'severed' && e.cause === 'rival');
  assert.equal(cuts.length, B.rivalRaidReach);
  assert.ok(Math.abs(cuts[0].at - touch[0].at - B.rivalRaidWither) < 0.2, `first cut ${cuts[0].at - touch[0].at} s after the touch`);
  const gap = (B.rivalRaidReach - 1) * (16 / B.rivalRaidSpeed);
  assert.ok(Math.abs(cuts[cuts.length - 1].at - touch[0].at - B.rivalRaidWither - gap) < 0.6, 'the last edge (the run took a few s) went later');
  for (let k = 13; k > 13 - B.rivalRaidReach; k--) assert.equal(s.net.nodes[ids[k]].alive, false, `node ${k} is gone`);
  for (let k = 13 - B.rivalRaidReach; k >= 0; k--) assert.equal(s.net.nodes[ids[k]].alive, true, `node ${k} lives`);
  assert.equal(r.over.length, 0);
  assert.equal(r.stats.raidCut, B.rivalRaidReach);
});

test('raider: while an edge withers its entry in rival.over grows to 1 and the black creeps along it (cover)', () => {
  const { s, r } = raidScene();
  let saw = null;
  stepR(s, 60, () => {
    if (r.over.length && !saw) saw = clone(r.over);
  });
  assert.ok(saw && saw.length >= 1);
  assert.deepEqual(Object.keys(saw[0]).sort(), ['born', 'cover', 'edge', 'from', 'wither']);
  const { s: s2, r: r2 } = raidScene();
  const first = [];
  let edge = -1;
  stepR(s2, 60, () => {
    if (edge < 0 && r2.over.length) edge = r2.over[0].edge;
    const o = r2.over.find((q) => q.edge === edge);
    if (o) first.push(o.wither);
  });
  assert.ok(first.length > 100 && first[0] < 0.05 && first[first.length - 1] > 0.95, 'from 0 to 1');
  for (let i = 1; i < first.length; i++) assert.ok(first[i] >= first[i - 1], 'wither never falls');
});

test('raider: a thick cord (w >= B.rivalBlockW) on its way stops the run: the cord is never overgrown, only the thin part is cut', () => {
  const { s, r, ids } = raidScene();
  edgeInto(s, ids[10]).w = B.rivalBlockW;
  const seen = stepR(s, 90);
  assert.equal(evs(seen, 'rival-raid-end')[0].reason, 'cord');
  assert.equal(r.stats.overgrown, 3, 'the edges into nodes 13, 12, 11');
  for (const k of [13, 12, 11]) assert.equal(s.net.nodes[ids[k]].alive, false);
  for (let k = 10; k >= 0; k--) assert.equal(s.net.nodes[ids[k]].alive, true);
  assert.equal(r.stats.raidStopped, 1);
});

test('raider: a thick cord across its way keeps it from reaching the hypha at all (as it keeps rhizomorphs out)', () => {
  const { s, r, x, y, ids } = raidScene();
  const wall = [addNode(s, s.net.nodes[ids[13]].x + 70, y - 40, -1).id];
  for (let k = 1; k <= 10; k++) wall.push(addNode(s, s.net.nodes[ids[13]].x + 70, y - 40 + k * 8, wall[k - 1]).id);
  for (const id of wall.slice(1)) edgeInto(s, id).w = B.rivalBlockW + 0.5;
  const seen = stepR(s, 90);
  assert.equal(evs(seen, 'rival-raid-touch').length, 0, 'never touched');
  assert.equal(r.stats.overgrown, 0);
  for (const id of ids) assert.equal(s.net.nodes[id].alive, true);
});

test('raider: the hyphae within B.biteImmuneDist of the spore are never overgrown (there is nothing to go for)', () => {
  const s = fresh(7);
  const r = quiet(s);
  const { x, y } = corridor(s.world);
  const ids = chain(s, x - 250, y, 3); // child distances 16, 32, 48: all inside the immune stretch
  const tip = spawnRaiderAt(s, x - 100, y, Math.PI);
  const seen = stepR(s, 60);
  assert.equal(r.stats.overgrown, 0);
  assert.equal(evs(seen, 'rival-raid-touch').length, 0);
  for (const id of ids) assert.equal(s.net.nodes[id].alive, true);
  assert.ok(!r.tips.includes(tip), 'it found nothing to go for and gave up');
});

test('raider: a barrier heals the edges it overgrew inside the ring, kills the raider, and nothing is cut', () => {
  const { s, r, ids } = raidScene();
  const seen = [];
  for (let i = 0; i < 90 * 60 && r.over.length < 3; i++) seen.push(...stepR(s, 1 / 60));
  assert.ok(r.over.length >= 3 && raiders(s).length === 1, 'the raider is mid-run with some edges overgrown');
  const before = r.over.length;
  assert.equal(commandBarrier(s, ids[7]), true);
  seen.push(...stepR(s, B.rivalRaidWither + 12));
  assert.equal(r.over.length, 0);
  assert.ok(r.stats.raidHealed >= before, `healed ${r.stats.raidHealed} of ${before}`);
  assert.equal(r.stats.raidCut, 0);
  assert.equal(seen.filter((e) => e.type === 'severed').length, 0);
  assert.equal(raiders(s).length, 0);
  assert.equal(evs(seen, 'rival-raid-end').length, 1);
  for (const id of ids) assert.equal(s.net.nodes[id].alive, true, 'the whole chain stands');
});

test('raider: a barrier over its path while it creeps kills it before it touches anything', () => {
  const { s, r, x, y, ids } = raidScene();
  stepR(s, B.rivalRaidLead + 1);
  const tip = raiders(s)[0];
  const spot = addNode(s, tip.x - 40, y, -1).id;
  assert.equal(commandBarrier(s, spot), true);
  const seen = stepR(s, 5);
  assert.equal(raiders(s).length, 0);
  assert.equal(evs(seen, 'rival-raid-end')[0].reason, 'barrier');
  assert.equal(r.stats.killed, 1);
  assert.equal(r.stats.overgrown, 0);
  for (const id of ids) assert.equal(s.net.nodes[id].alive, true);
});

test('raider: a hypha cut under it (as a worm would) ends the run at once, and overgrown edges beyond the cut are simply gone', () => {
  const { s, r, ids } = raidScene();
  for (let i = 0; i < 90 * 60 && r.over.length < 3; i++) stepR(s, 1 / 60);
  assert.equal(r.over.length, 3);
  cutEdge(s, s.sim.parentEdge[ids[9]]); // the edge the raider runs to next lies beyond the cut? no: it lies ahead (towards the spore)
  const seen = stepR(s, 40);
  assert.equal(raiders(s).length, 0);
  assert.equal(evs(seen, 'rival-raid-end')[0].reason, 'gone');
  assert.ok(r.stats.overgrown <= 4, `it did not go on overgrowing (${r.stats.overgrown})`);
  assert.equal(r.over.length, 0);
  assert.equal(s.net.nodes[ids[8]].alive, true, 'what lies towards the spore is untouched');
});

test('raid spawn: every B.rivalRaidEvery-th timer tip is a raider, at most B.rivalRaidMax live, and none without a thin hypha to go for', () => {
  const play = (withHypha) => {
    const s = fresh(7, 'now');
    if (withHypha) {
      const { x, y } = corridor(s.world);
      chain(s, x - 250, y, 13);
    }
    let maxAlive = 0;
    for (let i = 0; i < 30; i++) {
      run(s, 30);
      maxAlive = Math.max(maxAlive, raiders(s).length);
      s.res.sugar = 100; // (the bot-less economy may starve; nothing to do with the rival)
    }
    return { s, maxAlive };
  };
  const bare = play(false);
  assert.equal(bare.s.rival.stats.raiders, 0, 'with only the hyphae round the spore there is nothing to raid');
  const rich = play(true);
  const r = rich.s.rival;
  assert.ok(r.raidCount >= B.rivalRaidEvery, `${r.raidCount} timer tips`);
  assert.ok(r.stats.raiders >= 1, 'a raider came');
  assert.ok(r.stats.raiders <= Math.floor(r.raidCount / B.rivalRaidEvery));
  assert.ok(rich.maxAlive <= B.rivalRaidMax);
  assert.equal(raiders(createState(7)).length, 0);
});

// ---- 3. saving and determinism ----------------------------------------------------------------------------------------------

const snapshot = (s) => ({
  rival: clone(s.rival),
  alive: s.net.nodes.filter((n) => n.alive).map((n) => n.id),
  widths: s.net.edges.map((e) => e.w),
  barriers: clone(s.barriers),
  sugar: Math.round(s.res.sugar * 1000) / 1000,
});

test('save and load mid-raid: tip.raid and rival.over come back, and the raid goes on identically (the same cuts at the same times)', () => {
  const { s: orig, r } = raidScene();
  let mid = false;
  for (let i = 0; i < 90 * 60 && !mid; i++) {
    run(orig, DT);
    mid = r.over.length >= 3 && raiders(orig).length === 1 && raiders(orig)[0].raid.phase === 'run';
  }
  assert.ok(mid, 'a raider running with three edges overgrown');
  const raid = raiders(orig)[0].raid;
  assert.equal(raid.phase, 'run');
  const copy = decodeState(clone(encodeState(orig)));
  assert.deepEqual(clone(copy.rival), clone(orig.rival), 'the rival (tips with raid, over) is equal');
  assert.equal(raiders(copy)[0].raid.phase, 'run');
  assert.equal(copy.rival.over.length, orig.rival.over.length);
  const a = run(orig, 40);
  const b = run(copy, 40);
  assert.deepEqual(b, a, 'the same events');
  assert.deepEqual(snapshot(copy), snapshot(orig));
  assert.ok(a.some((e) => e.type === 'severed' && e.cause === 'rival'), 'and the cuts came');
});

test('save and load while the raider still seeks: the goal and the standing lead survive', () => {
  const { s: orig } = raidScene();
  run(orig, B.rivalRaidLead / 2);
  const copy = decodeState(clone(encodeState(orig)));
  assert.deepEqual(clone(copy.rival), clone(orig.rival));
  assert.equal(raiders(copy)[0].raid.phase, 'seek');
  assert.deepEqual(run(copy, 30), run(orig, 30));
  assert.deepEqual(snapshot(copy), snapshot(orig));
});

test('an old save without the raid fields (over, raidCount, the raid stats) loads and plays on', () => {
  const s = fresh(7, 'now');
  run(s, 20);
  const payload = clone(encodeState(s));
  delete payload.rival.over;
  delete payload.rival.raidCount;
  for (const k of ['raiders', 'raids', 'overgrown', 'raidCut', 'raidHealed', 'raidStopped']) delete payload.rival.stats[k];
  const old = decodeState(payload);
  assert.doesNotThrow(() => run(old, 10));
  assert.deepEqual(old.rival.over, []);
  assert.equal(typeof old.rival.stats.raidCut, 'number');
});

// ---- 4. balance: the barrier is a choice, not a free answer ----------------------------------------------------------------

function playBar(seed, mode, seconds = 1500) {
  const c = { barriers: 0, froze: 0, grips: 0, raids: 0, closed: 0, denied: 0 };
  const { state } = playBot(seed, {
    gen: 2,
    seasons: true,
    threats: true,
    runOn: true,
    rival: true,
    barrier: mode,
    maxSeconds: seconds,
    onEvent: (ev, s) => {
      if (ev.type === 'barrier-placed') {
        c.barriers++;
        c.froze += s.world.trees.filter((t) => treeBarred(s, t)).length;
      }
      if (ev.type === 'rival-grip') c.grips++;
      if (ev.type === 'grow-denied') c.denied++;
      if (ev.type === 'rival-raid-touch') c.raids++;
      if (ev.type === 'page-closed') c.closed++;
    },
  });
  return { ...c, state, lost: state.world.trees.filter((t) => t.lost).length };
}

test('balance (seeds 23, 7): the grip-mode barrier bot loses nothing and the page stays open, the passive bot loses more, and the barriers froze trees', () => {
  let lostPassive = 0;
  let froze = 0;
  for (const seed of [23, 7]) {
    const grip = playBar(seed, 'grip');
    assert.equal(grip.lost, 0, `seed ${seed}: no tree lost with barriers`);
    assert.equal(grip.closed, 0, `seed ${seed}: the page stays open`);
    assert.ok(grip.barriers >= 1);
    froze += grip.froze;
    const passive = playBar(seed, false);
    lostPassive += passive.lost;
    assert.ok(passive.lost >= grip.lost, `seed ${seed}: passive loses at least as many`);
  }
  assert.ok(lostPassive >= 2, `the passive bot lost ${lostPassive}`);
  assert.ok(froze >= 1, 'a barrier froze a tree at least once: the price is real');
});

// A drag refused at a ring is covered by the unit tests above: since the pages rebalance (bb6141a) the bot dives for the gravel
// only while that goal is pending, so whether one of its drags crosses a ring is luck, not balance.
test('balance: the barrier-spamming bot (near mode) pays for it: trees frozen under its barriers', () => {
  let froze = 0;
  for (const [seed, seconds] of [[26, 1500], [42, 900]]) {
    const near = playBar(seed, 'near', seconds);
    froze += near.froze;
    assert.ok(near.barriers >= 3, `seed ${seed}: the near bot did spam barriers (${near.barriers})`);
  }
  assert.ok(froze >= 1, `trees frozen as the barriers went up: ${froze}`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { addNode } from '../src/sim/network.js';
import { B } from '../src/sim/balance.js';
import { groundYAt, rockAt, targetAt } from '../src/world/query.js';
import { DT, playBot } from './bot.mjs';

const SEEDS = [1, 7, 42, 1234, 99991];

function fresh(seed = 7) {
  const state = createState(seed);
  state.phase = 'playing';
  return state;
}

/** Runs the simulation for `seconds`, returning every event seen. */
function run(state, seconds) {
  const seen = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    sim.updateSim(state, DT);
    state.time += DT;
    seen.push(...state.events);
    state.events.length = 0;
  }
  return seen;
}

/** Straight drag from the origin to a point. */
const drag = (state, x, y, fromId = state.net.originId) => {
  const n = state.net.nodes[fromId];
  return [{ x: (n.x + x) / 2, y: (n.y + y) / 2 }, { x, y }];
};

const evs = (events, type) => events.filter((e) => e.type === type);

test('initial state: origin, ring of hyphae, objectives, starting sugar', () => {
  const s = fresh();
  const origin = s.net.nodes[s.net.originId];
  assert.equal(origin.parent, -1);
  assert.equal(origin.dist, 0);
  assert.equal(s.net.nodes.length, 6);
  assert.equal(s.net.edges.length, 5);
  for (const n of s.net.nodes.slice(1)) {
    assert.equal(n.parent, 0);
    assert.ok(Math.abs(n.dist - B.originRingRadius) < 1e-6);
  }
  assert.equal(s.res.sugar, B.startSugar);
  assert.deepEqual(s.objectives.map((o) => o.id), ['water', 'tree', 'mushroom', 'treeGrow', 'spores']);
  assert.equal(s.net.links.length, 0, 'nothing is linked at the start');
  assert.ok(s.stats.hyphaeLength > 0);
  assert.ok(s.cap.pool > 0 && s.cap.sugar > 0);
});

test('growth is gradual: ~140 u/s, nodes every ~16 u, sugar paid as it goes, events', () => {
  const s = fresh();
  const from = s.net.nodes[1];
  const target = { x: from.x - 320, y: from.y };
  const preview = sim.estimateGrowth(s, 1, [target]);
  assert.equal(preview.blocked, null);
  assert.ok(preview.affordable);
  const before = s.res.sugar;
  assert.ok(sim.commandGrow(s, 1, [target]));
  assert.equal(s.res.sugar, before, 'nothing is paid at command time');
  assert.equal(evs(s.events, 'grow-start').length, 1, 'grow-start is emitted by the command');
  s.events.length = 0;
  assert.equal(s.net.growing.length, 1);
  const version = s.net.version;
  const seen = run(s, 1);
  const h = s.net.growing[0];
  assert.ok(h, 'still growing after 1 s of a ~330 u hypha');
  assert.ok(h.grown > 120 && h.grown < 160, `tip advanced ~140 u in 1 s, got ${h.grown}`);
  assert.ok(s.res.sugar < before, 'sugar is paid while growing');
  assert.ok(s.net.version > version);
  const last = s.net.nodes[h.lastNode];
  assert.ok(last.parent >= 0 && last.dist > 0);
  assert.ok(evs(seen, 'grow-tick').length >= 2);
  run(s, 3);
  assert.equal(s.net.growing.length, 0);
  const total = preview.length;
  const paid = before - s.res.sugar;
  assert.ok(paid > 0 && paid < preview.cost + 8, `paid ${paid} for a preview cost of ${preview.cost}`);
  // spacing of the chain of new nodes
  for (const n of s.net.nodes.slice(6)) {
    const p = s.net.nodes[n.parent];
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    assert.ok(d <= B.nodeSpacing + 0.5, `node spacing ${d}`);
    assert.ok(Math.abs(n.dist - (p.dist + d)) < 1e-6);
  }
  assert.ok(Math.abs(s.stats.hyphaeLength - s.net.edges.reduce((a, e) => a + e.len, 0)) < 1e-6);
  assert.ok(total > 300);
});

test('grow-start and grow-end events come with the command and the finished hypha', () => {
  const s = fresh();
  const n = s.net.nodes[3];
  assert.ok(sim.commandGrow(s, 3, [{ x: n.x, y: n.y + 60 }]));
  assert.equal(evs(s.events, 'grow-start').length, 1);
  s.events.length = 0;
  const seen = run(s, 1);
  assert.equal(evs(seen, 'grow-end').length, 1);
});

test('hyphae cannot grow through rocks or above ground; commands are cut at the first obstacle', () => {
  const s = fresh();
  const from = s.net.nodes[0];
  // a drag straight through the centre of a rock, long enough to pass it (the nearest rock the straight line really reaches)
  const aim = (r) => [{ x: r.x + (r.x - from.x) * 0.5, y: r.y + (r.y - from.y) * 0.5 }];
  const rock = [...s.world.rocks].sort((p, q) => Math.hypot(p.x - from.x, p.y - from.y) - Math.hypot(q.x - from.x, q.y - from.y)).find((r) => {
    const b = sim.estimateGrowth(s, 0, aim(r)).blocked;
    return b && rockAt(s.world, b.x, b.y);
  });
  assert.ok(rock, 'some rock lies on a straight line from the spore');
  const dx = rock.x - from.x;
  const dy = rock.y - from.y;
  const through = aim(rock);
  const preview = sim.estimateGrowth(s, 0, through);
  assert.ok(preview.blocked, 'blocked by a rock');
  assert.ok(rockAt(s.world, preview.blocked.x, preview.blocked.y));
  assert.ok(preview.length < Math.hypot(dx, dy) * 1.5);
  s.res.sugar = s.cap.sugar;
  assert.ok(sim.commandGrow(s, 0, through) || preview.length < B.minGrowLength);
  run(s, 12);
  for (const n of s.net.nodes) assert.equal(rockAt(s.world, n.x, n.y), null, 'no node inside a rock');

  const up = sim.estimateGrowth(s, 0, [{ x: from.x, y: groundYAt(s.world, from.x) - 80 }]);
  assert.ok(up.blocked, 'cannot grow above ground');
  assert.ok(up.points[up.points.length - 1].y >= groundYAt(s.world, from.x) - 1);
  const edge = sim.estimateGrowth(s, 0, [{ x: s.world.width + 400, y: from.y }]);
  assert.ok(edge.blocked, 'cannot grow past the world edge');
  assert.equal(sim.commandGrow(s, 0, [{ x: from.x, y: from.y }]), false, 'zero-length command rejected');
});

test('insufficient sugar: command rejected with an event; sugar running out mid-way stops the hypha', () => {
  const s = fresh();
  const from = s.net.nodes[1];
  s.res.sugar = 2;
  assert.equal(sim.commandGrow(s, 1, [{ x: from.x - 300, y: from.y }]), false);
  assert.equal(evs(s.events, 'insufficient').length, 1);
  s.events.length = 0;
  assert.equal(sim.estimateGrowth(s, 1, [{ x: from.x - 300, y: from.y }]).affordable, false);

  s.res.sugar = 60;
  assert.ok(sim.commandGrow(s, 1, [{ x: from.x - 300, y: from.y }]));
  run(s, 0.5);
  s.res.sugar = 0.5; // drained by something else
  const seen = run(s, 1);
  assert.equal(s.net.growing.length, 0, 'hypha stopped');
  assert.equal(evs(seen, 'insufficient').length, 1);
  assert.equal(evs(seen, 'grow-end').length, 1);
  assert.ok(s.res.sugar >= 0);
});

test('several hyphae grow at once and may start from any node', () => {
  const s = fresh();
  s.res.sugar = 100;
  for (const id of [1, 2, 3]) {
    const n = s.net.nodes[id];
    assert.ok(sim.commandGrow(s, id, [{ x: n.x + (id - 2) * 60, y: n.y + 70 }]));
  }
  assert.equal(s.net.growing.length, 3);
  run(s, 3);
  assert.equal(s.net.growing.length, 0);
  assert.ok(s.net.nodes.length > 12);
});

test('pickNode finds the nearest alive node', () => {
  const s = fresh();
  const n = s.net.nodes[2];
  assert.equal(sim.pickNode(s, n.x + 3, n.y - 2), 2);
  assert.equal(sim.pickNode(s, n.x + 400, n.y + 400), null);
});

test('links: water pocket, mineral deposit and tree tip create links once per node and target', () => {
  const s = fresh();
  const w = s.world.water[0];
  const m = s.world.minerals[0];
  const t = s.world.trees.find((x) => x.tips.some((p) => p.minStage <= x.stage));
  const tip = t.tips.find((p) => p.minStage <= t.stage);
  const nodeA = addNode(s, w.x, w.y, 0);
  const nodeB = addNode(s, w.x + 5, w.y, nodeA.id);
  addNode(s, m.x, m.y, 0);
  addNode(s, tip.x + 4, tip.y - 3, 0);
  const links = s.net.links;
  assert.equal(links.filter((l) => l.kind === 'water' && l.targetId === w.id).length, 2);
  assert.equal(links.filter((l) => l.kind === 'mineral' && l.targetId === m.id).length, 1);
  assert.equal(links.filter((l) => l.kind === 'tree' && l.targetId === t.id).length, 1);
  assert.equal(new Set(links.map((l) => `${l.nodeId}:${l.kind}:${l.targetId}`)).size, links.length);
  assert.ok(t.linked);
  assert.ok(nodeB.id > nodeA.id);
  const kinds = evs(s.events, 'link').map((e) => e.kind);
  assert.ok(kinds.includes('water') && kinds.includes('mineral') && kinds.includes('tree'));
  // a second node in the same tip radius does not make a second tree link for that tip
  addNode(s, tip.x + 6, tip.y, 0);
  assert.equal(links.filter((l) => l.kind === 'tree' && l.targetId === t.id).length, 1);
  // an inactive tip (minStage above the tree stage) does not link
  const other = s.world.trees.find((x) => x !== t && x.tips.some((p) => p.minStage > x.stage));
  const late = other.tips.find((p) => p.minStage > other.stage);
  addNode(s, late.x, late.y, 0);
  assert.equal(links.filter((l) => l.kind === 'tree' && l.targetId === other.id).length, 0);
});

test('extraction fills the pool, depletes mineral deposits (deposit-empty once), stops when the pool is full', () => {
  const s = fresh();
  const m = s.world.minerals[0];
  m.amount = 5;
  addNode(s, m.x, m.y, 0);
  s.events.length = 0;
  const seen = run(s, 20);
  assert.ok(Math.abs(s.res.minerals - 5) < 1e-6, `all 5 units extracted, got ${s.res.minerals}`);
  assert.equal(m.amount, 0);
  const empties = evs(seen, 'deposit-empty');
  assert.equal(empties.length, 1);
  assert.deepEqual([empties[0].kind, empties[0].id], ['mineral', m.id]);

  // pool capacity: water stops at cap.pool and the pocket keeps its water
  const s2 = fresh();
  const w = s2.world.water[0];
  addNode(s2, w.x, w.y, 0);
  run(s2, 90);
  assert.ok(s2.res.water <= s2.cap.pool + 1e-9);
  assert.ok(Math.abs(s2.res.water - s2.cap.pool) < 1e-6, 'pool filled');
  assert.ok(w.amount > 0);
});

test('water pockets regenerate slowly', () => {
  const s = fresh();
  const w = s.world.water[0];
  w.amount = 10;
  run(s, 10);
  assert.ok(Math.abs(w.amount - (10 + w.regen * 10)) < 0.05);
  w.amount = w.max;
  run(s, 5);
  assert.equal(w.amount, w.max, 'capped at max');
});

test('a drained pocket signals once and stays near empty while linked', () => {
  const s = fresh();
  const w = s.world.water[0];
  w.amount = 3;
  for (let i = 0; i < 4; i++) addNode(s, w.x + i * 3, w.y, 0);
  let seen = run(s, 5);
  assert.equal(evs(seen, 'deposit-empty').length, 1);
  assert.ok(w.amount < 1, 'kept near empty while links extract everything that regrows');
});

test('tree exchange: linked trees take water and minerals and pay sugar; health follows satisfaction', () => {
  const s = fresh();
  const t = s.world.trees[1];
  const tip = t.tips.find((p) => p.minStage <= t.stage);
  addNode(s, tip.x, tip.y, 0);
  s.res.sugar = 20;
  s.res.water = 30;
  s.res.minerals = 15;
  const sugar0 = s.res.sugar;
  run(s, 30);
  assert.ok(s.res.water < 30 && s.res.minerals < 15, 'resources are drawn');
  assert.ok(s.res.sugar > sugar0, 'sugar is paid');
  assert.ok(t.health > 0.9, `health ${t.health}`);
  // starving trees lose health and stop paying
  const s2 = fresh();
  const t2 = s2.world.trees[1];
  const tip2 = t2.tips.find((p) => p.minStage <= t2.stage);
  addNode(s2, tip2.x, tip2.y, 0);
  run(s2, 60);
  assert.ok(t2.health < 0.2, `unfed health ${t2.health}`);
});

test('a well-fed tree grows to the next stage, opens new tips and re-checks existing nodes', () => {
  const s = fresh([7, 1, 2, 3, 4, 5, 6, 8].find((n) => createState(n).world.trees.some((x) => x.stage === 0)));
  const t = s.world.trees.find((x) => x.stage === 0); // a sapling
  const early = t.tips.find((p) => p.minStage <= t.stage);
  const later = t.tips.find((p) => p.minStage === 1);
  assert.ok(early && later);
  addNode(s, early.x, early.y, 0);
  const waiting = addNode(s, later.x, later.y, 0); // not a contact yet
  assert.ok(!s.net.links.some((l) => l.nodeId === waiting.id));
  t.health = 1;
  t.growth = 0.999;
  s.res.water = s.cap.pool;
  s.res.minerals = s.cap.pool;
  const seen = run(s, 10);
  const stageEv = evs(seen, 'tree-stage');
  assert.equal(stageEv.length, 1);
  assert.equal(stageEv[0].treeId, t.id);
  assert.equal(stageEv[0].stage, 1);
  assert.equal(t.stage, 1);
  assert.ok(t.growth < 0.1);
  assert.ok(s.net.links.some((l) => l.nodeId === waiting.id && l.kind === 'tree'), 'new tip touches the existing node');
  assert.ok(s.objectives.find((o) => o.id === 'treeGrow').done);
});

test('stage-ups raise demand and payout', () => {
  for (let i = 1; i < 4; i++) {
    assert.ok(B.treeDemandWater[i] > B.treeDemandWater[i - 1]);
    assert.ok(B.treeDemandMinerals[i] > B.treeDemandMinerals[i - 1]);
    assert.ok(B.treePay[i] > B.treePay[i - 1]);
  }
});

test('upkeep drains sugar; the saprotrophic trickle keeps a lone spore from soft-locking', () => {
  const s = fresh();
  s.res.sugar = 0;
  run(s, 60);
  assert.ok(s.res.sugar > 5, `sugar recovers without allies, got ${s.res.sugar}`);
  // a huge network cannot push the stock to a permanent zero either
  const s2 = fresh();
  let prev = 0;
  for (let i = 0; i < 400; i++) prev = addNode(s2, s2.net.nodes[prev].x + (i % 2 ? 5 : -5), s2.net.nodes[prev].y, prev).id;
  s2.net.nodes.forEach((n) => (n.y = Math.min(Math.max(n.y, groundYAt(s2.world, n.x) + 10), groundYAt(s2.world, n.x) + 60)));
  s2.stats.hyphaeLength = 50000; // pretend the network is enormous
  s2.res.sugar = 0;
  run(s2, 120);
  assert.ok(s2.res.sugar > 0.5, `no permanent zero, got ${s2.res.sugar}`);
  // upkeep applies when stocks are healthy
  const s3 = fresh();
  s3.stats.hyphaeLength = 4000;
  s3.res.sugar = 80;
  const r0 = s3.res.sugar;
  run(s3, 10);
  assert.ok(s3.res.sugar < r0, 'a big network costs more than a lone spore yields');
});

test('mushrooms: fruiting rules, denial events, growth, maturity, spores', () => {
  const s = fresh();
  const origin = s.net.nodes[0];
  assert.equal(sim.canFruit(s, 0), false, 'the origin is too deep');
  assert.equal(sim.commandFruit(s, 0), false);
  assert.deepEqual(evs(s.events, 'fruit-denied').map((e) => e.reason), ['deep']);
  s.events.length = 0;

  const x = origin.x + 120;
  const shallow = addNode(s, x, groundYAt(s.world, x) + 20, 0);
  assert.ok(sim.canFruit(s, shallow.id));
  const sugar = s.res.sugar;
  assert.ok(sim.commandFruit(s, shallow.id));
  assert.equal(s.res.sugar, sugar - B.mushroomCost);
  const m = s.mushrooms[0];
  assert.equal(m.species, 'common');
  assert.ok(Number.isInteger(m.variant));
  assert.equal(m.nodeId, shallow.id);
  assert.ok(Math.abs(m.baseY - groundYAt(s.world, x)) < 1e-9);
  assert.equal(evs(s.events, 'mushroom-planted').length, 1);
  s.events.length = 0;

  const near = addNode(s, x + 30, groundYAt(s.world, x + 30) + 15, shallow.id);
  assert.equal(sim.canFruit(s, near.id), false, 'crowded');
  sim.commandFruit(s, near.id);
  assert.deepEqual(evs(s.events, 'fruit-denied').map((e) => e.reason), ['crowded']);
  s.events.length = 0;

  const far = addNode(s, x - 240, groundYAt(s.world, x - 240) + 15, 0);
  s.res.sugar = 5;
  assert.equal(sim.canFruit(s, far.id), false);
  sim.commandFruit(s, far.id);
  const denied = s.events.filter((e) => e.type === 'fruit-denied');
  assert.deepEqual(denied.map((e) => e.reason), ['sugar']);
  assert.ok(evs(s.events, 'insufficient').length >= 1);
  s.events.length = 0;

  // growth: slow when unfed, faster when fed
  s.res.sugar = 100;
  s.res.water = s.cap.pool;
  s.res.minerals = s.cap.pool;
  const seen = run(s, B.mushroomGrowSeconds + 2);
  assert.ok(m.mature);
  assert.equal(evs(seen, 'mushroom-mature').length, 1);
  const spores = s.res.spores;
  const seen2 = run(s, 30);
  assert.ok(s.res.spores > spores);
  assert.ok(Math.abs(m.spores - s.res.spores) < 1e-9);
  const bursts = evs(seen2, 'spores');
  assert.ok(bursts.length >= 5 && bursts.every((e) => e.amount > 0 && e.id === m.id && e.y < m.baseY));
  assert.ok(Math.abs(bursts.reduce((a, e) => a + e.amount, 0) - (s.res.spores - spores)) < B.sporeRate * 2 * B.sporeEventEvery + 1e-6);

  const unfed = fresh();
  const ux = unfed.net.nodes[0].x + 120;
  const un = addNode(unfed, ux, groundYAt(unfed.world, ux) + 20, 0);
  sim.commandFruit(unfed, un.id);
  run(unfed, B.mushroomGrowSeconds + 2);
  assert.ok(!unfed.mushrooms[0].mature, 'an unfed network fruits more slowly');
  run(unfed, 40);
  assert.ok(unfed.mushrooms[0].mature);
});

test('sporulation is faster when the network is fed', () => {
  const rate = (fed) => {
    const s = fresh();
    const x = s.net.nodes[0].x + 120;
    const n = addNode(s, x, groundYAt(s.world, x) + 20, 0);
    sim.commandFruit(s, n.id);
    s.mushrooms[0].mature = true;
    s.mushrooms[0].growth = 1;
    if (fed) {
      s.res.water = s.cap.pool;
      s.res.minerals = s.cap.pool;
    }
    run(s, 20);
    return s.res.spores;
  };
  assert.ok(rate(true) > rate(false) * 1.5);
});

test('flows: valid connected paths from sources to sinks; busy edges thicken and bump net.version', () => {
  const r = playBot(7, { maxSeconds: 150, runOn: true });
  const s = r.state;
  assert.ok(s.flows.length > 0, 'something flows');
  const kinds = new Set(s.flows.map((f) => f.kind));
  assert.ok(kinds.has('water') && kinds.has('sugar'));
  for (const f of s.flows) {
    assert.ok(f.rate > 0);
    assert.equal(f.path[0], f.from);
    assert.equal(f.path[f.path.length - 1], f.to);
    for (let i = 1; i < f.path.length; i++) {
      const a = s.net.nodes[f.path[i - 1]];
      const b = s.net.nodes[f.path[i]];
      assert.ok(a.parent === b.id || b.parent === a.id, `path step ${a.id}->${b.id} is a network edge`);
    }
    // path goes up to a common ancestor and then down (no repeated nodes)
    assert.equal(new Set(f.path).size, f.path.length);
  }
  const thick = s.net.edges.filter((e) => e.w > 1.2);
  assert.ok(thick.length > 0, 'busy cords thicken');
  assert.ok(s.net.edges.every((e) => e.w >= 1 && e.w <= B.edgeMaxW));
  const v = s.net.version;
  run(s, 60);
  assert.ok(s.net.version >= v);
  // water flows start at a water link node
  for (const f of s.flows.filter((f) => f.kind === 'water')) {
    assert.ok(s.net.links.some((l) => l.kind === 'water' && l.nodeId === f.from));
  }
});

test('objectives complete once, emit events, and the game continues', () => {
  const s = fresh();
  const w = s.world.water[0];
  const seen = [];
  addNode(s, w.x, w.y, 0);
  seen.push(...run(s, 0.1));
  assert.ok(s.objectives[0].done);
  assert.equal(evs(seen, 'objective').filter((e) => e.id === 'water').length, 1);
  seen.push(...run(s, 5));
  assert.equal(evs(seen, 'objective').filter((e) => e.id === 'water').length, 1, 'only once');
  assert.ok(!s.flags.allObjectivesDone);
  for (const o of s.objectives) o.done = true;
  s.flags.allObjectivesDone = false;
  s.res.spores = 500;
  s.objectives[4].done = false;
  seen.push(...run(s, 0.1));
  assert.equal(evs(seen, 'all-objectives').length, 1);
  assert.ok(s.flags.allObjectivesDone);
  seen.push(...run(s, 2));
  assert.equal(evs(seen, 'all-objectives').length, 1);
});

test('rates are smoothed per-second net changes; stats stay current', () => {
  const s = fresh();
  run(s, 20);
  assert.ok(s.rates.sugar > 0 && s.rates.sugar < 1.5, `sugar rate ${s.rates.sugar}`);
  const w = s.world.water[0];
  addNode(s, w.x, w.y, 0);
  run(s, 8);
  assert.ok(s.rates.water > 1);
  assert.ok(s.stats.maxDepth > 0);
  const deepest = Math.max(...s.net.nodes.map((n) => n.y - groundYAt(s.world, n.x)));
  assert.ok(Math.abs(s.stats.maxDepth - deepest) < 1e-9);
});

test('hover targets: what is under the pointer', () => {
  const s = fresh();
  const w = s.world.water[0];
  const m = s.world.minerals[0];
  const rock = s.world.rocks[0];
  const t = s.world.trees[0];
  assert.deepEqual(targetAt(s.world, s.mushrooms, w.x, w.y), { kind: 'water', id: w.id });
  assert.deepEqual(targetAt(s.world, s.mushrooms, m.x, m.y), { kind: 'mineral', id: m.id });
  assert.deepEqual(targetAt(s.world, s.mushrooms, rock.x, rock.y), { kind: 'rock', id: rock.id });
  assert.deepEqual(targetAt(s.world, s.mushrooms, t.x, t.baseY - 100), { kind: 'tree', id: t.id });
  assert.equal(targetAt(s.world, s.mushrooms, 5, 40), null, 'open sky');
  const o = s.world.origin;
  assert.equal(targetAt(s.world, s.mushrooms, o.x, o.y).kind, 'horizon');
  const x = o.x + 120;
  const n = addNode(s, x, groundYAt(s.world, x) + 20, 0);
  sim.commandFruit(s, n.id);
  assert.deepEqual(targetAt(s.world, s.mushrooms, x, groundYAt(s.world, x) - 20), { kind: 'mushroom', id: 0 });
});

test('pickFruitNode prefers a node that can fruit', () => {
  const s = fresh();
  const x = s.net.nodes[0].x + 100;
  const n = addNode(s, x, groundYAt(s.world, x) + 25, 0);
  assert.equal(sim.pickFruitNode(s, x, groundYAt(s.world, x) - 10), n.id);
  assert.equal(sim.pickFruitNode(s, 5, 5), null);
});

test('determinism: the same seed and commands give identical states', () => {
  const a = playBot(7, { maxSeconds: 90, runOn: true }).state;
  const b = playBot(7, { maxSeconds: 90, runOn: true }).state;
  const plain = (st) => ({ ...st, sim: { ...st.sim, rng: st.sim.rng.next() }, world: undefined }); // rng holds closures
  assert.deepEqual(plain(a), plain(b));
  assert.deepEqual(a.world, b.world);
  const c = playBot(8, { maxSeconds: 90, runOn: true }).state;
  assert.notDeepEqual(a.net.nodes, c.net.nodes);
});

test('performance: one step with ~3000 nodes is well under 1 ms', () => {
  const s = fresh(42);
  const w = s.world;
  // a dense random-walk mesh of passable nodes below the ground
  let id = 0;
  let x = s.net.nodes[0].x;
  let y = s.net.nodes[0].y;
  let k = 0;
  while (s.net.nodes.length < 3000 && k++ < 40000) {
    const nx = Math.min(Math.max(x + ((k * 37) % 21) - 10, 10), w.width - 10);
    const ny = Math.min(Math.max(y + ((k * 53) % 21) - 10, groundYAt(w, nx) + 30), groundYAt(w, nx) + 120);
    if (rockAt(w, nx, ny)) continue;
    id = addNode(s, nx, ny, k % 7 === 0 ? 0 : id).id;
    x = nx;
    y = ny;
  }
  assert.ok(s.net.nodes.length >= 3000);
  const t = s.world.trees[1];
  addNode(s, t.tips[0].x, t.tips[0].y, 0);
  s.res.sugar = 100;
  s.net.nodes[10].alive = true;
  run(s, 2); // warm up
  const start = performance.now();
  const steps = 600;
  for (let i = 0; i < steps; i++) {
    sim.updateSim(s, DT);
    s.time += DT;
    s.events.length = 0;
  }
  const ms = (performance.now() - start) / steps;
  console.log(`# step with ${s.net.nodes.length} nodes: ${ms.toFixed(4)} ms`);
  assert.ok(ms < 1, `step took ${ms} ms`);
});

for (const seed of SEEDS) {
  test(`bot playthrough, seed ${seed}: all objectives within 15 game minutes, sugar never stuck at zero`, () => {
    const { state, completedAt, stats } = playBot(seed, { maxSeconds: 1200 });
    const mins = completedAt === null ? 'never' : `${(completedAt / 60).toFixed(1)} min`;
    const done = Object.entries(stats.doneAt).map(([k, v]) => `${k}@${v.toFixed(0)}s`).join(' ');
    console.log(`# seed ${seed}: completed at ${mins} (${completedAt?.toFixed(0)} s); ${done}; max zero-sugar streak ${stats.maxZeroStreak.toFixed(1)} s`);
    assert.notEqual(completedAt, null, 'all objectives completed');
    assert.ok(completedAt >= 240, 'not trivial');
    assert.ok(completedAt <= 900, `took ${completedAt} s`);
    assert.ok(state.flags.allObjectivesDone);
    assert.ok(state.objectives.every((o) => o.done));
    assert.ok(stats.maxZeroStreak < 15, `sugar stuck at zero for ${stats.maxZeroStreak} s`);
    assert.equal(stats.rejected, 0);
  });
}

test('opening is affordable on every tested seed: the starting sugar reaches water and a root tip', () => {
  for (const seed of [...SEEDS, 2, 3, 5, 11, 100, 2024]) {
    const { state, stats } = playBot(seed, { maxSeconds: 20, runOn: true });
    const { world } = state;
    const o = world.origin;
    const nearestWater = Math.min(...world.water.map((w) => Math.hypot(w.x - o.x, w.y - o.y)));
    const nearestTip = Math.min(
      ...world.trees.flatMap((t) => t.tips.filter((p) => p.minStage <= t.stage).map((p) => Math.hypot(p.x - o.x, p.y - o.y))),
    );
    assert.ok(nearestWater < 340, `seed ${seed}: water ${nearestWater}`);
    assert.ok(nearestTip < 300, `seed ${seed}: tip ${nearestTip}`);
    assert.ok(stats.doneAt.water < 15 && stats.doneAt.tree < 20, `seed ${seed}: water@${stats.doneAt.water} tree@${stats.doneAt.tree}`);
    assert.ok(stats.minSugar > 0, `seed ${seed}: opening never ran dry`);
  }
});

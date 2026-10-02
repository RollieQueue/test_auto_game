// Threats (state.flags.threats): nematodes, bites and cut-off branches, «ловчие кольца», starvation dieback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { addNode, nearestNode } from '../src/sim/network.js';
import { B } from '../src/sim/balance.js';
import { biteSecondsFor, cutEdge, spawnWormAt, stepThreats, biteEdge } from '../src/sim/threats.js';
import { groundYAt, horizonIndexAt, isPassable } from '../src/world/query.js';
import { encodeState, decodeState } from '../src/persist-codec.js';

const DT = 1 / 60;
const evs = (events, type) => events.filter((e) => e.type === type);

/** A fresh game with threats on; every edge made so far counts as old enough to bite. */
function fresh(seed = 7) {
  const s = createState(seed);
  s.phase = 'playing';
  s.flags.threats = true;
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

/** Adds nodes every 16 u from node `from` towards (x, y); returns their ids (the last one is at the target). */
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

/** The starting network plus a straight thin hypha of `n` nodes from the spore, to the right in a clear corridor. */
function arena(seed = 7, n = 14) {
  const s = fresh(seed);
  const o = s.net.nodes[s.net.originId];
  const ids = branch(s, s.net.originId, o.x + 16 * n, o.y);
  s.time = 100; // all edges are old
  return { s, ids, o };
}

/** A worm that does not wander off before the test looks (it stands still until it finds something to bite). */
function worm(s, x, y, extra = {}) {
  const w = spawnWormAt(s, x, y);
  s.events.length = 0;
  w.base = 0.001;
  w.life = 1e6;
  w.grazer = true;
  Object.assign(w, extra);
  return w;
}

/** A worm that has long since caught the scent (`worm-sense` came and the lead B.biteLead is over): it bites as soon as it is at a hypha. */
function warned(s, x, y, extra = {}) {
  return worm(s, x, y, { sensed: true, senseAge: -1e6, ...extra });
}

/** True when the straight way from (x0, y0) to (x1, y1) touches no pocket, deposit or root tip (nothing that would link). */
function clearOfDeposits(s, x0, y0, x1, y1) {
  const { world } = s;
  for (let k = 0; k <= 20; k++) {
    const x = x0 + ((x1 - x0) * k) / 20;
    const y = y0 + ((y1 - y0) * k) / 20;
    if (world.water.some((w) => ((x - w.x) / (w.rx + 14)) ** 2 + ((y - w.y) / (w.ry + 14)) ** 2 <= 1)) return false;
    if (world.minerals.some((m) => Math.hypot(x - m.x, y - m.y) <= m.r + 14)) return false;
    if (world.trees.some((t) => t.tips.some((p) => Math.hypot(x - p.x, y - p.y) <= B.tipLinkRadius + 14))) return false;
    if (!isPassable(world, x, y)) return false;
  }
  return true;
}

/** Everything a cut must keep true. */
function assertConsistent(s) {
  const { net } = s;
  let length = 0;
  for (const n of net.nodes) {
    if (!n.alive) continue;
    if (n.parent >= 0) {
      assert.ok(net.nodes[n.parent].alive, `alive node ${n.id} has a dead parent`);
      assert.ok(net.edges[s.sim.parentEdge[n.id]].alive, `alive node ${n.id} has a dead edge`);
    }
  }
  for (const e of net.edges) {
    assert.equal(e.alive, net.nodes[e.b].alive, `edge ${e.id} follows its child node`);
    if (e.alive) length += e.len;
  }
  assert.ok(Math.abs(s.stats.hyphaeLength - length) < 1e-6, 'hyphaeLength is the sum of the living edges');
  for (const l of net.links) assert.ok(net.nodes[l.nodeId].alive, 'no link on a dead node');
  for (const list of [...s.sim.waterLinks, ...s.sim.mineralLinks, ...s.sim.contacts]) for (const id of list) assert.ok(net.nodes[id].alive);
  for (const f of s.flows) for (const id of f.path) assert.ok(net.nodes[id].alive, 'flows run over living nodes');
  for (const m of s.mushrooms) assert.ok(net.nodes[m.nodeId].alive, 'no mushroom on a dead node');
  for (const t of s.traps) assert.ok(net.nodes[t.nodeId].alive, 'no ring on a dead node');
  for (const h of net.growing) assert.ok(net.nodes[h.lastNode].alive && net.nodes[h.from].alive, 'no hypha grows from a dead node');
  s.world.trees.forEach((t) => assert.equal(t.linked, s.sim.contacts[t.id].length > 0));
  // every living node is still found by the spatial grid, dead ones are not
  for (const n of net.nodes) {
    const found = nearestNode(s, n.x, n.y, 1);
    if (n.alive) assert.notEqual(found, null);
  }
}

test('the start is unchanged: no worms or rings without the flag, the new state fields exist', () => {
  const s = createState(7);
  s.phase = 'playing';
  assert.deepEqual(s.fauna, []);
  assert.deepEqual(s.traps, []);
  assert.equal(s.chapter, 1);
  const o = s.net.nodes[0];
  branch(s, 0, o.x + 400, o.y);
  const seen = run(s, 400);
  assert.deepEqual(s.fauna, []);
  for (const t of ['worm-spawn', 'bite', 'severed', 'worm-caught', 'trap-placed', 'chapter']) assert.equal(evs(seen, t).length, 0, t);
  assert.equal(sim.commandTrap(s, 1), false, 'no rings without the flag');
  assert.equal(sim.trapDenial(s, 1), 'off');
  assert.deepEqual(s.events, [], 'and no denial event either');
});

test('worms wait out the grace period and a small network, then spawn on moist ground away from the hyphae', () => {
  const s = fresh();
  const o = s.net.nodes[0];
  const seen = run(s, B.wormGrace + 60);
  assert.equal(evs(seen, 'worm-spawn').length, 0, 'a lone spore draws no worms');
  branch(s, 0, o.x + 480, o.y); // ~480 u of hyphae
  s.time += 0; // edges are young: they cannot be bitten yet, which keeps this test about spawning only
  const spawned = [];
  for (let i = 0; i < 90; i++) {
    for (const e of evs(run(s, 1), 'worm-spawn')) spawned.push(e);
  }
  assert.ok(spawned.length >= 1, 'a worm comes once the network is long enough');
  assert.ok(s.fauna.length <= 1 + Math.floor(s.stats.hyphaeLength / B.wormPerLength), 'the number of worms is capped');
  for (const e of spawned) {
    const h = horizonIndexAt(s.world, e.x, e.y);
    assert.ok(h === 1 || h === 2, `spawned in humus or loam, not horizon ${h}`);
    const depth = e.y - groundYAt(s.world, e.x);
    assert.ok(depth >= B.wormDepthMin && depth <= B.wormDepthMax + 40, `depth ${depth}`);
    assert.ok(isPassable(s.world, e.x, e.y));
  }
});

test('worms wander slowly, stay in passable soil and in their depth band, and head for thin hyphae', () => {
  const { s, o, ids } = arena();
  const w = spawnWormAt(s, o.x + 90, o.y + 110);
  w.life = 1e6;
  w.grazer = true;
  let moved = 0;
  let last = { x: w.x, y: w.y };
  let nearest = Infinity;
  for (let i = 0; i < 60; i++) {
    run(s, 1);
    assert.ok(s.fauna.includes(w) || w.mode === 'leave', 'it stays');
    assert.ok(isPassable(s.world, w.x, w.y), `worm at ${w.x}, ${w.y} is in rock or air`);
    assert.ok(w.y - groundYAt(s.world, w.x) >= 16);
    assert.ok(w.speed <= B.wormSpeed[1] + 1e-9, `speed ${w.speed}`);
    moved += Math.hypot(w.x - last.x, w.y - last.y);
    last = { x: w.x, y: w.y };
    for (const id of ids) nearest = Math.min(nearest, Math.hypot(s.net.nodes[id].x - w.x, s.net.nodes[id].y - w.y));
  }
  assert.ok(moved > 150 && moved < 60 * B.wormSpeed[1], `it crawled ${moved} u in a minute`);
  assert.ok(nearest < 40, `it found the thin hypha (closest ${nearest.toFixed(1)} u)`);
});

test('a worm bites a thin hypha, chews for biteSeconds, and the branch beyond the cut dies', () => {
  const { s, ids } = arena();
  const target = s.net.nodes[ids[7]];
  const w = warned(s, target.x, target.y + 2);
  const before = s.stats.hyphaeLength;
  const first = run(s, 0.5);
  const bite = evs(first, 'bite')[0];
  assert.ok(bite, 'it starts chewing at once');
  assert.equal(w.mode, 'bite');
  assert.ok(w.bite.t > 0 && w.bite.dur === biteSecondsFor(s) && w.bite.dur === B.biteSecondsByChapter[0]);
  assert.equal(evs(first, 'severed').length, 0, 'not cut yet');
  assert.equal(evs(run(s, biteSecondsFor(s) - 1), 'severed').length, 0, 'still chewing');
  const seen = run(s, 1.5);
  const cut = evs(seen, 'severed')[0];
  assert.ok(cut, 'cut');
  assert.equal(cut.cause, 'worm');
  assert.ok(cut.nodes >= 1 && cut.lost > 0 && cut.edges.length === cut.nodes);
  assert.equal(s.net.edges[cut.cut].alive, false);
  // everything beyond the cut edge is dead, everything before it lives
  const lastAlive = ids.filter((id) => s.net.nodes[id].alive);
  const lastDead = ids.filter((id) => !s.net.nodes[id].alive);
  assert.ok(lastAlive.length >= 3 && lastDead.length >= 1);
  assert.ok(Math.max(...lastAlive) < Math.min(...lastDead), 'the dead part is the far part');
  assert.equal(lastDead.length, ids[ids.length - 1] - Math.min(...lastDead) + 1);
  assert.ok(s.stats.hyphaeLength < before);
  assert.ok(s.net.nodes[ids[2]].alive, 'the stretch next to the spore is never touched');
  assert.equal(cut.edges[0], cut.cut, 'dead edges come nearest to the cut first');
  assertConsistent(s);
  assert.equal(w.bites, 1);
  assert.ok(w.full > 0, 'it is full for a while');
});

test('only thin hyphae are bitten: busy cords, the stretch near the spore and brand-new hyphae are safe', () => {
  const { s, ids } = arena();
  for (const id of ids) s.net.edges[s.sim.parentEdge[id]].w = B.biteMaxW + 0.2;
  const mid = s.net.nodes[ids[7]];
  const w = warned(s, mid.x, mid.y + 2);
  const seen = run(s, 30);
  assert.equal(evs(seen, 'bite').length, 0, 'a thick cord is left alone');
  assert.equal(w.bites, 0);
  assertConsistent(s);
  // a thin edge but near the spore
  const t = fresh();
  const o = t.net.nodes[0];
  const [a] = branch(t, 0, o.x + 16, o.y);
  t.time = 100;
  assert.equal(biteEdge(t, t.net.nodes[a]), null, 'immune near the spore');
  // a thin edge, far, but new
  const u = fresh();
  const ids2 = branch(u, 0, u.net.nodes[0].x + 160, u.net.nodes[0].y);
  assert.equal(biteEdge(u, u.net.nodes[ids2[8]]), null, 'too young');
  u.time = B.biteMinAge + 1;
  assert.ok(biteEdge(u, u.net.nodes[ids2[8]]), 'old enough now and thin');
});

test('only grazing worms smell hyphae: one that catches the scent says so once, the others wander on', () => {
  const { s, ids } = arena();
  const t = s.net.nodes[ids[8]];
  const w = worm(s, t.x + 70, t.y + 60, { base: 17, bites: 0 });
  w.full = 0;
  const seen = run(s, 4);
  const sense = evs(seen, 'worm-sense');
  assert.equal(sense.length, 1, 'once');
  assert.equal(sense[0].id, w.id);
  assert.ok(Number.isFinite(sense[0].tx) && Number.isFinite(sense[0].ty));
  const v = worm(s, t.x + 70, t.y - 60, { grazer: false, base: 17 });
  const quiet = run(s, 20);
  assert.equal(evs(quiet, 'worm-sense').filter((e) => e.id === v.id).length, 0);
  assert.equal(v.bites, 0);
  assert.equal(v.mode === 'bite', false);
});

test('a hypha that thickens while it is being chewed is let go', () => {
  const { s, ids } = arena();
  const target = s.net.nodes[ids[7]];
  const w = warned(s, target.x, target.y + 2);
  run(s, 1);
  assert.equal(w.mode, 'bite');
  s.net.edges[w.bite.edge].w = B.biteMaxW + 0.5;
  const seen = run(s, biteSecondsFor(s) + 1);
  assert.equal(evs(seen, 'severed').length, 0);
  assert.equal(evs(seen, 'bite-abort').length, 1);
  assert.equal(s.net.edges[s.sim.parentEdge[ids[7]]].alive, true);
});

test('a cut takes links, mushrooms, rings and growing tips of the branch with it, frees the root tip, and flows stay valid', () => {
  const s = fresh();
  s.time = 100;
  const { world, net } = s;
  const water = world.water[0];
  const tree = world.trees[0];
  const tip = tree.tips.find((t) => t.minStage <= tree.stage);
  const o = net.nodes[0];
  // trunk from the spore: first to the tree tip, a side branch to the water pocket, one up to the surface for a mushroom
  const toTip = branch(s, 0, tip.x, tip.y);
  const toWater = branch(s, toTip[2], water.x, water.y);
  const gx = net.nodes[toTip[4]].x;
  const up = branch(s, toTip[4], gx, groundYAt(world, gx) + 24);
  s.res.sugar = 100;
  assert.ok(sim.commandFruit(s, up[up.length - 1]));
  assert.ok(sim.commandTrap(s, toWater[3]));
  run(s, 2);
  assert.ok(net.links.some((l) => l.kind === 'tree') && net.links.some((l) => l.kind === 'water'));
  assert.ok(tree.linked);
  net.growing.push({ id: 99, from: toWater[5], path: [{ x: 0, y: 0 }, { x: 1, y: 1 }], grown: 0, total: 10, lastNode: toWater[5], tip: { x: 0, y: 0 }, cum: [0, 1], segCost: [0.1], seg: 0, nodeS: 0, tickAt: 40 });
  const version = net.version;
  const flowsBefore = s.flows.length;
  const rep = cutEdge(s, s.sim.parentEdge[toTip[2]]); // cut the trunk where the water branch leaves: everything beyond dies
  assert.ok(rep);
  const seen = s.events.splice(0);
  const cut = evs(seen, 'severed')[0];
  assert.equal(cut.mushrooms, 1);
  assert.ok(cut.links >= 2, `links lost: ${cut.links}`);
  assert.equal(evs(seen, 'mushroom-wilted').length, 1);
  const wilted = evs(seen, 'mushroom-wilted')[0];
  assert.ok(wilted.id === 0 && Number.isFinite(wilted.x) && Number.isFinite(wilted.y) && 'variant' in wilted);
  assert.equal(wilted.species, 'common', 'the event names the species, so the ghost can wear the look of the living mushroom');
  assert.equal(evs(seen, 'trap-spent').filter((e) => e.lost).length, 1);
  assert.equal(s.mushrooms.length, 0);
  assert.equal(s.traps.length, 0);
  assert.equal(net.growing.length, 0);
  assert.ok(net.version > version);
  assert.equal(net.links.length, 0);
  assert.equal(tree.linked, false);
  assert.equal(s.sim.tipClaimed.size, 0, 'the root tip is free again');
  assert.ok(flowsBefore >= 0);
  assertConsistent(s);
  run(s, 3); // the economy keeps running without trees or pockets and does not trip over stale flows
  assertConsistent(s);
  // regrowing to the tip claims it again and makes a new link
  const near = sim.pickNode(s, o.x + 10, o.y + 10, 400) ?? 0;
  const again = branch(s, near, tip.x, tip.y);
  assert.ok(again.length > 0);
  const relink = evs(s.events, 'link').filter((e) => e.kind === 'tree');
  assert.ok(relink.length >= 1 && tree.linked, 'the tree is allied again');
  s.events.length = 0;
});

test('a ring costs sugar, may not crowd another, grows for a few seconds, then lures and snares a worm: nitrogen for the net', () => {
  const { s, ids } = arena();
  s.res.sugar = 60;
  assert.equal(sim.canTrap(s, ids[6]), true);
  assert.ok(sim.commandTrap(s, ids[6]));
  assert.equal(s.res.sugar, 60 - B.trapCost);
  const placed = evs(s.events.splice(0), 'trap-placed')[0];
  assert.ok(placed && placed.nodeId === ids[6]);
  const trap = s.traps[0];
  assert.ok(trap.grow === 0 && trap.charges === B.trapCharges && trap.r === B.trapRadius);
  assert.equal(sim.canTrap(s, ids[7]), false, 'crowded');
  assert.equal(sim.commandTrap(s, ids[7]), false);
  assert.deepEqual(evs(s.events.splice(0), 'trap-denied').map((e) => e.reason), ['crowded']);
  s.res.sugar = 3;
  assert.equal(sim.commandTrap(s, ids[12]), false);
  const denied = s.events.splice(0);
  assert.deepEqual(evs(denied, 'trap-denied').map((e) => e.reason), ['sugar']);
  assert.equal(evs(denied, 'insufficient').length, 1);
  s.res.sugar = 60;
  assert.equal(sim.pickTrapNode(s, s.net.nodes[ids[12]].x, s.net.nodes[ids[12]].y + 5), ids[12]);
  const seen = run(s, B.trapGrowSeconds + 0.3);
  assert.equal(evs(seen, 'trap-ready').length, 1);
  assert.equal(trap.grow, 1);
  // a worm comes within the lure radius, away from any hypha it could bite
  const t = s.net.nodes[ids[6]];
  const w = worm(s, t.x, t.y + B.trapRadius - 10, { full: 100 }); // full: it does not bite meanwhile
  const minerals = s.res.minerals;
  let ev = null;
  for (let i = 0; i < 50 && !ev; i++) ev = evs(run(s, 0.1), 'worm-caught')[0];
  assert.ok(ev, 'caught');
  assert.equal(ev.trapId, trap.id);
  assert.equal(ev.wormId, w.id);
  assert.ok(ev.minerals > 0 && ev.minerals <= B.trapMinerals);
  assert.ok(s.res.minerals > minerals);
  assert.ok(!s.fauna.includes(w));
  assert.equal(trap.charges, B.trapCharges - 1);
  assert.ok(trap.cool > B.trapDigestSeconds - 0.2 && trap.glow > 0.9, 'digesting, and glowing from the catch');
  assert.equal(s.sim.threat.caught, 1);
  assertConsistent(s);
  // while it digests, the ring catches nothing
  const w2 = worm(s, t.x, t.y + 30, { full: 100 });
  run(s, 3);
  assert.equal(w2.mode, 'wander');
  trap.cool = 0;
  run(s, 3);
  assert.ok(!s.fauna.includes(w2), 'the second worm is caught once the ring has digested');
  assert.equal(s.sim.threat.caught, 2);
});

test('a ring finished while a worm is chewing makes it let go, and a ring with no catches left withers away', () => {
  const { s, ids } = arena();
  const target = s.net.nodes[ids[7]];
  const w = warned(s, target.x, target.y + 2);
  run(s, 0.3);
  assert.equal(w.mode, 'bite');
  w.bite.dur = B.trapGrowSeconds + 1.5; // a slow chew, so the ring is there in time (a real bite is short: rings must be laid ahead)
  assert.ok(sim.commandTrap(s, ids[8]));
  const seen = run(s, B.trapGrowSeconds + 1.5);
  assert.equal(evs(seen, 'bite-abort').length, 1);
  assert.equal(evs(seen, 'severed').length, 0, 'the hypha was saved');
  assert.equal(evs(seen, 'worm-caught').length, 1);
  assert.ok(s.net.nodes[ids[13]].alive);
  const trap = s.traps[0];
  trap.charges = 0;
  trap.cool = 1;
  const gone = run(s, 2);
  assert.equal(evs(gone, 'trap-spent').length, 1);
  assert.equal(s.traps.length, 0);
});

test('worms leave when full or old, and fade out first', () => {
  const { s, ids } = arena();
  const target = s.net.nodes[ids[9]];
  const w = warned(s, target.x, target.y + 2, { bites: B.wormMaxBites - 1 });
  run(s, biteSecondsFor(s) + 1);
  assert.equal(w.mode, 'leave', 'a full worm burrows away');
  const v0 = w.fade;
  const seen = run(s, B.wormLeaveSeconds + 0.5);
  assert.ok(v0 > 0);
  assert.equal(evs(seen, 'worm-gone').length, 1);
  assert.ok(!s.fauna.includes(w));
  const old = worm(s, target.x, target.y + 200, { life: 1, full: 100 });
  run(s, 1.5);
  assert.equal(old.mode, 'leave');
});

test('a network that cannot pay for itself lets its unproductive tips wither, one twig at a time, never the useful parts', () => {
  const s = fresh();
  s.time = 100;
  const o = s.net.nodes[0];
  const water = s.world.water[0];
  const leg = branch(s, 0, o.x + 176, o.y); // a stretch beyond the spore's immune ring ...
  const useful = [...leg, ...branch(s, leg[leg.length - 1], water.x, water.y)]; // ... then on to a pocket: a link
  // two dead-end twigs off the leg, on ground that touches no pocket, deposit or root tip (whatever glade this seed made)
  const twig = (skip) => {
    for (const at of [5, 6, 4, 7, 3, 8]) {
      if (at === skip) continue;
      const p = s.net.nodes[leg[at]];
      for (const len of [120, 90, 60]) {
        for (let k = 0; k < 16; k++) {
          const a = (k * Math.PI) / 8;
          const x = p.x + Math.cos(a) * len;
          const y = p.y + Math.sin(a) * len;
          if (Math.abs(Math.sin(a)) > 0.3 && clearOfDeposits(s, p.x, p.y, x, y)) return { at, ids: branch(s, leg[at], x, y) };
        }
      }
    }
    throw new Error('no free ground for a twig');
  };
  const first = twig(-1);
  const second = twig(first.at);
  const twigA = first.ids;
  const twigB = second.ids;
  s.events.length = 0;
  const seen = [];
  for (let i = 0; i < 120 * 60; i++) {
    s.res.sugar = 4;
    s.rates.sugar = 0;
    stepThreats(s, DT);
    s.time += DT;
    seen.push(...s.events.splice(0));
  }
  const cuts = evs(seen, 'severed');
  assert.ok(cuts.length >= 2, `twigs died back (${cuts.length})`);
  assert.ok(cuts.every((c) => c.cause === 'starved' && c.links === 0 && c.mushrooms === 0));
  assert.ok(twigA.every((id) => !s.net.nodes[id].alive) && twigB.every((id) => !s.net.nodes[id].alive), 'both twigs withered');
  assert.ok(useful.every((id) => s.net.nodes[id].alive), 'the way to the water stays');
  assert.ok(s.net.links.some((l) => l.kind === 'water'));
  assertConsistent(s);
  assert.ok(o);
  // not while the player is growing something, nor while sugar is healthy
  const t = fresh();
  t.time = 100;
  const tw = branch(t, 0, t.net.nodes[0].x - 200, t.net.nodes[0].y);
  t.net.growing.push({ id: 1, from: 0, lastNode: 0 });
  const quiet = [];
  for (let i = 0; i < 60 * 60; i++) {
    t.res.sugar = 4;
    t.rates.sugar = 0;
    stepThreats(t, DT);
    quiet.push(...t.events.splice(0));
  }
  assert.equal(evs(quiet, 'severed').length, 0, 'spending is not starving');
  assert.ok(tw.every((id) => t.net.nodes[id].alive));
});

test('determinism: the same seed and the same steps give identical worms, rings and networks', () => {
  const play = () => {
    const { s, ids } = arena(7, 20);
    s.res.sugar = 80;
    sim.commandTrap(s, ids[10]);
    run(s, 400);
    return s;
  };
  const a = play();
  const b = play();
  assert.deepEqual(a.fauna, b.fauna);
  assert.deepEqual(a.traps, b.traps);
  assert.deepEqual(a.sim.threat, b.sim.threat);
  assert.deepEqual(a.net.nodes.map((n) => n.alive), b.net.nodes.map((n) => n.alive));
  assert.ok(a.sim.threat.nextWorm > 0, 'something happened');
});

test('worms, rings and the chapter survive save and load exactly, and the game goes on the same', () => {
  const { s, ids } = arena(7, 24);
  s.res.sugar = 90;
  sim.commandTrap(s, ids[12]);
  run(s, 330);
  assert.ok(s.fauna.length > 0 || s.sim.threat.nextWorm > 0);
  const copy = decodeState(JSON.parse(JSON.stringify(encodeState(s))));
  assert.deepEqual(copy.fauna, s.fauna);
  assert.deepEqual(copy.traps, s.traps);
  assert.equal(copy.chapter, s.chapter);
  assert.deepEqual(copy.sim.threat, s.sim.threat);
  assert.equal(copy.flags.threats, true);
  run(s, 120);
  run(copy, 120);
  assert.deepEqual(copy.fauna, s.fauna);
  assert.deepEqual(copy.traps, s.traps);
  assert.deepEqual(copy.net.nodes.map((n) => n.alive), s.net.nodes.map((n) => n.alive));
  assert.ok(Math.abs(copy.res.sugar - s.res.sugar) < 1e-6);
  assertConsistent(copy);
});

test('seasons: worms are rarer and slower in winter', () => {
  const { s } = arena(7, 24);
  s.flags.seasons = true;
  s.sim.clock = 3 * B.seasonSeconds + 10; // winter
  sim.updateSim(s, DT);
  assert.equal(s.clock.season, 'winter');
  const w = spawnWormAt(s, s.net.nodes[0].x + 120, s.net.nodes[0].y + 120);
  w.full = 100;
  w.base = 20;
  run(s, 2);
  assert.ok(w.speed <= 20 * B.wormColdSpeed * 1.001, `winter speed ${w.speed}`);
  assert.ok(B.wormSeason.winter < B.wormSeason.summer);
});

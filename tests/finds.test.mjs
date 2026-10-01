import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { addNode } from '../src/sim/network.js';
import { findRadius, findReward, rescanFinds } from '../src/sim/finds.js';
import { B } from '../src/sim/balance.js';
import { FINDS } from '../src/content/finds.js';
import { DT, playBot } from './bot.mjs';

const finds = (events) => events.filter((e) => e.type === 'find');
/** A node placed `d` units from the item (to the right), attached to the origin. */
const nodeAt = (state, decor, d) => addNode(state, decor.x + d, decor.y, state.net.originId);

test('finds: every decor type has a note in src/content/finds.js and a rarity 1..4', () => {
  for (const seed of [1, 7, 42, 123, 99991]) {
    for (const d of createState(seed).world.decor) {
      const f = FINDS[d.type];
      assert.ok(f, `${d.type} has content`);
      assert.ok(f.rarity >= 1 && f.rarity <= 4 && f.name && f.latin && f.zone && f.note);
    }
  }
});

test('finds: a fresh game has none and the rewards are modest and rarer = bigger', () => {
  const state = createState(7);
  assert.deepEqual(state.finds, {});
  let prev = -1;
  for (const rarity of [1, 2, 3, 4]) {
    const kind = Object.keys(FINDS).find((k) => FINDS[k].rarity === rarity);
    const r = findReward(kind);
    assert.ok(r.sugar > prev && r.sugar <= 30 && r.spores <= 5);
    prev = r.sugar;
  }
});

test('finds: the distance rule is 8 + 10 * scale, exclusive of anything farther', () => {
  for (const seed of [7, 42]) {
    const state = createState(seed);
    state.time = 12.5;
    const { world } = state;
    // a curiosity well away from deposits and root tips (a node next to those would also make a link event)
    const d = world.decor.find(
      (c) =>
        [...world.water, ...world.minerals].every((o) => Math.hypot(o.x - c.x, o.y - c.y) > 120) &&
        world.trees.every((t) => t.tips.every((p) => Math.hypot(p.x - c.x, p.y - c.y) > 60)),
    );
    const r = findRadius(d);
    assert.equal(r, 8 + 10 * d.scale);
    nodeAt(state, d, r + 0.5);
    nodeAt(state, d, -(r + 0.5));
    assert.deepEqual(state.finds, {});
    assert.equal(state.events.length, 0);
    nodeAt(state, d, r - 0.5);
    assert.deepEqual(state.finds, { [d.id]: { kind: d.type, at: 12.5 } });
  }
});

test('finds: event shape, once per item, other items untouched', () => {
  const state = createState(42);
  const [a, b] = state.world.decor;
  state.events.length = 0;
  nodeAt(state, a, 1);
  nodeAt(state, a, 2);
  nodeAt(state, a, 3);
  const ev = finds(state.events);
  assert.deepEqual(ev, [{ type: 'find', id: a.id, kind: a.type, x: a.x, y: a.y }]);
  assert.deepEqual(Object.keys(state.finds), [String(a.id)]);
  assert.ok(!state.finds[b.id]);
  nodeAt(state, b, 0);
  assert.equal(finds(state.events).length, 2);
  assert.equal(Object.keys(state.finds).length, 2);
});

test('finds: the reward is paid once, sugar stays within the cap', () => {
  const state = createState(42);
  const d = state.world.decor[0];
  const reward = findReward(d.type);
  state.res.sugar = 50;
  state.res.spores = 0;
  nodeAt(state, d, 1);
  nodeAt(state, d, 2);
  assert.equal(state.res.sugar, 50 + reward.sugar);
  assert.equal(state.res.spores, reward.spores);
  const e = state.world.decor[1];
  state.res.sugar = state.cap.sugar - 1;
  nodeAt(state, e, 1);
  assert.equal(state.res.sugar, state.cap.sugar);
  const f = state.world.decor[2];
  state.res.sugar = state.cap.sugar + 10; // above the cap (e.g. a tree stage was lost): never reduced
  nodeAt(state, f, 1);
  assert.equal(state.res.sugar, state.cap.sugar + 10);
});

test('finds: nothing is discovered by the starting spore', () => {
  for (const seed of [1, 7, 42, 99991, 2024, 31337]) {
    const state = createState(seed);
    assert.deepEqual(state.finds, {}, `seed ${seed}`);
  }
});

test('finds: a grown hypha discovers the item at the end of its path (through the real growth step)', () => {
  // a curiosity 90-320 u from the spore with an open straight path and no other curiosity near the path
  let state;
  let d;
  for (const seed of [42, 7, 1, 2, 3, 4, 5, 6, 8, 9]) {
    state = createState(seed);
    const from = state.net.nodes[state.net.originId];
    d = state.world.decor.find((c) => {
      const len = Math.hypot(c.x - from.x, c.y - from.y);
      if (len < 90 || len > 320) return false;
      if (sim.estimateGrowth(state, state.net.originId, [{ x: c.x, y: c.y }]).blocked !== null) return false;
      return state.world.decor.every((e) => {
        if (e === c) return true;
        const t = Math.max(0, Math.min(1, ((e.x - from.x) * (c.x - from.x) + (e.y - from.y) * (c.y - from.y)) / (len * len)));
        return Math.hypot(e.x - (from.x + t * (c.x - from.x)), e.y - (from.y + t * (c.y - from.y))) > 40;
      });
    });
    if (d) break;
  }
  state.res.sugar = state.cap.sugar = 5000;
  const o = state.net.originId;
  assert.ok(d, 'a curiosity within reach');
  assert.equal(sim.estimateGrowth(state, o, [{ x: d.x, y: d.y }]).blocked, null, 'the straight path is open');
  assert.ok(sim.commandGrow(state, o, [{ x: d.x, y: d.y }]));
  const seen = [];
  for (let i = 0; i < 60 * 40 && state.net.growing.length; i++) {
    sim.updateSim(state, DT);
    state.time += DT;
    seen.push(...finds(state.events));
    state.events.length = 0;
  }
  assert.equal(state.net.growing.length, 0);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { type: 'find', id: d.id, kind: d.type, x: d.x, y: d.y });
  assert.ok(state.finds[d.id].at > 0 && state.finds[d.id].at < state.time + 1e-9);
});

test('finds: rescanFinds catches up a network that already touches items (old saves)', () => {
  const state = createState(42);
  const d = state.world.decor[0];
  state.time = 77;
  nodeAt(state, d, 1);
  const born = state.net.nodes.at(-1).born;
  const expected = JSON.parse(JSON.stringify(state.finds));
  state.finds = {};
  state.events.length = 0;
  rescanFinds(state);
  assert.deepEqual(state.finds, { [d.id]: { kind: d.type, at: born } });
  assert.deepEqual(expected[d.id].kind, state.finds[d.id].kind);
  assert.equal(state.events.length, 0, 'silent');
});

test('finds: deterministic per seed, bot playthrough still completes, counts per seed', () => {
  const counts = {};
  for (const seed of [1, 7, 42]) {
    const a = playBot(seed, { maxSeconds: 600 });
    const b = playBot(seed, { maxSeconds: 600 });
    assert.ok(a.completedAt !== null, `seed ${seed} completes all objectives`);
    assert.deepEqual(a.state.finds, b.state.finds, 'same finds, same times');
    assert.equal(a.stats.events.find ?? 0, Object.keys(a.state.finds).length, 'one event per find');
    for (const [id, f] of Object.entries(a.state.finds)) assert.equal(f.kind, a.state.world.decor[id].type);
    counts[seed] = Object.keys(a.state.finds).length;
  }
  console.log('# bot finds per seed:', JSON.stringify(counts));
});

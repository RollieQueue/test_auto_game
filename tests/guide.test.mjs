// The first-session guide picks its hint from the game state alone (src/ui/guide-logic.js has no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { WAIT_HINT_UNTIL, pickHint } from '../src/ui/guide-logic.js';

function advance(state, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    sim.updateSim(state, 1 / 60);
    state.time += 1 / 60;
  }
}

test('the guide starts at the spore', () => {
  const s = createState(7);
  const h = pickHint(s);
  assert.equal(h.id, 'spore');
  const o = s.net.nodes[s.net.originId];
  assert.ok(Math.hypot(h.ring.x - o.x, h.ring.y - o.y) < 1, 'the ring surrounds the spore');
});

for (const seed of [1, 7, 42]) {
  test(`the guide walks water → tree → mushroom → mineral → wait, seed ${seed}`, () => {
    const s = createState(seed);
    s.phase = 'playing';
    const o = s.net.nodes[s.net.originId];
    assert.ok(sim.commandGrow(s, o.id, [{ x: o.x + 12, y: o.y + 6 }, { x: o.x + 24, y: o.y + 12 }]));
    advance(s, 1);

    let h = pickHint(s);
    assert.equal(h.id, 'water');
    const pocket = s.world.water.find((w) => h.key === `water:${w.id}`);
    assert.ok(pocket, 'points at a real water pocket');
    assert.ok(Math.hypot(h.ring.x - pocket.x, h.ring.y - pocket.y) < 1);

    s.net.links.push({ nodeId: o.id, kind: 'water', targetId: pocket.id, born: s.time });
    h = pickHint(s);
    assert.equal(h.id, 'tree');
    assert.ok(h.ring, 'points at a root tip');

    s.net.links.push({ nodeId: o.id, kind: 'tree', targetId: s.world.trees[0].id, born: s.time });
    h = pickHint(s);
    assert.match(h.id, /^fruit/);

    s.mushrooms.push({ id: 0, nodeId: o.id, x: o.x, baseY: o.y, species: 'common', variant: 0, age: 0, growth: 0, mature: false, spores: 0 });
    h = pickHint(s);
    assert.equal(h.id, 'mineral');
    assert.ok(s.world.minerals.some((m) => h.key === `mineral:${m.id}`), 'points at a real deposit');

    s.net.links.push({ nodeId: o.id, kind: 'mineral', targetId: s.world.minerals[0].id, born: s.time });
    h = pickHint(s);
    assert.equal(h.id, 'wait');
  });
}

test('«Теперь жди…» belongs to the first minutes: gone once page 1 is closed or the game is four minutes old', () => {
  const s = createState(7);
  s.phase = 'playing';
  const o = s.net.nodes[s.net.originId];
  assert.ok(sim.commandGrow(s, o.id, [{ x: o.x + 12, y: o.y + 6 }, { x: o.x + 24, y: o.y + 12 }]));
  advance(s, 1);
  const w = s.world.water[0];
  s.net.links.push({ nodeId: o.id, kind: 'water', targetId: w.id, born: s.time });
  s.net.links.push({ nodeId: o.id, kind: 'tree', targetId: s.world.trees[0].id, born: s.time });
  s.net.links.push({ nodeId: o.id, kind: 'mineral', targetId: s.world.minerals[0].id, born: s.time });
  s.mushrooms.push({ id: 0, nodeId: o.id, x: o.x, baseY: o.y, species: 'common', variant: 0, age: 0, growth: 0, mature: false, spores: 0 });
  const at = (t) => {
    s.time = t;
    for (const l of s.net.links) l.born = t; // a fresh mineral link is never «dry» yet
    return pickHint(s);
  };
  assert.equal(at(60).id, 'wait', 'a minute in, all in place: wait');
  assert.equal(at(WAIT_HINT_UNTIL - 1).id, 'wait');
  assert.equal(at(WAIT_HINT_UNTIL), null, 'four minutes in, nothing to add');
  assert.equal(at(700), null, 'a fast-forwarded game after a barrier');
  at(100);
  s.flags.allObjectivesDone = true; // page 1 closed early
  assert.equal(at(100), null);
});

for (const seed of [9, 26]) {
  test(`a gripped tree outranks «Это спора» and the walk steps, the other priorities stay, seed ${seed}`, () => {
    const gripped = (s) => {
      s.phase = 'playing';
      s.flags.threats = true;
      s.flags.rival = true;
      const tree = s.world.trees[0];
      s.rival = { awake: true, nodes: [], edges: [], tips: [], grip: [{ treeId: tree.id, node: 0, x: tree.x, y: 400, since: 50 }], clusters: [], spores: 0, ver: 0, rs: 1 };
      return s;
    };
    // nothing grown yet: without the one-time arrow the spore comes first, with it the grip does
    const s = gripped(createState(seed));
    assert.equal(pickHint(s).id, 'spore');
    assert.equal(pickHint(s, null, 'grow', { rivalHint: false }).id, 'spore');
    assert.equal(pickHint(s, null, 'grow', { rivalHint: true }).id, 'rival');
    assert.equal(pickHint(s, null, 'grow', { rivalHint: true, wormHint: true }).id, 'rival');
    // the arrow is for the grip only: without one the spore stays
    s.rival.grip = [];
    assert.equal(pickHint(s, null, 'grow', { rivalHint: true }).id, 'spore');
    // a started game: the grip beats the water step, and without the arrow the steps go on as before
    const t = createState(seed);
    t.phase = 'playing';
    const o = t.net.nodes[t.net.originId];
    assert.ok(sim.commandGrow(t, o.id, [{ x: o.x + 12, y: o.y + 6 }, { x: o.x + 24, y: o.y + 12 }]));
    advance(t, 1);
    gripped(t);
    assert.equal(pickHint(t, null, 'grow', { rivalHint: true }).id, 'rival');
    assert.equal(pickHint(t, null, 'grow', { rivalHint: false }).id, 'water');
    t.rival.grip = [];
    assert.equal(pickHint(t, null, 'grow', { rivalHint: true }).id, 'water');
  });
}

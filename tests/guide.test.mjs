// The first-session guide picks its hint from the game state alone (src/ui/guide-logic.js has no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { pickHint } from '../src/ui/guide-logic.js';

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

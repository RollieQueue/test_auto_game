// The stump tooltip exists only where the stump is drawn: with the rival in the state (render/rival-logic stumpsOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTarget } from '../src/ui/tooltip.js';

const world = { trees: [], water: [], minerals: [], stumps: [{ id: 0, x: 500, y: 300, r: 30 }] };
const stump = { kind: 'stump', id: 0 };

test('no stump tooltip while the rival is off (?rival=0, old saves): the stump is not drawn', () => {
  assert.equal(describeTarget({ world, flags: { rival: false }, rival: null }, stump), null);
});

test('a sleeping rival: the stump tooltip foreshadows it', () => {
  const d = describeTarget({ world, flags: { rival: true }, rival: { awake: false, dormant: false } }, stump);
  assert.ok(d && /пень/i.test(d.main), JSON.stringify(d));
});

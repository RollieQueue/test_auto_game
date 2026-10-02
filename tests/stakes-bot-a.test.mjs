// The bot that answers the honey fungus with barriers (grip mode) never loses a page: seeds 7, 13, 23, 42 over 1500 s (a year and a quarter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playStakes } from './stakes-bot-run.mjs';

for (const seed of [7, 13, 23, 42]) {
  test(`stakes bot: grip mode keeps every tree and the page open, seed ${seed}`, () => {
    const r = playStakes(seed, 'grip');
    assert.deepEqual(r.closed, []);
    assert.equal(r.lost, 0, 'no tree lost');
    assert.ok(r.state.flags.yearGrades.length >= 1, 'a year ended and was graded');
    assert.notEqual(r.state.flags.yearGrades[0].grade, 'poor');
  });
}

test('stakes bot: the passive bot (no barriers) loses the grove and the page closes, the glade then stands still', () => {
  const r = playStakes(23, false);
  assert.equal(r.closed.length, 1);
  assert.equal(r.closed[0].cause, 'grove');
  assert.ok(r.closed[0].at >= 600, 'not in the first ten minutes');
  assert.equal(r.state.world.trees.every((t) => t.lost), true);
});

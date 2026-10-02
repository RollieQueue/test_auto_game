// The bot that answers the honey fungus with barriers (grip mode) never loses a page and at most a tree (the deep grip of a page comes from under the gravel: a ring on the nodes at hand does not reach it): seeds 7, 13, 23, 42 over 1500 s (a year and a quarter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playStakes } from './stakes-bot-run.mjs';

for (const seed of [7, 13, 23, 42]) {
  test(`stakes bot: grip mode keeps the page open and at most one tree lost, seed ${seed}`, () => {
    const r = playStakes(seed, 'grip');
    assert.deepEqual(r.closed, []);
    assert.ok(r.lost <= 1, `at most one tree lost, lost ${r.lost}`);
    assert.ok(r.state.flags.yearGrades.length >= 1, 'a year ended and was graded');
    if (r.lost === 0) assert.notEqual(r.state.flags.yearGrades[0].grade, 'poor');
  });
}

test('stakes bot: the passive bot (no barriers) loses the grove, or the raiders cut it off from the last ally, and the page closes', () => {
  const r = playStakes(23, false);
  assert.equal(r.closed.length, 1);
  assert.ok(['grove', 'allies'].includes(r.closed[0].cause), r.closed[0].cause);
  assert.ok(r.closed[0].at >= 600, 'not in the first ten minutes');
  const lost = r.state.world.trees.filter((t) => t.lost).length;
  if (r.closed[0].cause === 'grove') assert.equal(lost, r.state.world.trees.length);
  else assert.ok(lost >= 2, `the rival took ${lost} trees before the net lost its last ally`);
});

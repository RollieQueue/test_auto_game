// The bot that answers the honey fungus with barriers (grip mode) never loses a page and at most a tree (the deep grip of a page comes from under the gravel: a ring on the nodes at hand does not reach it): seeds 2, 5, 9, 26 over 1500 s (a year and a quarter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playStakes } from './stakes-bot-run.mjs';

for (const seed of [2, 5, 9, 26]) {
  test(`stakes bot: grip mode keeps the page open and at most one tree lost, seed ${seed}`, () => {
    const r = playStakes(seed, 'grip');
    assert.deepEqual(r.closed, []);
    assert.ok(r.lost <= 1, `at most one tree lost, lost ${r.lost}`);
    assert.ok(r.state.flags.yearGrades.length >= 1, 'a year ended and was graded');
    if (r.lost === 0) assert.notEqual(r.state.flags.yearGrades[0].grade, 'poor');
  });
}

// The bot that answers the honey fungus with barriers (grip mode) never loses a page: seeds 2, 5, 9, 26 over 1500 s (a year and a quarter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playStakes } from './stakes-bot-run.mjs';

for (const seed of [2, 5, 9, 26]) {
  test(`stakes bot: grip mode keeps every tree and the page open, seed ${seed}`, () => {
    const r = playStakes(seed, 'grip');
    assert.deepEqual(r.closed, []);
    assert.equal(r.lost, 0, 'no tree lost');
    assert.ok(r.state.flags.yearGrades.length >= 1, 'a year ended and was graded');
    assert.notEqual(r.state.flags.yearGrades[0].grade, 'poor');
  });
}

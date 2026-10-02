// The background painter of src/render/trees.js (createPump): a per-frame time budget, steps in order, one step at least
// per frame, cancelled jobs skipped, a failing step ends only its own job. Pure: a fake clock, no browser, no canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPump } from '../src/render/trees.js';

/** A clock the steps advance themselves: step(ms) costs `ms` of fake time and records its tag. */
function rig() {
  const clock = { t: 0 };
  const ran = [];
  const step = (tag, ms) => () => {
    clock.t += ms;
    ran.push(tag);
  };
  const job = (tag, costs, extra = {}) => ({ steps: costs.map((ms, i) => step(`${tag}${i}`, ms)), i: 0, done: false, cancelled: false, ...extra });
  const queue = [];
  const errors = [];
  const pump = createPump(queue, () => clock.t, (e) => errors.push(e));
  return { clock, ran, job, queue, errors, pump };
}

test('a frame stops once the budget is spent: steps that fit run, the next frame carries on', () => {
  const r = rig();
  r.queue.push(r.job('a', [1.5, 1.5, 1.5, 1.5, 1.5, 1.5]));
  r.pump(4, 1);
  assert.deepEqual(r.ran, ['a0', 'a1'], 'two 1.5 ms steps fit in 4 ms; a third would not');
  r.pump(4, 2);
  assert.deepEqual(r.ran, ['a0', 'a1', 'a2', 'a3']);
  r.pump(4, 3);
  assert.equal(r.queue.length, 0);
  assert.equal(r.ran.length, 6);
});

test('the budget is per frame: the same frame time shares it, a new one starts afresh', () => {
  const r = rig();
  r.queue.push(r.job('a', [1.5, 1.5, 1.5, 1.5]));
  r.pump(4, 7);
  r.pump(4, 7); // drawRoots then drawTrees in one frame: still the same 4 ms
  assert.equal(r.ran.length, 2);
  r.pump(4, 8);
  assert.equal(r.ran.length, 4);
});

test('a step longer than the budget still runs, one per frame, so the queue never stalls', () => {
  const r = rig();
  r.queue.push(r.job('a', [9, 9, 9]));
  r.pump(4, 1);
  assert.equal(r.ran.length, 1);
  r.pump(4, 2);
  assert.equal(r.ran.length, 2);
  r.pump(4, 3);
  assert.equal(r.queue.length, 0);
});

test('steps that cannot be timed (a coarse clock) are capped per frame, not let through all at once', () => {
  const r = rig();
  r.queue.push(r.job('a', new Array(40).fill(0)));
  r.pump(4, 1);
  assert.ok(r.ran.length >= 1 && r.ran.length <= 8, `${r.ran.length} steps in one frame`);
});

test('jobs run in queue order', () => {
  const r = rig();
  r.queue.push(r.job('a', [1, 1]), r.job('b', [1, 1]));
  r.pump(100, 1);
  assert.deepEqual(r.ran, ['a0', 'a1', 'b0', 'b1']);
});

test('a finished job is marked done and leaves the queue', () => {
  const r = rig();
  const j = r.job('a', [1, 1]);
  r.queue.push(j);
  r.pump(100, 1);
  assert.equal(j.done, true);
  assert.equal(r.queue.length, 0);
});

test('a cancelled job is skipped without running a step', () => {
  const r = rig();
  const dead = r.job('x', [1, 1], { cancelled: true });
  r.queue.push(dead, r.job('a', [1]));
  r.pump(100, 1);
  assert.deepEqual(r.ran, ['a0']);
  assert.equal(dead.done, false);
});

test('a step that throws ends its own job (reported once), the next job still runs', () => {
  const r = rig();
  const bad = r.job('b', [1, 1, 1]);
  bad.steps[1] = () => {
    throw new Error('boom');
  };
  r.queue.push(bad, r.job('a', [1]));
  r.pump(100, 1);
  assert.deepEqual(r.ran, ['b0', 'a0']);
  assert.equal(r.errors.length, 1);
  assert.equal(bad.done, true);
});

test('a job queued while the queue is being drained is reached in the same frame if there is time', () => {
  const r = rig();
  r.queue.push(r.job('a', [1]));
  r.pump(4, 1);
  r.queue.push(r.job('b', [1]));
  r.pump(4, 1);
  assert.deepEqual(r.ran, ['a0', 'b0']);
});

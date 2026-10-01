import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/world/generate.js';
import { costAt, groundYAt, horizonIndexAt, rockAt } from '../src/world/query.js';

test('world generation is deterministic for a seed', () => {
  assert.deepEqual(generateWorld(42), generateWorld(42));
  assert.notDeepEqual(generateWorld(42).rocks, generateWorld(43).rocks);
});

for (const seed of [1, 7, 42, 1234, 99991]) {
  test(`world invariants, seed ${seed}`, () => {
    const w = generateWorld(seed);
    assert.equal(w.trees.length, 3);
    assert.ok(w.water.length >= 4, 'enough water pockets');
    assert.ok(w.minerals.length >= 4, 'enough mineral deposits');
    assert.ok(Number.isFinite(costAt(w, w.origin.x, w.origin.y)), 'origin is passable');
    for (const t of w.trees) {
      assert.ok(t.roots.some((r) => r.minStage <= t.stage), 'every tree has visible roots');
      assert.ok(t.tips.some((p) => p.minStage <= t.stage), 'every tree has active root tips');
    }
    for (const d of [...w.water, ...w.minerals]) {
      assert.equal(rockAt(w, d.x, d.y), null, 'deposits are not inside rocks');
      assert.ok(d.y > groundYAt(w, d.x), 'deposits are underground');
    }
    for (let i = 1; i < w.horizons.length; i++) {
      w.horizons[i].top.forEach((y, k) => assert.ok(y > w.horizons[i - 1].top[k], 'horizons are ordered'));
    }
    assert.equal(horizonIndexAt(w, 500, groundYAt(w, 500) - 5), -1);
  });
}

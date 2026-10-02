// Hover and the HUD cards see the whole clump: any cap finds its mushroom, the card box covers every cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/world/generate.js';
import { clusterOf, clumpCaps, clumpLayout } from '../src/world/clump.js';
import * as renderSide from '../src/render/mushroom-cluster.js';
import { groundYAt, targetAt } from '../src/world/query.js';
import { mushroomBox, coverage } from '../src/ui/cards-logic.js';

const world = generateWorld(7);
const mk = (id, x) => ({ id, x, baseY: groundYAt(world, x), growth: 1 });
/** A mushroom whose clump (as it stands at x in this world) has exactly n companions. */
function withClump(n, x) {
  let id = 0;
  while (clumpLayout(world, mk(id, x)).cl.length !== n) id++;
  return mk(id, x);
}

test('render/mushroom-cluster.js re-exports the world layout unchanged', () => {
  assert.equal(renderSide.clusterOf, clusterOf);
  for (const id of [0, 1, 5, 17]) assert.deepEqual(renderSide.clusterOf(7, id), clusterOf(7, id));
});

test('hover over a small cap finds its mushroom; just outside the clump finds nothing', () => {
  const m = withClump(2, 900);
  const caps = clumpCaps(world, m, groundYAt);
  assert.equal(caps.length, 3);
  for (const c of caps) assert.deepEqual(targetAt(world, [m], c.x, c.y - 10 * c.scale), { kind: 'mushroom', id: m.id });
  const far = caps.reduce((a, c) => Math.max(a, Math.abs(c.x - m.x) + 24 * c.scale), 0);
  const t = targetAt(world, [m], m.x + far + 6, m.baseY - 20);
  assert.notEqual(t && t.kind, 'mushroom');
  const t2 = targetAt(world, [m], m.x - far - 6, m.baseY - 20);
  assert.notEqual(t2 && t2.kind, 'mushroom');
});

test('two clumps close together: the nearest stalk wins', () => {
  const a = withClump(1, 900);
  const b = { ...mk(a.id + 1000, 940) };
  const ca = clumpCaps(world, a, groundYAt)[1];
  const hit = targetAt(world, [a, b], ca.x, ca.y - 10);
  assert.equal(hit.kind, 'mushroom');
  const nearer = Math.abs(ca.x - a.x) <= Math.abs(ca.x - b.x) ? a : null;
  // inside the main cap of b the answer is b
  assert.equal(targetAt(world, [a, b], b.x, b.baseY - 10).id, b.id);
  if (nearer) assert.equal(hit.id, a.id);
});

test('a young mushroom shows only the caps that have pushed up', () => {
  const m = { ...withClump(2, 900), growth: 0.05 };
  assert.equal(clumpCaps(world, m, groundYAt).length, 1);
});

test('mushroomBox covers every cap', () => {
  const m = withClump(2, 900);
  const box = mushroomBox(m, world.trees, world);
  for (const c of clumpCaps(world, m, groundYAt)) {
    assert.ok(c.x >= box.l && c.x <= box.r && c.y >= box.t && c.y <= box.b, `cap at ${c.x}`);
  }
  const plain = mushroomBox(m, world.trees);
  assert.ok(box.l <= plain.l && box.r >= plain.r);
  assert.ok(box.r - box.l > plain.r - plain.l);
});

test('a card over only a small cap counts the mushroom', () => {
  let id = 0;
  while (!clumpCaps(world, mk(id, 900), groundYAt).some((q) => Math.abs(q.x - 900) >= 42)) id++;
  const m = mk(id, 900);
  const c = clumpCaps(world, m, groundYAt).find((q) => Math.abs(q.x - m.x) >= 42);
  const state = { world, mushrooms: [m] };
  const view = { scale: 1, ox: 0, oy: 0 };
  const rect = { l: c.x - 3, r: c.x + 3, t: c.y - 30, b: c.y };
  const plainBox = mushroomBox(m, world.trees);
  const alone = rect.l > plainBox.r + 10 || rect.r < plainBox.l - 10;
  assert.ok(alone, 'test setup: the card must clear the main cap');
  assert.equal(coverage(state, view, rect).mushrooms, 1);
});

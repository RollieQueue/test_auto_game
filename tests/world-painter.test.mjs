// The world plate painted in slices (render/world-layer.js createWorldPainter): the main-thread fallback spreads the
// painting over frames, so the slices must add up to exactly the one-shot picture, and there must be many small ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/world/generate.js';
import { createWorldPainter, paintWorldLayer } from '../src/render/world-layer.js';
import { fakeCtx, fakeOffscreenCanvas } from './fake-canvas.mjs';

const VIEW = { scale: 1, ox: 0, oy: 0, cssW: 1600, cssH: 900, dpr: 1 };

function withStubs(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  globalThis.OffscreenCanvas = fakeOffscreenCanvas();
  try {
    return fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'OffscreenCanvas', had);
    else delete globalThis.OffscreenCanvas;
  }
}

test('slices of a plate draw exactly what the one-shot painter draws, in many small units', () => {
  withStubs(() => {
    for (const [seed, season] of [[7, ''], [7, 'autumn'], [12, 'spring'], [31, 'winter']]) {
      const world = generateWorld(seed);
      const whole = fakeCtx(VIEW.cssW, VIEW.cssH);
      paintWorldLayer(whole.ctx, VIEW.cssW, VIEW.cssH, world, VIEW, season);

      const sliced = fakeCtx(VIEW.cssW, VIEW.cssH);
      let flushes = 0;
      const painter = createWorldPainter(sliced.ctx, VIEW.cssW, VIEW.cssH, world, VIEW, season, () => flushes++);
      let calls = 0;
      while (!painter.step(0)) calls++; // budget 0: one unit of work per call
      assert.ok(painter.done);
      assert.ok(calls > 100, `seed ${seed} ${season}: ${calls} slices`);
      assert.equal(flushes, painter.units, 'the flush hook runs after every unit');
      assert.ok(sliced.log.length > 2000, 'it really painted');
      assert.deepEqual(sliced.log, whole.log, `seed ${seed} ${season}: the same drawing calls`);
      assert.equal(painter.step(6), true, 'a finished painter stays finished');
    }
  });
});

test('a budget groups units into slices and the painter finishes in a bounded number of calls', () => {
  withStubs(() => {
    const world = generateWorld(7);
    const { ctx, log } = fakeCtx(VIEW.cssW, VIEW.cssH);
    const painter = createWorldPainter(ctx, VIEW.cssW, VIEW.cssH, world, VIEW, 'summer');
    let calls = 0;
    while (!painter.step(1e9)) calls++;
    assert.equal(calls, 0, 'an unlimited budget finishes in the first call');
    const again = fakeCtx(VIEW.cssW, VIEW.cssH);
    const p2 = createWorldPainter(again.ctx, VIEW.cssW, VIEW.cssH, world, VIEW, 'summer');
    let n = 0;
    while (!p2.step(0.0001)) n++;
    assert.ok(n > 100 && n <= p2.units, `${n} slices for ${p2.units} units`);
    assert.deepEqual(again.log, log);
  });
});

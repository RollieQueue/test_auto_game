import test from 'node:test';
import assert from 'node:assert/strict';
// no DOM in node: a Path2D that accepts every path call
globalThis.Path2D ??= class Path2D {
  constructor() {
    return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => undefined) });
  }
};
const { SENSE_LIFE, createFauna, senseAlpha, senseEndsOn } = await import('../src/render/fauna.js');

// a 2D context that records which calls were made and never throws
function stubCtx() {
  const calls = [];
  const target = { calls, globalAlpha: 1 };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => {
        calls.push([String(k), a]);
        return undefined;
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

const worm = (o = {}) => ({ id: 7, x: 100, y: 200, a: 0, len: 40, mode: 'wander', speed: 8, phase: 0, fade: 1, ...o });
const SENSE = { type: 'worm-sense', id: 7, x: 100, y: 200, tx: 160, ty: 230 };
const dashed = (ctx) => ctx.calls.filter(([k, a]) => k === 'setLineDash' && a[0] && a[0].length && a[0][0] > 2);

test('senseAlpha fades in quickly and out gently', () => {
  assert.equal(senseAlpha(-1), 0);
  assert.equal(senseAlpha(0), 0);
  assert.ok(senseAlpha(0.1) > 0.1 && senseAlpha(0.1) < 1);
  assert.equal(senseAlpha(0.3), 1);
  assert.equal(senseAlpha(SENSE_LIFE / 2), 1);
  const late = senseAlpha(SENSE_LIFE - 0.6);
  assert.ok(late > 0 && late < 1);
  assert.equal(senseAlpha(SENSE_LIFE), 0);
});

test('an early end fades the marker out within a second', () => {
  assert.equal(senseAlpha(2, 0), 1);
  const mid = senseAlpha(2, 0.25);
  assert.ok(mid > 0 && mid < 1);
  assert.equal(senseAlpha(2, 0.6), 0);
  assert.equal(senseAlpha(2, null), 1);
});

test('bites, catches and departures end the marker of that worm', () => {
  assert.equal(senseEndsOn({ type: 'bite', id: 3 }), 3);
  assert.equal(senseEndsOn({ type: 'worm-gone', id: 4 }), 4);
  assert.equal(senseEndsOn({ type: 'worm-caught', wormId: 5, trapId: 1 }), 5);
  assert.equal(senseEndsOn({ type: 'bite-abort', id: 3 }), null);
  assert.equal(senseEndsOn({ type: 'worm-sense', id: 3 }), null);
  assert.equal(senseEndsOn(null), null);
});

test('the marker is drawn while the worm exists, then removed', () => {
  const f = createFauna();
  f.event(SENSE, {});
  const state = { fauna: [worm()], traps: [], ui: {} };
  const c1 = stubCtx();
  f.draw(c1, state, 1, 1 / 60);
  f.draw(c1, state, 1.5, 1 / 60);
  const c2 = stubCtx();
  f.draw(c2, state, 2, 1 / 60);
  assert.ok(dashed(c2).length >= 1, 'dashed line to the target');
  assert.ok(c2.calls.some(([k]) => k === 'quadraticCurveTo'));
  const late = stubCtx();
  f.draw(late, state, 1 + SENSE_LIFE + 0.5, 1 / 60);
  assert.equal(dashed(late).length, 0, 'gone after its life');
});

test('a bite ends the marker early', () => {
  const f = createFauna();
  f.event(SENSE, {});
  const state = { fauna: [worm()], traps: [], ui: {} };
  f.draw(stubCtx(), state, 1, 1 / 60);
  f.draw(stubCtx(), state, 2, 1 / 60);
  f.event({ type: 'bite', id: 7, edge: 1, x: 150, y: 220 }, state);
  f.draw(stubCtx(), state, 2.1, 1 / 60); // ending is noticed on the next frame
  const after = stubCtx();
  f.draw(after, state, 3, 1 / 60);
  assert.equal(dashed(after).length, 0);
});

test('a worm that disappears takes its marker with it; without fauna nothing is drawn', () => {
  const f = createFauna();
  f.event(SENSE, {});
  const ctx = stubCtx();
  f.draw(ctx, { fauna: [], traps: [], ui: {} }, 1, 1 / 60);
  assert.equal(ctx.calls.length, 0);
  const gone = createFauna();
  gone.event(SENSE, {});
  gone.draw(stubCtx(), { fauna: [worm()], traps: [], ui: {} }, 1, 1 / 60);
  gone.draw(stubCtx(), { fauna: [worm({ id: 9 })], traps: [], ui: {} }, 1.2, 1 / 60); // worm 7 left
  const after = stubCtx();
  gone.draw(after, { fauna: [worm({ id: 9 })], traps: [], ui: {} }, 2.5, 1 / 60);
  assert.equal(dashed(after).length, 0);
});

test('malformed sense events do not throw', () => {
  const f = createFauna();
  f.event({ type: 'worm-sense' }, {});
  f.event({ type: 'worm-sense', id: 1, tx: NaN, ty: 2 }, {});
  f.event(null, {});
  f.draw(stubCtx(), { fauna: [worm()], traps: [], ui: {} }, 1, 1 / 60);
});

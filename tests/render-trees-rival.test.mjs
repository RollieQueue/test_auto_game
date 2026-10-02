// Honey fungus on painted trees: the pure look parameters (src/render/infection-look.js: how an infected crown browns and
// thins, how a snag is shaped) and, through a recording fake 2D context, that the painters (trees-paint.js infectionSteps,
// snagSteps) run all their steps for every species, season and bucket, draw the same picture for the same seed and erase
// only where they should. No browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INF_BUCKETS, infBucket } from '../src/render/rival-logic.js';
import {
  MAX_COVER,
  MAX_WASH,
  blotchCount,
  deadDensity,
  holeCover,
  infectionLook,
  isBareCrown,
  snagKeep,
  snagSpires,
  snagWidths,
  washAmount,
  washColor,
} from '../src/render/infection-look.js';
import { crownSteps, infectionSteps, snagSteps } from '../src/render/trees-paint.js';
import { buildModel } from '../src/render/trees-model.js';
import { mulberry } from '../src/render/ink.js';

const SPECIES = ['birch', 'oak', 'pine'];
const SEASONS = [undefined, 'spring', 'summer', 'autumn', 'winter'];
const BUCKETS = Array.from({ length: INF_BUCKETS + 1 }, (_, b) => b);

/* ------------------------------------------------------------------ pure parameters */

test('bucket 0 is a healthy crown: no wash, no holes, no dead leaves', () => {
  for (const sp of SPECIES) {
    for (const se of SEASONS) {
      const L = infectionLook(0, sp, se);
      assert.equal(L.active, false);
      assert.equal(L.wash, 0);
      assert.equal(L.cover, 0);
      assert.equal(L.blotches, 0);
      assert.equal(L.dead, 0);
    }
  }
  assert.equal(washAmount(undefined, 'oak', 'autumn'), 0);
  assert.equal(holeCover(NaN, 'pine'), 0);
});

test('every step of infection browns, thins and speckles more (all species and seasons)', () => {
  for (const sp of SPECIES) {
    for (const se of SEASONS) {
      for (let b = 1; b <= INF_BUCKETS; b++) {
        const a = infectionLook(b - 1, sp, se);
        const c = infectionLook(b, sp, se);
        assert.ok(c.active, `${sp}/${se}/${b} active`);
        assert.ok(c.wash > a.wash, `${sp}/${se}/${b} wash grows`);
        assert.ok(c.cover > a.cover, `${sp}/${se}/${b} cover grows`);
        assert.ok(c.blotches >= a.blotches, `${sp}/${se}/${b} blotches do not shrink`);
        assert.ok(c.dead >= a.dead, `${sp}/${se}/${b} dead leaves do not shrink`);
      }
    }
  }
});

test('the parameters stay bounded, and bad input reads as a healthy tree or the nearest bucket', () => {
  for (const sp of SPECIES) {
    for (const se of SEASONS) {
      for (const b of [-3, 0, 1, 2, 3, 4, 9, NaN, undefined, 2.4]) {
        const L = infectionLook(b, sp, se);
        assert.ok(L.wash >= 0 && L.wash <= MAX_WASH, 'wash');
        assert.ok(L.cover >= 0 && L.cover <= MAX_COVER, 'cover');
        assert.ok(L.blotches >= 0 && L.blotches <= 8, 'blotches');
        assert.ok(L.dead >= 0 && L.dead <= 8, 'dead');
        assert.match(L.color, /^#[0-9a-f]{6}$/i);
      }
    }
  }
  assert.equal(infectionLook(9, 'oak').bucket, INF_BUCKETS);
  assert.equal(infectionLook(-1, 'oak').bucket, 0);
});

test('infection brown is visible on the autumn crown, rusty for needles, and a bare crown gets only a light touch', () => {
  // the wash is the crown's own change of colour: stronger on the yellow autumn crown than in summer
  assert.ok(washAmount(2, 'birch', 'autumn') > washAmount(2, 'birch', 'summer'));
  assert.ok(washAmount(2, 'pine', 'summer') > washAmount(2, 'birch', 'summer'));
  assert.notEqual(washColor('birch', 'autumn'), washColor('pine', 'autumn'));
  assert.ok(washAmount(2, 'birch', 'autumn') >= 0.3, 'at 40-50 % infection a yellow crown is clearly browner');
  assert.ok(isBareCrown('birch', 'winter') && isBareCrown('oak', 'winter') && !isBareCrown('pine', 'winter') && !isBareCrown('oak', 'autumn'));
  assert.ok(washAmount(2, 'oak', 'winter') < washAmount(2, 'oak', 'autumn') / 2);
  assert.equal(blotchCount(4, 'oak', 'winter'), 0);
  assert.equal(deadDensity(4, 'birch', 'winter'), 0);
  assert.ok(deadDensity(4, 'pine', 'winter') > 0, 'an evergreen is not bare in winter');
});

test('the infection steps of rival-logic map onto the look buckets', () => {
  for (const inf of [0, 0.03, 0.1, 0.4, 0.8, 1]) assert.ok(infectionLook(infBucket(inf), 'oak', 'summer').bucket === infBucket(inf));
  assert.equal(infectionLook(infBucket(0.4), 'birch', 'autumn').active, true, 'a tree at 40 % is already painted as sick');
});

test('a snag keeps about half a tall trunk (nearly all of an oak stem) and is thicker than the living stem', () => {
  for (const r of [0, 0.3, 0.7, 1]) {
    for (const sp of ['birch', 'pine']) {
      const k = snagKeep(sp, r);
      assert.ok(k >= 0.38 && k <= 0.55, `${sp} keeps ${k}`);
    }
    const o = snagKeep('oak', r);
    assert.ok(o > 0.7 && o <= 1);
  }
  assert.ok(snagKeep('birch', 0) < snagKeep('birch', 1));
  assert.equal(snagKeep('unknown', 0.5), snagKeep('oak', 0.5));
  assert.equal(snagKeep('birch', NaN), snagKeep('birch', 0));
  // widths of a tapering trunk of 40 points, 12 wide at the base
  const w = Array.from({ length: 40 }, (_, i) => 12 * (1 - 0.92 * (i / 39)));
  const n = 20;
  const sw = snagWidths(w, 12, n);
  assert.equal(sw.length, n);
  for (let i = 0; i < n; i++) {
    assert.ok(sw[i] >= w[i], 'never thinner than the living trunk');
    assert.ok(sw[i] <= 1.5 * 12, 'but still a trunk');
  }
  assert.ok(sw[n - 1] / w[n - 1] >= 1.3, 'the top is at least a third thicker');
  assert.ok(Math.abs(sw[0] - 12) <= 12 * 0.1, 'the foot keeps its width');
  assert.ok(sw[n - 1] / sw[0] > w[n - 1] / w[0], 'less tapered');
});

test('the spires of a broken top differ in height and one of them is tall', () => {
  for (let seed = 1; seed <= 25; seed++) {
    for (const hw of [3, 6, 12]) {
      const rng = mulberry(seed);
      const k = 5;
      const hts = snagSpires(hw, k, rng);
      assert.equal(hts.length, k);
      const max = Math.max(...hts);
      const rest = hts.filter((h) => h !== max);
      assert.ok(hts.every((h) => h > 0 && h <= 60));
      assert.ok(max >= 20, 'a tall splinter');
      assert.ok(Math.max(...rest) < max, 'the tallest stands alone');
      assert.ok(new Set(hts.map((h) => h.toFixed(2))).size >= k - 1, 'different heights');
    }
  }
  assert.deepEqual(snagSpires(8, 4, mulberry(5)), snagSpires(8, 4, mulberry(5)), 'deterministic');
});

/* ------------------------------------------------------------------ the painters, on a recording fake context */

/** A 2D context that does nothing but remember: calls (name + rounded numbers), and what was filled under which operation. */
function fakeCtx(w = 400, h = 400) {
  const log = [];
  const st = { globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: '#000' };
  const stack = [];
  const stats = { erase: 0, wash: [], granulated: 0, calls: 0 };
  const num = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : typeof v === 'string' ? v : typeof v);
  const handler = {
    get(_, name) {
      if (name in st) return st[name];
      if (name === 'canvas') return { width: w, height: h };
      if (name === 'save') return () => stack.push({ ...st });
      if (name === 'restore') return () => Object.assign(st, stack.pop() || {});
      if (name === 'createRadialGradient' || name === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (name === 'createPattern') return () => ((stats.granulated += 1), {});
      if (name === 'createImageData') return (cw, ch) => ({ data: new Uint8ClampedArray(cw * ch * 4) });
      if (name === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 200, f: 300 });
      if (name === 'putImageData' || name === 'drawImage') return () => {};
      return (...args) => {
        stats.calls++;
        log.push(`${String(name)}(${args.map(num).join(',')})`);
        if (name === 'fill' && st.globalCompositeOperation === 'destination-out') stats.erase++;
        if (name === 'fillRect' && st.globalCompositeOperation === 'source-atop' && args[2] >= w) stats.wash.push(st.globalAlpha);
      };
    },
    set(_, name, value) {
      st[name] = value;
      if (name === 'globalCompositeOperation') log.push(`op=${value}`);
      return true;
    },
  };
  return { ctx: new Proxy({}, handler), log, stats };
}

/** The painters make grain tiles through OffscreenCanvas (and the oak crown through Path2D and document) when there is no browser: give them stubs. */
function withCanvasStub(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  const hadPath = Object.getOwnPropertyDescriptor(globalThis, 'Path2D');
  const hadDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.Path2D = class {
    moveTo() {}
    lineTo() {}
    closePath() {}
    quadraticCurveTo() {}
    rect() {}
  };
  class Canvas {
    constructor(w, h) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return fakeCtx(this.width, this.height).ctx;
    }
  }
  globalThis.OffscreenCanvas = Canvas;
  globalThis.document = { createElement: () => new Canvas(1, 1) };
  try {
    return fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'OffscreenCanvas', had);
    else delete globalThis.OffscreenCanvas;
    if (hadDoc) Object.defineProperty(globalThis, 'document', hadDoc);
    else delete globalThis.document;
    if (hadPath) Object.defineProperty(globalThis, 'Path2D', hadPath);
    else delete globalThis.Path2D;
  }
}

const run = (steps) => steps.forEach((f) => f());

test('infection steps: none for a healthy crown, more of them as the infection grows, all of them run', () => {
  withCanvasStub(() => {
    for (const sp of SPECIES) {
      for (const stage of [1, 2, 3]) {
        const m = buildModel(sp, stage, 4242 + stage);
        for (const se of SEASONS) {
          let prev = 0;
          for (const b of BUCKETS) {
            const v = 0.8;
            const { ctx, stats } = fakeCtx();
            const steps = infectionSteps(ctx, m, b, v, se, 400, 400);
            if (b === 0) {
              assert.deepEqual(steps, [], `${sp}/${stage}/${se}: a healthy crown gets no steps`);
              continue;
            }
            assert.ok(Array.isArray(steps) && steps.length > 0, `${sp}/${stage}/${se}/${b}: has steps`);
            assert.ok(steps.every((f) => typeof f === 'function'));
            assert.doesNotThrow(() => run(steps), `${sp}/${stage}/${se}/${b}`);
            assert.ok(steps.length >= prev - 1, 'more infection, at least as many steps');
            prev = steps.length;
            assert.ok(stats.erase > 0, `${sp}/${stage}/${se}/${b}: some leaves are erased`);
            if (!isBareCrown(sp, se)) assert.equal(stats.wash.length, 1, 'one wash over the whole sprite');
            if (stats.wash.length) assert.ok(Math.abs(stats.wash[0] - washAmount(b, sp, se)) < 1e-9, 'with the wash alpha of the bucket');
          }
        }
      }
    }
  });
});

test('infection steps are deterministic and the speckles of a lower bucket come first', () => {
  withCanvasStub(() => {
    for (const sp of SPECIES) {
      const m = buildModel(sp, 3, 99);
      const draw = (b) => {
        const { ctx, log } = fakeCtx();
        run(infectionSteps(ctx, m, b, 0.7, 'autumn', 400, 400));
        return log;
      };
      assert.deepEqual(draw(3), draw(3), `${sp}: same picture for the same seed`);
      const m2 = buildModel(sp, 3, 100);
      const { ctx, log } = fakeCtx();
      run(infectionSteps(ctx, m2, 3, 0.7, 'autumn', 400, 400));
      assert.notDeepEqual(log, draw(3), `${sp}: another seed, another picture`);
      // the dead-leaf stream does not depend on the bucket: the first dead leaves of bucket 2 open those of bucket 4
      const a = draw(2).filter((l) => l.startsWith('quadraticCurveTo') || l.startsWith('lineTo'));
      const c = draw(4).filter((l) => l.startsWith('quadraticCurveTo') || l.startsWith('lineTo'));
      assert.ok(c.length >= a.length, `${sp}: more strokes at bucket 4`);
    }
  });
});

test('crownSteps for a leafy crown still run for every season after the lobe helper was shared with the infection painter', () => {
  withCanvasStub(() => {
    for (const sp of SPECIES) {
      const m = buildModel(sp, 3, 7);
      for (const se of SEASONS) for (const v of [0.1, 0.5, 1]) {
        const { ctx } = fakeCtx();
        assert.doesNotThrow(() => run(crownSteps(ctx, m, v, 400, 400, se)), `${sp}/${se}/${v}`);
      }
    }
  });
});

test('snag steps: a list of steps for every species and stage, the last one granulates, the same seed paints the same snag', () => {
  withCanvasStub(() => {
    for (const sp of SPECIES) {
      for (const stage of [0, 1, 2, 3]) {
        for (const seed of [1, 7, 31, 1234]) {
          const m = buildModel(sp, stage, seed);
          const { ctx, log, stats } = fakeCtx();
          const steps = snagSteps(ctx, m, 400, 400);
          assert.ok(Array.isArray(steps) && steps.length >= 6, `${sp}/${stage}/${seed}: a handful of steps`);
          assert.ok(steps.every((f) => typeof f === 'function'));
          assert.doesNotThrow(() => run(steps.slice(0, -1)), `${sp}/${stage}/${seed}`);
          assert.equal(stats.granulated, 0, 'only the last step granulates');
          steps[steps.length - 1]();
          assert.ok(stats.granulated > 0, 'the last step granulates the whole sprite');
          const again = fakeCtx();
          run(snagSteps(again.ctx, buildModel(sp, stage, seed), 400, 400));
          assert.deepEqual(again.log.slice(0, log.length), log, `${sp}/${stage}/${seed}: deterministic`);
          assert.equal(stats.erase, 0, 'a snag erases nothing');
        }
      }
    }
  });
});

test('snag steps differ from species to species and from tree to tree', () => {
  withCanvasStub(() => {
    const logOf = (sp, seed) => {
      const { ctx, log } = fakeCtx();
      run(snagSteps(ctx, buildModel(sp, 3, seed), 400, 400));
      return log.join('|');
    };
    assert.notEqual(logOf('birch', 5), logOf('oak', 5));
    assert.notEqual(logOf('oak', 5), logOf('pine', 5));
    assert.notEqual(logOf('birch', 5), logOf('birch', 6));
  });
});

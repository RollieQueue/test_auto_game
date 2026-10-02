// The mushrooms' draw pass with clumps: the main cap stays at the simulation's position, the small caps stand where
// mushroom-cluster.js puts them, nothing moves between frames, and a wilted mushroom's clump fades instead of vanishing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMushrooms } from '../src/render/mushrooms.js';
import { _setSpritesForTest } from '../src/render/sprites.js';
import { clusterOf, clumpLayout, companionGrowth } from '../src/render/mushroom-cluster.js';
import { groundYAt, targetAt } from '../src/world/query.js';

// the halo sprites and the mushrooms' wash copies are made on canvases: a stub that accepts any call stands in for them
class FakeCanvas {
  constructor(w, h) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    const noop = () => {};
    return new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : t[k] || noop), set: (t, k, v) => ((t[k] = v), true) });
  }
}
globalThis.OffscreenCanvas = FakeCanvas;

const entry = (id, type) => ({ id, group: 'mushroom', type, file: `${id}.webp`, w: 8, h: 10, anchor: { x: 4, y: 10 }, worldSize: 50, img: {} });

/** A 2D context that records where each drawImage landed (the identity view: the transform's e and f are world x and y). */
function recorder() {
  const log = [];
  let cur = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const noop = () => {};
  const base = {
    globalAlpha: 1,
    getTransform: () => ({ ...cur }),
    setTransform: (a, b, c, d, e, f) => {
      cur = typeof a === 'object' ? { ...a } : { a, b, c, d, e, f };
    },
    drawImage: () => log.push({ ...cur, alpha: base.globalAlpha }),
  };
  const ctx = new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) });
  return { ctx, log };
}

const world = (seed) => ({ seed, width: 1920, height: 1080, step: 16, ground: new Array(130).fill(300).map((y, i) => y + 12 * Math.sin(i / 3)), trees: [], horizons: [] });
const mushroom = (id, x, world0) => ({ id, x, baseY: groundYAt(world0, x), growth: 1, mature: true, variant: id });

test('the main cap stays at the sim position; the small caps stand at the clump offsets; frames agree', () => {
  _setSpritesForTest([entry('mushroom.common.1', 'common'), entry('mushroom.common.2', 'common')]);
  const w = world(7);
  const ms = Array.from({ length: 8 }, (_, i) => mushroom(i, 200 + 150 * i, w));
  const state = { world: w, mushrooms: ms, flags: {}, clock: {} };
  const view = createMushrooms();
  const frames = [];
  for (const t of [1, 1.5, 9]) {
    const { ctx, log } = recorder();
    view.draw(ctx, state, t, 0.05);
    frames.push(log);
  }
  for (const log of frames) {
    const bodies = log.filter((e) => e.alpha === 1); // the bodies (a halo, if any, is drawn lighter)
    let k = 0;
    for (const m of [...ms].sort((a, b) => a.baseY - b.baseY)) { // the view draws from the back (small baseY) to the front
      const { look, cl } = clumpLayout(w, m);
      const expect = cl.length + 1;
      const group = bodies.slice(k, k + expect);
      k += expect;
      const main = group[group.length - 1]; // the clump stands behind the main cap
      assert.ok(Math.abs(main.e - m.x) < 1e-6, `mushroom ${m.id}: the main cap's x is the sim x (${main.e} vs ${m.x})`);
      assert.ok(main.f >= m.baseY && main.f <= m.baseY + 4, `mushroom ${m.id}: and sits on its baseY (${main.f} vs ${m.baseY})`);
      cl.forEach((c, j) => {
        assert.ok(Math.abs(group[j].e - (m.x + c.dx * look.size)) < 1e-6, `mushroom ${m.id}: cap ${j} stands at the clump offset (scaled by the main cap's size)`);
        const ground = groundYAt(w, m.x + c.dx * look.size) + c.dy;
        assert.ok(group[j].f >= ground && group[j].f <= ground + 4, 'on the ground at its own x');
      });
    }
    assert.equal(k, bodies.length, 'no caps beyond the clumps');
  }
  // placement never changes between frames (only the gentle sway does)
  const xy = (log) => log.map((e) => [Math.round(e.e * 1e6), Math.round(e.f * 1e6)]);
  assert.deepEqual(xy(frames[1]), xy(frames[0]));
  assert.deepEqual(xy(frames[2]), xy(frames[0]));
  // the hover target of the sim is still the main cap's spot
  const m = ms[3];
  assert.deepEqual(targetAt({ ...w, trees: [], water: [], minerals: [], rocks: [], horizons: [] }, ms, m.x, m.baseY - 20), { kind: 'mushroom', id: m.id });
});

test('a young mushroom draws the clump only as it grows; another world draws another clump', () => {
  _setSpritesForTest([entry('mushroom.common.1', 'common'), entry('mushroom.common.2', 'common')]);
  const w = world(13);
  const m = { ...mushroom(5, 700, w), growth: 0.1, mature: false };
  const bodiesAt = (g, seed) => {
    const state = { world: { ...w, seed }, mushrooms: [{ ...m, growth: g }], flags: {}, clock: {} };
    const view = createMushrooms();
    let log;
    for (let i = 0; i < 30; i++) {
      const r = recorder();
      view.draw(r.ctx, state, i * 0.2, 0.2); // the shown growth eases toward the real one
      log = r.log;
    }
    return log.filter((e) => e.alpha === 1).length;
  };
  const cl = clusterOf(13, 5);
  assert.equal(bodiesAt(0.1, 13), 1 + cl.filter((c) => companionGrowth(0.1, c) >= 0.03).length);
  assert.equal(bodiesAt(1, 13), 1 + cl.length);
  const other = [1, 2, 3, 4, 5, 6].map((s) => bodiesAt(1, s));
  assert.ok(new Set(other).size > 1, `different worlds, different clump sizes: ${other}`);
});

test('a wilted mushroom keeps its small caps for a while, fading, then they are gone', () => {
  _setSpritesForTest([entry('mushroom.common.1', 'common')]);
  const w = world(7);
  let id = 0;
  while (clusterOf(7, id).length < 2) id++;
  const m = mushroom(id, 600, w);
  const state = { world: w, mushrooms: [m], flags: {}, clock: {} };
  const view = createMushrooms();
  for (let t = 1; t < 2; t += 0.1) view.draw(recorder().ctx, state, t, 0.1);
  state.mushrooms = []; // the thread was cut: fauna.js plays the main cap's wilt
  const first = recorder();
  view.draw(first.ctx, state, 2.2, 0.1);
  const standing = (log) => new Set(log.map((e) => Math.round(e.e))).size;
  assert.equal(standing(first.log), 2, 'both small caps are still standing');
  const later = recorder();
  view.draw(later.ctx, state, 3.2, 0.5);
  assert.equal(standing(later.log), 2);
  assert.ok(later.log[0].alpha < first.log[0].alpha || later.log[0].alpha < 1, 'and fading');
  const gone = recorder();
  view.draw(gone.ctx, state, 8, 0.1);
  assert.equal(gone.log.length, 0, 'and gone after the wilt');
});

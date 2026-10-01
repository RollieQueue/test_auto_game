// Honey-fungus rival, rendering side: the pure helpers (infection -> crown, wither -> alpha, cache key, timing), the sprite
// lookups (the player's mushrooms never wear the rival's `honey` images) and the rule that missing fields draw nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROW_TIME,
  INF_BUCKETS,
  MAX_CAPS,
  barrierLook,
  cameraKey,
  clusterLook,
  growFrac,
  infBucket,
  infectedVitality,
  infectionLook,
  isLost,
  mantleOf,
  rivalCacheKey,
  rivalParts,
  sallowAmount,
  stumpsOf,
  witherAlpha,
} from '../src/render/rival-logic.js';
import { _setSpritesForTest, getSprite, honeySprite, mushroomLook, mushroomSprite, spriteTypes, stumpSprite } from '../src/render/sprites.js';
import { applyRivalFixture } from '../src/render/fixture.js';
import { generateWorld } from '../src/world/generate.js';

/* ------------------------------------------------------------------ infection -> crown */

test('infection buckets: healthy stays 0, the rest rise to INF_BUCKETS', () => {
  assert.equal(infBucket(0), 0);
  assert.equal(infBucket(0.02), 0);
  assert.equal(infBucket(undefined), 0);
  assert.equal(infBucket(NaN), 0);
  assert.equal(infBucket(0.3), 1);
  assert.equal(infBucket(0.7), 3);
  assert.equal(infBucket(1), INF_BUCKETS);
  assert.equal(infBucket(5), INF_BUCKETS);
  assert.equal(infBucket(-1), 0);
  let prev = 0;
  for (let i = 0; i <= 100; i++) {
    const b = infBucket(i / 100);
    assert.ok(b >= prev, 'monotonic');
    prev = b;
  }
});

test('infection thins the crown and turns it sallow; a healthy tree is untouched', () => {
  assert.equal(infectedVitality(0.8, 0), 0.8);
  assert.equal(sallowAmount(0), 0);
  const looks = [0, 0.3, 0.7, 1].map(infectionLook);
  for (let i = 1; i < looks.length; i++) {
    assert.ok(looks[i].vitality < looks[i - 1].vitality, 'thinner with infection');
    assert.ok(looks[i].sallow > looks[i - 1].sallow, 'more sallow with infection');
  }
  assert.equal(looks[0].vitality, 1);
  assert.ok(looks[3].vitality > 0 && looks[3].vitality < 0.25, 'a fully infected crown is sparse but not gone');
  assert.ok(looks[3].sallow <= 0.6, 'the yellow wash stays a wash');
  // never brighter than the tree's own vitality, and stays within 0..1
  for (const v of [0, 0.25, 0.5, 1]) for (let b = 0; b <= INF_BUCKETS; b++) assert.ok(infectedVitality(v, b) <= Math.max(v, 0.06) + 1e-9);
});

test('missing tree fields read as 0 / 0 / false', () => {
  assert.equal(isLost({}), false);
  assert.equal(isLost(null), false);
  assert.equal(isLost({ lost: true }), true);
  assert.equal(mantleOf({}), 0);
  assert.equal(mantleOf(undefined), 0);
  assert.equal(mantleOf({ mantle: 3 }), 1);
  assert.equal(mantleOf({ mantle: 0.4 }), 0.4);
});

/* ------------------------------------------------------------------ wither, growth, barrier, cluster */

test('wither fades an edge from fully drawn to gone', () => {
  assert.equal(witherAlpha(0), 1);
  assert.equal(witherAlpha(1), 0);
  assert.equal(witherAlpha(undefined), 1);
  assert.equal(witherAlpha(-3), 1);
  assert.equal(witherAlpha(9), 0);
  let prev = 1;
  for (let i = 1; i <= 20; i++) {
    const a = witherAlpha(i / 20);
    assert.ok(a < prev, 'strictly falling');
    prev = a;
  }
  assert.ok(witherAlpha(0.5) < 0.5, 'drops quickly at first');
});

test('edges grow in from their born time', () => {
  assert.equal(growFrac(10, 10), 0);
  assert.ok(Math.abs(growFrac(10 + GROW_TIME / 2, 10) - 0.5) < 1e-9);
  assert.equal(growFrac(10 + GROW_TIME * 3, 10), 1);
  assert.equal(growFrac(5, 10), 0, 'not born yet');
  assert.equal(growFrac(10, undefined), 1, 'unknown born reads as grown');
  assert.equal(growFrac(undefined, 3), 1);
});

test('barrier: the ring is drawn on, stays, then fades towards dur', () => {
  assert.equal(barrierLook({ t: 0, dur: 90 }).draw, 0);
  assert.ok(barrierLook({ t: 0.4, dur: 90 }).draw > 0 && barrierLook({ t: 0.4, dur: 90 }).draw < 1);
  assert.equal(barrierLook({ t: 20, dur: 90 }).draw, 1);
  assert.equal(barrierLook({ t: 20, dur: 90 }).alpha, 1);
  const fading = [60, 70, 80, 85, 89, 90].map((t) => barrierLook({ t, dur: 90 }).alpha);
  for (let i = 1; i < fading.length; i++) assert.ok(fading[i] <= fading[i - 1]);
  assert.equal(fading[0], 1);
  assert.equal(fading[fading.length - 1], 0);
  assert.equal(barrierLook({ t: 95, dur: 90 }).done, true);
  assert.doesNotThrow(() => barrierLook(null));
  assert.doesNotThrow(() => barrierLook({}));
});

test('honey cluster: caps are capped, the tuft grows in with age', () => {
  assert.equal(clusterLook({ n: 99, age: 100 }).n, MAX_CAPS);
  assert.equal(clusterLook({ n: 0, age: 0 }).n, 1);
  assert.equal(clusterLook({}).n, 1);
  assert.equal(clusterLook({ n: 3, age: 0 }).grow, 0);
  assert.equal(clusterLook({ n: 3, age: 60 }).grow, 1);
  assert.ok(clusterLook({ n: 3, age: 7 }).grow > 0.3);
});

/* ------------------------------------------------------------------ cache key */

test('cache key changes with ver, scale, offset and canvas size, and nothing else', () => {
  const view = { scale: 0.8, ox: 12.5, oy: 3 };
  const base = rivalCacheKey({ ver: 4 }, view, 1600, 900);
  assert.equal(rivalCacheKey({ ver: 4, edges: [1, 2, 3] }, { ...view }, 1600, 900), base, 'same inputs, same key');
  assert.notEqual(rivalCacheKey({ ver: 5 }, view, 1600, 900), base);
  assert.notEqual(rivalCacheKey({ ver: 4 }, { ...view, scale: 0.81 }, 1600, 900), base);
  assert.notEqual(rivalCacheKey({ ver: 4 }, { ...view, ox: 14 }, 1600, 900), base);
  assert.notEqual(rivalCacheKey({ ver: 4 }, { ...view, oy: 9 }, 1600, 900), base);
  assert.notEqual(rivalCacheKey({ ver: 4 }, view, 1601, 900), base);
  assert.notEqual(rivalCacheKey({ ver: 4 }, view, 1600, 901), base);
  // sub-pixel noise is ignored
  assert.equal(rivalCacheKey({ ver: 4 }, { ...view, scale: 0.80001 }, 1600, 900), base);
  // without ver the edge count stands in; a missing rival or view never throws
  assert.notEqual(rivalCacheKey({ edges: [1] }, view, 1, 1), rivalCacheKey({ edges: [1, 2] }, view, 1, 1));
  assert.doesNotThrow(() => rivalCacheKey(null, null));
  // wither does not change it: it is not part of the key
  assert.equal(rivalCacheKey({ ver: 4, edges: [{ wither: 0.5 }] }, view, 1600, 900), base);
  // the camera part alone ignores ver
  assert.equal(cameraKey(view, 1600, 900), cameraKey(view, 1600, 900));
  assert.ok(!cameraKey(view, 1600, 900).includes('4|'));
});

/* ------------------------------------------------------------------ sprites */

const entry = (id, group, type, h = 100) => ({ id, group, type, file: `assets/art/${id}.webp`, w: 80, h, anchor: { x: 40, y: h }, worldSize: 50, img: {} });

test('the player\'s mushrooms never pick the rival\'s honey images', () => {
  _setSpritesForTest([
    entry('mushroom.common.1', 'mushroom', 'common'),
    entry('mushroom.fly_agaric.1', 'mushroom', 'fly_agaric'),
    entry('mushroom.porcini.1', 'mushroom', 'porcini'),
    entry('mushroom.honey.1', 'mushroom', 'honey'),
    entry('mushroom.honey.2', 'mushroom', 'honey'),
    entry('decor.stump.1', 'decor', 'stump'),
  ]);
  assert.ok(spriteTypes('mushroom').includes('honey'), 'the manifest does carry them');
  const trees = [{ x: 100, species: 'birch' }, { x: 900, species: 'oak' }];
  const kinds = [undefined, 'common', 'honey', 'fly_agaric', 'chanterelle', 'nonsense'];
  for (const species of kinds) {
    for (let id = 0; id < 80; id++) {
      const m = { id, species, variant: id % 5, x: (id * 37) % 1000 };
      assert.notEqual(mushroomLook(m, trees), 'honey', `look ${species}/${id}`);
      const s = mushroomSprite(m, trees);
      assert.ok(s, 'some sprite is found');
      assert.notEqual(s.type, 'honey', `sprite ${species}/${id}`);
    }
  }
  // the rival's own lookups find them, and are stable per id
  assert.equal(honeySprite(3).type, 'honey');
  assert.equal(honeySprite(3).id, honeySprite(3).id);
  assert.deepEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((i) => honeySprite(i).id)), new Set(['mushroom.honey.1', 'mushroom.honey.2']));
  assert.equal(stumpSprite(1).id, 'decor.stump.1');
  assert.equal(getSprite('decor', 'stump', 7).id, 'decor.stump.1');
});

test('without the images the lookups return null (procedural drawing takes over)', () => {
  _setSpritesForTest([entry('mushroom.common.1', 'mushroom', 'common')]);
  assert.equal(honeySprite(1), null);
  assert.equal(stumpSprite(1), null);
  assert.equal(mushroomSprite({ id: 1, species: 'honey', x: 0 }, []).type, 'common');
});

/* ------------------------------------------------------------------ nothing to draw */

// a 2D context that only records what is painted
function recorder() {
  const log = [];
  const PAINT = new Set(['drawImage', 'fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'putImageData']);
  const canvas = { width: 1600, height: 900 };
  const m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const ctx = new Proxy(
    {},
    {
      get(_, k) {
        if (k === 'canvas') return canvas;
        if (k === 'getTransform') return () => m;
        if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
        if (k === 'createPattern') return () => ({});
        if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
        return (...args) => {
          if (PAINT.has(k)) log.push(k);
          return args[0];
        };
      },
      set() {
        return true;
      },
    },
  );
  return { ctx, log };
}

class FakePath {
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
}
class FakeCanvas {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.ctx = recorder().ctx;
  }
  getContext() {
    return this.ctx;
  }
}

async function rivalApi() {
  globalThis.Path2D = FakePath;
  globalThis.OffscreenCanvas = FakeCanvas;
  const { createRival } = await import('../src/render/rival.js');
  return createRival();
}

test('no rival, no stumps, no barriers: nothing is drawn and nothing throws', async () => {
  const rival = await rivalApi();
  const world = { stumps: [{ id: 1, x: 100, y: 200, r: 30 }], trees: [] };
  const states = [
    { world: {}, ui: {}, events: [] },
    { world, ui: {}, events: [] }, // stumps but no state.rival (old save, ?rival=0): not drawn
    { world, rival: null, barriers: [], ui: { tool: 'grow' } },
    { world: {}, rival: {}, ui: { tool: 'barrier' } }, // tool but no pick
    { world: {}, rival: undefined, barriers: undefined, ui: { tool: 'barrier', barrierPick: null } },
    { world: { stumps: [] }, rival: { awake: false }, barriers: [], ui: {} },
  ];
  for (const state of states) {
    const { ctx, log } = recorder();
    assert.doesNotThrow(() => {
      rival.reset(state.world);
      rival.drawSoil(ctx, state, 1, 1 / 60);
      rival.drawSurface(ctx, state, 1, 1 / 60);
      rival.drawFx(ctx, state, 1, 1 / 60);
    });
    assert.deepEqual(log, [], `painted something: ${log.join(',')}`);
  }
  assert.doesNotThrow(() => rival.drawSoil(null, {}, 0, 0));
  assert.doesNotThrow(() => rival.drawSurface(undefined, undefined, 0, 0));
  assert.deepEqual(stumpsOf({ world }), []);
  assert.equal(stumpsOf({ world, rival: {} }).length, 1);
  assert.deepEqual(rivalParts({}), { nodes: [], edges: [], tips: [], grip: [], clusters: [] });
});

test('garbage inside the rival state never throws', async () => {
  const rival = await rivalApi();
  const { ctx } = recorder();
  const state = {
    time: 5,
    world: { stumps: [null, { id: 1 }, { id: 2, x: 5, y: 5 }], trees: [{ id: 1, stage: 'x' }] },
    rival: {
      ver: 'x',
      nodes: [null, { id: 0 }, { id: 1, x: 5, y: 6 }],
      edges: [null, { id: 1, a: 0, b: 9 }, { id: 2, a: 1, b: 1, alive: true }, { id: 3, a: 1, b: 1, alive: true, wither: 'a', born: NaN }],
      tips: [null, { x: NaN }, { id: 1, node: 77, x: 3, y: 4 }],
      grip: [null, {}, { treeId: 1, x: 1, y: 2 }],
      clusters: [null, { x: 1 }, { id: 4, x: 10, y: 10, n: 'many', age: -5 }],
    },
    barriers: [null, {}, { id: 1, x: 10, y: 10, r: 'big', t: -1, dur: 0 }],
    ui: { tool: 'barrier', barrierPick: { x: 'a', y: 2 } },
  };
  assert.doesNotThrow(() => {
    rival.reset(state.world);
    rival.drawSoil(ctx, state, 1, 1 / 60);
    rival.drawSurface(ctx, state, 1, 1 / 60);
    rival.drawFx(ctx, state, 1, 1 / 60);
  });
  for (const ev of [null, 7, {}, { type: 'rival-wake' }, { type: 'tree-lost', treeId: 99 }, { type: 'barrier-placed', id: 3 }, { type: 'rival-cut', x: 1, y: 2 }, { type: 'rival-fruit', x: 'a' }]) {
    assert.doesNotThrow(() => rival.event(ev, state), JSON.stringify(ev));
    assert.doesNotThrow(() => rival.event(ev, {}), JSON.stringify(ev));
    assert.doesNotThrow(() => rival.event(ev));
  }
  assert.doesNotThrow(() => rival.drawFx(ctx, state, 2, 1 / 60));
});

test('the gallery fixture builds a web of about 300 segments with every field of the contract', () => {
  const world = generateWorld(7);
  const state = { world, ui: {}, events: [], time: 0 };
  applyRivalFixture(state, { edges: 300 });
  const r = state.rival;
  assert.ok(r.edges.length >= 280 && r.edges.length <= 330, `edges ${r.edges.length}`);
  assert.equal(new Set(r.edges.map((e) => e.id)).size, r.edges.length);
  for (const e of r.edges) {
    assert.ok(r.nodes[e.a] && r.nodes[e.b]);
    assert.ok(e.w >= 1 && Number.isFinite(e.born) && e.wither >= 0 && e.wither <= 1);
  }
  assert.ok(r.edges.some((e) => e.wither > 0), 'withering edges');
  assert.ok(r.tips.length >= 3 && r.grip.length >= 2 && r.clusters.length >= 2);
  assert.ok(Number.isInteger(r.ver));
  assert.equal(world.stumps.length, 1);
  const inf = world.trees.map((t) => t.infection).sort();
  assert.ok(inf.includes(0) && inf.includes(0.3) && inf.includes(0.7) && world.trees.some((t) => t.lost));
  assert.ok(world.trees.some((t) => t.mantle > 0.5));
  assert.equal(state.barriers.length, 2);
  assert.ok(state.ui.barrierPick.ok);
});

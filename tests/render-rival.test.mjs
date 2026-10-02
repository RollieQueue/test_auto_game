// Honey-fungus rival, rendering side: the pure helpers (infection -> crown, wither -> alpha, cache key, timing), the sprite
// lookups (the player's mushrooms never wear the rival's `honey` images) and the rule that missing fields draw nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEAD_NEAR,
  GROW_TIME,
  INF_BUCKETS,
  MAX_CAPS,
  barrierLook,
  cameraKey,
  chaikin,
  clusterLook,
  curveAt,
  headingAlpha,
  growFrac,
  infBucket,
  infectedVitality,
  infectionLabel,
  infectionLook,
  isLost,
  mantleOf,
  rivalCacheKey,
  ringStrength,
  rivalParts,
  rootGoal,
  sallowAmount,
  smoothEdges,
  stumpsOf,
  tipPulse,
  tuftLayout,
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

/* ------------------------------------------------------------------ Chaikin chains, heading, tufts, rot ring */

const node = (id, x, y) => ({ id, x, y, alive: true });
const edge = (id, a, b, alive = true) => ({ id, a, b, w: 1, alive, born: 0, wither: 0 });
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

test('chaikin: ends stay, corners are cut at 1/4 and 3/4, the polyline never leaves its hull', () => {
  const pts = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }];
  const one = chaikin(pts, 1);
  assert.deepEqual(one[0], pts[0]);
  assert.deepEqual(one[one.length - 1], pts[2]);
  assert.deepEqual(one[1], { x: 10, y: 0 });
  assert.deepEqual(one[2], { x: 30, y: 0 });
  assert.deepEqual(one[3], { x: 40, y: 10 });
  const many = chaikin(pts, 4);
  assert.ok(many.length > one.length);
  for (const p of many) assert.ok(p.x >= 0 && p.x <= 40 && p.y >= 0 && p.y <= 40);
  // the right-angle corner is gone: nothing sits on the corner point any more
  assert.ok(many.every((p) => dist(p, { x: 40, y: 0 }) > 1));
  assert.deepEqual(chaikin([{ x: 1, y: 2 }], 3), [{ x: 1, y: 2 }]);
  assert.equal(chaikin([], 3).length, 0);
});

test('smoothEdges: a chain is one continuous, tangent-continuous curve through rounded corners', () => {
  // a right-angle bend: (0,0) -> (40,0) -> (40,40)
  const nodes = [node(0, 0, 0), node(1, 40, 0), node(2, 40, 40)];
  const edges = [edge(0, 0, 1), edge(1, 1, 2)];
  const m = smoothEdges(nodes, edges);
  const a = m.get(0);
  const b = m.get(1);
  // the two curves meet at the corner's apex, which is inside the corner (the corner itself is cut off)
  assert.ok(dist({ x: a.x1, y: a.y1 }, { x: b.x0, y: b.y0 }) < 1e-9);
  assert.ok(dist({ x: a.x1, y: a.y1 }, nodes[1]) > 2 && dist({ x: a.x1, y: a.y1 }, nodes[1]) < 20);
  // ... with the same tangent on both sides (C1): the direction into the apex equals the direction out of it
  const tin = { x: a.x1 - a.c2x, y: a.y1 - a.c2y };
  const tout = { x: b.c1x - b.x0, y: b.c1y - b.y0 };
  const cross = tin.x * tout.y - tin.y * tout.x;
  assert.ok(Math.abs(cross) < 1e-6, `tangent kink ${cross}`);
  assert.ok(tin.x * tout.x + tin.y * tout.y > 0);
  // free ends stay on their nodes
  assert.deepEqual([a.x0, a.y0], [0, 0]);
  assert.deepEqual([b.x1, b.y1], [40, 40]);
  assert.ok(a.len === 40 && b.len === 40);
  // curveAt walks from the first apex to the second
  assert.deepEqual(curveAt(a, 0), { x: a.x0, y: a.y0 });
  assert.ok(dist(curveAt(a, 1), { x: a.x1, y: a.y1 }) < 1e-9);
  assert.ok(dist(curveAt(a, 0.5), { x: a.mx, y: a.my }) < 1e-9);
  // the whole drawn chain stays inside the hull of its nodes and never passes the cut corner
  for (const s of [a, b]) for (let k = 0; k <= 1; k += 0.05) {
    const p = curveAt(s, k);
    assert.ok(p.x >= -1e-9 && p.x <= 40 + 1e-9 && p.y >= -1e-9 && p.y <= 40 + 1e-9);
    assert.ok(dist(p, { x: 40, y: 0 }) > 2);
  }
});

test('smoothEdges equals the limit of Chaikin: the curve through midpoints matches chaikin() of the node chain', () => {
  const nodes = [node(0, 0, 0), node(1, 30, 10), node(2, 50, 40), node(3, 90, 45), node(4, 100, 10)];
  const edges = [edge(0, 0, 1), edge(1, 1, 2), edge(2, 2, 3), edge(3, 3, 4)];
  const m = smoothEdges(nodes, edges);
  const curve = [];
  for (const e of edges) for (let k = 0; k < 1; k += 0.01) curve.push(curveAt(m.get(e.id), k));
  const ref = chaikin(nodes, 6);
  // every point of the reference lies within ~1 u of the exact curve (the ends differ: Chaikin keeps the end nodes)
  for (const p of ref.slice(8, -8)) {
    const d = Math.min(...curve.map((q) => dist(p, q)));
    assert.ok(d < 1, `reference point off the curve by ${d}`);
  }
});

test('smoothEdges: forks join the parent with the straightest child, dead edges and missing nodes are left out', () => {
  // parent 0->1, children 1->2 (straight on) and 1->3 (a sharp turn back)
  const nodes = [node(0, 0, 0), node(1, 40, 0), node(2, 80, 5), node(3, 20, 30)];
  const edges = [edge(0, 0, 1), edge(1, 1, 2), edge(2, 1, 3)];
  const m = smoothEdges(nodes, edges);
  const par = m.get(0);
  const straight = m.get(1);
  const turn = m.get(2);
  assert.ok(dist({ x: par.x1, y: par.y1 }, { x: straight.x0, y: straight.y0 }) < 1e-9, 'joined with the straight child');
  assert.deepEqual([turn.x0, turn.y0], [40, 0], 'the sharp child leaves from the node itself');
  // a node with a dead edge only has the alive ones to pair with
  const dead = smoothEdges(nodes, [edge(0, 0, 1), edge(1, 1, 2, false)]);
  assert.equal(dead.has(1), false);
  assert.deepEqual([dead.get(0).x1, dead.get(0).y1], [40, 0]);
  // missing nodes, garbage rows, self loops
  const bad = smoothEdges([node(0, 0, 0), null, { id: 1, x: NaN, y: 0 }], [null, edge(0, 0, 9), edge(1, 0, 1), edge(2, 0, 0)]);
  assert.equal(bad.size, 0);
  assert.equal(smoothEdges(undefined, undefined).size, 0);
});

test('rootGoal picks the sim\'s root tip: linked first, held ones skipped, shallow preferred, target x/y win', () => {
  const tree = { id: 3, stage: 2, baseY: 300, lost: false, tips: [{ x: 100, y: 400, minStage: 0 }, { x: 200, y: 320, minStage: 0 }, { x: 150, y: 330, minStage: 3 }] };
  const tip = { x: 190, y: 330, target: { kind: 'tree', id: 3 } };
  const g = rootGoal(tip, tree);
  assert.deepEqual([g.x, g.y], [200, 320], 'the nearest one the tree has grown');
  assert.ok(Math.abs(g.d - Math.hypot(10, 10)) < 1e-9);
  // held by a grip: the next one
  assert.deepEqual([rootGoal(tip, tree, { grips: [{ treeId: 3, tip: 1 }] }).x], [100]);
  // linked tips win over nearer unlinked ones
  assert.deepEqual([rootGoal(tip, tree, { claimed: new Set(['3:0']) }).x], [100]);
  // the sim may publish its own goal
  assert.deepEqual(rootGoal({ ...tip, target: { kind: 'tree', id: 3, x: 5, y: 6 } }, tree), { x: 5, y: 6, d: Math.hypot(185, 324) });
  assert.equal(rootGoal(tip, { ...tree, lost: true }), null);
  assert.equal(rootGoal(null, tree), null);
  assert.equal(rootGoal(tip, null), null);
  assert.equal(rootGoal({ x: NaN, y: 1 }, tree), null);
  assert.equal(rootGoal(tip, { id: 3, stage: 0, tips: [] }), null);
});

test('heading: shown inside 150 u only, fading in; the tip pulse is slow and still under reduced motion', () => {
  assert.equal(HEAD_NEAR, 150);
  assert.equal(headingAlpha(150), 0);
  assert.equal(headingAlpha(400), 0);
  assert.equal(headingAlpha(NaN), 0);
  assert.equal(headingAlpha(100), 1);
  assert.equal(headingAlpha(20), 1);
  let prev = 0;
  for (let d = 150; d >= 100; d -= 5) {
    const a = headingAlpha(d);
    assert.ok(a >= prev - 1e-12 && a >= 0 && a <= 1);
    prev = a;
  }
  assert.ok(headingAlpha(140) > 0 && headingAlpha(140) < 1);
  assert.equal(tipPulse(12.3, 4, true), 0.5);
  assert.equal(tipPulse(99, 1, true), 0.5);
  let lo = 1;
  let hi = 0;
  for (let t = 0; t < 8; t += 0.05) {
    const p = tipPulse(t, 2);
    lo = Math.min(lo, p);
    hi = Math.max(hi, p);
    assert.ok(p >= 0 && p <= 1);
  }
  assert.ok(lo < 0.05 && hi > 0.95, 'it swings the whole range');
  assert.notEqual(tipPulse(1, 1), tipPulse(1, 2), 'a phase per tip');
  // slow: less than one full swing per 3 s
  const crossings = [];
  for (let t = 0; t < 12; t += 0.01) if (tipPulse(t, 0) > 0.5 !== tipPulse(t + 0.01, 0) > 0.5) crossings.push(t);
  assert.ok(crossings.length <= 8);
});

test('tuftLayout: caps spread over a flat band around the foot, deterministic, never one column', () => {
  const hash = (a, b) => (Math.imul(a + 1, 2654435761) ^ Math.imul(b + 7, 40503)) >>> 0;
  for (const n of [1, 2, 3, 5, 7]) {
    const c = { id: 4, n, x: 100, y: 200, age: 30 };
    const caps = tuftLayout(c, hash);
    assert.equal(caps.length, n);
    assert.deepEqual(caps, tuftLayout(c, hash));
    for (const cap of caps) {
      assert.ok(Number.isFinite(cap.dx + cap.dy + cap.scale + cap.lean));
      assert.ok(cap.scale > 0.4 && cap.scale < 1.2);
      assert.ok(Math.abs(cap.dy) <= 7, 'a band, not a pile');
      assert.ok(Math.abs(cap.dx) <= 12 + n * 4.5 + 1e-9);
    }
    if (n >= 3) {
      const xs = caps.map((q) => q.dx).sort((p, q) => p - q);
      const gaps = xs.slice(1).map((v, i) => v - xs[i]);
      assert.ok(Math.min(...gaps) > 2, `caps stack in a column: ${gaps}`);
      assert.ok(xs[xs.length - 1] - xs[0] > 20, 'spread out sideways');
    }
  }
  // count and spread override the cluster's own size
  const wide = tuftLayout({ id: 1, n: 7 }, hash, 3, 40);
  assert.equal(wide.length, 3);
  assert.ok(wide.every((q) => Math.abs(q.dx) <= 40));
  assert.ok(tuftLayout({ id: 1, n: 7 }, hash).some((q) => q.row === 0) && tuftLayout({ id: 9, n: 7 }, hash).length === 7);
  assert.equal(tuftLayout(null, hash).length, 1);
});

test('infection mark and rot ring strength', () => {
  assert.equal(infectionLabel(0.4), '40 %');
  assert.equal(infectionLabel(0.43), '45 %');
  assert.equal(infectionLabel(0), '5 %');
  assert.equal(infectionLabel(1), '95 %');
  assert.equal(infectionLabel(NaN), '5 %');
  assert.equal(infectionLabel(0.04), '5 %');
  assert.ok(ringStrength(0, 0) >= 0.1 && ringStrength(0, 0) < 0.2, 'a new grip already shows a little');
  assert.ok(ringStrength(10, 0.5) > ringStrength(0, 0.5));
  assert.ok(ringStrength(10, 0.9) > ringStrength(10, 0.1));
  for (const [age, inf] of [[-5, 2], [1e9, 1e9], [NaN, NaN], [3, -1]]) {
    const s = ringStrength(age, inf);
    assert.ok(s >= 0 && s <= 1);
  }
});

test('the renderer draws the full fixture web (smoothed cords, tips, heading, rot rings, tufts) without throwing, and caches it', async () => {
  const rival = await rivalApi();
  // the fake Path2D of the other tests lacks the calls the heading and the «!» use
  globalThis.Path2D = class {
    moveTo() {}
    lineTo() {}
    quadraticCurveTo() {}
    closePath() {}
    ellipse() {}
  };
  const world = generateWorld(7);
  const state = { world, ui: {}, events: [], time: 0, flags: {} };
  applyRivalFixture(state, { edges: 120 });
  const tree = world.trees[0];
  const near = tree.tips[0];
  const r = state.rival;
  r.tips.push({ id: 90, node: r.nodes.length - 1, x: near.x - 60, y: near.y, dir: 0, target: { kind: 'tree', id: tree.id }, speed: 6 });
  r.ver++;
  const { ctx, log } = recorder();
  rival.reset(world);
  assert.doesNotThrow(() => {
    for (let i = 0; i < 4; i++) {
      state.time += 0.05;
      rival.drawSoil(ctx, state, 1 + i * 0.05, 0.05);
      rival.drawSurface(ctx, state, 1 + i * 0.05, 0.05);
      rival.drawFx(ctx, state, 1 + i * 0.05, 0.05);
    }
  });
  assert.ok(log.length > 20);
  // all edges are mature, so one repaint made the cache and the later frames only blit it
  const rebuilds = rival.stats.rebuilds;
  assert.ok(rebuilds >= 1 && rebuilds <= 2, `rebuilds ${rebuilds}`);
  rival.drawSoil(ctx, state, 2, 0.05);
  assert.equal(rival.stats.rebuilds, rebuilds, 'a steady frame repaints nothing');
  // a new node (ver bump) repaints it: the corner at the old end is rounded now
  r.nodes.push({ id: r.nodes.length, x: 300, y: 400, alive: true, born: 0 });
  r.edges.push({ id: r.edges.length, a: r.nodes.length - 2, b: r.nodes.length - 1, w: 1, alive: true, born: -9, wither: 0 });
  r.ver++;
  rival.drawSoil(ctx, state, 2.05, 0.05);
  assert.equal(rival.stats.rebuilds, rebuilds + 1);
});

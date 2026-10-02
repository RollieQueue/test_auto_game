// The raider's render side: black cord laid over the player's hyphae (state.rival.over), the raider's head, its heading to a
// point on a hypha, and the frost inside a standing barrier. Pure helpers first, then the renderer against a fake 2D context
// (no DOM in node): nothing is drawn when nothing is overgrown, a dead edge is skipped, the cord cache is never rebuilt by a
// change of cover / wither, and the frost needs a barrier.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeLook, hyphaCurve, overList, overLook, overPoints, pointAlong, raidGoal, raidPhase, OVER_W, FREEZE_DRAW } from '../src/render/rival-logic.js';
import { applyFixture, applyRaidFixture, applyRivalFixture } from '../src/render/fixture.js';
import { createState } from '../src/state.js';

/* ------------------------------------------------------------------ a fake 2D context that counts the calls that paint */

function recorder() {
  const calls = {};
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
          calls[k] = (calls[k] || 0) + 1;
          return args[0];
        };
      },
      set() {
        return true;
      },
    },
  );
  const paints = () => (calls.stroke || 0) + (calls.fill || 0) + (calls.fillRect || 0) + (calls.drawImage || 0);
  return { ctx, calls, paints };
}

class FakePath {
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  closePath() {}
  ellipse() {}
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

/** A player's hypha of four nodes running down from the origin, a rival with a mature web, and nothing overgrown yet. */
function makeState() {
  const nodes = [
    { id: 0, x: 100, y: 300, alive: true, parent: -1, dist: 0 },
    { id: 1, x: 120, y: 340, alive: true, parent: 0, dist: 45 },
    { id: 2, x: 150, y: 375, alive: true, parent: 1, dist: 90 },
    { id: 3, x: 190, y: 395, alive: true, parent: 2, dist: 135 },
  ];
  const edges = [1, 2, 3].map((b) => ({ id: b - 1, a: b - 1, b, len: 45, born: 0, alive: true, w: 1.6 }));
  const rnodes = [
    { id: 0, x: 600, y: 400, alive: true, born: -50 },
    { id: 1, x: 620, y: 420, alive: true, born: -50 },
    { id: 2, x: 640, y: 440, alive: true, born: -50 },
  ];
  const redges = [0, 1].map((i) => ({ id: i, a: i, b: i + 1, w: 1, alive: true, born: -50, wither: 0 }));
  return {
    time: 100,
    world: { stumps: [], trees: [] },
    ui: { tool: 'grow' },
    events: [],
    net: { nodes, edges, links: [] },
    barriers: [],
    rival: { awake: true, nodes: rnodes, edges: redges, tips: [], grip: [], clusters: [], over: [], ver: 1, rs: 1 },
  };
}

/* ------------------------------------------------------------------ pure helpers */

test('overList keeps the rows that can be drawn and drops the rest without throwing', () => {
  const s = makeState();
  s.rival.over = [
    { edge: 0, from: 1, cover: 1, wither: 0 },
    { edge: 2, from: 3, cover: 0.4, wither: 0.2 },
    { edge: 9, from: 1, cover: 1, wither: 0 }, // no such edge
    { edge: -1 },
    { edge: 'x' },
    null,
    undefined,
    {},
  ];
  s.net.edges[1].alive = false; // dead edge: not drawn (the sim removes the row on its next step)
  const rows = overList(s);
  assert.deepEqual(rows.map((r) => r.o.edge), [0, 2]);
  assert.ok(rows[0].A === s.net.nodes[0] && rows[0].B === s.net.nodes[1]);
  assert.deepEqual(overList({}), []);
  assert.deepEqual(overList({ rival: { over: [{ edge: 0 }] } }), [], 'no net');
  assert.deepEqual(overList({ rival: { over: 5 }, net: s.net }), []);
  s.net.nodes[2].x = NaN;
  assert.deepEqual(overList(s).map((r) => r.o.edge), [0], 'a node without coordinates');
});

test('hyphaCurve runs parent to child; overPoints starts at the end the raider entered and stops at cover', () => {
  const s = makeState();
  const e = s.net.edges[1]; // node 1 -> node 2
  const c = hyphaCurve(s.net.nodes, e);
  assert.deepEqual([c.x0, c.y0, c.x1, c.y1], [120, 340, 150, 375]);
  assert.equal(c.parentId, 1);
  assert.equal(c.childId, 2);
  const fromChild = overPoints(c, 2, 1);
  assert.deepEqual([fromChild[0], fromChild[1]], [150, 375], 'entered at the child end');
  assert.ok(Math.hypot(fromChild[fromChild.length - 2] - 120, fromChild[fromChild.length - 1] - 340) < 1e-6, 'full cover reaches the parent');
  const fromParent = overPoints(c, 1, 1);
  assert.deepEqual([fromParent[0], fromParent[1]], [120, 340], 'entered at the parent end');
  const half = overPoints(c, 2, 0.5);
  const end = { x: half[half.length - 2], y: half[half.length - 1] };
  const full = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
  const covered = Math.hypot(end.x - c.x1, end.y - c.y1);
  assert.ok(covered > full * 0.35 && covered < full * 0.6, `half cover ${covered} of ${full}`);
  assert.ok(overPoints(c, 2, 0).length >= 6 && overPoints(c, 2, NaN).length >= 6, 'a zero or bad cover is still a valid list');
  assert.ok(overPoints(c, 99, 1)[0] === 150, 'an unknown id reads as the child end');
  // an edge stored the other way round (the child is e.a) still runs from the parent
  const flipped = hyphaCurve(s.net.nodes, { id: 7, a: 2, b: 1 });
  assert.equal(flipped.parentId, 1);
  assert.equal(flipped.childId, 2);
  const mid = pointAlong([0, 0, 10, 0, 20, 0], 0.75);
  assert.deepEqual(mid, { x: 15, y: 0 });
  assert.deepEqual(pointAlong([5, 6], 0.5), { x: 5, y: 6 });
});

test('overLook: the black cord greys, thins and frays as it withers, and every channel stays in 0..1', () => {
  const fresh = overLook({ cover: 1, wither: 0 });
  assert.equal(fresh.width, OVER_W);
  assert.equal(fresh.rimAlpha, 1);
  assert.equal(fresh.glossAlpha, 1);
  assert.equal(fresh.shineAlpha, 1);
  assert.equal(fresh.gap, 0);
  assert.equal(fresh.crumbs, 0);
  let prev = fresh;
  for (let i = 1; i <= 20; i++) {
    const look = overLook({ cover: 1, wither: i / 20 });
    assert.ok(look.width <= prev.width && look.rimAlpha <= prev.rimAlpha && look.glossAlpha <= prev.glossAlpha && look.shineAlpha <= prev.shineAlpha && look.bodyAlpha <= prev.bodyAlpha, `thinner at ${i}`);
    assert.ok(look.ash >= prev.ash && look.gap >= prev.gap && look.crumbs >= prev.crumbs, `greyer and more frayed at ${i}`);
    prev = look;
  }
  const dying = overLook({ cover: 1, wither: 1 });
  assert.equal(dying.rimAlpha, 0);
  assert.equal(dying.glossAlpha, 0);
  assert.ok(dying.bodyAlpha > 0.3, 'still a faint cord when the cut comes');
  assert.ok(dying.width < OVER_W && dying.width > 0.5 * OVER_W);
  for (const o of [null, {}, { cover: 9, wither: -3 }, { cover: NaN, wither: NaN }]) {
    const look = overLook(o);
    for (const k of ['cover', 'wither', 'ash', 'bodyAlpha', 'rimAlpha', 'glossAlpha', 'shineAlpha', 'gap', 'crumbs']) assert.ok(look[k] >= 0 && look[k] <= 1, `${k} ${look[k]}`);
  }
  assert.equal(overLook({ cover: 3 }).cover, 1);
});

test('raidPhase and raidGoal read the raid field of a tip', () => {
  assert.equal(raidPhase({ x: 1 }), null);
  assert.equal(raidPhase(null), null);
  assert.equal(raidPhase({ raid: null }), null);
  assert.equal(raidPhase({ raid: { phase: 'run' } }), 'run');
  assert.equal(raidPhase({ raid: { phase: 'seek' } }), 'seek');
  assert.equal(raidPhase({ raid: {} }), 'seek');
  assert.deepEqual(raidGoal({ x: 0, y: 0, raid: { phase: 'seek', goal: { x: 30, y: 40 } } }), { x: 30, y: 40, d: 50 });
  assert.equal(raidGoal({ x: 0, y: 0, raid: { phase: 'seek', goal: null } }), null);
  assert.equal(raidGoal({ x: 0, y: 0, raid: { goal: { x: 'a', y: 2 } } }), null);
  assert.equal(raidGoal({ x: NaN, y: 0, raid: { goal: { x: 1, y: 2 } } }), null);
  assert.equal(raidGoal({ x: 0, y: 0 }), null);
});

test('freezeLook: the frost settles over the first seconds and goes with the ring', () => {
  assert.equal(freezeLook(null), 0);
  assert.equal(freezeLook({}), 0);
  assert.equal(freezeLook({ x: 1, y: 2, t: 0, dur: 40 }), 0);
  const settling = [0.2, 0.6, 1.0, 1.4].map((t) => freezeLook({ x: 1, y: 2, t, dur: 40 }));
  for (let i = 1; i < settling.length; i++) assert.ok(settling[i] > settling[i - 1]);
  assert.equal(freezeLook({ x: 1, y: 2, t: FREEZE_DRAW + 1, dur: 40 }), 1);
  assert.equal(freezeLook({ x: 1, y: 2, t: 20, dur: 40 }), 1);
  const leaving = [28, 34, 38, 40].map((t) => freezeLook({ x: 1, y: 2, t, dur: 40 }));
  for (let i = 1; i < leaving.length; i++) assert.ok(leaving[i] <= leaving[i - 1]);
  assert.equal(leaving[leaving.length - 1], 0);
});

/* ------------------------------------------------------------------ the renderer */

test('with nothing overgrown and no barrier the raid layers paint nothing and allocate no path', async () => {
  const rival = await rivalApi();
  const s = makeState();
  s.rival.edges = [];
  s.rival.nodes = [];
  const { ctx, paints, calls } = recorder();
  let made = 0;
  globalThis.Path2D = class extends FakePath {
    constructor() {
      super();
      made++;
    }
  };
  rival.reset(s.world);
  rival.drawSoil(ctx, s, 1, 1 / 60);
  rival.drawSurface(ctx, s, 1, 1 / 60);
  rival.drawFx(ctx, s, 1, 1 / 60);
  assert.equal(paints(), 0, JSON.stringify(calls));
  assert.equal(made, 0);
  globalThis.Path2D = FakePath;
});

test('an overgrown entry paints a cord; its raider head paints too; a dead edge or a bad row paints nothing and never throws', async () => {
  const rival = await rivalApi();
  const s = makeState();
  s.rival.edges = [];
  s.rival.nodes = [];
  rival.reset(s.world);
  const idle = recorder();
  rival.drawSoil(idle.ctx, s, 1, 1 / 60);
  assert.equal(idle.paints(), 0);
  s.rival.over = [{ edge: 1, from: 2, cover: 0.7, wither: 0, born: 99 }];
  const one = recorder();
  rival.drawSoil(one.ctx, s, 1, 1 / 60);
  assert.ok((one.calls.stroke || 0) >= 3, `strokes ${one.calls.stroke}`);
  assert.ok(!one.calls.fill, 'a cord alone has no head and no crumbs');
  // withering adds specks and dashes
  s.rival.over[0].wither = 0.8;
  const dying = recorder();
  rival.drawSoil(dying.ctx, s, 1, 1 / 60);
  assert.ok((dying.calls.fill || 0) > 0 && (dying.calls.setLineDash || 0) > 0, 'crumbs and dashes');
  // the head of the raider that runs along the hypha
  s.rival.tips = [{ id: 5, node: 0, x: 140, y: 360, dir: 0, target: null, speed: 20, raid: { phase: 'run', n: 1, edge: 1, at: 0.3, s: 0, goal: null } }];
  const withHead = recorder();
  rival.drawSoil(withHead.ctx, s, 1, 1 / 60);
  assert.ok((withHead.calls.arc || 0) >= 4 && (withHead.calls.fill || 0) > (dying.calls.fill || 0), 'a bead with a rim and a ring');
  // dead edge, garbage rows: nothing painted for them
  s.rival.tips = [];
  s.net.edges[1].alive = false;
  s.rival.over = [{ edge: 1, from: 2, cover: 1, wither: 0 }, null, { edge: 77 }, { edge: 0, from: 1, cover: NaN, wither: 'x' }];
  const dead = recorder();
  assert.doesNotThrow(() => rival.drawSoil(dead.ctx, s, 1, 1 / 60));
  // only the last row can paint (a cover that reads as 0 is skipped), so nothing here
  assert.equal(dead.paints(), 0);
  s.net.nodes.length = 2; // edges whose nodes are gone
  s.net.edges[1].alive = true;
  s.rival.over = [{ edge: 1, from: 2, cover: 1, wither: 0 }];
  assert.doesNotThrow(() => rival.drawSoil(recorder().ctx, s, 1, 1 / 60));
});

test('the cord cache is not rebuilt when only cover and wither change, and the overgrowth never touches rival.ver', async () => {
  const rival = await rivalApi();
  const s = makeState();
  rival.reset(s.world);
  const { ctx } = recorder();
  rival.drawSoil(ctx, s, 1, 1 / 60);
  rival.drawSoil(ctx, s, 1.1, 1 / 60);
  const rebuilds = rival.stats.rebuilds;
  assert.ok(rebuilds >= 1);
  const ver = s.rival.ver;
  s.rival.over = [
    { edge: 0, from: 1, cover: 0.2, wither: 0, born: 100 },
    { edge: 1, from: 2, cover: 1, wither: 0.4, born: 95 },
  ];
  for (let i = 0; i < 40; i++) {
    s.time += 0.2;
    s.rival.over[0].cover = Math.min(1, s.rival.over[0].cover + 0.025);
    s.rival.over.forEach((o) => (o.wither = Math.min(1, o.wither + 0.02)));
    rival.drawSoil(ctx, s, 1 + i * 0.2, 0.2);
  }
  assert.equal(rival.stats.rebuilds, rebuilds, 'not one repaint of the cache');
  assert.equal(s.rival.ver, ver);
  assert.equal(rival.stats.baked, 2, 'the web itself is still the two cached edges');
});

test('a raider that is seeking heads for the goal on a hypha: a dashed path appears only with a goal', async () => {
  const rival = await rivalApi();
  const s = makeState();
  rival.reset(s.world);
  const tip = { id: 8, node: 2, x: 664, y: 452, dir: 0, target: null, speed: 14, raid: { phase: 'seek', n: 0, edge: -1, at: 0, s: 0, goal: null } };
  s.rival.tips = [tip];
  const blind = recorder();
  rival.drawSoil(blind.ctx, s, 1, 1 / 60);
  tip.raid.goal = { x: 560, y: 470 };
  const aimed = recorder();
  rival.drawSoil(aimed.ctx, s, 1, 1 / 60);
  assert.ok((aimed.calls.stroke || 0) > (blind.calls.stroke || 0) + 2, `${aimed.calls.stroke} vs ${blind.calls.stroke}`);
  assert.ok((aimed.calls.setLineDash || 0) > (blind.calls.setLineDash || 0));
  // far away the path stays hidden, like the rhizomorph's own
  tip.raid.goal = { x: 100, y: 100 };
  const far = recorder();
  rival.drawSoil(far.ctx, s, 1, 1 / 60);
  assert.equal(far.calls.stroke, blind.calls.stroke);
  // a running raider has no bulb at its last rival node: no cord stub is drawn from there
  tip.raid = { phase: 'run', n: 1, edge: 0, at: 0.1, s: 0, goal: null };
  tip.node = 0;
  const run = recorder();
  rival.drawSoil(run.ctx, s, 1, 1 / 60);
  assert.ok((run.calls.stroke || 0) < (blind.calls.stroke || 0), 'no stub, no heading');
});

test('the frost needs a barrier: none, a fresh one (still no frost), a settled one, a finished one', async () => {
  const rival = await rivalApi();
  const s = makeState();
  s.rival.edges = [];
  s.rival.nodes = [];
  rival.reset(s.world);
  const images = (barriers) => {
    s.barriers = barriers;
    const r = recorder();
    rival.drawSoil(r.ctx, s, 1, 1 / 60);
    return r.calls.drawImage || 0;
  };
  assert.equal(images([]), 0);
  const ring = images([{ id: 1, x: 150, y: 350, r: 85, t: 0, dur: 40 }]);
  assert.equal(ring, 1, 'at t = 0 only the chalk ring');
  assert.equal(images([{ id: 1, x: 150, y: 350, r: 85, t: 12, dur: 40 }]), 2, 'ring and frost');
  assert.equal(images([{ id: 1, x: 150, y: 350, r: 85, t: 12, dur: 40 }, { id: 2, x: 450, y: 350, r: 85, t: 14, dur: 40 }]), 4);
  assert.equal(images([{ id: 1, x: 150, y: 350, r: 85, t: 41, dur: 40 }]), 0, 'finished: both gone');
  assert.equal(images([{ id: 1, x: NaN, y: 350, r: 85, t: 12, dur: 40 }, null, {}]), 0);
  // it also works for a game without a rival object (a barrier can stand alone)
  const bare = { time: 5, world: {}, ui: {}, barriers: [{ id: 1, x: 150, y: 350, r: 85, t: 12, dur: 40 }] };
  const r = recorder();
  rival.drawSoil(r.ctx, bare, 1, 1 / 60);
  assert.equal(r.calls.drawImage, 2);
});

test('the raid events make short effects and never throw on garbage', async () => {
  const rival = await rivalApi();
  const s = makeState();
  rival.reset(s.world);
  const quiet = recorder();
  rival.drawFx(quiet.ctx, s, 1, 1 / 60);
  assert.equal(quiet.paints(), 0);
  const events = [
    { type: 'rival-raid-seek', x: 100, y: 300 },
    { type: 'rival-raid-touch', x: 120, y: 340, edge: 0 },
    { type: 'rival-raid-end', x: 150, y: 375, reason: 'barrier' },
    { type: 'rival-raid-end', x: 150, y: 375, reason: 'cord' },
    { type: 'severed', x: 150, y: 375, cause: 'rival' },
    { type: 'grow-denied', reason: 'barrier', x: 190, y: 395 },
  ];
  for (const ev of events) {
    const before = recorder();
    rival.event(ev, s);
    rival.drawFx(before.ctx, s, 10, 1 / 60);
    rival.drawFx(before.ctx, s, 10.4, 1 / 60);
    assert.ok(before.paints() > 0, `${ev.type} ${ev.reason || ''} paints`);
    rival.reset(s.world);
  }
  // the worm's and the player's own severing, and a denial for another reason, are not the rival's business
  for (const ev of [{ type: 'severed', x: 1, y: 2, cause: 'worm' }, { type: 'grow-denied', reason: 'sugar', x: 1, y: 2 }]) {
    rival.event(ev, s);
    const r = recorder();
    rival.drawFx(r.ctx, s, 20, 1 / 60);
    assert.equal(r.paints(), 0, ev.type);
  }
  for (const ev of [{ type: 'rival-raid-seek' }, { type: 'rival-raid-touch', x: 'a' }, { type: 'rival-raid-end', reason: null }, { type: 'severed', cause: 'rival' }, { type: 'grow-denied', reason: 'barrier', x: NaN }]) {
    assert.doesNotThrow(() => rival.event(ev, s), JSON.stringify(ev));
    assert.doesNotThrow(() => rival.event(ev));
  }
});

test('garbage in over, tips and barriers never throws', async () => {
  const rival = await rivalApi();
  const s = makeState();
  s.rival.over = [{ edge: 0, from: 'a', cover: 'x', wither: {}, born: NaN }, { edge: 1, from: null }];
  s.rival.tips = [null, { raid: 5 }, { x: 1, y: 2, raid: { phase: 'run' } }, { x: 'a', y: 2, raid: { phase: 'run' } }, { id: 2, x: 5, y: 6, raid: { phase: 'seek', goal: { x: 'q' } } }];
  s.barriers = [{ x: 10, y: 10, r: 'big', t: -1, dur: 0 }];
  rival.reset(s.world);
  assert.doesNotThrow(() => {
    rival.drawSoil(recorder().ctx, s, 1, 1 / 60);
    rival.drawSurface(recorder().ctx, s, 1, 1 / 60);
    rival.drawFx(recorder().ctx, s, 1, 1 / 60);
  });
});

/* ------------------------------------------------------------------ the gallery fixture */

test('the raid fixture builds a branch with five overgrown edges, a running and a seeking raider and two barriers', () => {
  const state = createState(7);
  applyFixture(state, { nodes: 380 });
  applyRivalFixture(state, { edges: 60 });
  const info = applyRaidFixture(state);
  const r = state.rival;
  assert.ok(r.over.length >= 6);
  const seen = new Set();
  for (const o of r.over) {
    const e = state.net.edges[o.edge];
    assert.ok(e && e.alive && !seen.has(o.edge), 'live, distinct edges');
    seen.add(o.edge);
    assert.ok(o.from === e.a || o.from === e.b);
    assert.ok(o.cover > 0 && o.cover <= 1 && o.wither >= 0 && o.wither <= 1);
  }
  assert.equal(overList(state).length, r.over.length);
  const phases = r.tips.filter((t) => t.raid).map((t) => t.raid.phase).sort();
  assert.deepEqual(phases, ['run', 'seek']);
  const seek = r.tips.find((t) => t.raid && t.raid.phase === 'seek');
  assert.ok(raidGoal(seek).d > 60 && raidGoal(seek).d < 150, 'the heading path is in view');
  assert.equal(state.barriers.length, 2);
  assert.ok(state.barriers.every((b) => b.r === 85 && b.dur === 40));
  assert.ok(info.chain && info.seek && info.barrier);
  // the net stays a tree: every new node has a parent and an edge
  for (const n of state.net.nodes) assert.ok(n.parent < 0 || state.net.edges.some((e) => e.b === n.id));
});

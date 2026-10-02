// The raider's render side: the player's hyphae it has overgrown (state.rival.over: the pale thread kept, honey-tinted, wrapped
// by a black spiral that tightens as the cut nears), the raider's head, its lead (a dashed amber arrow with a honey drop that
// fades in and out over the 12 s warning), and the frost inside a standing barrier. Pure helpers first, then the renderer against
// a fake 2D context (no DOM in node): nothing is drawn when nothing is overgrown, a dead edge is skipped, the cord cache is
// never rebuilt by a change of cover / wither, no Path2D is made per frame, and the frost needs a barrier.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freezeLook, hyphaCurve, overList, overLook, overPoints, pointAlong, raidGoal, raidPhase, OVER_W, FREEZE_DRAW,
  spiralLook, threadPoints, threadAt, threadSlice, spiralBands, leadAlpha, raidLead, leadDashes, leadDrop,
  SPIRAL_PITCH, SPIRAL_MAX, RAID_LEAD, LEAD_IN, LEAD_OUT, LEAD_LEN, LEAD_DROP, LEAD_MAX_DASHES,
} from '../src/render/rival-logic.js';
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
  assert.ok((dying.calls.fill || 0) > 0, 'crumbs');
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

/* ------------------------------------------------------------------ the overgrown thread and the raider's lead */

/** A straight thread of two nodes, 60 u along x, from the parent (0, 0) to the child (60, 0). */
function straightThread() {
  const nodes = [
    { id: 0, x: 0, y: 0, alive: true, parent: -1 },
    { id: 1, x: 60, y: 0, alive: true, parent: 0 },
  ];
  return threadPoints(hyphaCurve(nodes, { id: 0, a: 0, b: 1 }), 0);
}

/** Distance of (x, y) from the nearest point of a thread, by fine sampling. */
function distTo(th, x, y) {
  let best = Infinity;
  const p = {};
  for (let s = 0; s <= th.len; s += 0.25) {
    threadAt(th, s, p);
    best = Math.min(best, Math.hypot(p.x - x, p.y - y));
  }
  return best;
}

test('spiralLook: the spiral tightens as the thread is strangled, the honey halo dies and the wraps come undone', () => {
  const fresh = spiralLook({ cover: 1, wither: 0 });
  assert.equal(fresh.pitch, SPIRAL_PITCH[0]);
  assert.equal(fresh.halo, 1);
  assert.equal(fresh.dim, 0);
  assert.equal(fresh.skip, 0);
  let prev = fresh;
  for (let i = 1; i <= 20; i++) {
    const look = spiralLook({ cover: 1, wither: i / 20 });
    assert.ok(look.pitch <= prev.pitch && look.halo <= prev.halo && look.band <= prev.band, `tighter at ${i}`);
    assert.ok(look.dim >= prev.dim && look.skip >= prev.skip, `darker and more undone at ${i}`);
    prev = look;
  }
  assert.ok(Math.abs(prev.pitch - SPIRAL_PITCH[1]) < 1e-9, 'tight at the cut');
  assert.ok(prev.halo > 0.1 && prev.halo < 0.3, 'a faint halo is left');
  assert.ok(prev.skip < 0.75, 'never all wraps gone');
  for (const o of [null, {}, { cover: 9, wither: -3 }, { cover: NaN, wither: NaN }]) {
    const look = spiralLook(o);
    for (const k of ['halo', 'dim', 'skip']) assert.ok(look[k] >= 0 && look[k] <= 1, `${k} ${look[k]}`);
    assert.ok(look.pitch >= SPIRAL_PITCH[1] && look.pitch <= SPIRAL_PITCH[0]);
  }
});

test('threadPoints: a thread runs from the parent to the child, its arc length adds up, and threadAt finds the point and direction', () => {
  const s = makeState();
  const e = s.net.edges[1];
  const th = threadPoints(hyphaCurve(s.net.nodes, e), e.id);
  assert.deepEqual([th.pts[0], th.pts[1]], [120, 340]);
  assert.deepEqual([th.pts[th.n * 2], th.pts[th.n * 2 + 1]], [150, 375]);
  assert.equal(th.parentId, 1);
  for (let k = 1; k <= th.n; k++) assert.ok(th.cum[k] > th.cum[k - 1]);
  assert.ok(th.len >= Math.hypot(30, 35) - 1e-3 && th.len < 1.1 * Math.hypot(30, 35), `len ${th.len}`);
  const p = threadAt(th, th.len / 2, {});
  assert.ok(Math.abs(Math.hypot(p.tx, p.ty) - 1) < 1e-6, 'unit tangent');
  assert.ok(p.tx > 0 && p.ty > 0, 'towards the child');
  const a = threadAt(th, -5, {});
  const b = threadAt(th, 1e6, {});
  assert.ok(Math.hypot(a.x - 120, a.y - 340) < 1e-3 && Math.hypot(b.x - 150, b.y - 375) < 1e-3, 'clamped to the ends');
  // the meander (noise) moves the middle sideways by at most 2.4 u and leaves the ends alone
  const wavy = threadPoints(hyphaCurve(s.net.nodes, e), e.id, (x) => Math.sin(x));
  assert.deepEqual([wavy.pts[0], wavy.pts[1]], [120, 340]);
  assert.ok(Math.hypot(wavy.pts[th.n * 2] - 150, wavy.pts[th.n * 2 + 1] - 375) < 1e-3);
  let far = 0;
  for (let k = 0; k <= th.n; k++) far = Math.max(far, Math.hypot(wavy.pts[k * 2] - th.pts[k * 2], wavy.pts[k * 2 + 1] - th.pts[k * 2 + 1]));
  assert.ok(far > 0.1 && far <= 2.4 + 1e-3, `meander ${far}`);
});

test('threadSlice covers the thread from the entry end as far as cover', () => {
  const th = straightThread();
  const buf = new Float32Array(2 * 160);
  const fromParent = threadSlice(buf, th, false, 0.5);
  assert.deepEqual([buf[0], buf[1]], [0, 0]);
  assert.ok(Math.abs(buf[fromParent - 2] - 30) < 1e-3 && Math.abs(buf[fromParent - 1]) < 1e-3, 'half way');
  const fromChild = threadSlice(buf, th, true, 0.25);
  assert.deepEqual([buf[0], buf[1]], [60, 0]);
  assert.ok(Math.abs(buf[fromChild - 2] - 45) < 1e-3, 'a quarter from the child end');
  assert.ok(threadSlice(buf, th, false, 0) >= 4 && threadSlice(buf, th, false, NaN) >= 4, 'a zero cover is still a valid line');
  assert.ok(threadSlice(new Float32Array(6), th, false, 1) <= 6, 'a small buffer is never overrun');
  const full = threadSlice(buf, th, false, 9);
  assert.ok(Math.abs(buf[full - 2] - 60) < 1e-3, 'cover is clamped to 1');
});

test('spiralBands: wraps sit on the thread, start at the entry end, follow the cover, tighten with the pitch and come undone with skip', () => {
  const th = straightThread();
  const out = new Float32Array(6 * SPIRAL_MAX);
  const half = 2.5;
  const n = spiralBands(out, th, false, 1, 8, half, 3, 0);
  assert.ok(n >= 6 && n <= 9, `${n} wraps of pitch 8 on 60 u`);
  for (let i = 0; i < n; i++) {
    const [x0, y0, cx, cy, x1, y1] = Array.from(out.subarray(i * 6, i * 6 + 6));
    // the band crosses the thread: one end on each side, a half width off it
    assert.ok(Math.abs(Math.abs(y0) - half) < 1e-3 && Math.abs(Math.abs(y1) - half) < 1e-3 && y0 * y1 < 0, `crosses the thread ${i}`);
    const full = Math.hypot(0.9 * 8, 2 * half);
    const len = Math.hypot(x1 - x0, y1 - y0);
    assert.ok(i < n - 1 ? Math.abs(len - full) < 0.05 : len <= full + 0.05, 'leans by 0.9 pitch');
    assert.ok(x0 >= -1e-3 && x1 <= 60 + 1e-3, 'never past the ends');
    assert.ok(Math.abs(cx - (x0 + x1) / 2) < 8 && Math.abs(cy - (y0 + y1) / 2) < 1.5, 'only a slight bow');
    if (i) assert.ok((x0 + x1) / 2 > (out[(i - 1) * 6] + out[(i - 1) * 6 + 4]) / 2, 'in order along the thread');
  }
  assert.ok((out[0] + out[4]) / 2 > 2 && (out[0] + out[4]) / 2 < 8, 'the first wrap is about half a pitch from the entry end');
  // from the child end the first wrap is near x = 60, and the hand of the lean is the same
  const m = spiralBands(out, th, true, 1, 8, half, 3, 0);
  assert.equal(m, n);
  assert.ok((out[0] + out[4]) / 2 > 52, 'entered at the child end');
  assert.equal(spiralBandsHand(th, false, half), 1, 'the hand is fixed by the thread: parent to child');
  assert.equal(spiralBandsHand(th, true, half), 1, 'the same from the other end');
  // cover limits the stretch, from either end
  const part = spiralBands(out, th, false, 0.4, 8, half, 3, 0);
  assert.ok(part >= 2 && part < n);
  for (let i = 0; i < part; i++) assert.ok(out[i * 6] <= 24 + 1e-3 && out[i * 6 + 4] <= 24 + 1e-3);
  assert.equal(spiralBands(out, th, false, 0, 8, half, 3, 0), 0);
  assert.equal(spiralBands(out, th, false, NaN, 8, half, 3, 0), 0);
  // a tighter pitch makes more wraps, never more than SPIRAL_MAX or than the buffer holds
  assert.ok(spiralBands(out, th, false, 1, 4.2, half, 3, 0) > n * 1.6);
  assert.ok(spiralBands(out, th, false, 1, 0.1, half, 3, 0) <= SPIRAL_MAX);
  assert.equal(spiralBands(new Float32Array(12), th, false, 1, 4, half, 3, 0), 2);
  // skip drops about that share, the same ones every time
  const kept = spiralBands(out, th, false, 1, 4.2, half, 3, 0.5);
  const all = spiralBands(out, th, false, 1, 4.2, half, 3, 0);
  assert.ok(kept > all * 0.25 && kept < all * 0.8, `${kept} of ${all}`);
  assert.equal(spiralBands(out, th, false, 1, 4.2, half, 3, 0.5), kept);
  assert.equal(spiralBands(out, th, false, 1, 4.2, half, 3, 1), 0);
});

/** The sign of y at the start of the first band (the hand of the wrap) for a thread entered from one end. */
function spiralBandsHand(th, fromChild, half) {
  const out = new Float32Array(6 * 4);
  spiralBands(out, th, fromChild, 1, 8, half, 3, 0);
  return Math.sign(out[1]);
}

test('spiralBands on a bent thread keeps every wrap within reach of the thread', () => {
  const s = makeState();
  const e = s.net.edges[2];
  const th = threadPoints(hyphaCurve(s.net.nodes, e), e.id, (x) => Math.sin(x * 1.7));
  const out = new Float32Array(6 * SPIRAL_MAX);
  const half = 2.8;
  for (const fromChild of [false, true]) {
    const n = spiralBands(out, th, fromChild, 0.8, 6, half, 11, 0);
    assert.ok(n >= 3);
    for (let i = 0; i < n; i++) {
      assert.ok(distTo(th, out[i * 6], out[i * 6 + 1]) <= half + 0.6, 'start of a band');
      assert.ok(distTo(th, out[i * 6 + 4], out[i * 6 + 5]) <= half + 0.6, 'end of a band');
    }
  }
  // the hand of the wrap does not depend on the end the raider came from
  assert.equal(spiralBandsHand(th, false, 2.5), spiralBandsHand(th, true, 2.5));
});

test('leadAlpha: the arrow fades in, holds, and fades out before the raider sets off', () => {
  assert.equal(leadAlpha(0), 0);
  assert.equal(leadAlpha(-1), 0);
  assert.equal(leadAlpha(undefined), 0);
  assert.equal(leadAlpha(NaN), 0);
  assert.equal(leadAlpha(LEAD_IN), 1);
  assert.equal(leadAlpha(RAID_LEAD / 2), 1);
  assert.equal(leadAlpha(RAID_LEAD - LEAD_OUT), 1);
  assert.equal(leadAlpha(RAID_LEAD), 0);
  assert.equal(leadAlpha(RAID_LEAD + 5), 0);
  const ins = [0.2, 0.5, 0.9, 1.2].map((a) => leadAlpha(a));
  for (let i = 1; i < ins.length; i++) assert.ok(ins[i] > ins[i - 1], 'in');
  const outs = [9.6, 10.4, 11.2, 11.9].map((a) => leadAlpha(a));
  for (let i = 1; i < outs.length; i++) assert.ok(outs[i] < outs[i - 1], 'out');
  assert.equal(leadAlpha(6, 6), 0, 'a shorter lead ends where it ends');
});

const seeker = (o = {}) => ({ id: 3, x: 100, y: 200, dir: 0, age: 6, raid: { phase: 'seek', goal: { x: 300, y: 200 } }, ...o });

test('raidLead: a long arrow along the heading to the goal, short of it, with its tip where the honey drop sits', () => {
  const tip = seeker();
  const lead = raidLead(tip, 7, {});
  assert.ok(lead);
  assert.equal(lead.alpha, 1);
  assert.deepEqual([lead.ux, lead.uy], [1, 0], 'towards the goal');
  assert.ok(Math.abs(lead.x1 - (100 + LEAD_LEN)) < 1e-9 && lead.y1 === 200, 'a far goal: the longest arrow');
  assert.ok(lead.x0 > 100 + 7 && lead.x0 < 100 + 15, 'starts just outside the bulb');
  assert.ok(Math.abs(lead.len - Math.hypot(lead.x1 - lead.x0, lead.y1 - lead.y0)) < 1e-9);
  assert.ok(lead.len > 100, 'far longer than the old 2 px dash');
  // a near goal: the arrow stops 16 u short of it
  const near = raidLead(seeker({ raid: { phase: 'seek', goal: { x: 190, y: 200 } } }), 7, {});
  assert.ok(Math.abs(near.x1 - 174) < 1e-9);
  // a diagonal goal
  const diag = raidLead(seeker({ raid: { phase: 'seek', goal: { x: 100, y: 500 } } }), 7, {});
  assert.deepEqual([diag.ux, diag.uy], [0, 1]);
  // with no goal it points along tip.dir
  const blind = raidLead(seeker({ raid: { phase: 'seek', goal: null }, dir: Math.PI / 2 }), 7, {});
  assert.ok(Math.abs(blind.ux) < 1e-9 && Math.abs(blind.uy - 1) < 1e-9 && Math.abs(blind.len - (LEAD_LEN - 11)) < 1e-9);
  // not for a runner, a non-raider, a tip without coordinates or a goal too close to leave room for an arrow
  assert.equal(raidLead(seeker({ raid: { phase: 'run' } })), null);
  assert.equal(raidLead({ x: 1, y: 2 }), null);
  assert.equal(raidLead(null), null);
  assert.equal(raidLead(seeker({ x: NaN })), null);
  assert.equal(raidLead(seeker({ raid: { phase: 'seek', goal: { x: 120, y: 200 } } })), null);
  assert.equal(raidLead(seeker({ raid: { phase: 'seek', goal: null }, dir: undefined })), null);
});

test('raidLead follows the warning: faint at the start, full during it, gone when the raider sets off, back faintly when its hypha is near', () => {
  const at = (age, goalX = 400) => raidLead(seeker({ age, raid: { phase: 'seek', goal: { x: goalX, y: 200 } } }), 7, {});
  assert.equal(at(0), null, 'not yet');
  const a1 = at(0.4).alpha;
  const a2 = at(0.9).alpha;
  assert.ok(a1 > 0 && a2 > a1 && a2 < 1);
  assert.equal(at(5).alpha, 1);
  assert.ok(at(11).alpha < at(10).alpha && at(10).alpha < 1);
  assert.equal(at(12), null, 'the raider creeps now and its goal is far');
  const noAge = raidLead(seeker({ age: undefined, raid: { phase: 'seek', goal: { x: 220, y: 200 } } }), 7, {});
  assert.ok(noAge && noAge.alpha > 0, 'a goal within 150 u shows a faint arrow even without an age');
  const faint = at(13, 100 + 120).alpha;
  assert.ok(faint > 0 && faint <= 0.55, `near goal after the warning ${faint}`);
  assert.ok(at(13, 100 + 90).alpha > faint, 'stronger the closer it is');
});

test('leadDashes march to the tip along the heading, thin at the tail and stronger at the head, and stop short of the drop', () => {
  const lead = raidLead(seeker(), 7, {});
  const out = new Float32Array(6 * LEAD_MAX_DASHES);
  const n = leadDashes(out, lead, 0);
  assert.ok(n >= 6 && n <= LEAD_MAX_DASHES, `${n} dashes`);
  let prevMid = -1;
  for (let i = 0; i < n; i++) {
    const [x0, y0, x1, y1, w, a] = Array.from(out.subarray(i * 6, i * 6 + 6));
    assert.ok(Math.abs(y0 - 200) < 1e-6 && Math.abs(y1 - 200) < 1e-6, 'on the heading line');
    assert.ok(x0 >= lead.x0 - 1e-6 && x1 <= lead.x1 - LEAD_DROP + 1e-6, 'between the bulb and the drop');
    assert.ok(x1 > x0 && (x0 + x1) / 2 > prevMid, 'in order, pointing on');
    assert.ok(w >= 1.5 && w <= 3.2 && a >= 0.3 && a <= 1);
    if (i) assert.ok(w >= out[(i - 1) * 6 + 4] && a >= out[(i - 1) * 6 + 5], 'growing towards the tip');
    prevMid = (x0 + x1) / 2;
  }
  // they march: a later moment shifts them towards the tip, a reduced-motion frame stands still
  const later = new Float32Array(6 * LEAD_MAX_DASHES);
  leadDashes(later, lead, 0.4);
  assert.notDeepEqual(Array.from(later.subarray(0, 12)), Array.from(out.subarray(0, 12)));
  const still = new Float32Array(6 * LEAD_MAX_DASHES);
  const calm = new Float32Array(6 * LEAD_MAX_DASHES);
  leadDashes(still, lead, 0, true);
  leadDashes(calm, lead, 77.7, true);
  assert.deepEqual(Array.from(still), Array.from(calm));
  assert.equal(leadDashes(new Float32Array(6), lead, 0) <= 1, true, 'a small buffer is never overrun');
  assert.equal(leadDashes(out, { ...lead, len: 3 }, 0), 0);
});

test('leadDrop sits at the tip of the arrow, turned along it, bobbing a little', () => {
  const lead = raidLead(seeker(), 7, {});
  const d = leadDrop(lead, 0, true, {});
  assert.deepEqual([d.x, d.y, d.ang, d.size], [lead.x1, lead.y1, 0, LEAD_DROP]);
  let far = 0;
  for (let t = 0; t < 6; t += 0.1) {
    const m = leadDrop(lead, t, false, {});
    far = Math.max(far, Math.hypot(m.x - lead.x1, m.y - lead.y1));
    assert.ok(Math.abs(m.y - lead.y1) < 1e-9, 'bobs along the heading');
  }
  assert.ok(far > 0.5 && far <= 1.4 + 1e-9, `bob ${far}`);
  const down = leadDrop({ x1: 5, y1: 5, ux: 0, uy: 1 }, 0, true, {});
  assert.ok(Math.abs(down.ang - Math.PI / 2) < 1e-9);
});

test('the renderer: a seeking raider in its warning paints the arrow and the drop, a creeping one with a far goal paints neither', async () => {
  const rival = await rivalApi();
  const s = makeState();
  rival.reset(s.world);
  const tip = { id: 8, node: 2, x: 664, y: 452, dir: 0, age: 6, target: null, speed: 0, raid: { phase: 'seek', n: 0, edge: -1, at: 0, s: 0, goal: { x: 880, y: 470 } } };
  s.rival.tips = [tip];
  const warning = recorder();
  rival.drawSoil(warning.ctx, s, 1, 1 / 60);
  assert.ok((warning.calls.bezierCurveTo || 0) >= 3, 'the honey drop');
  tip.age = 14;
  const creeping = recorder();
  rival.drawSoil(creeping.ctx, s, 1, 1 / 60);
  assert.equal(creeping.calls.bezierCurveTo || 0, 0, 'the warning is over');
  assert.ok((warning.calls.stroke || 0) > (creeping.calls.stroke || 0) + 8, `${warning.calls.stroke} vs ${creeping.calls.stroke}`);
  // reduced motion and a missing age never throw
  delete tip.age;
  assert.doesNotThrow(() => rival.drawSoil(recorder().ctx, s, 3, 1 / 60));
});

test('an overgrown edge is drawn as a thread with a spiral round it, from the cached shape, without allocating paths', async () => {
  const rival = await rivalApi();
  const s = makeState();
  s.rival.edges = [];
  s.rival.nodes = [];
  rival.reset(s.world);
  s.rival.over = [{ edge: 1, from: 2, cover: 1, wither: 0.1, born: 99 }, { edge: 2, from: 3, cover: 0.5, wither: 0.5, born: 95 }];
  let made = 0;
  globalThis.Path2D = class extends FakePath {
    constructor() {
      super();
      made++;
    }
  };
  const first = recorder();
  rival.drawSoil(first.ctx, s, 1, 1 / 60);
  const again = recorder();
  for (let i = 0; i < 20; i++) rival.drawSoil(again.ctx, s, 1 + i / 60, 1 / 60);
  globalThis.Path2D = FakePath;
  assert.equal(made, 0, 'no Path2D per edge or per frame');
  assert.ok((first.calls.quadraticCurveTo || 0) >= 4, 'the wraps are quadratics');
  assert.ok((first.calls.stroke || 0) >= 8, `halo, core tint, wraps and rim of two edges: ${first.calls.stroke}`);
  assert.ok(!first.calls.setLineDash, 'not the dashed black cord of the rhizomorph');
  // the wraps of a thread are the same on the next frame (the shape is cached); a moved node makes a new shape
  assert.equal(again.calls.quadraticCurveTo, 20 * first.calls.quadraticCurveTo);
  s.net.nodes[2].x += 10;
  const moved = recorder();
  assert.doesNotThrow(() => rival.drawSoil(moved.ctx, s, 2, 1 / 60));
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
  assert.ok(raidLead(seek) && raidLead(seek).alpha === 1, 'the fixture raider is mid-warning: its arrow is at full strength');
  assert.equal(state.barriers.length, 2);
  assert.ok(state.barriers.every((b) => b.r === 85 && b.dur === 40));
  assert.ok(info.chain && info.seek && info.barrier);
  // the net stays a tree: every new node has a parent and an edge
  for (const n of state.net.nodes) assert.ok(n.parent < 0 || state.net.edges.some((e) => e.b === n.id));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { addNode } from '../src/sim/network.js';
import { createRng } from '../src/core/rng.js';
import { restoreTime, weatherAt } from '../src/sim/clock.js';
import * as persist from '../src/persist.js';
import { encodeState } from '../src/persist-codec.js';
import { DT, playBot } from './bot.mjs';

const KEY = persist.SAVE_KEY;
const round2 = (v) => Math.round(v * 100) / 100;

// ---- a localStorage shim installed on globalThis for the duration of a test ----

function shim() {
  const data = new Map();
  const calls = { set: 0, get: 0 };
  return {
    data,
    calls,
    getItem: (k) => (calls.get++, data.has(k) ? data.get(k) : null),
    setItem: (k, v) => (calls.set++, void data.set(k, String(v))),
    removeItem: (k) => void data.delete(k),
  };
}

function withStorage(storage, fn) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  persist.clearSave();
  try {
    return fn(storage);
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete globalThis.localStorage;
  }
}

function withGetter(getter, fn) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { get: getter, configurable: true });
  try {
    return fn();
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete globalThis.localStorage;
  }
}

// ---- comparable view of everything dynamic (the world is regenerated, so only its dynamic fields) ----

function plain(v) {
  if (v instanceof Map) return [...v].map(([k, x]) => [plain(k), plain(x)]);
  if (v instanceof Set) return [...v].map(plain).sort();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

function view(state) {
  const { net, world, sim: s } = state;
  const born = (o) => ({ ...o, born: round2(o.born) });
  const simData = {};
  for (const [k, v] of Object.entries(s)) simData[k] = k === 'rng' ? v.getState() : plain(v);
  return {
    seed: state.seed,
    time: state.time,
    speed: state.speed,
    res: state.res,
    rates: state.rates,
    cap: state.cap,
    stats: state.stats,
    flags: state.flags,
    clock: state.clock,
    weather: state.weather,
    objectives: state.objectives,
    net: { originId: net.originId, version: net.version, nodes: net.nodes.map(born), edges: net.edges.map(born), links: net.links.map(born), growing: net.growing },
    trees: world.trees.map((t) => ({ stage: t.stage, growth: t.growth, health: t.health, linked: t.linked })),
    water: world.water.map((d) => d.amount),
    minerals: world.minerals.map((d) => d.amount),
    mushrooms: state.mushrooms,
    flows: state.flows,
    sim: simData,
  };
}

/** The world with its dynamic fields blanked: must equal a freshly generated one. */
function staticWorld(world) {
  const w = structuredClone(world);
  for (const t of w.trees) t.stage = t.growth = t.health = t.linked = 0;
  for (const d of [...w.water, ...w.minerals]) d.amount = 0;
  return w;
}

function advance(state, seconds, script) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    script?.(state, i);
    sim.updateSim(state, DT);
    state.time += DT;
    state.events.length = 0;
  }
}

/** Commands that only depend on the state they are applied to (and a step counter). */
function script(state, i) {
  const { nodes } = state.net;
  if (i % 180 === 0) {
    const k = i / 180;
    const from = nodes[(k * 37 + 5) % nodes.length];
    const a = k * 2.399963;
    const end = { x: from.x + Math.cos(a) * 140, y: from.y + Math.abs(Math.sin(a)) * 140 + 10 };
    sim.commandGrow(state, from.id, [{ x: (from.x + end.x) / 2, y: (from.y + end.y) / 2 }, end]);
  }
  if (i % 1200 === 600) {
    const n = nodes.find((x) => sim.canFruit(state, x.id));
    if (n) sim.commandFruit(state, n.id);
  }
}

const keyMetrics = (s) => ({
  res: s.res,
  rates: s.rates,
  cap: s.cap,
  stats: s.stats,
  nodes: s.net.nodes.length,
  edges: s.net.edges.length,
  links: s.net.links.length,
  growing: s.net.growing.length,
  trees: s.world.trees.map((t) => [t.stage, t.growth, t.health, t.linked]),
  water: s.world.water.map((d) => d.amount),
  minerals: s.world.minerals.map((d) => d.amount),
  mushrooms: s.mushrooms,
  rng: s.sim.rng.getState(),
  flows: s.flows.length,
  objectives: s.objectives.map((o) => o.done),
});

// ---- tests ----

test('round trip: a saved bot game loads into the same dynamic state', () => {
  withStorage(shim(), () => {
    for (const seed of [7, 42]) {
      const { state } = playBot(seed, { maxSeconds: 240 });
      assert.ok(state.mushrooms.length > 0 && state.net.links.length > 0 && state.flows.length > 0, 'a played game has something to save');
      const before = view(state);
      persist.saveNow(state);
      assert.equal(persist.hasSave(), true);
      const loaded = persist.loadSave();
      assert.ok(loaded);
      assert.equal(loaded.phase, 'paused');
      assert.deepEqual(loaded.events, []);
      assert.equal(loaded.ui.tool, 'grow');
      assert.deepEqual(view(loaded), before);
      assert.deepEqual(staticWorld(loaded.world), staticWorld(createState(seed).world), 'only the dynamic world fields change');
      assert.notEqual(loaded.world, state.world);
      assert.deepEqual(view(state), before, 'saving does not touch the state');
    }
  });
});

test('round trip with growing hyphae in flight, thick edges and a dead node', () => {
  withStorage(shim(), () => {
    const { state } = playBot(1, { maxSeconds: 120 });
    const n = state.net.nodes[3];
    assert.ok(sim.commandGrow(state, 3, [{ x: n.x, y: n.y + 90 }]));
    advance(state, 0.3);
    assert.ok(state.net.growing.length > 0, 'a hypha is still growing');
    state.net.nodes.at(-1).alive = false;
    state.net.edges.at(-1).alive = false;
    state.net.edges[2].w = 1.55;
    state.sim.wTrue.set(2, 1.5517);
    // seasons on, at a moment of spring rain: clock, weather and effects are consistent, as a live game has them
    state.flags.seasons = true;
    let rainT = 0;
    while (weatherAt(state, rainT).intensity < 0.5 || weatherAt(state, rainT).kind !== 'rain') rainT += 0.5;
    state.sim.clock = rainT;
    restoreTime(state);
    assert.equal(state.weather.kind, 'rain');
    state.sim.extraMap = new Map([['a', 1.5]]);
    persist.saveNow(state);
    const loaded = persist.loadSave();
    assert.deepEqual(view(loaded), view(state));
    advance(state, 5, script);
    advance(loaded, 5, script);
    assert.deepEqual(keyMetrics(loaded), keyMetrics(state));
  });
});

test('determinism with seasons on: saved in late autumn, the loaded game goes through winter and into the next year identically', () => {
  withStorage(shim(), () => {
    const { state } = playBot(7, { seasons: true, runOn: true, maxSeconds: 860 });
    assert.equal(state.clock.season, 'autumn');
    persist.saveNow(state);
    const loaded = persist.loadSave();
    assert.equal(loaded.flags.seasons, true);
    assert.deepEqual(loaded.clock, state.clock);
    assert.deepEqual(loaded.weather, state.weather);
    assert.deepEqual(view(loaded), view(state));
    for (let minute = 0; minute < 6; minute++) {
      advance(state, 60, script);
      advance(loaded, 60, script);
      assert.deepEqual(keyMetrics(loaded), keyMetrics(state), `minute ${minute + 1}`);
    }
    assert.equal(state.clock.year, 1);
    assert.equal(loaded.clock.year, 1);
    assert.equal(loaded.flags.yearDone, true);
    assert.deepEqual(view(loaded), view(state), 'the whole dynamic state agrees at the end');
  });
});

test('determinism: a loaded game continues exactly like the original (2 seeds)', () => {
  withStorage(shim(), () => {
    for (const seed of [1, 99991]) {
      const { state } = playBot(seed, { maxSeconds: 300, runOn: true });
      persist.saveNow(state);
      const loaded = persist.loadSave();
      assert.deepEqual(view(loaded), view(state));
      for (let minute = 0; minute < 4; minute++) {
        advance(state, 60, script);
        advance(loaded, 60, script);
        assert.deepEqual(keyMetrics(loaded), keyMetrics(state), `seed ${seed}, minute ${minute + 1}`);
      }
      assert.deepEqual(view(loaded), view(state), 'the whole dynamic state agrees at the end');
      assert.ok(loaded.net.nodes.length > 0 && state.stats.hyphaeLength > 100);
    }
  });
});

test('a game can be saved, loaded, saved again and loaded again', () => {
  withStorage(shim(), () => {
    const { state } = playBot(5, { maxSeconds: 200 });
    persist.saveNow(state);
    const once = persist.loadSave();
    persist.saveNow(once);
    const twice = persist.loadSave();
    assert.deepEqual(view(twice), view(state));
  });
});

test('no save: hasSave false, loadSave null, clearSave harmless', () => {
  withStorage(shim(), () => {
    assert.equal(persist.hasSave(), false);
    assert.equal(persist.loadSave(), null);
    persist.clearSave();
    persist.saveNow(createState(3)); // phase 'title' is never saved
    assert.equal(persist.hasSave(), false);
  });
});

test('clearSave removes the save', () => {
  withStorage(shim(), (st) => {
    const s = createState(3);
    s.phase = 'paused';
    persist.saveNow(s);
    assert.equal(persist.hasSave(), true);
    assert.ok(st.data.has(KEY));
    persist.clearSave();
    assert.equal(persist.hasSave(), false);
    assert.equal(st.data.has(KEY), false);
    assert.equal(persist.loadSave(), null);
  });
});

test('damaged, truncated, old and inconsistent saves are ignored without throwing', () => {
  withStorage(shim(), (st) => {
    const { state } = playBot(7, { maxSeconds: 120 });
    const good = JSON.stringify(encodeState(state));
    const mutate = (fn) => {
      const p = JSON.parse(good);
      fn(p);
      return JSON.stringify(p);
    };
    const bad = {
      empty: '',
      garbage: 'not json at all {{{',
      null: 'null',
      array: '[]',
      number: '42',
      object: '{}',
      truncated: good.slice(0, good.length >> 1),
      'newer version': mutate((p) => (p.v = 2)),
      'older version': mutate((p) => (p.v = 0)),
      'no version': mutate((p) => delete p.v),
      'bad seed': mutate((p) => (p.seed = 'x')),
      'zero seed': mutate((p) => (p.seed = 0)),
      'nan time': mutate((p) => (p.time = null)),
      'parent after child': mutate((p) => (p.net.p[3] = 9)),
      'parent out of range': mutate((p) => (p.net.p[2] = 1e6)),
      'short y array': mutate((p) => p.net.y.pop()),
      'origin out of range': mutate((p) => (p.net.originId = 1e6)),
      'link to missing node': mutate((p) => p.net.links.push([1e6, 'water', 0, 0])),
      'link of unknown kind': mutate((p) => p.net.links.push([1, 'gold', 0, 0])),
      'link to missing deposit': mutate((p) => p.net.links.push([1, 'water', 99, 0])),
      'dead edge out of range': mutate((p) => p.net.deadEdges.push(1e6)),
      'broken hypha': mutate((p) => p.net.growing.push({ id: 1, from: 0, lastNode: 0 })),
      'mushroom on missing node': mutate((p) => (p.mushrooms[0].nodeId = 1e6)),
      'flow to missing node': mutate((p) => p.flows.push([0, 1e6, 'sugar', 1])),
      'tree count': mutate((p) => p.trees.pop()),
      'text resource': mutate((p) => (p.res.sugar = 'lots')),
      'no rng': mutate((p) => delete p.sim.rng),
      'other world': mutate((p) => (p.wf = (p.wf + 1) >>> 0)),
    };
    for (const [name, raw] of Object.entries(bad)) {
      st.data.set(KEY, raw);
      assert.doesNotThrow(() => persist.hasSave(), name);
      assert.equal(persist.loadSave(), null, name);
      assert.equal(persist.hasSave(), false, name);
    }
    st.data.set(KEY, good);
    assert.equal(persist.hasSave(), true);
    assert.ok(persist.loadSave());
  });
});

test('hasSave is cheap: the save is parsed once per distinct stored string', () => {
  withStorage(shim(), (st) => {
    const s = createState(3);
    s.phase = 'playing';
    persist.saveNow(s);
    st.data.set(KEY, st.data.get(KEY)); // as if written by another tab
    const parse = JSON.parse;
    let parses = 0;
    JSON.parse = (...a) => (parses++, parse(...a));
    try {
      for (let i = 0; i < 1000; i++) assert.equal(persist.hasSave(), true);
      st.data.set(KEY, 'x');
      for (let i = 0; i < 1000; i++) assert.equal(persist.hasSave(), false);
    } finally {
      JSON.parse = parse;
    }
    assert.ok(parses <= 2, `parsed ${parses} times`);
  });
});

test('works without localStorage, and with storage that throws', () => {
  const s = createState(3);
  s.phase = 'playing';
  const quiet = () => {
    assert.equal(persist.hasSave(), false);
    assert.equal(persist.loadSave(), null);
    assert.doesNotThrow(() => persist.saveNow(s));
    assert.doesNotThrow(() => persist.clearSave());
    assert.doesNotThrow(() => persist.tick(s, 30));
  };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  delete globalThis.localStorage;
  try {
    quiet();
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
  }
  withGetter(() => {
    throw new Error('SecurityError');
  }, quiet);
  const boom = () => {
    throw new Error('boom');
  };
  withStorage({ getItem: boom, setItem: boom, removeItem: boom }, quiet);
});

test('a full quota keeps the previous save', () => {
  withStorage(shim(), (st) => {
    const s = createState(3);
    s.phase = 'playing';
    persist.saveNow(s);
    const first = st.data.get(KEY);
    s.res.sugar = 5;
    st.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    assert.doesNotThrow(() => persist.saveNow(s));
    assert.equal(st.data.get(KEY), first);
    assert.equal(persist.hasSave(), true);
    assert.equal(persist.loadSave().res.sugar, createState(3).res.sugar);
  });
});

test('size budget: a 5000-node network stays well under 1 MB', () => {
  withStorage(shim(), () => {
    const state = createState(11);
    state.phase = 'playing';
    const rng = createRng(5);
    const { nodes } = state.net;
    const { width, height } = state.world;
    while (nodes.length < 5000) {
      const parent = nodes[rng.int(Math.max(0, nodes.length - 60), nodes.length - 1)];
      const a = rng.range(0, Math.PI * 2);
      const x = Math.min(width - 5, Math.max(5, parent.x + Math.cos(a) * 16));
      const y = Math.min(height - 5, Math.max(5, parent.y + Math.sin(a) * 16));
      addNode(state, x, y, parent.id);
      state.time += 0.05;
    }
    state.res.sugar = 400;
    for (let i = 0; i < 6; i++) sim.commandGrow(state, nodes[i * 800].id, [{ x: nodes[i * 800].x + 60, y: nodes[i * 800].y + 60 }]);
    advance(state, 6);
    const t0 = performance.now();
    persist.saveNow(state);
    const t1 = performance.now();
    const loaded = persist.loadSave();
    const t2 = performance.now();
    const bytes = Buffer.byteLength(globalThis.localStorage.getItem(KEY));
    console.log(`# 5000 nodes: ${bytes} bytes (${(bytes / state.net.nodes.length).toFixed(1)} B/node), save ${(t1 - t0).toFixed(1)} ms, load ${(t2 - t1).toFixed(1)} ms`);
    assert.ok(state.net.nodes.length >= 5000);
    assert.ok(bytes < 1024 * 1024, `${bytes} bytes`);
    assert.deepEqual(view(loaded), view(state));
    advance(state, 3, script);
    advance(loaded, 3, script);
    assert.deepEqual(keyMetrics(loaded), keyMetrics(state));
  });
});

test('tick autosaves after about 10 s of real time while playing, not before, not when paused', () => {
  withStorage(shim(), (st) => {
    const s = createState(3);
    s.phase = 'playing';
    for (let i = 0; i < 19; i++) persist.tick(s, 0.5);
    assert.equal(st.calls.set, 0, 'not before 10 s');
    persist.tick(s, 0.5);
    assert.equal(st.calls.set, 1, 'at 10 s');
    assert.equal(persist.hasSave(), true);
    for (let i = 0; i < 19; i++) persist.tick(s, 0.5);
    assert.equal(st.calls.set, 1);
    persist.tick(s, 0.5);
    assert.equal(st.calls.set, 2, 'and again 10 s later');

    s.phase = 'paused';
    for (let i = 0; i < 100; i++) persist.tick(s, 0.5);
    assert.equal(st.calls.set, 2, 'nothing while paused');

    const next = createState(4);
    next.phase = 'playing';
    persist.tick(s, 0.5); // paused state: still nothing
    for (let i = 0; i < 19; i++) persist.tick(next, 0.5);
    assert.equal(st.calls.set, 2, 'a new state starts counting from zero');
    persist.tick(next, 0.5);
    assert.equal(st.calls.set, 3);
    assert.equal(persist.loadSave().seed, 4);
  });
});

test('saveNow ignores the title screen but saves a paused game', () => {
  withStorage(shim(), (st) => {
    const s = createState(3);
    persist.saveNow(s);
    assert.equal(st.calls.set, 0);
    s.phase = 'paused';
    persist.saveNow(s);
    assert.equal(st.calls.set, 1);
  });
});

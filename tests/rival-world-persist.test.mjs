// The honey-fungus rival, world and save slice: old stumps in the glade and the save format for state.rival,
// state.barriers and the tree fields infection / mantle / lost. (The rival's simulation is tested in sim-rival.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateWorld } from '../src/world/generate.js';
import { STUMP, checkFairness, stumpProblems } from '../src/world/fairness.js';
import { groundYAt } from '../src/world/query.js';
import { decodeState, encodeState, validatePayload } from '../src/persist-codec.js';
import { playBot } from './bot.mjs';

// ---- stumps ----

const digest = (obj) => createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16);

/** Everything the generator produced before stumps existed: the world minus `stumps` and the tree fields added with them. */
function oldWorldDigest(seed) {
  const { stumps, ...rest } = generateWorld(seed);
  rest.trees = rest.trees.map(({ infection, mantle, lost, ...t }) => t);
  return digest(rest);
}

// Digests taken from the generator as it was before stumps were added (checked for seeds 1..400).
const PINNED = {
  1: '5b46dfe5cdae0e04',
  2: 'af9ab91a70c239a9',
  3: '1c2befa06b81cf5f',
  7: 'c51abe42e9757232',
  23: '373af7b55cc5f0ee',
  42: '484621d35684ec9a',
  99: 'ca69b56ab9fa8240',
  150: '5fa4a336bcd603b2',
  300: '4f13c71c8f3029ab',
  400: '05efb7fa4ae50e6e',
};
const PINNED_ALL_1_400 = '1f31cffce0ddd6b3';

test('adding stumps leaves trees, deposits, rocks, decor and spore of existing seeds untouched', () => {
  for (const [seed, want] of Object.entries(PINNED)) assert.equal(oldWorldDigest(Number(seed)), want, `seed ${seed}`);
  let all = '';
  for (let seed = 1; seed <= 400; seed++) all += oldWorldDigest(seed);
  assert.equal(createHash('sha1').update(all).digest('hex').slice(0, 16), PINNED_ALL_1_400);
});

test('every glade has 1-2 old stumps that satisfy the placement rules (seeds 1..300)', () => {
  let sides = [0, 0];
  for (let seed = 1; seed <= 300; seed++) {
    const w = generateWorld(seed);
    assert.deepEqual(stumpProblems(w), [], `seed ${seed}`);
    assert.ok(w.stumps.length >= 1 && w.stumps.length <= 2, `seed ${seed}: ${w.stumps.length} stumps`);
    for (const s of w.stumps) {
      assert.equal(s.y, groundYAt(w, s.x), 'on the ground');
      assert.ok(Math.hypot(s.x - w.origin.x, s.y - w.origin.y) >= 260, 'far from the spore');
      assert.ok(w.trees.every((t) => Math.abs(t.x - s.x) >= 140), 'clear of the trunks');
      assert.ok(s.x >= 40 && s.x <= w.width - 40, 'off the edges');
      assert.ok(s.r >= 26 && s.r <= 34, 'radius');
      sides[s.x < w.width / 2 ? 0 : 1]++;
    }
    assert.ok(w.stumps.every((s, i) => s.id === i), 'ids follow the array');
    for (const t of w.trees) assert.deepEqual([t.infection, t.mantle, t.lost], [0, 0, false]);
  }
  assert.ok(sides[0] > 30 && sides[1] > 30, `both edges get stumps: ${sides}`);
});

test('stumps are deterministic and do not decide fairness', () => {
  for (const seed of [1, 42, 77, 205]) {
    assert.deepEqual(generateWorld(seed).stumps, generateWorld(seed).stumps);
    assert.equal(checkFairness(generateWorld(seed)).ok, true);
  }
  // different seeds give different stump layouts
  const keys = new Set();
  for (let seed = 1; seed <= 60; seed++) keys.add(JSON.stringify(generateWorld(seed).stumps));
  assert.ok(keys.size > 40);
});

test('stumpProblems catches stumps that break a rule', () => {
  const w = generateWorld(42);
  const bad = (stumps) => stumpProblems({ ...w, stumps });
  const ok = w.stumps[0];
  assert.deepEqual(bad([ok]), []);
  assert.ok(bad([]).length > 0, 'none');
  assert.ok(bad([ok, { ...ok, id: 1 }, { ...ok, id: 2 }]).length > 0, 'three');
  assert.ok(bad([{ ...ok, x: w.origin.x, y: groundYAt(w, w.origin.x) }]).length > 0, 'at the spore');
  assert.ok(bad([{ ...ok, x: w.trees[0].x + 20, y: groundYAt(w, w.trees[0].x + 20) }]).length > 0, 'at a trunk');
  assert.ok(bad([{ ...ok, y: ok.y + 30 }]).length > 0, 'floating');
  assert.ok(bad([{ ...ok, r: 60 }]).length > 0, 'huge');
  assert.ok(bad([{ ...ok, x: 20, y: groundYAt(w, 20) }]).length > 0, 'at the edge');
  assert.ok(STUMP.count[0] === 1 && STUMP.count[1] === 2);
});

// ---- persistence of the rival, barriers and tree fields ----

/** A hand-built rival with every pinned field plus the sim's own extras (they must round-trip untouched). */
function makeRival(state) {
  const trees = state.world.trees;
  const s = state.world.stumps[0];
  return {
    awake: true,
    nodes: [
      { id: 0, x: s.x, y: s.y + 6, alive: true, born: 130.5 },
      { id: 1, x: s.x + 20, y: s.y + 30, alive: true, born: 134.25 },
      { id: 2, x: s.x + 44, y: s.y + 52, alive: false, born: 140 },
      { id: 3, x: s.x + 70, y: s.y + 60, alive: true, born: 150.75 },
    ],
    edges: [
      { id: 0, a: 0, b: 1, w: 1, alive: true, born: 134.25, wither: 0 },
      { id: 1, a: 1, b: 2, w: 1.5, alive: false, born: 140, wither: 1 },
      { id: 2, a: 1, b: 3, w: 2, alive: true, born: 150.75, wither: 0.4 },
    ],
    tips: [
      { id: 0, node: 3, x: s.x + 74, y: s.y + 62, dir: 0.31, target: { kind: 'tree', id: trees.length - 1 }, speed: 7.5 },
      { id: 1, node: 2, x: s.x + 45, y: s.y + 53, dir: -1.2, target: null, speed: 0 },
    ],
    grip: [{ treeId: 0, node: 3, x: trees[0].x, y: trees[0].baseY + 60, since: 160 }],
    clusters: [{ id: 0, treeId: 0, x: trees[0].x + 8, y: trees[0].baseY, n: 5, age: 12.5 }],
    spores: 7.5,
    // the sim's internals: integers, plain numbers, arrays, objects and the odd Map or Set
    rs: 123456789,
    ver: 17,
    wakeT: 128,
    stats: { cut: 2, lost: 0 },
    levels: [0.25, 0.5],
    seenTrees: new Set([0, 2]),
    lastTip: new Map([[0, 99.5]]),
  };
}

function makeState() {
  const { state } = playBot(7, { maxSeconds: 90 });
  state.rival = makeRival(state);
  const net = state.net.nodes;
  const at = net[Math.min(2, net.length - 1)];
  state.barriers = [
    { id: 0, nodeId: at.id, x: at.x, y: at.y, r: 120, t: 31.5, dur: 120 },
    { id: 1, nodeId: net[0].id, x: net[0].x, y: net[0].y, r: 120, t: 0, dur: 120 },
  ];
  state.world.trees[0].infection = 0.375;
  state.world.trees[0].mantle = 0.8125;
  state.world.trees[0].lost = false;
  const last = state.world.trees[state.world.trees.length - 1];
  last.infection = 1;
  last.mantle = 0;
  last.lost = true;
  return state;
}

const roundTrip = (state) => decodeState(JSON.parse(JSON.stringify(encodeState(state))));

test('state.rival, state.barriers and tree infection / mantle / lost survive a save', () => {
  const state = makeState();
  const back = roundTrip(state);
  assert.deepEqual(back.rival, state.rival);
  assert.ok(back.rival.seenTrees instanceof Set && back.rival.lastTip instanceof Map, 'Map and Set come back as such');
  assert.deepEqual(back.barriers, state.barriers);
  state.world.trees.forEach((t, i) => {
    const u = back.world.trees[i];
    assert.deepEqual([u.infection, u.mantle, u.lost], [t.infection, t.mantle, t.lost], `tree ${i}`);
  });
  assert.equal(back.world.trees.at(-1).lost, true);
  // saving the loaded game again gives the same payload
  assert.deepEqual(encodeState(back), encodeState(state));
  // and the loaded copy is detached from the live state
  back.rival.nodes[0].x += 1;
  assert.notEqual(back.rival.nodes[0].x, state.rival.nodes[0].x);
});

test('a game without a rival saves null and loads back without one', () => {
  const state = makeState();
  state.rival = null;
  state.barriers = [];
  const p = JSON.parse(JSON.stringify(encodeState(state)));
  assert.equal(p.rival, null);
  assert.deepEqual(p.barriers, []);
  assert.ok(p.trees.every((r) => r.length === 7));
  const back = decodeState(p);
  assert.equal(back.rival, null);
  assert.deepEqual(back.barriers, []);
  // a state object that never had these members (older code paths) saves the same way
  delete state.rival;
  delete state.barriers;
  assert.deepEqual(JSON.parse(JSON.stringify(encodeState(state))).barriers, []);
});

test('saves from before the rival (no rival, no barriers, 4-number tree rows) still load', () => {
  const state = makeState();
  const p = JSON.parse(JSON.stringify(encodeState(state)));
  delete p.rival;
  delete p.barriers;
  p.trees = p.trees.map((r) => r.slice(0, 4));
  assert.doesNotThrow(() => validatePayload(p));
  const back = decodeState(p);
  assert.equal(back.rival, null);
  assert.deepEqual(back.barriers, []);
  for (const [i, t] of back.world.trees.entries()) {
    assert.deepEqual([t.infection, t.mantle, t.lost], [0, 0, false]);
    assert.equal(t.stage, state.world.trees[i].stage);
    assert.equal(t.health, state.world.trees[i].health);
  }
});

test('malformed rival, barrier and tree payloads are rejected', () => {
  const state = makeState();
  const good = JSON.stringify(encodeState(state));
  const mutate = (fn) => {
    const p = JSON.parse(good);
    fn(p);
    return p;
  };
  assert.doesNotThrow(() => validatePayload(JSON.parse(good)));
  const nodes = state.net.nodes.length;
  const treeCount = state.world.trees.length;
  const bad = {
    'rival is a number': (p) => (p.rival = 5),
    'rival is an array': (p) => (p.rival = []),
    'rival without nodes': (p) => delete p.rival.nodes,
    'rival nodes not a list': (p) => (p.rival.nodes = {}),
    'rival edges missing': (p) => delete p.rival.edges,
    'rival tips missing': (p) => delete p.rival.tips,
    'rival grip missing': (p) => delete p.rival.grip,
    'rival clusters missing': (p) => delete p.rival.clusters,
    'node id off the index': (p) => (p.rival.nodes[1].id = 7),
    'node with text position': (p) => (p.rival.nodes[0].x = 'left'),
    'node alive not a boolean': (p) => (p.rival.nodes[0].alive = 1),
    'node born is NaN': (p) => (p.rival.nodes[0].born = null),
    'edge to a missing node': (p) => (p.rival.edges[0].b = 4),
    'edge from a negative node': (p) => (p.rival.edges[0].a = -1),
    'edge id off the index': (p) => (p.rival.edges[2].id = 0),
    'edge without wither': (p) => delete p.rival.edges[0].wither,
    'edge width text': (p) => (p.rival.edges[1].w = 'thick'),
    'tip on a missing node': (p) => (p.rival.tips[0].node = 99),
    'tip with a text speed': (p) => (p.rival.tips[0].speed = '7'),
    'tip target of a wrong kind': (p) => (p.rival.tips[0].target = { kind: 'water', id: 0 }),
    'tip target tree out of range': (p) => (p.rival.tips[0].target = { kind: 'tree', id: treeCount }),
    'tip target a number': (p) => (p.rival.tips[0].target = 3),
    'grip on a missing tree': (p) => (p.rival.grip[0].treeId = treeCount),
    'grip on a missing node': (p) => (p.rival.grip[0].node = -2),
    'grip without since': (p) => delete p.rival.grip[0].since,
    'cluster on a missing tree': (p) => (p.rival.clusters[0].treeId = 99),
    'cluster with no count': (p) => delete p.rival.clusters[0].n,
    'awake is text': (p) => (p.rival.awake = 'yes'),
    'spores missing': (p) => delete p.rival.spores,
    'rng state fractional': (p) => (p.rival.rs = 1.5),
    'barriers not a list': (p) => (p.barriers = {}),
    'barrier on a missing node': (p) => (p.barriers[0].nodeId = nodes),
    'barrier without radius': (p) => delete p.barriers[0].r,
    'barrier time NaN': (p) => (p.barriers[1].t = null),
    'barrier duration text': (p) => (p.barriers[1].dur = '120'),
    'barrier is a number': (p) => (p.barriers[0] = 7),
    'tree row of 5 numbers': (p) => (p.trees[0] = p.trees[0].slice(0, 5)),
    'tree row of 8 numbers': (p) => p.trees[0].push(0),
    'tree infection text': (p) => (p.trees[0][4] = 'sick'),
  };
  for (const [name, fn] of Object.entries(bad)) assert.throws(() => validatePayload(mutate(fn)), /save:/, name);
  for (const [name, fn] of Object.entries(bad)) assert.throws(() => decodeState(mutate(fn)), /save:/, `decode: ${name}`);
  // optional members and extras the sim adds are fine
  assert.doesNotThrow(() => validatePayload(mutate((p) => delete p.rival.rs)));
  assert.doesNotThrow(() => validatePayload(mutate((p) => (p.rival.somethingNew = { a: [1, 2] }))));
  assert.doesNotThrow(() => validatePayload(mutate((p) => (p.rival.tips[1].target = undefined))));
  assert.doesNotThrow(() => validatePayload(mutate((p) => (p.rival = null))));
});

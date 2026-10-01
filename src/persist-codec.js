// Save format: turns a game state into a compact JSON-able payload and back (no storage, no DOM).
// Everything that influences the simulation round-trips bit-exactly; derived structures (grid, link lists,
// edges, distances, flow paths) are rebuilt from the saved network in the same order the live game builds them.
import { hash32 } from './core/rng.js';
import { createState } from './state.js';
import { createSimData, pathBetween } from './sim/network.js';
import { restoreTime } from './sim/clock.js';
import { rescanFinds } from './sim/finds.js';

export const SAVE_VERSION = 1;

const CELL = 40; // keep equal to the grid cell of src/sim/network.js (the tests compare the rebuilt grid)
const KINDS = ['water', 'mineral', 'tree'];
const FLOW_KINDS = ['water', 'mineral', 'sugar'];
// state.sim members that are rebuilt from the network; every other member is saved as it is.
const DERIVED = new Set(['rng', 'cells', 'parentEdge', 'waterLinks', 'mineralLinks', 'contacts', 'tipClaimed']);
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

const round2 = (v) => Math.round(v * 100) / 100;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isId = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function check(ok, what) {
  if (!ok) throw new Error(`save: ${what}`);
}

/** Digest of the generated world (deposits, trees, origin): a save made on another world generator is refused. */
export function worldFingerprint(world) {
  const parts = [world.seed, world.origin.x.toFixed(1), world.origin.y.toFixed(1), world.ground.length];
  for (const w of world.water) parts.push(w.x.toFixed(1), w.y.toFixed(1), w.rx.toFixed(1), w.max);
  for (const m of world.minerals) parts.push(m.x.toFixed(1), m.y.toFixed(1), m.r.toFixed(1), m.max);
  for (const t of world.trees) parts.push(t.species, t.x.toFixed(1), t.tips.length, t.roots.length);
  return hash32(...parts);
}

// ---- generic values: plain data with Map and Set ----

function encodeValue(v) {
  if (v instanceof Map) return { $map: [...v].map(([k, x]) => [encodeValue(k), encodeValue(x)]) };
  if (v instanceof Set) return { $set: [...v].map(encodeValue) };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (isObj(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (typeof x !== 'function') out[k] = encodeValue(x);
    return out;
  }
  return v;
}

function decodeValue(v) {
  if (Array.isArray(v)) return v.map(decodeValue);
  if (!isObj(v)) return v;
  if (Array.isArray(v.$map)) return new Map(v.$map.map(([k, x]) => [decodeValue(k), decodeValue(x)]));
  if (Array.isArray(v.$set)) return new Set(v.$set.map(decodeValue));
  const out = {};
  for (const [k, x] of Object.entries(v)) if (!UNSAFE.has(k)) out[k] = decodeValue(x);
  return out;
}

function assignPlain(target, source) {
  for (const [k, v] of Object.entries(source)) if (!UNSAFE.has(k)) target[k] = v;
}

// ---- encoding ----

function encodeNet(net) {
  const x = [];
  const y = [];
  const p = [];
  const b = [];
  const deadNodes = [];
  const deadEdges = [];
  const w = [];
  let e = 0;
  for (const n of net.nodes) {
    x.push(n.x);
    y.push(n.y);
    p.push(n.parent);
    b.push(round2(n.born));
    if (!n.alive) deadNodes.push(n.id);
    if (n.parent < 0) continue;
    const edge = net.edges[e++];
    check(edge && edge.a === n.parent && edge.b === n.id, 'edges do not follow nodes');
    if (!edge.alive) deadEdges.push(edge.id);
    if (edge.w !== 1) w.push([edge.id, edge.w]);
  }
  check(e === net.edges.length, 'edge count');
  const links = net.links.map((l) => {
    const row = [l.nodeId, l.kind, l.targetId, round2(l.born)];
    if (l.tip !== undefined) row.push(l.tip);
    return row;
  });
  return { originId: net.originId, version: net.version, x, y, p, b, deadNodes, deadEdges, w, links, growing: encodeValue(net.growing) };
}

function encodeSim(sim) {
  const rest = {};
  for (const [k, v] of Object.entries(sim)) if (!DERIVED.has(k) && typeof v !== 'function') rest[k] = encodeValue(v);
  return { rng: sim.rng.getState(), rest };
}

/** The state as a JSON-able object. Does not touch the state. */
export function encodeState(state) {
  const { world } = state;
  return {
    v: SAVE_VERSION,
    seed: state.seed,
    wf: worldFingerprint(world),
    time: state.time,
    speed: state.speed,
    res: { ...state.res },
    rates: { ...state.rates },
    cap: { ...state.cap },
    stats: { ...state.stats },
    flags: encodeValue(state.flags),
    clock: encodeValue(state.clock),
    weather: encodeValue(state.weather),
    objectives: state.objectives.filter((o) => o.done).map((o) => o.id),
    net: encodeNet(state.net),
    trees: world.trees.map((t) => [t.stage, t.growth, t.health, t.linked ? 1 : 0]),
    water: world.water.map((d) => d.amount),
    minerals: world.minerals.map((d) => d.amount),
    finds: Object.entries(state.finds ?? {}).map(([id, f]) => [Number(id), f.kind, round2(f.at)]),
    mushrooms: encodeValue(state.mushrooms),
    flows: state.flows.map((f) => [f.from, f.to, f.kind, f.rate]),
    sim: encodeSim(state.sim),
  };
}

// ---- validation (structure only: cheap, needs no world) ----

function validateNet(n) {
  check(isObj(n), 'net');
  const count = Array.isArray(n.x) ? n.x.length : 0;
  check(count >= 1 && [n.y, n.p, n.b].every((a) => Array.isArray(a) && a.length === count), 'node arrays');
  let edges = 0;
  for (let i = 0; i < count; i++) {
    check(isNum(n.x[i]) && isNum(n.y[i]) && isNum(n.b[i]), 'node numbers');
    check(Number.isInteger(n.p[i]) && n.p[i] >= -1 && n.p[i] < i, 'node parent');
    if (n.p[i] >= 0) edges++;
  }
  check(isId(n.originId, count) && Number.isInteger(n.version), 'origin');
  check(Array.isArray(n.deadNodes) && n.deadNodes.every((id) => isId(id, count)), 'dead nodes');
  check(Array.isArray(n.deadEdges) && n.deadEdges.every((id) => isId(id, edges)), 'dead edges');
  check(Array.isArray(n.w) && n.w.every((r) => Array.isArray(r) && isId(r[0], edges) && isNum(r[1]) && r[1] > 0), 'edge widths');
  check(Array.isArray(n.links), 'links');
  for (const l of n.links) {
    check(Array.isArray(l) && isId(l[0], count) && KINDS.includes(l[1]) && Number.isInteger(l[2]) && l[2] >= 0 && isNum(l[3]), 'link');
    check(l[1] !== 'tree' || (Number.isInteger(l[4]) && l[4] >= 0), 'link tip');
  }
  check(Array.isArray(n.growing), 'growing');
  for (const h of n.growing) validateHypha(h, count);
  return count;
}

function validateHypha(h, count) {
  check(isObj(h) && isId(h.from, count) && isId(h.lastNode, count) && Number.isInteger(h.id), 'hypha ids');
  check([h.grown, h.total, h.nodeS, h.tickAt].every(isNum), 'hypha numbers');
  const pts = h.path;
  check(Array.isArray(pts) && pts.length >= 2 && pts.every((q) => isObj(q) && isNum(q.x) && isNum(q.y)), 'hypha path');
  check(Array.isArray(h.cum) && h.cum.length === pts.length && h.cum.every(isNum), 'hypha cum');
  check(Array.isArray(h.segCost) && h.segCost.length === pts.length - 1 && h.segCost.every(isNum), 'hypha segCost');
  check(isId(h.seg, h.segCost.length) && isObj(h.tip) && isNum(h.tip.x) && isNum(h.tip.y), 'hypha seg/tip');
}

/** Throws when the payload cannot be a save of this version; returns it otherwise. */
export function validatePayload(p) {
  check(isObj(p) && p.v === SAVE_VERSION, 'version');
  check(isNum(p.seed) && p.seed > 0 && Number.isInteger(p.wf), 'seed');
  check(isNum(p.time) && p.time >= 0 && isNum(p.speed), 'time');
  for (const k of ['res', 'rates', 'cap', 'stats']) check(isObj(p[k]) && Object.values(p[k]).every(isNum), k);
  check(['sugar', 'water', 'minerals', 'spores'].every((k) => isNum(p.res[k]) && isNum(p.rates[k])), 'resources');
  check(isNum(p.cap.pool) && isNum(p.cap.sugar), 'caps');
  check(isObj(p.flags) && Array.isArray(p.objectives), 'flags');
  const nodes = validateNet(p.net);
  for (const k of ['trees', 'water', 'minerals', 'mushrooms', 'flows']) check(Array.isArray(p[k]), k);
  check(p.trees.every((t) => Array.isArray(t) && t.length === 4 && t.every(isNum)), 'trees');
  check(p.water.every(isNum) && p.minerals.every(isNum), 'deposits');
  check(p.mushrooms.every((m) => isObj(m) && isId(m.nodeId, nodes) && isNum(m.x) && isNum(m.baseY) && isNum(m.age) && isNum(m.growth)), 'mushrooms');
  check(p.flows.every((f) => Array.isArray(f) && isId(f[0], nodes) && isId(f[1], nodes) && FLOW_KINDS.includes(f[2]) && isNum(f[3])), 'flows');
  // `finds` is optional: saves from before the atlas have none (decodeState rebuilds them from the network)
  check(p.finds === undefined || (Array.isArray(p.finds) && p.finds.every((f) => Array.isArray(f) && Number.isInteger(f[0]) && f[0] >= 0 && typeof f[1] === 'string' && isNum(f[2]))), 'finds');
  check(isObj(p.sim) && Number.isInteger(p.sim.rng) && isObj(p.sim.rest), 'sim');
  return p;
}

// ---- decoding ----

function gridInsert(sim, node) {
  const k = Math.floor(node.x / CELL) * 4096 + Math.floor(node.y / CELL);
  const cell = sim.cells.get(k);
  if (cell) cell.push(node.id);
  else sim.cells.set(k, [node.id]);
}

/** Nodes, edges and the spatial grid, built in id order exactly like addNode does. */
function rebuildGraph(state, p) {
  const { net, sim } = state;
  const dead = new Set(p.deadNodes);
  const deadEdges = new Set(p.deadEdges);
  const widths = new Map(p.w);
  net.nodes = [];
  net.edges = [];
  for (let i = 0; i < p.x.length; i++) {
    const parentId = p.p[i];
    const node = { id: i, x: p.x[i], y: p.y[i], born: p.b[i], alive: !dead.has(i), parent: parentId, dist: 0 };
    net.nodes.push(node);
    sim.parentEdge.push(-1);
    if (parentId >= 0) {
      const parent = net.nodes[parentId];
      const len = Math.hypot(node.x - parent.x, node.y - parent.y);
      node.dist = parent.dist + len;
      const edge = { id: net.edges.length, a: parentId, b: i, len, born: node.born, alive: !deadEdges.has(net.edges.length), w: widths.get(net.edges.length) ?? 1 };
      net.edges.push(edge);
      sim.parentEdge[i] = edge.id;
    }
    gridInsert(sim, node);
  }
}

/** Links in saved order, and the per-deposit lists and claimed tips derived from them. */
function rebuildLinks(state, rows) {
  const { net, sim, world } = state;
  net.links = [];
  for (const [nodeId, kind, targetId, born, tip] of rows) {
    const link = { nodeId, kind, targetId, born };
    if (kind === 'tree') {
      check(isId(targetId, world.trees.length), 'link target');
      link.tip = tip;
      sim.contacts[targetId].push(nodeId);
      sim.tipClaimed.add(`${targetId}:${tip}`);
    } else {
      const lists = kind === 'water' ? sim.waterLinks : sim.mineralLinks;
      check(isId(targetId, lists.length), 'link target');
      lists[targetId].push(nodeId);
    }
    net.links.push(link);
  }
}

function restoreWorld(world, p) {
  check(p.trees.length === world.trees.length && p.water.length === world.water.length && p.minerals.length === world.minerals.length, 'world shape');
  world.trees.forEach((t, i) => {
    [t.stage, t.growth, t.health] = p.trees[i];
    t.linked = p.trees[i][3] === 1;
  });
  world.water.forEach((d, i) => (d.amount = p.water[i]));
  world.minerals.forEach((d, i) => (d.amount = p.minerals[i]));
}

function restoreFinds(state, p) {
  if (p.finds === undefined) {
    rescanFinds(state);
    return;
  }
  const { decor } = state.world;
  for (const [id, kind, at] of p.finds) {
    check(id < decor.length && decor[id].type === kind, 'find');
    state.finds[id] = { kind, at };
  }
}

/** Builds a fresh, playable state (phase 'paused') from a validated payload. Throws when it does not fit. */
export function decodeState(p) {
  validatePayload(p);
  const state = createState(p.seed);
  check(worldFingerprint(state.world) === p.wf, 'world differs');
  state.sim = createSimData(state);
  const { net, sim } = state;
  state.time = p.time;
  state.speed = p.speed;
  state.phase = 'paused';
  assignPlain(state.res, p.res);
  assignPlain(state.rates, p.rates);
  assignPlain(state.cap, p.cap);
  assignPlain(state.stats, p.stats);
  assignPlain(state.flags, decodeValue(p.flags));
  if (p.clock !== undefined) state.clock = decodeValue(p.clock);
  if (p.weather !== undefined) state.weather = decodeValue(p.weather);
  const done = new Set(p.objectives);
  for (const o of state.objectives) o.done = done.has(o.id);

  net.originId = p.net.originId;
  net.version = p.net.version;
  rebuildGraph(state, p.net);
  rebuildLinks(state, p.net.links);
  net.growing = decodeValue(p.net.growing);
  restoreWorld(state.world, p);
  state.mushrooms = decodeValue(p.mushrooms);
  restoreFinds(state, p);
  state.flows = p.flows.map(([from, to, kind, rate]) => ({ from, to, kind, rate, path: pathBetween(net, from, to) }));
  sim.rng.setState(p.sim.rng);
  assignPlain(sim, decodeValue(p.sim.rest));
  state.events = [];
  restoreTime(state);
  return state;
}

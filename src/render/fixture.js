// Test fixture for the renderer: fills a state with a big synthetic network, links, flows, mushrooms, grown trees and
// half-depleted deposits, per the contract in docs/ARCHITECTURE.md. Not used by the game.
//   await import('/src/render/fixture.js').then(m => m.applyFixture(__game.state))
import { createRng } from '../core/rng.js';
import { isPassable, groundYAt } from '../world/query.js';

export function applyFixture(state, opts = {}) {
  const { nodes: targetNodes = 2400, seed = state.world.seed + 99 } = opts;
  const world = state.world;
  const rng = createRng(seed);
  const net = {
    nodes: [],
    edges: [],
    links: [],
    growing: [],
    originId: 0,
    version: 1,
  };
  const born = 0;
  const kids = [];

  const addNode = (x, y, parent) => {
    const id = net.nodes.length;
    const p = parent >= 0 ? net.nodes[parent] : null;
    net.nodes.push({ id, x, y, born, alive: true, parent, dist: p ? p.dist + Math.hypot(x - p.x, y - p.y) : 0 });
    kids[id] = 0;
    if (p) {
      net.edges.push({ id: net.edges.length, a: parent, b: id, len: Math.hypot(x - p.x, y - p.y), born, alive: true, w: 1 });
      kids[parent]++;
    }
    return id;
  };
  addNode(world.origin.x, world.origin.y, -1);

  const free = (x, y) => isPassable(world, x, y) && y > groundYAt(world, x) + 14;
  const STEP = 16;

  // random branching growth
  const tips = [{ id: 0, a: Math.PI / 2, life: 40 }];
  for (let k = 0; k < 6; k++) tips.push({ id: 0, a: rng.range(0, Math.PI * 2), life: rng.int(20, 60) });
  let guard = 0;
  while (net.nodes.length < targetNodes && tips.length && guard++ < 200000) {
    const i = rng.int(0, tips.length - 1);
    const tp = tips[i];
    const from = net.nodes[tp.id];
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      const a = tp.a + rng.range(-0.5, 0.5) + (attempt ? rng.range(-1.2, 1.2) : 0);
      const nx = from.x + Math.cos(a) * STEP;
      const ny = from.y + Math.sin(a) * STEP;
      if (!free(nx, ny) || !free((nx + from.x) / 2, (ny + from.y) / 2)) continue;
      const id = addNode(nx, ny, tp.id);
      tp.id = id;
      tp.a = a + (Math.PI / 2 - a) * 0.012; // tiny downward gravity
      tp.life--;
      ok = true;
      if (rng.chance(0.11) && tips.length < 90) tips.push({ id, a: a + rng.range(-1.1, 1.1) * (rng.chance(0.5) ? 1 : -1), life: rng.int(15, 70) });
    }
    if (!ok || tp.life <= 0) tips.splice(i, 1);
  }

  // directed hyphae toward targets, so links exist
  const growToward = (tx, ty, kind, targetId, within) => {
    let best = 0;
    let bd = Infinity;
    for (const n of net.nodes) {
      const d = Math.hypot(n.x - tx, n.y - ty);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    let cur = best;
    for (let s = 0; s < 120; s++) {
      const c = net.nodes[cur];
      if (Math.hypot(c.x - tx, c.y - ty) <= within) break;
      const base = Math.atan2(ty - c.y, tx - c.x);
      let moved = false;
      for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95, 1.3, -1.3]) {
        const a = base + off;
        const nx = c.x + Math.cos(a) * STEP;
        const ny = c.y + Math.sin(a) * STEP;
        if (!free(nx, ny) || !free((nx + c.x) / 2, (ny + c.y) / 2)) continue;
        cur = addNode(nx, ny, cur);
        moved = true;
        break;
      }
      if (!moved) break;
    }
    net.links.push({ nodeId: cur, kind, targetId, born });
    return cur;
  };
  const wanted = [];
  world.water.slice(0, 4).forEach((d) => wanted.push([d.x, d.y, 'water', d.id, Math.min(d.rx, 30)]));
  world.minerals.slice(0, 3).forEach((d) => wanted.push([d.x, d.y, 'mineral', d.id, d.r * 0.8]));
  world.trees.forEach((t) => {
    const tip = t.tips.find((p) => p.minStage <= Math.max(t.stage, 1)) || t.tips[0];
    if (tip) wanted.push([tip.x, tip.y, 'tree', t.id, 14]);
  });
  for (const w of wanted) growToward(...w);

  // thickness by subtree size (pipe model)
  const count = new Float32Array(net.nodes.length).fill(1);
  for (let i = net.nodes.length - 1; i > 0; i--) count[net.nodes[i].parent] += count[i];
  for (const e of net.edges) e.w = Math.min(6, 1 + Math.log2(count[e.b]) * 0.42);

  // flows along parents to the origin
  const pathUp = (id) => {
    const out = [];
    for (let n = id; n >= 0; n = net.nodes[n].parent) out.push(n);
    return out;
  };
  state.flows = [];
  net.links.forEach((lk, i) => {
    const up = pathUp(lk.nodeId);
    const kind = lk.kind === 'tree' ? 'sugar' : lk.kind;
    state.flows.push({ from: lk.nodeId, to: 0, kind, rate: 0.6 + (i % 4) * 0.5, path: up });
    if (lk.kind === 'tree') state.flows.push({ from: 0, to: lk.nodeId, kind: i % 2 ? 'water' : 'mineral', rate: 0.8, path: up.slice().reverse() });
  });

  // growing hyphae with a moving tip
  const leaf = net.nodes.length - 1;
  const ln = net.nodes[leaf];
  net.growing = [{ id: 1, from: leaf, path: [{ x: ln.x, y: ln.y }, { x: ln.x + 40, y: ln.y + 20 }], grown: 6, total: 44, lastNode: leaf, tip: { x: ln.x + 9, y: ln.y + 5 } }];

  state.net = net;
  state.res = { sugar: 140, water: 38, minerals: 22, spores: 31 };
  state.cap = { pool: 100 };

  // trees at various stages / health
  const look = [
    { stage: 1, health: 0.9, linked: true },
    { stage: 2, health: 0.55, linked: true },
    { stage: 3, health: 0.25, linked: false },
  ];
  world.trees.forEach((t, i) => Object.assign(t, look[i % 3]));

  // half-depleted deposits
  world.water.forEach((d, i) => (d.amount = d.max * [0.95, 0.6, 0.3, 0.1, 0][i % 5]));
  world.minerals.forEach((d, i) => (d.amount = d.max * [1, 0.55, 0.2, 0.7, 0.05][i % 5]));

  // mushrooms near the surface
  const shallow = net.nodes.filter((n) => n.y < groundYAt(world, n.x) + 90);
  state.mushrooms = [];
  const growths = [1, 0.85, 0.6, 0.35, 0.12, 1, 0.5];
  for (let i = 0; i < Math.min(growths.length, shallow.length); i++) {
    const n = shallow[Math.floor((i + 0.5) * (shallow.length / growths.length))];
    state.mushrooms.push({
      id: i,
      nodeId: n.id,
      x: n.x,
      baseY: groundYAt(world, n.x),
      species: 'common',
      variant: i,
      age: growths[i] * 20,
      growth: growths[i],
      mature: growths[i] >= 1,
      spores: 12,
    });
  }
  state.stats = { hyphaeLength: net.edges.reduce((s, e) => s + e.len, 0), maxDepth: 640 };
  return state;
}

/** UI overlays for screenshots: kind = 'preview' | 'blocked' | 'unaffordable' | 'hover' | 'fruit'. */
export function applyUiFixture(state, kind) {
  const w = state.world;
  const o = state.net.nodes[0];
  state.ui.drag = null;
  state.ui.preview = null;
  state.ui.hoverNode = null;
  state.ui.hoverTarget = null;
  state.ui.tool = 'grow';
  const pts = [];
  for (let i = 1; i <= 12; i++) pts.push({ x: o.x + i * 14, y: o.y + 30 * Math.sin(i * 0.35) + i * 6 });
  if (kind === 'preview') state.ui.preview = { from: 0, points: [{ x: o.x, y: o.y }, ...pts], blocked: null, length: 170, cost: 20, affordable: true };
  if (kind === 'blocked') state.ui.preview = { from: 0, points: [{ x: o.x, y: o.y }, ...pts.slice(0, 7)], blocked: pts[7], length: 100, cost: 12, affordable: true };
  if (kind === 'unaffordable') state.ui.preview = { from: 0, points: [{ x: o.x, y: o.y }, ...pts], blocked: null, length: 170, cost: 999, affordable: false };
  if (kind === 'hover') {
    state.ui.hoverNode = Math.min(40, state.net.nodes.length - 1);
    state.ui.hoverTarget = { kind: 'water', id: w.water[1]?.id ?? 0 };
  }
  if (kind === 'fruit') state.ui.tool = 'fruit';
  if (kind === 'tree') state.ui.hoverTarget = { kind: 'tree', id: 1 };
  if (kind === 'rock') state.ui.hoverTarget = { kind: 'rock', id: 2 };
  if (kind === 'mineral') state.ui.hoverTarget = { kind: 'mineral', id: 3 };
  if (kind === 'mushroom') state.ui.hoverTarget = { kind: 'mushroom', id: 0 };
  if (kind === 'horizon') state.ui.hoverTarget = { kind: 'horizon', id: 2 };
  return state;
}

/**
 * Fake honey-fungus rival for galleries and benchmarks (the real sim builds this in src/sim/rival.js): one stump,
 * a web of about `edges` rhizomorph segments with growing tips and withering edges, grips, trees at infection
 * 0 / 0.3 / 0.7 / lost with a mantle on the healthy one, honey clusters, two barriers and a barrier cursor.
 * Fields as in docs/ARCHITECTURE.md §«Rival: honey fungus». Fixed time: state.time = 100.
 */
export function applyRivalFixture(state, opts = {}) {
  const { edges: wanted = 300, seed = (state.world.seed || 1) + 7, pick = 'ok' } = opts;
  const world = state.world;
  const rng = createRng(seed);
  const time = (state.time = opts.time ?? 100);

  // four trees: infection 0 (with a mantle), 0.3, 0.7 and a lost one; the world's own trees come first
  const list = world.trees;
  const taken = list.map((t) => t.x);
  while (list.length < 4) {
    const src = list[0];
    const cand = [420, 700, 980, 1260, 1540, 1780].map((x) => ({ x, d: Math.min(...taken.map((v) => Math.abs(v - x))) })).sort((a, b) => b.d - a.d)[0];
    const dx = cand.x - src.x;
    const id = Math.max(...list.map((t) => t.id)) + 1;
    const moved = (p) => ({ ...p, x: p.x + dx });
    list.push({ ...src, id, x: src.x + dx, baseY: groundYAt(world, src.x + dx), crownSeed: src.crownSeed + 17, roots: src.roots.map((r) => ({ ...r, points: r.points.map(moved) })), tips: src.tips.map(moved) });
    taken.push(cand.x);
  }
  const trees = list.slice().sort((a, b) => a.x - b.x);
  const look = [
    { infection: 0, mantle: 0.85, lost: false },
    { infection: 0.3, mantle: 0.4, lost: false },
    { infection: 0.7, mantle: 0.1, lost: false },
    { infection: 1, mantle: 0, lost: true },
  ];
  trees.slice(0, 4).forEach((t, i) => Object.assign(t, { stage: 3, health: 0.85, linked: i < 3 }, look[i]));

  // the stump: at the surface near the left edge
  const sx = trees[0].x > 500 ? 180 : 1760;
  world.stumps = [{ id: 1, x: sx, y: groundYAt(world, sx), r: 30 }];
  const stump = world.stumps[0];

  const nodes = [];
  const rEdges = [];
  const addNode = (x, y, bornT) => {
    nodes.push({ id: nodes.length, x, y, alive: true, born: bornT });
    return nodes.length - 1;
  };
  const free = (x, y) => isPassable(world, x, y) && y > groundYAt(world, x) + 8;
  const STEP = 20;
  const root = addNode(stump.x, stump.y + 12, time - 400);
  const heads = [];
  const targets = trees.slice(0, 4).map((t) => t.tips[Math.min(1, t.tips.length - 1)]).filter(Boolean);
  // three leading rhizomorphs make for the trees, the rest are side branches
  for (let i = 0; i < 4; i++) heads.push({ node: root, a: Math.PI / 2 + rng.range(-0.6, 0.6), tgt: targets[(i + 1) % targets.length] });
  let guard = 0;
  while (rEdges.length < wanted && guard++ < 20000) {
    const h = heads[rng.chance(0.65) ? rng.int(0, 3) : rng.int(0, heads.length - 1)];
    const from = nodes[h.node];
    let ok = false;
    for (let at = 0; at < 6 && !ok; at++) {
      const toward = h.tgt && rng.chance(0.8) ? Math.atan2(h.tgt.y - from.y, h.tgt.x - from.x) : h.a;
      const a = toward + rng.range(-0.4, 0.4) + (at ? rng.range(-1.1, 1.1) : 0);
      const nx = from.x + Math.cos(a) * STEP;
      const ny = from.y + Math.sin(a) * STEP;
      if (!free(nx, ny) || !free((nx + from.x) / 2, (ny + from.y) / 2)) continue;
      const id = addNode(nx, ny, time - (wanted - rEdges.length) * 0.5);
      rEdges.push({ id: rEdges.length, a: h.node, b: id, w: 1, alive: true, born: time - (wanted - rEdges.length) * 0.5, wither: 0 });
      h.node = id;
      h.a = a;
      ok = true;
      if (rng.chance(0.045) && heads.length < 40) heads.push({ node: id, a: a + rng.range(-1, 1), tgt: rng.chance(0.4) ? rng.pick(targets) : null });
    }
    if (!ok) h.a += rng.range(-1.2, 1.2);
  }
  // pipe-model thickness: trunk edges thicker than the twigs
  const count = new Float32Array(nodes.length).fill(1);
  const parent = new Int32Array(nodes.length).fill(-1);
  for (const e of rEdges) parent[e.b] = e.a;
  for (let i = nodes.length - 1; i > 0; i--) if (parent[i] >= 0) count[parent[i]] += count[i];
  for (const e of rEdges) e.w = Math.min(3, 1 + Math.log2(count[e.b]) * 0.28);

  // growing tips: the five latest heads, edges near them are young
  const tips = heads.slice(0, 5).map((h, i) => {
    const n = nodes[h.node];
    return { id: i + 1, node: h.node, x: n.x + Math.cos(h.a) * 6, y: n.y + Math.sin(h.a) * 6, dir: h.a, target: null, speed: 14 };
  });
  for (const tp of tips) {
    let id = tp.node;
    for (let k = 0; k < 5 && id > 0; k++) {
      const e = rEdges.find((q) => q.b === id);
      if (!e) break;
      e.born = time - 0.12 * (k + 1) * 0.4 + 0.05;
      id = e.a;
    }
  }

  // barriers: one freshly drawn, one in its last seconds; edges inside the old one are withering
  const bn = (n) => ({ x: n.x, y: n.y });
  const mid = nodes[Math.floor(nodes.length * 0.55)];
  const far = nodes[Math.floor(nodes.length * 0.8)];
  state.barriers = [
    { id: 1, nodeId: 0, ...bn(mid), r: 70, t: 0.45, dur: 90 },
    { id: 2, nodeId: 0, ...bn(far), r: 70, t: 81, dur: 90 },
  ];
  rEdges.forEach((e) => {
    const a = nodes[e.a];
    const d = Math.hypot(a.x - far.x, a.y - far.y);
    if (d < 70 && e.alive) e.wither = Math.min(0.97, 0.25 + 0.7 * (1 - d / 70) * rng.range(0.6, 1.2));
  });
  // tree-lost sprouts: grips on the three infected trees' root zones, honey clusters at the heavy ones
  const grip = [];
  const clusters = [];
  trees.slice(1, 4).forEach((t, i) => {
    const tp = t.tips[Math.min(1, t.tips.length - 1)];
    let best = 1;
    let bd = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - tp.x, n.y - tp.y);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    grip.push({ treeId: t.id, node: best, x: tp.x, y: tp.y, since: time - 20 - i * 15 });
    if (t.infection >= 0.4) clusters.push({ id: i + 1, treeId: t.id, x: t.x + 14 * (i ? -1 : 1), y: t.baseY, n: i ? 7 : 5, age: 30 });
  });
  clusters.push({ id: 9, treeId: trees[1].id, x: trees[1].x - 22, y: trees[1].baseY, n: 2, age: 4 });

  state.rival = { awake: true, nodes, edges: rEdges, tips, grip, clusters, spores: 3, ver: 1, rs: 1 };
  state.ui.tool = 'barrier';
  const at = nodes[Math.floor(nodes.length * 0.3)];
  state.ui.barrierPick = { nodeId: at.id, x: at.x + 30, y: at.y - 6, r: 70, ok: pick === 'ok', reason: pick === 'ok' ? null : 'sugar', cost: 30 };
  return state;
}

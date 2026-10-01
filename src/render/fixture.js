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

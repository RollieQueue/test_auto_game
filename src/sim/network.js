// Network graph primitives: nodes, edges, spatial grid, links to deposits and trees, paths.
import { createRng, hash32 } from '../core/rng.js';
import { dist2 } from '../core/geom.js';
import { groundYAt, horizonIndexAt } from '../world/query.js';
import { B } from './balance.js';
import { checkFinds } from './finds.js';

const CELL = 40;

/** Internal simulation data kept at state.sim (not part of the public schema). */
export function createSimData(state) {
  const { world } = state;
  return {
    rng: createRng(hash32(state.seed, 'sim')),
    clock: 0,
    cells: new Map(), // spatial grid of alive nodes
    parentEdge: [], // node id -> id of the edge towards its parent (-1 for the origin)
    lenSap: 0, // hyphae length lying in litter and humus
    waterLinks: world.water.map(() => []), // per pocket: ids of link nodes
    mineralLinks: world.minerals.map(() => []),
    contacts: world.trees.map(() => []), // per tree: ids of tree link nodes
    tipClaimed: new Set(), // `${treeId}:${tipIndex}`
    emptyFlag: { water: world.water.map(() => false), mineral: world.minerals.map(() => false) },
    linkEvent: new Map(), // `${kind}:${id}` -> clock of the last link event
    taken: { water: world.water.map(() => 0), mineral: world.minerals.map(() => 0) }, // extracted since last flow tick
    intake: world.trees.map(() => ({ water: 0, minerals: 0, sugar: 0 })), // per tree, accumulated since last flow tick
    wTrue: new Map(), // edge id -> unrounded thickness
    flowTimer: 0,
    flowDt: 0,
    fed: 0,
    income: 0, // current sugar income per second (diagnostics)
    nextGrowId: 0,
    treeStageUps: 0,
    nextMushroomId: 0,
    // threats (state.flags.threats): plain numbers only, saved with the rest of state.sim
    threat: { rs: hash32(state.seed, 'threat'), spawnT: B.wormFirst, nextWorm: 0, nextTrap: 0, starve: 0, caught: 0, bites: 0, severed: 0, lostLength: 0 },
  };
}

const key = (cx, cy) => cx * 4096 + cy;

function gridInsert(sim, node) {
  const k = key(Math.floor(node.x / CELL), Math.floor(node.y / CELL));
  const cell = sim.cells.get(k);
  if (cell) cell.push(node.id);
  else sim.cells.set(k, [node.id]);
}

/** Nearest alive node within `radius` (optionally accepting only nodes passing `accept`), or null. */
export function nearestNode(state, x, y, radius, accept = null) {
  const { cells } = state.sim;
  const nodes = state.net.nodes;
  const r2 = radius * radius;
  let best = null;
  let bestD = r2;
  const x0 = Math.floor((x - radius) / CELL);
  const x1 = Math.floor((x + radius) / CELL);
  const y0 = Math.floor((y - radius) / CELL);
  const y1 = Math.floor((y + radius) / CELL);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const cell = cells.get(key(cx, cy));
      if (!cell) continue;
      for (const id of cell) {
        const n = nodes[id];
        if (!n.alive) continue;
        const d = dist2(x, y, n.x, n.y);
        if (d <= bestD && (!accept || accept(n))) {
          bestD = d;
          best = n.id;
        }
      }
    }
  }
  return best;
}

/** Creates a node; with parentId >= 0 also the edge to it. Registers links and statistics. */
export function addNode(state, x, y, parentId) {
  const { net, sim, world } = state;
  const node = { id: net.nodes.length, x, y, born: state.time, alive: true, parent: parentId, dist: 0 };
  net.nodes.push(node);
  sim.parentEdge.push(-1);
  if (parentId >= 0) {
    const p = net.nodes[parentId];
    const len = Math.hypot(x - p.x, y - p.y);
    node.dist = p.dist + len;
    const edge = { id: net.edges.length, a: parentId, b: node.id, len, born: state.time, alive: true, w: 1 };
    net.edges.push(edge);
    sim.parentEdge[node.id] = edge.id;
    state.stats.hyphaeLength += len;
    if (horizonIndexAt(world, x, y) <= 1) sim.lenSap += len;
  }
  const depth = y - groundYAt(world, x);
  if (depth > state.stats.maxDepth) state.stats.maxDepth = depth;
  gridInsert(sim, node);
  net.version++;
  checkLinks(state, node);
  checkFinds(state, node);
  return node;
}

function pushEvent(state, ev) {
  state.events.push(ev);
}

/** Registers one link; `tip` is set for tree links. Emits a (throttled) `link` event. */
function addLink(state, kind, targetId, node, tip = -1, x = node.x, y = node.y) {
  const { net, sim, world } = state;
  const link = { nodeId: node.id, kind, targetId, born: state.time };
  if (tip >= 0) link.tip = tip;
  net.links.push(link);
  if (kind === 'water') sim.waterLinks[targetId].push(node.id);
  else if (kind === 'mineral') sim.mineralLinks[targetId].push(node.id);
  else {
    sim.contacts[targetId].push(node.id);
    world.trees[targetId].linked = true;
  }
  const k = `${kind}:${targetId}`;
  const last = sim.linkEvent.get(k);
  if (kind === 'tree' || last === undefined || sim.clock - last >= B.linkEventCooldown) {
    sim.linkEvent.set(k, sim.clock);
    pushEvent(state, { type: 'link', kind, targetId, x, y });
  }
}

function checkLinks(state, node) {
  const { world, sim } = state;
  for (const w of world.water) {
    const dx = (node.x - w.x) / w.rx;
    const dy = (node.y - w.y) / w.ry;
    if (dx * dx + dy * dy <= 1) addLink(state, 'water', w.id, node);
  }
  for (const m of world.minerals) {
    if (dist2(node.x, node.y, m.x, m.y) <= m.r * m.r) addLink(state, 'mineral', m.id, node);
  }
  for (const t of world.trees) {
    for (let i = 0; i < t.tips.length; i++) {
      const tip = t.tips[i];
      if (tip.minStage > t.stage || sim.tipClaimed.has(`${t.id}:${i}`)) continue;
      if (dist2(node.x, node.y, tip.x, tip.y) <= B.tipLinkRadius * B.tipLinkRadius) {
        sim.tipClaimed.add(`${t.id}:${i}`);
        addLink(state, 'tree', t.id, node, i, tip.x, tip.y);
      }
    }
  }
}

/** After a tree reaches a new stage its new tips may already touch existing nodes. */
export function recheckTips(state, tree) {
  const claimed = state.sim.tipClaimed;
  for (let i = 0; i < tree.tips.length; i++) {
    const tip = tree.tips[i];
    if (tip.minStage > tree.stage || claimed.has(`${tree.id}:${i}`)) continue;
    const id = nearestNode(state, tip.x, tip.y, B.tipLinkRadius);
    if (id === null) continue;
    claimed.add(`${tree.id}:${i}`);
    addLink(state, 'tree', tree.id, state.net.nodes[id], i, tip.x, tip.y);
  }
}

/** Node ids from a to b along the network (through their common ancestor), inclusive. */
export function pathBetween(net, a, b) {
  const nodes = net.nodes;
  const up = new Map();
  const left = [];
  for (let n = a; n !== -1; n = nodes[n].parent) {
    up.set(n, left.length);
    left.push(n);
  }
  const right = [];
  let n = b;
  while (n !== -1 && !up.has(n)) {
    right.push(n);
    n = nodes[n].parent;
  }
  if (n === -1) return [a, b]; // disconnected: should not happen
  const path = left.slice(0, up.get(n) + 1);
  for (let i = right.length - 1; i >= 0; i--) path.push(right[i]);
  return path;
}

/** Calls fn(node) for every alive node whose grid cell lies within `radius` of (x, y) (a superset: callers measure). */
export function eachNodeNear(state, x, y, radius, fn) {
  const { cells } = state.sim;
  const nodes = state.net.nodes;
  const x0 = Math.floor((x - radius) / CELL);
  const x1 = Math.floor((x + radius) / CELL);
  const y0 = Math.floor((y - radius) / CELL);
  const y1 = Math.floor((y + radius) / CELL);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      const cell = cells.get(key(cx, cy));
      if (!cell) continue;
      for (const id of cell) if (nodes[id].alive) fn(nodes[id]);
    }
  }
}

/**
 * Kills edge `edgeId` and everything beyond it (the branch whose root is the edge's child), the way a cut hypha
 * leaves the rest of the network cut off from the spore. Keeps the graph consistent: dead nodes and edges stay in the
 * arrays (alive = false), their links, growing hyphae and flows are dropped, statistics are recomputed, net.version
 * bumps. Returns the report { dead: Set of node ids, edges: dead edge ids nearest to the cut first, lost: length,
 * links: the removed link records } or null when the edge is already dead.
 */
export function severBranch(state, edgeId) {
  const { net, sim, world } = state;
  const cut = net.edges[edgeId];
  if (!cut || !cut.alive) return null;
  const nodes = net.nodes;
  const dead = new Set([cut.b]);
  for (let i = cut.b + 1; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.alive && dead.has(n.parent)) dead.add(i);
  }
  const order = [...dead].sort((a, b) => nodes[a].dist - nodes[b].dist || a - b);
  const edges = [];
  let lost = 0;
  for (const id of order) {
    nodes[id].alive = false;
    const e = net.edges[sim.parentEdge[id]];
    e.alive = false;
    edges.push(e.id);
    lost += e.len;
  }
  // links: deposits, trees (a freed root tip can be claimed again by a regrown hypha)
  const gone = net.links.filter((l) => dead.has(l.nodeId));
  net.links = net.links.filter((l) => !dead.has(l.nodeId));
  for (const l of gone) {
    if (l.kind === 'water') sim.waterLinks[l.targetId] = sim.waterLinks[l.targetId].filter((id) => !dead.has(id));
    else if (l.kind === 'mineral') sim.mineralLinks[l.targetId] = sim.mineralLinks[l.targetId].filter((id) => !dead.has(id));
    else {
      sim.contacts[l.targetId] = sim.contacts[l.targetId].filter((id) => !dead.has(id));
      sim.tipClaimed.delete(`${l.targetId}:${l.tip}`);
      world.trees[l.targetId].linked = sim.contacts[l.targetId].length > 0;
    }
  }
  net.growing = net.growing.filter((h) => !dead.has(h.lastNode) && !dead.has(h.from));
  state.flows = state.flows.filter((f) => f.path.every((id) => !dead.has(id)));
  // statistics, exactly (no drift from subtracting)
  let length = 0;
  let sap = 0;
  for (const e of net.edges) {
    if (!e.alive) continue;
    length += e.len;
    const c = nodes[e.b];
    if (horizonIndexAt(world, c.x, c.y) <= 1) sap += e.len;
  }
  state.stats.hyphaeLength = length;
  sim.lenSap = sap;
  net.version++;
  return { dead, edges, lost, links: gone };
}

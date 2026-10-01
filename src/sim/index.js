// STUB simulation: keeps the skeleton runnable. The simulation task replaces this module
// (same exported API, see docs/ARCHITECTURE.md).
import { dist2, resample } from '../core/geom.js';
import { costAt } from '../world/query.js';

function addNode(net, x, y, born) {
  const node = { id: net.nodes.length, x, y, born, alive: true };
  net.nodes.push(node);
  return node;
}

function addEdge(net, a, b, born) {
  const na = net.nodes[a];
  const nb = net.nodes[b];
  const edge = { id: net.edges.length, a, b, len: Math.hypot(nb.x - na.x, nb.y - na.y), born, alive: true, w: 1 };
  net.edges.push(edge);
  return edge;
}

export function initSim(state) {
  const { world, net } = state;
  state.res.sugar = 80;
  const origin = addNode(net, world.origin.x, world.origin.y, 0);
  net.originId = origin.id;
  for (let i = 0; i < 4; i++) {
    const a = -0.4 + i * 1.1;
    const n = addNode(net, origin.x + Math.cos(a) * 36, origin.y + Math.sin(a) * 30, 0);
    addEdge(net, origin.id, n.id, 0);
  }
  state.objectives = [
    { id: 'water', text: 'Дотянуться до воды', done: false },
    { id: 'tree', text: 'Заключить союз с деревом', done: false },
    { id: 'mushroom', text: 'Вырастить первый гриб', done: false },
    { id: 'treeGrow', text: 'Помочь дереву подрасти', done: false },
    { id: 'spores', text: 'Собрать 100 спор', done: false },
  ];
}

export function updateSim(state, dt) {
  void state;
  void dt;
}

export function pickNode(state, x, y, radius = 22) {
  let best = null;
  let bestD = radius * radius;
  for (const n of state.net.nodes) {
    if (!n.alive) continue;
    const d = dist2(x, y, n.x, n.y);
    if (d <= bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

export function estimateGrowth(state, fromId, points) {
  const from = state.net.nodes[fromId];
  const path = resample([{ x: from.x, y: from.y }, ...points], 8);
  const reachable = [path[0]];
  let blocked = null;
  let length = 0;
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const c = costAt(state.world, path[i].x, path[i].y);
    if (!Number.isFinite(c)) {
      blocked = path[i];
      break;
    }
    const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    length += seg;
    cost += seg * c;
    reachable.push(path[i]);
  }
  return { from: fromId, points: reachable, blocked, length, cost, affordable: cost <= state.res.sugar };
}

export function commandGrow(state, fromId, points) {
  const p = estimateGrowth(state, fromId, points);
  if (p.points.length < 2 || !p.affordable) return false;
  const nodes = resample(p.points, 16);
  let prev = fromId;
  for (let i = 1; i < nodes.length; i++) {
    const n = addNode(state.net, nodes[i].x, nodes[i].y, state.time);
    addEdge(state.net, prev, n.id, state.time);
    prev = n.id;
  }
  state.res.sugar -= p.cost;
  return true;
}

export function canFruit() {
  return false;
}

export function commandFruit() {
  return false;
}

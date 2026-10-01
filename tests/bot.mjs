// A scripted «player» for balance tests: greedily grows to the nearest water, then the nearest
// active root tip, plants mushrooms near the surface, then taps a mineral deposit and more water as needed.
// Pathfinding is a multi-source Dijkstra over a coarse cost grid, so it routes around rocks.
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { committedSugar } from '../src/sim/growth.js';
import { B } from '../src/sim/balance.js';
import { costAt, groundYAt } from '../src/world/query.js';

export const DT = 1 / 60;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const CELL = 8;

class Heap {
  constructor() {
    this.a = [];
  }
  push(k, v) {
    const a = this.a;
    a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

function costGrid(world) {
  const cols = Math.ceil(world.width / CELL);
  const rows = Math.ceil(world.height / CELL);
  const cost = new Float32Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = cx * CELL + CELL / 2;
      const y = cy * CELL + CELL / 2;
      let c = costAt(world, x, y);
      // keep a margin from rocks and the surface so straight segments between cell centres stay passable
      for (const [dx, dy] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) if (!Number.isFinite(costAt(world, x + dx, y + dy))) c = Infinity;
      cost[cy * cols + cx] = c;
    }
  }
  return { cols, rows, cost };
}

/** Cheapest route from any alive node to a target cell; returns { nodeId, points, cost } or null. */
function route(state, grid, isTarget) {
  const { cols, rows, cost } = grid;
  const dist = new Float64Array(cols * rows).fill(Infinity);
  const prev = new Int32Array(cols * rows).fill(-1);
  const src = new Int32Array(cols * rows).fill(-1);
  const heap = new Heap();
  for (const n of state.net.nodes) {
    if (!n.alive) continue;
    const cx = Math.floor(n.x / CELL);
    const cy = Math.floor(n.y / CELL);
    const i = cy * cols + cx;
    if (dist[i] > 0) {
      dist[i] = 0;
      src[i] = n.id;
      heap.push(0, i);
    }
  }
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    const cx = i % cols;
    const cy = (i / cols) | 0;
    if (dist[i] > 0 && isTarget(cx * CELL + CELL / 2, cy * CELL + CELL / 2)) {
      const pts = [];
      let j = i;
      while (prev[j] !== -1) {
        pts.push({ x: (j % cols) * CELL + CELL / 2, y: ((j / cols) | 0) * CELL + CELL / 2 });
        j = prev[j];
      }
      pts.reverse();
      return { nodeId: src[j], points: pts, cost: d };
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        const c = cost[j];
        if (!Number.isFinite(c)) continue;
        const nd = d + (dx && dy ? CELL * Math.SQRT2 : CELL) * c;
        if (nd < dist[j]) {
          dist[j] = nd;
          prev[j] = i;
          src[j] = src[i];
          heap.push(nd, j);
        }
      }
    }
  }
  return null;
}

/** Plays one game. opts: { maxSeconds, mushrooms, seasons (turn day/night and seasons on), runOn (keep playing after all objectives), debug } */
export function playBot(seed, opts = {}) {
  const maxSeconds = opts.maxSeconds ?? 1200;
  const wantMushrooms = opts.mushrooms ?? 4;
  const state = createState(seed);
  state.phase = 'playing';
  if (opts.seasons) state.flags.seasons = true;
  const grid = costGrid(state.world);
  const { world, net } = state;
  const stats = { zeroStreak: 0, maxZeroStreak: 0, doneAt: {}, events: {}, commands: 0, rejected: 0, minSugar: Infinity, bySeason: {}, yearEnd: null };
  let nextThink = 0;

  const linked = (kind) => net.links.some((l) => l.kind === kind);
  const free = () => state.res.sugar - committedSugar(net);

  const grow = (r) => {
    if (!r) {
      stats.noRoute = (stats.noRoute || 0) + 1;
      return false;
    }
    // as much of the route as is affordable
    let spend = 0;
    let n = 0;
    let prev = { x: net.nodes[r.nodeId].x, y: net.nodes[r.nodeId].y };
    const budget = free();
    for (const p of r.points) {
      const c = Math.hypot(p.x - prev.x, p.y - prev.y) * costAt(world, p.x, p.y);
      if (spend + c > budget) break;
      spend += c;
      n++;
      prev = p;
    }
    const full = n === r.points.length;
    if (opts.debug) console.log('grow', state.time.toFixed(1), 'pts', r.points.length, 'affordable', n, 'cost', r.cost.toFixed(0), 'budget', budget.toFixed(0), 'cap', state.cap.sugar.toFixed(0));
    // wait for the full route unless the purse is nearly at its cap
    if (!full && free() < state.cap.sugar - 6) return false;
    if (n < 1) return false;
    stats.commands++;
    const ok = sim.commandGrow(state, r.nodeId, r.points.slice(0, n));
    if (!ok) stats.rejected++;
    return ok;
  };

  const goWater = () =>
    grow(
      route(state, grid, (x, y) =>
        world.water.some((w) => w.amount > 25 && state.sim.waterLinks[w.id].length === 0 && ((x - w.x) / w.rx) ** 2 + ((y - w.y) / w.ry) ** 2 <= 0.6),
      ),
    );
  const goTree = () =>
    grow(
      route(state, grid, (x, y) =>
        world.trees.some((t) =>
          t.tips.some(
            (tip, i) => tip.minStage <= t.stage && !state.sim.tipClaimed.has(`${t.id}:${i}`) && Math.hypot(x - tip.x, y - tip.y) <= 11,
          ),
        ),
      ),
    );
  const goMineral = () =>
    grow(
      route(state, grid, (x, y) =>
        world.minerals.some((m) => m.amount > 15 && state.sim.mineralLinks[m.id].length === 0 && Math.hypot(x - m.x, y - m.y) <= m.r * 0.7),
      ),
    );
  const goSurface = () =>
    grow(
      route(state, grid, (x, y) => {
        const depth = y - groundYAt(world, x);
        if (depth < 16 || depth > 32) return false;
        return state.mushrooms.every((m) => Math.abs(m.x - x) > B.fruitSpacing + 14);
      }),
    );

  const plant = () => {
    for (const n of net.nodes) {
      if (sim.canFruit(state, n.id)) {
        stats.commands++;
        return sim.commandFruit(state, n.id);
      }
    }
    return false;
  };

  const think = () => {
    if (net.growing.length > 0) return;
    if (!linked('water')) return void goWater();
    if (!linked('tree')) return void goTree();
    if (state.mushrooms.length < wantMushrooms) {
      if (free() < B.mushroomCost + 6) return;
      if (plant()) return;
      return void goSurface();
    }
    if (!state.net.links.some((l) => l.kind === 'mineral')) return void goMineral();
    if (state.res.water < 4) return void goWater();
    if (state.res.minerals < 2) return void goMineral();
    if (state.mushrooms.length < wantMushrooms + 3 && free() > 70) {
      if (plant()) return;
      return void goSurface();
    }
  };

  let completed = null;
  const steps = Math.round(maxSeconds / DT);
  for (let i = 0; i < steps; i++) {
    sim.updateSim(state, DT);
    state.time += DT;
    for (const ev of state.events) {
      stats.events[ev.type] = (stats.events[ev.type] || 0) + 1;
      if (ev.type === 'objective') stats.doneAt[ev.id] = state.time;
      if (ev.type === 'all-objectives') completed = state.time;
      if (ev.type === 'year-end') stats.yearEnd = { time: state.time, sugar: state.res.sugar, spores: state.res.spores };
    }
    state.events.length = 0;
    stats.minSugar = Math.min(stats.minSugar, state.res.sugar);
    const ss = (stats.bySeason[state.clock.season + state.clock.year] ??= { min: Infinity, sum: 0, n: 0, zero: 0, spores0: state.res.spores, spores1: 0, waterMin: Infinity, health: 0 });
    ss.min = Math.min(ss.min, state.res.sugar);
    ss.sum += state.res.sugar;
    ss.n++;
    ss.spores1 = state.res.spores;
    ss.waterMin = Math.min(ss.waterMin, state.res.water);
    if (i % 60 === 0) ss.health += mean(state.world.trees.filter((t) => t.linked).map((t) => t.health));
    if (state.res.sugar < 0.5) ss.zero += DT;
    if (state.res.sugar < 0.5) {
      stats.zeroStreak += DT;
      stats.maxZeroStreak = Math.max(stats.maxZeroStreak, stats.zeroStreak);
    } else stats.zeroStreak = 0;
    if (state.time >= nextThink) {
      think();
      nextThink = state.time + 0.5;
    }
    if (completed !== null && !opts.runOn) break;
  }
  return { state, completedAt: completed, stats };
}

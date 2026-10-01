// A scripted «player» for balance tests: greedily grows to the nearest water, then the nearest
// active root tip, plants mushrooms near the surface, then taps a mineral deposit and more water as needed.
// Pathfinding is a multi-source Dijkstra over a coarse cost grid, so it routes around rocks.
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { committedSugar } from '../src/sim/growth.js';
import { B, pressure } from '../src/sim/balance.js';
import { mushroomCost } from '../src/sim/mushrooms.js';
import { findRadius } from '../src/sim/finds.js';
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

/**
 * Plays one game. opts: { maxSeconds, mushrooms, seasons (turn day/night and seasons on), threats (worms, traps, chapters and
 * the tighter economy: the bot then grows rings against worms and works through the later chapters), runOn (keep playing
 * after all objectives), untilChapter (with threats: stop once this chapter's page is complete), curve (sample the state
 * every 30 s into stats.curve), guard (false: never lay rings against worms), reaction / guardReach (how late and how
 * close the bot reacts to a worm), debug }
 */
export function playBot(seed, opts = {}) {
  const maxSeconds = opts.maxSeconds ?? 1200;
  const wantMushrooms = opts.mushrooms ?? 4;
  const state = createState(seed);
  state.phase = 'playing';
  if (opts.seasons) state.flags.seasons = true;
  if (opts.threats) state.flags.threats = true;
  const grid = costGrid(state.world);
  const { world, net } = state;
  const stats = { zeroStreak: 0, maxZeroStreak: 0, doneAt: {}, events: {}, commands: 0, rejected: 0, minSugar: Infinity, bySeason: {}, yearEnd: null, chapterDone: {}, traps: 0, curve: [], firstAt: {}, senseAt: {}, senseLead: [] };
  let nextThink = 0;

  const linked = (kind) => net.links.some((l) => l.kind === kind);
  const free = () => state.res.sugar - committedSugar(net);

  const grow = (r, minPartial = Infinity) => {
    if (!r) {
      stats.noRoute = (stats.noRoute || 0) + 1;
      return false;
    }
    // as much of the route as is affordable
    let spend = 0;
    let n = 0;
    let prev = { x: net.nodes[r.nodeId].x, y: net.nodes[r.nodeId].y };
    const budget = free() - 0.5; // the sim integrates the cost a little differently across horizon edges
    for (const p of r.points) {
      const c = Math.hypot(p.x - prev.x, p.y - prev.y) * costAt(world, p.x, p.y) * pressure(state).growCost;
      if (spend + c > budget) break;
      spend += c;
      n++;
      prev = p;
    }
    const full = n === r.points.length;
    if (opts.debug) console.log('grow', state.time.toFixed(1), 'pts', r.points.length, 'affordable', n, 'cost', r.cost.toFixed(0), 'budget', budget.toFixed(0), 'cap', state.cap.sugar.toFixed(0));
    // wait for the full route unless the purse is nearly at its cap
    if (!full && free() < state.cap.sugar - 6 && spend < minPartial) return false; // (a long drag may go ahead as far as `minPartial` sugar reaches)
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

  const goAlly = () =>
    grow(
      route(state, grid, (x, y) =>
        world.trees.some(
          (t) =>
            state.sim.contacts[t.id].length === 0 &&
            t.tips.some((tip, i) => tip.minStage <= t.stage && !state.sim.tipClaimed.has(`${t.id}:${i}`) && Math.hypot(x - tip.x, y - tip.y) <= 11),
        ),
      ),
    );
  const foundKinds = () => new Set(Object.values(state.finds).map((f) => f.kind));
  const goFind = () => {
    const have = foundKinds();
    return grow(route(state, grid, (x, y) => world.decor.some((d) => !state.finds[d.id] && !have.has(d.type) && Math.hypot(x - d.x, y - d.y) <= findRadius(d) * 0.6)));
  };
  const gravelDepth = world.horizons[world.horizons.length - 1].depth;
  const goGravel = () => grow(route(state, grid, (x, y) => y - groundYAt(world, x) >= gravelDepth + 8), 30);
  const goPhosphorus = () =>
    grow(
      route(state, grid, (x, y) =>
        world.minerals.some((m) => m.kind === 'phosphorus' && m.amount > 15 && state.sim.mineralLinks[m.id].length === 0 && Math.hypot(x - m.x, y - m.y) <= m.r * 0.7),
      ),
      30,
    );
  // glade observations (chapter 2): a mushroom at the roots of every species of tree
  const pending = (id) => state.objectives.some((o) => o.id === id && !o.done);
  const uncoveredTree = () => {
    const near = (t, slack) => state.mushrooms.some((m) => Math.abs(m.x - t.x) <= B.glade.mixedReach - slack);
    const covered = new Set(world.trees.filter((t) => near(t, 15)).map((t) => t.species));
    return world.trees.find((t) => !covered.has(t.species));
  };
  const goSpecies = (tree) =>
    grow(
      route(state, grid, (x, y) => {
        const depth = y - groundYAt(world, x);
        return depth >= 16 && depth <= 32 && Math.abs(x - tree.x) <= B.glade.mixedReach - 40 && state.mushrooms.every((m) => Math.abs(m.x - x) > B.fruitSpacing + 14);
      }),
      30,
    );
  const plantNear = (tree) => {
    for (const n of net.nodes) {
      if (Math.abs(n.x - tree.x) <= B.glade.mixedReach - 20 && sim.canFruit(state, n.id)) {
        stats.commands++;
        return sim.commandFruit(state, n.id);
      }
    }
    return false;
  };

  // A ring on the hypha a worm is after (or chewing), unless a ring with catches left already covers it.
  let nextTrapAt = 0;
  const reaction = opts.reaction ?? 2; // s a worm is in the world before the bot notices it is after something
  const reach = opts.guardReach ?? 70; // u: the bot reacts to a worm this close to the hypha it is after
  const trapCovers = (x, y) => state.traps.some((t) => t.charges > 0 && Math.hypot(t.x - x, t.y - y) < B.trapRadius - 12);
  const guard = () => {
    if (!state.flags.threats || opts.guard === false || state.time < nextTrapAt || free() < B.trapCost + 8) return false;
    for (const w of state.fauna) {
      if (w.mode !== 'wander' && w.mode !== 'bite') continue;
      const spot = w.bite ?? (w.target >= 0 ? net.nodes[w.target] : null);
      if (!spot || w.age < reaction || Math.hypot(w.x - spot.x, w.y - spot.y) > reach || trapCovers(spot.x, spot.y)) continue;
      const id = sim.pickNode(state, spot.x, spot.y, 30);
      if (id !== null && sim.canTrap(state, id) && sim.commandTrap(state, id)) {
        nextTrapAt = state.time + 4;
        stats.traps++;
        return true;
      }
    }
    return false;
  };

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
    guard();
    if (net.growing.length > 0) return;
    if (!linked('water')) return void goWater();
    if (!linked('tree')) return void goTree();
    if (state.mushrooms.length < wantMushrooms) {
      if (free() < mushroomCost(state) + 6) return;
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
    if (state.flags.threats && state.chapter >= 2) {
      if (!world.trees.every((t) => state.sim.contacts[t.id].length > 0)) return void goAlly();
      if (foundKinds().size < B.chapter2Finds && free() > 20) return void goFind();
      if (pending('gladePine') && free() > 35) return void goPhosphorus();
      if (pending('gladeMixed') && free() > 35) {
        const tree = uncoveredTree();
        if (tree) {
          if (free() >= mushroomCost(state) + 6 && plantNear(tree)) return;
          return void goSpecies(tree);
        }
      }
      if (state.stats.maxDepth < gravelDepth && free() > 40) return void goGravel();
      if (state.chapter >= 3 && state.mushrooms.length < B.chapter3Mushrooms + 1 && free() > 50) {
        if (plant()) return;
        return void goSurface();
      }
    }
  };

  let completed = null;
  const steps = Math.round(maxSeconds / DT);
  for (let i = 0; i < steps; i++) {
    sim.updateSim(state, DT);
    state.time += DT;
    for (const ev of state.events) {
      stats.events[ev.type] = (stats.events[ev.type] || 0) + 1;
      stats.firstAt[ev.type] ??= state.time;
      if (ev.type === 'worm-sense') stats.senseAt[ev.id] = state.time;
      if (ev.type === 'bite' && stats.senseAt[ev.id] !== undefined) stats.senseLead.push(state.time - stats.senseAt[ev.id]);
      if (ev.type === 'objective') stats.doneAt[ev.id] = state.time;
      if (ev.type === 'all-objectives') {
        stats.chapterDone[ev.chapter ?? 1] = state.time;
        if ((ev.chapter ?? 1) === 1) completed = state.time;
      }
      if (ev.type === 'year-end') stats.yearEnd = { time: state.time, sugar: state.res.sugar, spores: state.res.spores };
    }
    state.events.length = 0;
    stats.minSugar = Math.min(stats.minSugar, state.res.sugar);
    const ss = (stats.bySeason[state.clock.season + state.clock.year] ??= { min: Infinity, sum: 0, n: 0, zero: 0, spores0: state.res.spores, spores1: 0, waterMin: Infinity, health: 0, waterSum: 0 });
    ss.min = Math.min(ss.min, state.res.sugar);
    ss.sum += state.res.sugar;
    ss.n++;
    ss.spores1 = state.res.spores;
    ss.waterMin = Math.min(ss.waterMin, state.res.water);
    ss.waterSum += state.res.water;
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
    if (opts.curve && i % 1800 === 0) {
      stats.curve.push({ t: Math.round(state.time), sugar: Math.round(state.res.sugar), len: Math.round(state.stats.hyphaeLength), mush: state.mushrooms.length, worms: state.fauna.length, traps: state.traps.length, spores: Math.round(state.res.spores), chapter: state.chapter });
    }
    if (opts.untilChapter ? stats.chapterDone[opts.untilChapter] !== undefined : completed !== null && !opts.runOn) break;
  }
  return { state, completedAt: completed, stats };
}

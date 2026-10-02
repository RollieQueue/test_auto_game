// Threats (state.flags.threats): nematodes wander the soil, bite thin hyphae and cut off the branch beyond the bite;
// «ловчие кольца» (traps, as made by nematophagous fungi) lure, snare and digest them for nitrogen.
// Plain data only (state.fauna, state.traps, state.sim.threat) so the whole thing is saved with the game; every random
// choice comes from state.sim.threat.rs, so a seed and its commands replay exactly.
import { clamp, closestOnSegment } from '../core/geom.js';
import { costAt, groundYAt, horizonIndexAt } from '../world/query.js';
import { B, biomeFx } from './balance.js';
import { eachNodeNear, nearestNode, severBranch } from './network.js';
import { fungusFx } from './species.js';

const TAU = Math.PI * 2;
const wrapPi = (a) => {
  const m = (a + Math.PI) % TAU;
  return (m < 0 ? m + TAU : m) - Math.PI;
};

/** mulberry32 step on the plain integer th.rs: a float in [0, 1). */
function rand(th) {
  th.rs = (th.rs + 0x6d2b79f5) >>> 0;
  let t = th.rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (th, [lo, hi]) => lo + (hi - lo) * rand(th);

// ---- hyphae a worm may bite ------------------------------------------------------------------------------------

/** The edge from `node` towards the spore when a worm may bite it (thin, not near the spore, not brand new), else null. */
export function biteEdge(state, node) {
  const ei = state.sim.parentEdge[node.id];
  if (ei < 0 || node.dist < B.biteImmuneDist) return null;
  const e = state.net.edges[ei];
  return e.alive && e.w < B.biteMaxW && state.time - e.born >= B.biteMinAge ? e : null;
}

// ---- cutting ---------------------------------------------------------------------------------------------------

/**
 * Cuts edge `edgeId`: the branch beyond it dies (see severBranch), mushrooms and rings on it are lost, and a
 * `severed` event is emitted (with `mushroom-wilted` / `trap-spent` for what went with it). Returns the report or null.
 */
export function cutEdge(state, edgeId, at = null, cause = 'worm') {
  const { net, sim, events } = state;
  const e = net.edges[edgeId];
  const rep = severBranch(state, edgeId);
  if (!rep) return null;
  const a = net.nodes[e.a];
  const b = net.nodes[e.b];
  const x = at ? at.x : (a.x + b.x) / 2;
  const y = at ? at.y : (a.y + b.y) / 2;
  let wilted = 0;
  for (let i = state.mushrooms.length - 1; i >= 0; i--) {
    const m = state.mushrooms[i];
    if (!rep.dead.has(m.nodeId)) continue;
    state.mushrooms.splice(i, 1);
    wilted++;
    events.push({ type: 'mushroom-wilted', id: m.id, x: m.x, y: m.baseY, variant: m.variant, species: m.species, growth: m.growth, mature: m.mature });
  }
  for (let i = state.traps.length - 1; i >= 0; i--) {
    const t = state.traps[i];
    if (!rep.dead.has(t.nodeId)) continue;
    state.traps.splice(i, 1);
    events.push({ type: 'trap-spent', id: t.id, x: t.x, y: t.y, lost: true });
  }
  sim.threat.severed++;
  sim.threat.lostLength += rep.lost;
  events.push({
    type: 'severed', x, y, lost: Math.round(rep.lost), nodes: rep.dead.size, links: rep.links.length, mushrooms: wilted, cut: edgeId, edges: rep.edges, cause,
  });
  return rep;
}

// ---- worms -----------------------------------------------------------------------------------------------------

const free = (world, x, y) => Number.isFinite(costAt(world, x, y)) && y - groundYAt(world, x) >= 16;

/** A spot where a worm may start: moist humus or loam, away from the hyphae so it is seen coming. */
function habitable(state, x, y) {
  const { world } = state;
  if (!free(world, x, y)) return false;
  const depth = y - groundYAt(world, x);
  const h = horizonIndexAt(world, x, y);
  return depth >= B.wormDepthMin && depth <= B.wormDepthMax && (h === 1 || h === 2) && nearestNode(state, x, y, 40) === null;
}

/** Puts a new worm at (x, y) (it fades in); returns it. The caller has checked that the spot is fit. */
export function spawnWormAt(state, x, y) {
  const th = state.sim.threat;
  const w = {
    id: th.nextWorm++,
    x,
    y,
    a: rand(th) * TAU,
    len: between(th, B.wormLen),
    speed: 0,
    phase: rand(th) * TAU,
    age: 0,
    mode: 'wander',
    fade: 0,
    bite: null,
    trapId: null,
    // internal
    base: between(th, B.wormSpeed),
    life: between(th, B.wormLife),
    side: rand(th) < 0.5 ? -1 : 1, // the way it turns round an obstacle
    bites: 0,
    full: 0,
    turnT: 0,
    dturn: 0,
    senseT: 0,
    target: -1,
    sensed: false,
    grazer: rand(th) < B.wormGrazer * fungusFx(state).grazer, // only grazers smell hyphae and bite
    scanT: rand(th) * 0.12,
    snareT: 0,
  };
  state.fauna.push(w);
  state.events.push({ type: 'worm-spawn', id: w.id, x, y });
  return w;
}

function spawnWorm(state) {
  const { net, sim } = state;
  const th = sim.threat;
  for (let tries = 0; tries < 16; tries++) {
    const n = net.nodes[Math.floor(rand(th) * net.nodes.length)];
    const ang = rand(th) * TAU;
    const d = between(th, B.wormSpawnDist);
    if (!n.alive) continue;
    const x = n.x + Math.cos(ang) * d;
    const y = n.y + Math.sin(ang) * d;
    if (!habitable(state, x, y)) continue;
    spawnWormAt(state, x, y);
    return true;
  }
  return false;
}

/** Wandering: random turns, a pull towards the nearest bitable hypha, steering round rocks, the surface and the deep. */
function crawl(state, w, dt, cold) {
  const { world, net } = state;
  const th = state.sim.threat;
  w.turnT -= dt;
  if (w.turnT <= 0) {
    w.dturn = (rand(th) * 2 - 1) * B.wormWander;
    w.turnT = between(th, B.wormTurnEvery);
  }
  let turn = w.dturn;
  w.senseT -= dt;
  if (w.senseT <= 0) {
    w.senseT = 0.3;
    w.target = w.full > 0 || !w.grazer ? -1 : (nearestNode(state, w.x, w.y, B.wormSense, (n) => biteEdge(state, n) !== null) ?? -1);
    if (w.target >= 0 && !w.sensed) {
      w.sensed = true; // once per worm: it has caught the scent of a hypha (the HUD may warn)
      w.senseAge = w.age; // ... and it bites no sooner than B.biteLead after this
      const n = net.nodes[w.target];
      state.events.push({ type: 'worm-sense', id: w.id, x: w.x, y: w.y, tx: n.x, ty: n.y });
    }
  }
  if (w.target >= 0) {
    const n = net.nodes[w.target];
    if (n.alive) turn += clamp(wrapPi(Math.atan2(n.y - w.y, n.x - w.x) - w.a) * 2, -1, 1) * B.wormAttract;
    else w.target = -1;
  }
  const depth = w.y - groundYAt(world, w.x);
  if (depth < B.wormDepthMin) turn += clamp(wrapPi(Math.PI / 2 - w.a) * 2, -1, 1) * 0.9;
  else if (depth > B.wormDepthMax) turn += clamp(wrapPi(-Math.PI / 2 - w.a) * 2, -1, 1) * 0.9;
  let speed = w.base * B.wormHorizonSpeed[Math.max(0, horizonIndexAt(world, w.x, w.y))] * cold;
  const look = 18;
  const ahead = (da) => free(world, w.x + Math.cos(w.a + da) * look, w.y + Math.sin(w.a + da) * look);
  if (!ahead(0)) {
    const l = ahead(-0.9);
    const r = ahead(0.9);
    turn += (l && !r ? -1 : r && !l ? 1 : w.side) * 4;
    speed *= 0.4;
  }
  w.a = wrapPi(w.a + turn * dt);
  const nx = w.x + Math.cos(w.a) * speed * dt;
  const ny = w.y + Math.sin(w.a) * speed * dt;
  if (free(world, nx, ny)) {
    w.x = nx;
    w.y = ny;
  } else {
    speed = 0;
    w.a = wrapPi(w.a + w.side * 0.12);
  }
  w.speed = speed;
  w.phase += speed * dt * 0.4;
}

/** Seconds of chewing in the current chapter (B.biteSecondsByChapter; B.biteSeconds without chapters). */
export function biteSecondsFor(state) {
  return state.flags.threats ? (B.biteSecondsByChapter[(state.chapter ?? 1) - 1] ?? B.biteSeconds) : B.biteSeconds;
}

/** Starts chewing the nearest bitable hypha within reach, if any: never before the warning (`worm-sense`) has had its lead. */
function tryBite(state, w) {
  const { net } = state;
  if (!w.sensed || w.age - (w.senseAge ?? -Infinity) < B.biteLead) return;
  let best = null;
  let bestD = B.biteReach * B.biteReach;
  eachNodeNear(state, w.x, w.y, B.biteReach + 20, (n) => {
    const e = biteEdge(state, n);
    if (!e) return;
    const p = net.nodes[e.a];
    const c = closestOnSegment(w.x, w.y, p.x, p.y, n.x, n.y);
    if (c.d2 <= bestD) {
      bestD = c.d2;
      best = { e, c };
    }
  });
  if (!best) return;
  w.mode = 'bite';
  w.bite = { edge: best.e.id, x: best.c.x, y: best.c.y, t: 0, dur: biteSecondsFor(state) };
  w.x = best.c.x;
  w.y = best.c.y;
  w.speed = 0;
  state.sim.threat.bites++;
  state.events.push({ type: 'bite', id: w.id, edge: best.e.id, x: w.x, y: w.y });
}

function abortBite(state, w) {
  state.events.push({ type: 'bite-abort', id: w.id, x: w.x, y: w.y });
  w.bite = null;
  w.mode = w.bites >= B.wormMaxBites ? 'leave' : 'wander';
  w.full = 2;
}

/** One worm for dt; returns 'keep', 'gone' (it left) or 'caught' (the caller removes it). */
function stepWorm(state, w, dt, cold) {
  const { net } = state;
  w.age += dt;
  w.full = Math.max(0, w.full - dt);
  if (w.mode !== 'leave' && w.mode !== 'snared' && w.age >= w.life) {
    if (w.bite) abortBite(state, w);
    w.mode = 'leave';
  }
  if (w.mode === 'leave') {
    w.fade -= dt / B.wormLeaveSeconds;
    if (w.fade <= 0) return 'gone';
    crawl(state, w, dt, cold);
    return 'keep';
  }
  w.fade = Math.min(1, w.age / B.wormEmergeSeconds);

  if (w.mode === 'snared') {
    const trap = state.traps.find((t) => t.id === w.trapId);
    if (!trap) {
      w.mode = 'wander';
      w.trapId = null;
      return 'keep';
    }
    const dx = trap.x - w.x;
    const dy = trap.y - w.y;
    const d = Math.hypot(dx, dy);
    w.snareT += dt;
    w.a = Math.atan2(dy, dx);
    w.speed = Math.min(B.wormSnareSpeed, d / dt);
    w.x += Math.cos(w.a) * w.speed * dt;
    w.y += Math.sin(w.a) * w.speed * dt;
    w.phase += w.speed * dt * 0.4;
    if (d <= 5 || w.snareT >= B.wormSnareMax) {
      digest(state, w, trap);
      return 'caught';
    }
    return 'keep';
  }

  if (w.mode === 'bite') {
    const e = net.edges[w.bite.edge];
    if (!e.alive || e.w >= B.biteMaxW + 0.15) {
      abortBite(state, w);
      return 'keep';
    }
    w.speed = 0;
    w.bite.t += dt;
    if (w.bite.t >= w.bite.dur) {
      const at = { x: w.bite.x, y: w.bite.y };
      cutEdge(state, w.bite.edge, at);
      w.bite = null;
      w.bites++;
      w.full = B.wormFullSeconds;
      w.mode = w.bites >= B.wormMaxBites ? 'leave' : 'wander';
      w.target = -1;
    }
    return 'keep';
  }

  crawl(state, w, dt, cold);
  w.scanT -= dt;
  if (w.scanT <= 0) {
    w.scanT = 0.12;
    if (w.full <= 0 && w.grazer) tryBite(state, w);
  }
  return 'keep';
}

// ---- traps -----------------------------------------------------------------------------------------------------

/** null when a ring may be grown on the node, otherwise 'off' | 'dead' | 'crowded' | 'sugar'. */
export function trapDenial(state, nodeId) {
  if (!state.flags.threats) return 'off';
  const node = state.net.nodes[nodeId];
  if (!node || !node.alive) return 'dead';
  for (const t of state.traps) if (Math.hypot(t.x - node.x, t.y - node.y) < B.trapSpacing) return 'crowded';
  if (state.res.sugar < B.trapCost) return 'sugar';
  return null;
}

export const canTrap = (state, nodeId) => trapDenial(state, nodeId) === null;

/** Grows a ring on the node. Returns false (with a `trap-denied` event for a real node) when it may not. */
export function commandTrap(state, nodeId) {
  const reason = trapDenial(state, nodeId);
  const node = state.net.nodes[nodeId];
  if (reason) {
    if (node && reason !== 'off') {
      state.events.push({ type: 'trap-denied', x: node.x, y: node.y, reason });
      if (reason === 'sugar') state.events.push({ type: 'insufficient', x: node.x, y: node.y });
    }
    return false;
  }
  state.res.sugar -= B.trapCost;
  const t = {
    id: state.sim.threat.nextTrap++,
    nodeId,
    x: node.x,
    y: node.y,
    r: B.trapRadius,
    grow: 0,
    charges: B.trapCharges,
    cool: 0,
    glow: 0,
    age: 0,
    prey: null, // id of the worm being drawn in
  };
  state.traps.push(t);
  state.events.push({ type: 'trap-placed', id: t.id, x: t.x, y: t.y, nodeId });
  return true;
}

/** The node to grow a ring on for a click at (x, y): the nearest that may, else the nearest of any kind (for the reason). */
export function pickTrapNode(state, x, y, radius = 44) {
  const ok = nearestNode(state, x, y, radius, (n) => canTrap(state, n.id));
  if (ok !== null) return ok;
  return nearestNode(state, x, y, radius + 40);
}

/** A worm reaches the ring: it dies, the mycelium takes its nitrogen. */
function digest(state, w, trap) {
  const { res, cap, sim, events } = state;
  const gained = Math.max(0, Math.min(B.trapMinerals, cap.pool - res.minerals));
  res.minerals += gained;
  trap.charges--;
  trap.cool = B.trapDigestSeconds;
  trap.glow = 1;
  trap.prey = null;
  sim.threat.caught++;
  events.push({ type: 'worm-caught', x: trap.x, y: trap.y, trapId: trap.id, wormId: w.id, minerals: Math.round(gained * 10) / 10 });
}

function stepTraps(state, dt) {
  const { traps, events } = state;
  for (let i = traps.length - 1; i >= 0; i--) {
    const t = traps[i];
    t.age += dt;
    t.cool = Math.max(0, t.cool - dt);
    t.glow = Math.max(0, t.glow - dt / 1.8);
    if (t.grow < 1) {
      t.grow = Math.min(1, t.grow + dt / B.trapGrowSeconds);
      if (t.grow >= 1) events.push({ type: 'trap-ready', id: t.id, x: t.x, y: t.y });
    }
    if (t.charges <= 0 && t.cool <= 0 && t.prey === null) {
      traps.splice(i, 1);
      events.push({ type: 'trap-spent', id: t.id, x: t.x, y: t.y });
    }
  }
}

/** Every ready ring lures the nearest worm within its radius (a worm that is chewing lets go). */
function lure(state) {
  for (const t of state.traps) {
    if (t.grow < 1 || t.cool > 0 || t.charges <= 0 || t.prey !== null) continue;
    let best = null;
    let bestD = t.r * t.r;
    for (const w of state.fauna) {
      if (w.mode !== 'wander' && w.mode !== 'bite') continue;
      const d = (w.x - t.x) ** 2 + (w.y - t.y) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = w;
      }
    }
    if (!best) continue;
    if (best.bite) abortBite(state, best);
    best.mode = 'snared';
    best.trapId = t.id;
    best.snareT = 0;
    best.target = -1;
    t.prey = best.id;
  }
}

// ---- dieback ----------------------------------------------------------------------------------------------------

/**
 * The twig to let die: the farthest dead-end branch that serves nothing (no link, mushroom, ring or growing tip, not near
 * the spore), as the edge to cut; null when there is none.
 */
function starvingTwig(state) {
  const { net, sim } = state;
  const nodes = net.nodes;
  const kids = new Int32Array(nodes.length);
  for (const n of nodes) if (n.alive && n.parent >= 0) kids[n.parent]++;
  const keep = new Set();
  for (const l of net.links) keep.add(l.nodeId);
  for (const m of state.mushrooms) keep.add(m.nodeId);
  for (const t of state.traps) keep.add(t.nodeId);
  for (const h of net.growing) {
    keep.add(h.from);
    keep.add(h.lastNode);
  }
  let best = -1;
  for (const n of nodes) {
    if (!n.alive || kids[n.id] > 0 || keep.has(n.id) || n.dist < B.biteImmuneDist) continue;
    if (best < 0 || n.dist > nodes[best].dist) best = n.id;
  }
  if (best < 0) return null;
  let top = best; // climb to the root of the twig: the node just below the first junction, link or immune stretch
  for (;;) {
    const p = nodes[top].parent;
    if (p < 0 || keep.has(p) || kids[p] !== 1 || nodes[p].dist < B.biteImmuneDist) break;
    top = p;
  }
  return sim.parentEdge[top];
}

/** A network that cannot pay for itself loses its unproductive tips, one twig at a time. */
function stepStarvation(state, dt) {
  const { res, sim, net } = state;
  const th = sim.threat;
  if (res.sugar >= B.starveSugar * 1.5 || net.growing.length > 0 || state.rates.sugar >= B.starveRate) {
    if (res.sugar >= B.starveSugar * 1.5) th.starve = 0;
    return;
  }
  if (res.sugar >= B.starveSugar) return;
  th.starve += dt;
  if (th.starve < B.starveAfter) return;
  const edge = starvingTwig(state);
  th.starve = B.starveAfter - B.starveEvery;
  if (edge !== null) cutEdge(state, edge, null, 'starved');
}

// ---- the step --------------------------------------------------------------------------------------------------

const maxWorms = (len) => Math.min(B.wormMax, 1 + Math.floor(len / B.wormPerLength));

function stepSpawn(state, dt, season) {
  const { sim } = state;
  const th = sim.threat;
  const len = state.stats.hyphaeLength;
  if (sim.clock < B.wormGrace || len < B.wormMinLength) return;
  th.spawnT -= dt * (1 + len / B.wormLenRef) * (season ? B.wormSeason[season] : 1) * biomeFx(state.world).worm;
  if (th.spawnT > 0) return;
  if (state.fauna.length >= maxWorms(len)) {
    th.spawnT = B.wormSpawnEvery * 0.4; // no room: try again a little later
    return;
  }
  th.spawnT = B.wormSpawnEvery * (0.7 + 0.6 * rand(th));
  if (!spawnWorm(state)) th.spawnT = 6;
}

export function stepThreats(state, dt) {
  if (!state.flags.threats) return;
  const season = state.flags.seasons && state.clock ? state.clock.season : null;
  const cold = (season === 'winter' ? B.wormColdSpeed : 1) * biomeFx(state.world).wormSpeed;
  stepTraps(state, dt);
  lure(state);
  const { fauna, events } = state;
  for (let i = fauna.length - 1; i >= 0; i--) {
    const w = fauna[i];
    const r = stepWorm(state, w, dt, cold);
    if (r === 'keep') continue;
    fauna.splice(i, 1);
    if (r === 'gone') events.push({ type: 'worm-gone', id: w.id, x: w.x, y: w.y });
  }
  stepSpawn(state, dt, season);
  stepStarvation(state, dt);
}

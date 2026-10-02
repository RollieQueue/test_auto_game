// Rival (state.flags.rival): the honey fungus, Armillaria. Black rhizomorphs creep from old stumps (later from lost trees)
// towards the trees most worth having, grip their root tips and rot them (state.world.trees[].infection). A thick cord of the
// player's stops a tip; the barrier tool (key 4) withers rhizomorphs inside it and kills the tips there; a well-fed tree wears a
// mantle (tree.mantle, kept by economy.js) that slows the rot. The contract is docs/ARCHITECTURE.md §«Rival: honey fungus».
// Plain data only (state.rival, state.barriers, tree fields) so the whole thing is saved with the game; every random choice comes
// from state.rival.rs, so a seed and its commands replay exactly. Derived lookups live in a WeakMap and are never saved.
import { clamp, segmentsIntersect } from '../core/geom.js';
import { hash32 } from '../core/rng.js';
import { costAt, groundYAt } from '../world/query.js';
import { B, treeFx } from './balance.js';
import { eachNodeNear, nearestNode } from './network.js';
import { fungusFx } from './species.js';
import { stakesOn } from './stakes.js';

const TAU = Math.PI * 2;
const THINK = 0.1; // s between the steering decisions of one tip
const OFFSETS = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2, -2, 2.7, -2.7]; // headings tried, as turns away from the wanted one
const wrapPi = (a) => {
  const m = (a + Math.PI) % TAU;
  return (m < 0 ? m + TAU : m) - Math.PI;
};

/** mulberry32 step on the plain integer rival.rs: a float in [0, 1). */
function rand(rival) {
  rival.rs = (rival.rs + 0x6d2b79f5) >>> 0;
  let t = rival.rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (rival, [lo, hi]) => lo + (hi - lo) * rand(rival);

/** A fresh, sleeping rival (created by the first step with state.flags.rival). */
export function createRival(state) {
  return {
    awake: false,
    nodes: [], // { id, x, y, alive, born }
    edges: [], // { id, a (towards the source), b, w, alive, born, wither, orphan? }
    tips: [], // { id, node, x, y, dir, target, speed, ...steering internals }
    grip: [], // { treeId, node, x, y, since }
    clusters: [], // { id, treeId, x, y, n, age }
    spores: 0,
    // bookkeeping (saved with the rest)
    rs: hash32(state.seed, 'rival'),
    ver: 0, // bumped when nodes or edges are added or an edge dies (renderers cache by it)
    wait: 0, // s spent in chapter 2 or later before waking
    age: 0, // s since waking
    nextTip: 0,
    nextCluster: 0,
    nextBarrier: 0,
    spawnT: B.rivalTipEvery, // s (growing time) to the next new tip
    emptyT: 0, // s the rival has been cut back completely
    sweepT: 0, // s until the next look for dead-end twigs
    tipEvT: 0, // s until the next `rival-tip` event may be sent
    hot: false, // some edge has wither > 0
    src: [], // { key, node }: the rhizomorph root node of every stump and lost tree
    levels: state.world.trees.map(() => 0), // announced infection level per tree, 0..3 (tree-infected)
    stats: { grips: 0, freed: 0, lost: 0, cut: 0, killed: 0, freedTrees: 0 },
    dormant: false, // the wake fell in late autumn or winter: it sleeps until spring (rival-dormant was sent)
    grace: {}, // treeId -> state.time until which no rhizomorph goes for that tree (after a barrier freed it)
    retreats: [], // { treeId, at, x, y }: rival-retreat to send when the barrier that freed the tree ends
    freedIds: [], // distinct trees freed from the rival (stats.freedTrees = their number)
    turnT: 0, // s until the next rival-turn event may be sent
  };
}

/** Fields added after the first saves: a rival loaded from an older save gets their defaults. */
function upgrade(rival) {
  rival.dormant ??= false;
  rival.grace ??= {};
  rival.retreats ??= [];
  rival.freedIds ??= [];
  rival.turnT ??= 0;
  rival.stats.freedTrees ??= rival.freedIds.length;
}

// ---- derived lookups ------------------------------------------------------------------------------------------------

const caches = new WeakMap();

/** node id -> the edge towards its source, node id -> edges to its children, and the number of alive edges. */
function links(rival) {
  let c = caches.get(rival);
  if (c && c.nodes === rival.nodes.length && c.edges === rival.edges.length) return c;
  c = { nodes: rival.nodes.length, edges: rival.edges.length, into: rival.nodes.map(() => -1), kids: rival.nodes.map(() => []), live: 0 };
  for (const e of rival.edges) {
    c.into[e.b] = e.id;
    c.kids[e.a].push(e.id);
    if (e.alive) c.live++;
  }
  caches.set(rival, c);
  return c;
}

/** Alive rhizomorph edges. */
export const liveSegments = (rival) => links(rival).live;
/** No segment may be added: the budget (B.rivalMaxSegments alive edges, B.rivalMaxTotal nodes ever) is spent. */
const spent = (rival) => liveSegments(rival) >= B.rivalMaxSegments || rival.nodes.length >= B.rivalMaxTotal;

function addRoot(state, rival, x, y) {
  const c = links(rival);
  const node = { id: rival.nodes.length, x, y, alive: true, born: state.time };
  rival.nodes.push(node);
  c.into.push(-1);
  c.kids.push([]);
  c.nodes++;
  rival.ver++;
  return node;
}

function addSeg(state, rival, parent, x, y, w) {
  const c = links(rival);
  const node = { id: rival.nodes.length, x, y, alive: true, born: state.time };
  const edge = { id: rival.edges.length, a: parent, b: node.id, w, alive: true, born: state.time, wither: 0 };
  rival.nodes.push(node);
  rival.edges.push(edge);
  c.into.push(edge.id);
  c.kids.push([]);
  c.kids[parent].push(edge.id);
  c.nodes++;
  c.edges++;
  c.live++;
  rival.ver++;
  return node;
}

// ---- terrain and the player's cords -----------------------------------------------------------------------------------

/** A spot a rhizomorph may occupy: soil (not rock, not the air) at least B.rivalDepthMin - 1 below the surface. */
const open = (world, x, y) => Number.isFinite(costAt(world, x, y)) && y - groundYAt(world, x) >= B.rivalDepthMin - 1;

/** True when the segment crosses a live player edge that is a thick cord (B.rivalBlockW). */
function crossesCord(state, x1, y1, x2, y2) {
  const { net, sim } = state;
  let hit = false;
  eachNodeNear(state, (x1 + x2) / 2, (y1 + y2) / 2, 40, (n) => {
    if (hit) return;
    const ei = sim.parentEdge[n.id];
    if (ei < 0) return;
    const e = net.edges[ei];
    if (!e.alive || e.w < B.rivalBlockW) return;
    const p = net.nodes[e.a];
    if (segmentsIntersect(x1, y1, x2, y2, p.x, p.y, n.x, n.y)) hit = true;
  });
  return hit;
}

const WAY_CLEAR = 0;
const WAY_TERRAIN = 1; // rock, the surface or the air ahead
const WAY_CORD = 2; // open soil, but a thick player cord lies across it

/** Can a tip at (x, y) go on along heading `a` for `look` units? WAY_CLEAR: open soil on the way and no thick cord across it. */
function wayAhead(state, x, y, a, look) {
  const { world } = state;
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (!open(world, x + c * look * 0.45, y + s * look * 0.45) || !open(world, x + c * look, y + s * look)) return WAY_TERRAIN;
  return crossesCord(state, x, y, x + c * look, y + s * look) ? WAY_CORD : WAY_CLEAR;
}

/** Squared distance from a point to a segment (no allocation: this runs over every edge while a barrier stands). */
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  const ex = ax + dx * t - px;
  const ey = ay + dy * t - py;
  return ex * ex + ey * ey;
}

const inBarrier = (state, x, y) => state.barriers.some((b) => (b.x - x) ** 2 + (b.y - y) ** 2 < b.r * b.r);

// ---- seasons -----------------------------------------------------------------------------------------------------------

const seasonOf = (state) => (state.flags.seasons && state.clock ? state.clock.season : null);
/** Tip speed multiplier of the season (1 without seasons). */
export const growthFactor = (state) => {
  const s = seasonOf(state);
  return s ? B.rivalSeason[s] : 1;
};
const infectFactor = (state) => {
  const s = seasonOf(state);
  return s ? B.rivalInfectSeason[s] : 1;
};

// ---- trees as targets --------------------------------------------------------------------------------------------------

const gripsOf = (rival, treeId) => rival.grip.reduce((n, g) => n + (g.treeId === treeId ? 1 : 0), 0);
const gripped = (rival, treeId, idx) => rival.grip.some((g) => g.treeId === treeId && g.tip === idx);

/**
 * The root tip of `tree` a rhizomorph at (x, y) goes for: among the tips the rival does not hold yet, the ones the player has
 * linked (the roots the mycelium feeds draw it, and there the player has a node to put a barrier on), else any; the nearest of
 * them (shallow ones preferred). { x, y, d (straight distance), i (index in tree.tips) } or null.
 */
export function nearestRootTip(state, tree, x, y) {
  const { world, rival, sim } = state;
  let best = null;
  let bestScore = Infinity;
  let bestLinked = false;
  for (let i = 0; i < tree.tips.length; i++) {
    const tp = tree.tips[i];
    if (tp.minStage > tree.stage || (rival && gripped(rival, tree.id, i))) continue;
    const linked = sim.tipClaimed.has(`${tree.id}:${i}`);
    if (bestLinked && !linked) continue;
    const d = Math.hypot(tp.x - x, tp.y - y);
    const score = d + 0.35 * Math.max(0, tp.y - groundYAt(world, tp.x));
    if (score < bestScore || (linked && !bestLinked)) {
      bestScore = score;
      bestLinked = linked;
      best = { x: tp.x, y: tp.y, d, i };
    }
  }
  return best;
}

/** A barrier freed this tree a moment ago: the rhizomorphs leave it alone until the grace is over (B.rivalGrace after the barrier). */
const graced = (state, rival, treeId) => (rival.grace?.[treeId] ?? 0) > state.time;
const anyGrace = (state, rival) => {
  for (const id in rival.grace) if (rival.grace[id] > state.time) return true;
  return false;
};

/**
 * A grip must be one the player can answer: the tree is linked (the player has a node on its roots), or a player node lies
 * within B.rivalReach of the grip point `rt` (a barrier needs a node; a thread to there is a few seconds' work). A tip that
 * reaches the roots of a tree without that waits there.
 */
function answerable(state, rival, tree, rt) {
  if (tree.linked) return true;
  return nearestNode(state, rt.x, rt.y, B.rivalReach) !== null;
}

/** How much the rival wants this tree from (x, y): worth (stage, species, linked to the player) over the mantle and the way. */
function treeScore(state, rival, tree, x, y) {
  if (tree.lost || graced(state, rival, tree.id)) return 0;
  const grips = gripsOf(rival, tree.id);
  if (grips >= B.rivalMaxGrips) return 0;
  const rt = nearestRootTip(state, tree, x, y);
  if (!rt) return 0;
  const worth = B.treePay[tree.stage] * treeFx(tree).pay * (tree.linked ? 1.5 : 0.7);
  const fair = answerable(state, rival, tree, rt) ? 1 : B.rivalReachWeight; // a tree the player cannot answer for is only a second choice
  return (fair * worth * (1 - B.mantleProtect * (tree.mantle ?? 0))) / (1 + rt.d / 450) / (1 + 0.7 * grips);
}

function retarget(state, rival, tip) {
  const cur = tip.target ? state.world.trees[tip.target.id] : null;
  const curScore = cur ? treeScore(state, rival, cur, tip.x, tip.y) : 0;
  let best = null;
  let bestScore = 0;
  for (const tree of state.world.trees) {
    const s = treeScore(state, rival, tree, tip.x, tip.y);
    if (s > bestScore) {
      bestScore = s;
      best = tree;
    }
  }
  const next = best && (curScore <= 0 || bestScore > curScore * 1.4) ? best.id : cur && curScore > 0 ? cur.id : null;
  if (next !== (tip.target ? tip.target.id : null)) {
    tip.target = next === null ? null : { kind: 'tree', id: next };
    tip.best = 1e9; // a new goal: progress is measured afresh
    tip.noProg = 0;
  }
}

// ---- sources and tips --------------------------------------------------------------------------------------------------

/** Where rhizomorphs start: the stumps, and the base of every lost tree. */
function sources(state) {
  const out = (state.world.stumps ?? []).map((s) => ({ key: `s${s.id}`, x: s.x, y: s.y + 14, stump: s }));
  for (const t of state.world.trees) if (t.lost) out.push({ key: `t${t.id}`, x: t.x, y: t.baseY + 14, stump: null });
  return out;
}

function rootNode(state, rival, src) {
  const rec = rival.src.find((r) => r.key === src.key);
  if (rec && rival.nodes[rec.node].alive) return rival.nodes[rec.node];
  const node = addRoot(state, rival, src.x, src.y);
  if (rec) rec.node = node.id;
  else rival.src.push({ key: src.key, node: node.id });
  return node;
}

function newTip(rival, node, dir, base) {
  const tip = {
    id: rival.nextTip++,
    node: node.id,
    x: node.x,
    y: node.y,
    dir,
    target: null,
    speed: 0,
    // steering internals
    base,
    age: 0,
    acc: 0,
    nextLen: between(rival, B.rivalSpacing),
    side: rand(rival) < 0.5 ? -1 : 1, // the way it turns round an obstacle
    wob: 0,
    wobGoal: 0,
    wobT: 0,
    think: rand(rival) * THINK,
    retarget: 0,
    stall: 0,
    best: 1e9, // a finite stand-in for "nothing measured yet" (JSON saves Infinity as null)
    noProg: 0,
    lost: 0, // s without any tree to go for
    trunk: true,
    gripAt: B.rivalGripAfter + rand(rival) * B.rivalGripJitter, // rival.age before which this tip does not grip (seeded jitter)
  };
  rival.tips.push(tip);
  return tip;
}

/**
 * Hook for tests and scenarios: a tip at (x, y) heading `dir` on a root node of its own, after `treeId` when given (set
 * `tip.retarget = Infinity` to keep that goal). Creates the sleeping rival when there is none; does not wake it.
 */
export function spawnTipAt(state, x, y, dir, treeId = null) {
  const rival = (state.rival ??= createRival(state));
  const tip = newTip(rival, addRoot(state, rival, x, y), dir, between(rival, B.rivalSpeed));
  if (treeId !== null) tip.target = { kind: 'tree', id: treeId };
  return tip;
}

/** A new tip from source `src`; the heading points into the glade and down. Returns it, or null when it may not start. */
function spawnTip(state, rival, src) {
  if (rival.tips.length >= B.rivalMaxTips || spent(rival)) return null;
  if (inBarrier(state, src.x, src.y)) return null;
  const node = rootNode(state, rival, src);
  const down = 0.3 + rand(rival) * 0.6;
  const inward = src.x < state.world.width / 2 ? 1 : -1;
  const dir = src.stump ? (inward > 0 ? down : Math.PI - down) : 0.3 + rand(rival) * (Math.PI - 0.6);
  return newTip(rival, node, dir, between(rival, B.rivalSpeed));
}

function spawnTips(state, rival, dt, f) {
  if (f <= 0) return;
  const c = links(rival);
  if (rival.tips.length === 0 && c.live === 0) {
    // cut back completely: it comes again from the stumps after a pause
    rival.emptyT += dt;
    if (rival.emptyT < B.rivalRegrow) return;
    rival.emptyT = 0;
    const src = sources(state);
    for (let i = 0; i < B.rivalStartTips && src.length; i++) spawnTip(state, rival, src[i % src.length]);
    return;
  }
  rival.emptyT = 0;
  rival.spawnT -= dt * f;
  if (rival.spawnT > 0) return;
  const src = sources(state);
  if (!src.length) return;
  rival.spawnT = B.rivalTipEvery * (0.8 + 0.4 * rand(rival));
  if (rival.tips.length >= B.rivalMaxTips) return;
  spawnTip(state, rival, src[Math.floor(rand(rival) * src.length)]);
}

/** The tip has reached the root tip it was after: it holds the tree there. */
function makeGrip(state, rival, tip, tree, goal) {
  const node = addSeg(state, rival, tip.node, goal.x, goal.y, tip.trunk ? 1.5 : 1.2);
  rival.grip.push({ treeId: tree.id, node: node.id, x: goal.x, y: goal.y, since: state.time, tip: goal.i });
  rival.stats.grips++;
  state.events.push({ type: 'rival-grip', treeId: tree.id, x: goal.x, y: goal.y });
}

/** One steering decision of a tip. Returns 'ok', 'gripped' or 'dead' (the caller removes the tip in the last two cases). */
function thinkTip(state, rival, tip, f) {
  const { world } = state;
  tip.retarget -= THINK;
  const tree = tip.target ? world.trees[tip.target.id] : null;
  if (tip.retarget <= 0 || !tree || tree.lost || gripsOf(rival, tree.id) >= B.rivalMaxGrips || graced(state, rival, tree.id)) {
    retarget(state, rival, tip);
    tip.retarget = 1.5 + rand(rival) * 1.5;
  }
  if (spent(rival)) {
    tip.speed = 0; // no more segments to spend: the tip waits until some wither
    return 'ok';
  }
  const goalTree = tip.target ? world.trees[tip.target.id] : null;
  const goal = goalTree ? nearestRootTip(state, goalTree, tip.x, tip.y) : null;
  if (goal && goal.d <= B.rivalGripRadius) {
    if (rival.age < (tip.gripAt ?? B.rivalGripAfter) || !answerable(state, rival, goalTree, goal)) {
      tip.speed = 0; // it has arrived early, or the player cannot answer a grip here yet: it waits at the root
      return 'ok';
    }
    makeGrip(state, rival, tip, goalTree, goal);
    return 'gripped';
  }
  if (!goal && anyGrace(state, rival)) {
    tip.speed = 0; // the barrier drove it back: it holds still until the grace is over
    tip.lost = 0;
    return 'ok';
  }
  let want = tip.dir;
  let near = 1;
  if (goal) {
    want = Math.atan2(goal.y - tip.y, goal.x - tip.x);
    near = clamp(goal.d / 160, 0, 1);
    tip.lost = 0;
    if (goal.d < tip.best - 3) {
      tip.best = goal.d;
      tip.noProg = 0;
    } else if ((tip.noProg += THINK) > B.rivalNoProgress) return 'dead';
  } else if ((tip.lost += THINK) > 20) return 'dead';
  tip.wobT -= THINK;
  if (tip.wobT <= 0) {
    tip.wobGoal = (rand(rival) * 2 - 1) * 0.4;
    tip.wobT = 1 + rand(rival) * 1.5;
  }
  tip.wob += (tip.wobGoal - tip.wob) * 0.1;
  want += tip.wob * near;
  let chosen = null;
  let cordAhead = false;
  for (const off of OFFSETS) {
    const a = want + off * tip.side;
    const way = wayAhead(state, tip.x, tip.y, a, B.rivalLook);
    if (off === 0 && way === WAY_CORD) cordAhead = true; // the way it wants to go is shut by a thick cord of the player
    if (way === WAY_CLEAR) {
      chosen = a;
      break;
    }
  }
  if (cordAhead && goal && rival.turnT <= 0) {
    rival.turnT = B.rivalTurnGap;
    state.events.push({ type: 'rival-turn', x: tip.x, y: tip.y });
  }
  if (chosen === null) {
    // boxed in by rock, the surface or thick cords: stand, try the other way round next time, give up after a while
    tip.speed = 0;
    tip.side = -tip.side;
    return (tip.stall += THINK) >= B.rivalStallDie ? 'dead' : 'ok';
  }
  tip.stall = 0;
  tip.dir = wrapPi(chosen);
  tip.speed = tip.base * f;
  return 'ok';
}

/** A new node at the tip; sometimes a side branch starts there. */
function growNode(state, rival, tip) {
  const node = addSeg(state, rival, tip.node, tip.x, tip.y, tip.trunk ? 1.5 : 1.2);
  tip.node = node.id;
  tip.acc = 0;
  tip.nextLen = between(rival, B.rivalSpacing);
  if (rival.tipEvT <= 0) {
    state.events.push({ type: 'rival-tip', x: tip.x, y: tip.y });
    rival.tipEvT = 1;
  }
  if (rand(rival) < B.rivalBranch && rival.tips.length < B.rivalMaxTips && !spent(rival)) {
    const side = rand(rival) < 0.5 ? -1 : 1;
    const branch = newTip(rival, node, wrapPi(tip.dir + side * (0.6 + rand(rival) * 0.5)), between(rival, B.rivalSpeed));
    branch.trunk = false;
  }
}

function stepTips(state, rival, dt, f) {
  const { world } = state;
  const c = links(rival);
  for (let i = rival.tips.length - 1; i >= 0; i--) {
    const tip = rival.tips[i];
    const into = c.into[tip.node];
    const e = into >= 0 ? rival.edges[into] : null;
    if (!rival.nodes[tip.node].alive || (e && (!e.alive || e.orphan))) {
      rival.tips.splice(i, 1); // cut off from its source
      continue;
    }
    if (f <= 0) {
      tip.speed = 0; // winter: everything sleeps
      continue;
    }
    tip.age += dt;
    tip.think -= dt;
    if (tip.think <= 0) {
      tip.think += THINK;
      const verdict = thinkTip(state, rival, tip, f);
      if (verdict !== 'ok') {
        rival.tips.splice(i, 1);
        continue;
      }
    }
    if (tip.speed <= 0) continue;
    const step = tip.speed * dt;
    const nx = tip.x + Math.cos(tip.dir) * step;
    const ny = tip.y + Math.sin(tip.dir) * step;
    if (!open(world, nx, ny)) {
      tip.speed = 0;
      tip.think = 0; // look again at the next step
      continue;
    }
    tip.x = nx;
    tip.y = ny;
    tip.acc += step;
    if (tip.acc < tip.nextLen) continue;
    if (spent(rival)) tip.speed = 0; // another tip took the last segment: wait
    else growNode(state, rival, tip);
  }
}

// ---- barriers ----------------------------------------------------------------------------------------------------------

/** Cuts the descendants' lifeline: everything beyond a dead edge starts to wither away (`cut` marks it as the barrier's doing). */
function orphanBelow(rival, nodeId, cut) {
  const c = links(rival);
  const stack = [nodeId];
  while (stack.length) {
    for (const eid of c.kids[stack.pop()]) {
      const e = rival.edges[eid];
      if (!e.alive || e.orphan) continue;
      e.orphan = true;
      if (cut) e.cut = true;
      stack.push(e.b);
    }
  }
  rival.hot = true;
}

function killEdge(rival, e) {
  const c = links(rival);
  e.alive = false;
  e.wither = 1;
  rival.nodes[e.b].alive = false;
  c.live--;
  rival.ver++;
  orphanBelow(rival, e.b, e.cut === true);
}

/** Dead-end twigs (no tip, no grip, nothing beyond them) that are old enough wither away, so the rival never clogs its own budget. */
function sweepTwigs(state, rival, dt) {
  rival.sweepT -= dt;
  if (rival.sweepT > 0) return;
  rival.sweepT = 5;
  const serve = new Uint8Array(rival.nodes.length);
  for (const t of rival.tips) serve[t.node] = 1;
  for (const g of rival.grip) serve[g.node] = 1;
  for (const e of rival.edges) if (e.alive) serve[e.a] = 1;
  for (const e of rival.edges) {
    if (!e.alive || e.orphan || serve[e.b] || state.time - e.born < B.rivalTwigAge) continue;
    e.orphan = true;
    rival.hot = true;
  }
}

/** Barriers wither the rhizomorphs inside them and kill the tips there; they end after B.barrierDur. */
function stepBarriers(state, rival, dt) {
  const { barriers, events } = state;
  if (barriers.length) {
    for (let i = rival.tips.length - 1; i >= 0; i--) {
      if (!inBarrier(state, rival.tips[i].x, rival.tips[i].y)) continue;
      rival.tips.splice(i, 1);
      rival.stats.killed++;
    }
  }
  if (barriers.length || rival.hot) {
    let hot = false;
    let died = 0;
    let cx = 0;
    let cy = 0;
    for (const e of rival.edges) {
      if (!e.alive) continue;
      const a = rival.nodes[e.a];
      const b = rival.nodes[e.b];
      let inside = false;
      for (const br of barriers) {
        if (segDist2(br.x, br.y, a.x, a.y, b.x, b.y) <= br.r * br.r) {
          inside = true;
          break;
        }
      }
      if (inside) e.cut = true;
      if (inside || e.orphan) {
        e.wither = Math.min(1, e.wither + dt / (e.orphan && !inside ? B.rivalOrphanSeconds : B.barrierWither));
      } else if (e.wither > 0) {
        e.wither = Math.max(0, e.wither - dt / (2 * B.barrierWither));
        if (e.wither === 0) e.cut = false; // it recovered: no longer the barrier's
      }
      if (e.wither >= 1) {
        if (e.cut) {
          if (died === 0) {
            cx = (a.x + b.x) / 2;
            cy = (a.y + b.y) / 2;
          }
          died++;
        }
        killEdge(rival, e);
      } else if (e.wither > 0) hot = true;
    }
    rival.hot = hot;
    if (died > 0) {
      rival.stats.cut += died;
      events.push({ type: 'rival-cut', x: cx, y: cy, edges: died });
    }
  }
  for (let i = barriers.length - 1; i >= 0; i--) {
    const b = barriers[i];
    b.t += dt;
    if (b.t < b.dur) continue;
    barriers.splice(i, 1);
    events.push({ type: 'barrier-gone', id: b.id, x: b.x, y: b.y });
  }
  // the barrier that freed a tree is over: the rhizomorphs have drawn back from it (the grace runs B.rivalGrace s from here)
  for (let i = rival.retreats.length - 1; i >= 0; i--) {
    const r = rival.retreats[i];
    if (state.time < r.at) continue;
    rival.retreats.splice(i, 1);
    if (!state.world.trees[r.treeId].lost) events.push({ type: 'rival-retreat', treeId: r.treeId, x: r.x, y: r.y });
  }
}

/** Sugar a barrier costs now: the base price plus a step for every barrier still standing. */
export const barrierCost = (state) => B.barrierCost + B.barrierCostStep * state.barriers.length;

/** null when a barrier may be put on the node, otherwise 'off' (the rival sleeps) | 'dead' | 'max' | 'crowded' | 'sugar'. */
export function barrierDenial(state, nodeId) {
  const rival = state.rival;
  if (!state.flags.rival || !rival || !rival.awake) return 'off';
  const node = state.net.nodes[nodeId];
  if (!node || !node.alive) return 'dead';
  if (state.barriers.length >= B.barrierMax) return 'max';
  for (const b of state.barriers) if (Math.hypot(b.x - node.x, b.y - node.y) < b.r) return 'crowded';
  if (state.res.sugar < barrierCost(state)) return 'sugar';
  return null;
}

export const canBarrier = (state, nodeId) => barrierDenial(state, nodeId) === null;

/** Puts a barrier on the node. Returns false (with a `barrier-denied` event for a real node) when it may not. */
export function commandBarrier(state, nodeId) {
  const reason = barrierDenial(state, nodeId);
  const node = state.net.nodes[nodeId];
  if (reason) {
    if (node && reason !== 'off') {
      state.events.push({ type: 'barrier-denied', reason, x: node.x, y: node.y });
      if (reason === 'sugar') state.events.push({ type: 'insufficient', x: node.x, y: node.y });
    }
    return false;
  }
  state.res.sugar -= barrierCost(state);
  const b = { id: state.rival.nextBarrier++, nodeId, x: node.x, y: node.y, r: B.barrierRadius, t: 0, dur: B.barrierDur };
  state.barriers.push(b);
  state.events.push({ type: 'barrier-placed', id: b.id, x: b.x, y: b.y, nodeId });
  return true;
}

/** The node to put a barrier on for a click at (x, y): the nearest that may, else the nearest of any kind (for the reason). */
export function pickBarrierNode(state, x, y, radius = 44) {
  const ok = nearestNode(state, x, y, radius, (n) => canBarrier(state, n.id));
  if (ok !== null) return ok;
  return nearestNode(state, x, y, radius + 40);
}

// ---- grips, infection, clusters ----------------------------------------------------------------------------------------

/** A grip whose edge is dead (cut by a barrier, or withered after its source was cut) lets go. */
function releaseGrips(state, rival) {
  const c = links(rival);
  for (let i = rival.grip.length - 1; i >= 0; i--) {
    const g = rival.grip[i];
    const ei = c.into[g.node];
    if (ei < 0 || rival.edges[ei].alive) continue;
    rival.grip.splice(i, 1);
    rival.stats.freed++;
    state.events.push({ type: 'tree-freed', treeId: g.treeId, x: g.x, y: g.y });
    if (gripsOf(rival, g.treeId) > 0) continue;
    // the tree is free of the rival: it counts (once per tree) for the page-2 observation, and the rhizomorphs leave it alone
    // while the barrier stands and for B.rivalGrace s after it
    if (!rival.freedIds.includes(g.treeId)) {
      rival.freedIds.push(g.treeId);
      rival.stats.freedTrees = rival.freedIds.length;
    }
    const left = state.barriers.reduce((m, b) => Math.max(m, b.dur - b.t), 0);
    rival.grace[g.treeId] = Math.max(rival.grace[g.treeId] ?? 0, state.time + left + B.rivalGrace);
    if (left > 0) rival.retreats.push({ treeId: g.treeId, at: state.time + left, x: g.x, y: g.y });
  }
}

function loseTree(state, rival, tree) {
  tree.infection = 1;
  tree.lost = true;
  tree.mantle = 0;
  rival.grip = rival.grip.filter((g) => g.treeId !== tree.id);
  rival.stats.lost++;
  state.events.push({ type: 'tree-lost', treeId: tree.id, x: tree.x, y: tree.baseY });
}

/** Grips rot a tree (slower under a mantle and out of season); a free tree heals. Announces 25 / 50 / 75 %, and the loss at 100 %. */
function stepInfection(state, rival, dt) {
  const { world, events } = state;
  const c = links(rival);
  const season = infectFactor(state);
  const rot = fungusFx(state).rot; // tough threads (chanterelle) rot slower
  const living = world.trees.reduce((n, t) => n + (t.lost ? 0 : 1), 0);
  for (const tree of world.trees) {
    if (tree.lost) continue;
    tree.infection ??= 0;
    tree.mantle ??= 0;
    let rate = 0;
    let n = 0;
    for (const g of rival.grip) {
      if (g.treeId !== tree.id) continue;
      const e = rival.edges[c.into[g.node]];
      rate += (n++ === 0 ? 1 : B.rivalExtraGrip) * (e ? 1 - e.wither : 1);
    }
    // the first quarter of the rot runs slow (B.rivalEarlyRate): a grip is seen, and answered, well before it hurts
    if (n > 0) tree.infection += (rate * season * (1 - B.mantleProtect * tree.mantle) * rot * (tree.infection < 0.25 ? B.rivalEarlyRate : 1) * dt) / B.rivalInfectSeconds;
    else if (tree.infection > 0) tree.infection -= ((1 + B.rivalHealMantle * tree.mantle) * dt) / B.rivalHealSeconds;
    tree.infection = clamp(tree.infection, 0, living <= 1 && !stakesOn(state) ? B.rivalLastTree : 1);
    let lvl = rival.levels[tree.id] ?? 0;
    while (lvl < 3 && tree.infection >= 0.25 * (lvl + 1)) {
      lvl++;
      events.push({ type: 'tree-infected', treeId: tree.id, level: 0.25 * lvl, x: tree.x, y: tree.baseY });
    }
    while (lvl > 0 && tree.infection < 0.25 * lvl - 0.1) lvl--;
    rival.levels[tree.id] = lvl;
    if (tree.infection >= 1) loseTree(state, rival, tree);
  }
}

/** Autumn: honey mushrooms rise at the rotting trees (a cluster each); they are gone with the first cold. */
function stepClusters(state, rival, dt) {
  const { world, events } = state;
  const season = seasonOf(state);
  for (const cl of rival.clusters) cl.age += dt;
  if (season !== 'autumn') {
    if (rival.clusters.length) rival.clusters.length = 0;
    return;
  }
  for (const tree of world.trees) {
    if ((tree.infection ?? 0) < B.rivalFruitInfection || rival.clusters.some((cl) => cl.treeId === tree.id)) continue;
    if (rand(rival) >= B.rivalFruitRate * dt) continue;
    const x = tree.x + (rand(rival) * 2 - 1) * 36;
    const n = B.rivalFruit[0] + Math.floor(rand(rival) * (B.rivalFruit[1] - B.rivalFruit[0] + 1));
    const cl = { id: rival.nextCluster++, treeId: tree.id, x, y: groundYAt(world, x), n, age: 0 };
    rival.clusters.push(cl);
    rival.spores += n;
    events.push({ type: 'rival-fruit', treeId: tree.id, x: cl.x, y: cl.y, n });
  }
}

// ---- the step ----------------------------------------------------------------------------------------------------------

/** Late autumn and winter (seasons only): no waking, the rival sleeps until spring. */
function tooLate(state) {
  if (!state.flags.seasons || !state.clock) return false;
  const { season, seasonFrac } = state.clock;
  return season === 'winter' || (season === 'autumn' && seasonFrac >= B.rivalLateAutumn);
}

function wake(state, rival) {
  const src = sources(state);
  if (!src.length) return;
  rival.awake = true;
  rival.dormant = false;
  const first = src[0];
  const n = Math.min(B.rivalStartTips, B.rivalMaxTips);
  for (let i = 0; i < n; i++) spawnTip(state, rival, src[i % src.length]);
  state.events.push({ type: 'rival-wake', x: first.x, y: first.stump ? first.stump.y : first.y, stumpId: first.stump ? first.stump.id : -1 });
}

export function stepRival(state, dt) {
  if (!state.flags.rival) return;
  const rival = (state.rival ??= createRival(state));
  upgrade(rival);
  if (!rival.awake) {
    if ((state.chapter ?? 1) >= 2) rival.wait += dt;
    // it wakes B.rivalWakeDelay s into chapter 2, or after B.rivalWakeBy s of play, whichever is first; in late autumn and winter
    // it sleeps on until spring (and says so once)
    if (state.flags.rival === 'now') wake(state, rival);
    else if (rival.wait >= B.rivalWakeDelay || state.time >= B.rivalWakeBy) {
      if (!tooLate(state)) wake(state, rival);
      else if (!rival.dormant) {
        const first = sources(state)[0];
        rival.dormant = true;
        if (first) state.events.push({ type: 'rival-dormant', x: first.x, y: first.stump ? first.stump.y : first.y });
      }
    }
    if (!rival.awake) return;
  }
  rival.age += dt;
  rival.turnT = Math.max(0, rival.turnT - dt);
  rival.tipEvT = Math.max(0, rival.tipEvT - dt);
  const f = growthFactor(state);
  stepBarriers(state, rival, dt);
  sweepTwigs(state, rival, dt);
  stepTips(state, rival, dt, f);
  spawnTips(state, rival, dt, f);
  releaseGrips(state, rival);
  stepInfection(state, rival, dt);
  stepClusters(state, rival, dt);
}

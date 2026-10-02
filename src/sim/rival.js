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
import { cutEdge } from './threats.js';
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
    stats: { grips: 0, freed: 0, lost: 0, cut: 0, killed: 0, freedTrees: 0, raiders: 0, raids: 0, overgrown: 0, raidCut: 0, raidHealed: 0, raidStopped: 0 },
    dormant: false, // the wake fell in late autumn or winter: it sleeps until spring (rival-dormant was sent)
    grace: {}, // treeId -> state.time until which no rhizomorph goes for that tree (after a barrier freed it)
    retreats: [], // { treeId, at, x, y }: rival-retreat to send when the barrier that freed the tree ends
    freedIds: [], // distinct trees freed from the rival (stats.freedTrees = their number)
    turnT: 0, // s until the next rival-turn event may be sent
    // the raider (see stepRaid): tips with a `raid` field go for the player's network, `over` lists the player's edges it has overgrown
    over: [], // { edge (state.net edge id), from (node id it entered at), cover 0..1 (how far along it the black has crept), wither 0..1, born }
    raidCount: 0, // tips made by the spawn timer so far (every B.rivalRaidEvery-th is a raider)
    deepPage: 0, // the last page (chapter) that had its deep tip (see spawnDeepTip)
  };
}

const RAID_STATS = ['raiders', 'raids', 'overgrown', 'raidCut', 'raidHealed', 'raidStopped'];

/** Fields added after the first saves: a rival loaded from an older save gets their defaults. */
function upgrade(rival) {
  rival.dormant ??= false;
  rival.grace ??= {};
  rival.retreats ??= [];
  rival.freedIds ??= [];
  rival.turnT ??= 0;
  rival.stats.freedTrees ??= rival.freedIds.length;
  rival.over ??= [];
  rival.raidCount ??= 0;
  rival.deepPage ??= 0;
  for (const k of RAID_STATS) rival.stats[k] ??= 0;
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

/** True when (x, y) lies inside a standing barrier. */
export const inBarrier = (state, x, y) => state.barriers.some((b) => (b.x - x) ** 2 + (b.y - y) ** 2 < b.r * b.r);

/** Ids of the player's alive nodes inside a standing barrier (their hyphae are frozen), or null when no barrier stands. */
export function barredNodes(state) {
  if (state.barriers.length === 0) return null;
  const out = new Set();
  for (const n of state.net.nodes) if (n.alive && inBarrier(state, n.x, n.y)) out.add(n.id);
  return out;
}

/** A linked tree all of whose root contacts lie inside barriers: it pays nothing while they stand (economy.js stepTrees). */
export function treeBarred(state, tree) {
  if (state.barriers.length === 0) return false;
  const ids = state.sim.contacts[tree.id];
  if (!ids || ids.length === 0) return false;
  const nodes = state.net.nodes;
  return ids.every((id) => nodes[id] && inBarrier(state, nodes[id].x, nodes[id].y)); // a contact with no node is not inside
}

/**
 * What a barrier on node `nodeId` would freeze, for the tooltip: { frozen: alive nodes of the player inside its ring, trees: the
 * living trees that would stop paying ({ id, pay: their nominal sugar per second }; those already barred are left out) }.
 */
export function barrierEffects(state, nodeId) {
  const out = { frozen: 0, trees: [] };
  const node = state.net.nodes[nodeId];
  if (!node || !node.alive) return out;
  const r2 = B.barrierRadius * B.barrierRadius;
  const inside = (x, y) => (node.x - x) ** 2 + (node.y - y) ** 2 < r2 || inBarrier(state, x, y);
  for (const n of state.net.nodes) if (n.alive && (node.x - n.x) ** 2 + (node.y - n.y) ** 2 < r2) out.frozen++;
  for (const t of state.world.trees) {
    if (t.lost || treeBarred(state, t)) continue;
    const ids = state.sim.contacts[t.id];
    if (!ids || ids.length === 0 || !ids.every((id) => state.net.nodes[id] && inside(state.net.nodes[id].x, state.net.nodes[id].y))) continue;
    out.trees.push({ id: t.id, pay: B.treePay[t.stage] * treeFx(t).pay * (1 - B.rivalPayCut * (t.infection ?? 0)) });
  }
  return out;
}

/** The raid cadence of the page: every n-th timer tip is a raider, at most `max` alive at once (later pages press harder). */
const late = (state) => (state.chapter ?? 1) >= B.rivalRaidFromChapter;
export const raidEvery = (state) => (late(state) ? B.rivalRaidEveryLate : B.rivalRaidEvery);
export const raidMax = (state) => (late(state) ? B.rivalRaidMaxLate : B.rivalRaidMax);

/** The raiders: rhizomorph tips that go for the player's hyphae (tip.raid is { phase: 'seek' | 'run', ... }). */
export const raiders = (state) => (state.rival ? state.rival.tips.filter((t) => t.raid) : []);

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

/** A new tip from source `src`; the heading points into the glade and down. Returns it, or null when it may not start. `raid`: a raider. */
function spawnTip(state, rival, src, raid = false) {
  if (rival.tips.length >= B.rivalMaxTips || spent(rival)) return null;
  if (inBarrier(state, src.x, src.y)) return null;
  const node = rootNode(state, rival, src);
  const down = 0.3 + rand(rival) * 0.6;
  const inward = src.x < state.world.width / 2 ? 1 : -1;
  const dir = src.stump ? (inward > 0 ? down : Math.PI - down) : 0.3 + rand(rival) * (Math.PI - 0.6);
  const tip = newTip(rival, node, dir, between(rival, B.rivalSpeed));
  if (raid) makeRaider(rival, tip);
  return tip;
}

/** Turns `tip` into a raider (tip.raid; its target stays null: it goes for the player's network, not for a tree). */
function makeRaider(rival, tip) {
  tip.raid = { phase: 'seek', n: 0, edge: -1, at: -1, s: 0, goal: null, warned: false };
  rival.stats.raiders++;
}

/** Hook for tests and scenarios: a raider at (x, y) heading `dir` on a root node of its own (it stands B.rivalRaidLead s, then seeks). Does not wake the rival. */
export function spawnRaiderAt(state, x, y, dir = 0) {
  const rival = (state.rival ??= createRival(state));
  const tip = newTip(rival, addRoot(state, rival, x, y), dir, between(rival, B.rivalSpeed));
  makeRaider(rival, tip);
  return tip;
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
  let at = src[Math.floor(rand(rival) * src.length)];
  rival.raidCount++;
  let raid = false;
  if (rival.raidCount % raidEvery(state) === 0 && raiders(state).length < raidMax(state)) {
    // a raider starts where the player can see it coming: from a source at least B.rivalRaidMinDist from the nearest thin hypha
    const first = src.indexOf(at);
    for (let k = 0; k < src.length && !raid; k++) {
      const from = src[(first + k) % src.length];
      const goal = raidGoal(state, rival, from.x, from.y);
      if (goal && goal.d >= B.rivalRaidMinDist) {
        at = from;
        raid = true;
      }
    }
  }
  if (!raid && deepDue(state, rival)) spawnDeepTip(state, rival); // on top of the plain tip of this turn
  spawnTip(state, rival, at, raid);
}

// ---- the deep grip -----------------------------------------------------------------------------------------------------
// Once per page a tip is sent from BELOW the gravel up to a root tip none of the player's threads is near: a barrier ring put on an
// existing node cannot reach it, so the player must stretch a thread down first (the guide says so). Other grips wait for a node in
// reach (answerable); this one does not, which is what makes it the page's harder grip.

/** The page has not had its deep tip yet (the rival lives with the chapters from B.rivalDeepFromChapter on). */
const deepDue = (state, rival) => (state.chapter ?? 1) >= B.rivalDeepFromChapter && rival.deepPage < (state.chapter ?? 1);

/** The root tip of a linked, living tree that is deep and out of reach of the player's threads: { tree, i, x, y } (the best by worth x depth) or null. */
function deepGoal(state, rival) {
  const { world, sim } = state;
  let best = null;
  let bestScore = 0;
  for (const tree of world.trees) {
    if (!tree.linked || tree.lost || graced(state, rival, tree.id) || gripsOf(rival, tree.id) >= B.rivalMaxGrips) continue;
    const worth = B.treePay[tree.stage] * treeFx(tree).pay * (1 - B.mantleProtect * (tree.mantle ?? 0));
    for (let i = 0; i < tree.tips.length; i++) {
      const tp = tree.tips[i];
      if (tp.minStage > tree.stage || gripped(rival, tree.id, i) || sim.tipClaimed.has(`${tree.id}:${i}`)) continue;
      const depth = tp.y - groundYAt(world, tp.x);
      if (depth < B.rivalDeepTipMin || nearestNode(state, tp.x, tp.y, B.rivalDeepClear) !== null) continue;
      const score = worth * depth;
      if (score > bestScore) {
        bestScore = score;
        best = { tree, i, x: tp.x, y: tp.y };
      }
    }
  }
  return best;
}

/** Is the straight way from (x1, y1) to (x2, y2) open soil all along (a rock between would stall the climbing tip)? */
function lineOpen(world, x1, y1, x2, y2) {
  const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 10);
  for (let i = 1; i < n; i++) if (!open(world, x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n)) return false;
  return true;
}

/** Open soil under the top of the gravel near the root tip (a little under it, else on it) with a clear way up to it: { x, y } or null. The start of the deep tip. */
function deepStart(state, goal) {
  const { world } = state;
  const gravel = world.horizons[world.horizons.length - 1].depth;
  for (let off = B.rivalDeepStart; off >= 0; off -= 10) {
    for (const dx of [0, 40, -40, 80, -80, 130, -130, 200, -200]) {
      const sx = clamp(goal.x + dx, 60, world.width - 60);
      const sy = groundYAt(world, sx) + gravel + off;
      if (sy < world.height - 15 && open(world, sx, sy) && !inBarrier(state, sx, sy) && lineOpen(world, sx, sy, goal.x, goal.y)) return { x: sx, y: sy };
    }
  }
  return null;
}

/** Starts the page's deep tip (its own root node under the gravel, pinned by `tip.deep`). Returns false when no root tip or start qualifies. */
function spawnDeepTip(state, rival) {
  if (rival.tips.length >= B.rivalMaxTips || spent(rival)) return false;
  const goal = deepGoal(state, rival);
  const from = goal && deepStart(state, goal);
  if (!from) return false;
  const tip = newTip(rival, addRoot(state, rival, from.x, from.y), Math.atan2(goal.y - from.y, goal.x - from.x), between(rival, B.rivalSpeed));
  tip.target = { kind: 'tree', id: goal.tree.id };
  tip.deep = { treeId: goal.tree.id, i: goal.i };
  rival.deepPage = state.chapter ?? 1;
  state.events.push({ type: 'rival-deep', x: from.x, y: from.y, treeId: goal.tree.id });
  return true;
}

/** The pinned root tip of a deep tip as a goal ({ x, y, d, i }); null (and the tip is an ordinary one from now on) when it is no longer worth going for. */
function deepGoalOf(state, rival, tip) {
  const { treeId, i } = tip.deep;
  const tree = state.world.trees[treeId];
  const tp = tree && tree.tips[i];
  if (!tp || tree.lost || tp.minStage > tree.stage || gripped(rival, treeId, i) || gripsOf(rival, treeId) >= B.rivalMaxGrips || graced(state, rival, treeId)) {
    delete tip.deep;
    return null;
  }
  return { x: tp.x, y: tp.y, d: Math.hypot(tp.x - tip.x, tp.y - tip.y), i };
}

/** The tip has reached the root tip it was after: it holds the tree there. */
function makeGrip(state, rival, tip, tree, goal) {
  const node = addSeg(state, rival, tip.node, goal.x, goal.y, tip.trunk ? 1.5 : 1.2);
  const deep = tip.deep ? { deep: true } : null;
  rival.grip.push({ treeId: tree.id, node: node.id, x: goal.x, y: goal.y, since: state.time, tip: goal.i, ...deep });
  rival.stats.grips++;
  state.events.push({ type: 'rival-grip', treeId: tree.id, x: goal.x, y: goal.y, ...deep });
}

/** One steering decision of a tip. Returns 'ok', 'gripped' or 'dead' (the caller removes the tip in the last two cases). */
function thinkTip(state, rival, tip, f) {
  if (tip.raid) return thinkRaider(state, rival, tip, f);
  const { world } = state;
  const pinned = tip.deep ? deepGoalOf(state, rival, tip) : null; // a deep tip keeps its root tip; the others go for the nearest of a tree
  tip.retarget -= THINK;
  const tree = tip.target ? world.trees[tip.target.id] : null;
  if (!pinned && (tip.retarget <= 0 || !tree || tree.lost || gripsOf(rival, tree.id) >= B.rivalMaxGrips || graced(state, rival, tree.id))) {
    retarget(state, rival, tip);
    tip.retarget = 1.5 + rand(rival) * 1.5;
  }
  if (spent(rival)) {
    tip.speed = 0; // no more segments to spend: the tip waits until some wither
    return 'ok';
  }
  const goalTree = tip.target ? world.trees[tip.target.id] : null;
  const goal = pinned || (goalTree ? nearestRootTip(state, goalTree, tip.x, tip.y) : null);
  if (goal && goal.d <= B.rivalGripRadius) {
    if (rival.age < (tip.gripAt ?? B.rivalGripAfter) || (!pinned && !answerable(state, rival, goalTree, goal))) {
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
  return steerTip(state, rival, tip, f, goal);
}

/** The steering of a tip towards `goal` ({ x, y, d } or null: no goal, it goes straight on): a heading that is open soil and free of thick cords. */
function steerTip(state, rival, tip, f, goal) {
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
      if (tip.raid) endRaid(state, rival, tip, 'gone');
      rival.tips.splice(i, 1); // cut off from its source
      continue;
    }
    if (f <= 0) {
      tip.speed = 0; // winter: everything sleeps
      continue;
    }
    tip.age += dt;
    if (tip.raid && tip.raid.phase === 'run') {
      const end = runRaider(state, rival, tip, dt * f);
      if (end) {
        endRaid(state, rival, tip, end);
        rival.tips.splice(i, 1);
      }
      continue;
    }
    tip.think -= dt;
    if (tip.think <= 0) {
      tip.think += THINK;
      const verdict = thinkTip(state, rival, tip, f);
      if (verdict !== 'ok') {
        if (tip.raid) endRaid(state, rival, tip, 'gone');
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

// ---- the raider --------------------------------------------------------------------------------------------------------
// A raider is a tip with tip.raid. In phase 'seek' it creeps like any tip, but towards the player's nearest thin hypha; on touching
// it (phase 'run') it overgrows that edge and runs on over thin edges towards the spore at B.rivalRaidSpeed, at most B.rivalRaidReach
// edges. An overgrown edge (rival.over) withers for B.rivalRaidWither s and is then cut like a worm bite (threats.js cutEdge), the
// branch beyond it dying with it. A thick cord, the hyphae round the spore, a barrier or the reach stop it; a barrier also kills it
// and heals what it has overgrown inside the ring.

const overgrown = (rival, edgeId) => rival.over.some((o) => o.edge === edgeId);

/** The edge from `node` towards the spore a raider may overgrow: alive, thin (w < B.rivalBlockW), not round the spore, not overgrown yet; else null. */
function raidEdge(state, rival, node) {
  const ei = state.sim.parentEdge[node.id];
  if (ei < 0 || !node.alive || node.dist < B.biteImmuneDist) return null;
  const e = state.net.edges[ei];
  return e.alive && e.w < B.rivalBlockW && !overgrown(rival, ei) ? e : null;
}

/** The thin hypha a raider at (x, y) goes for: the nearest node (outside barriers) whose edge it may overgrow. { x, y, d, node } or null. */
function raidGoal(state, rival, x, y) {
  const id = nearestNode(state, x, y, B.rivalRaidSense, (n) => raidEdge(state, rival, n) !== null && !inBarrier(state, n.x, n.y));
  if (id === null) return null;
  const n = state.net.nodes[id];
  return { x: n.x, y: n.y, d: Math.hypot(n.x - x, n.y - y), node: id };
}

/** The raid is over (the caller removes the tip): `reason` is 'cord' | 'barrier' | 'reach' | 'spore' | 'gone'. */
function endRaid(state, rival, tip, reason) {
  if (tip.raid.phase === 'run' && reason !== 'gone') rival.stats.raidStopped++;
  state.events.push({ type: 'rival-raid-end', x: tip.x, y: tip.y, reason });
}

/** Overgrows edge `e` from its child end: it blackens and withers, then is cut (stepOver). */
function overgrow(state, rival, e) {
  rival.over.push({ edge: e.id, from: e.b, cover: 0, wither: 0, born: state.time });
  rival.stats.overgrown++;
}

/** One think of a raider in phase 'seek': find its hypha, touch it (and start the run), or steer on. */
function thinkRaider(state, rival, tip, f) {
  const { net } = state;
  const raid = tip.raid;
  tip.retarget -= THINK;
  let goal = raid.goal;
  const stale = !goal || !net.nodes[goal.node].alive || raidEdge(state, rival, net.nodes[goal.node]) === null || inBarrier(state, goal.x, goal.y);
  if (stale || tip.retarget <= 0) {
    const next = raidGoal(state, rival, tip.x, tip.y);
    if (next && (!goal || next.node !== goal.node)) {
      tip.best = 1e9; // a new goal: progress is measured afresh
      tip.noProg = 0;
    }
    goal = raid.goal = next;
    tip.retarget = 1.5 + rand(rival) * 1.5;
  }
  if (spent(rival)) {
    tip.speed = 0; // no more segments to spend: the tip waits until some wither
    return 'ok';
  }
  if (goal) {
    goal.d = Math.hypot(goal.x - tip.x, goal.y - tip.y);
    if (!raid.warned && goal.d <= B.rivalRaidWarn) {
      raid.warned = true;
      state.events.push({ type: 'rival-raid-seek', x: tip.x, y: tip.y });
    }
  }
  if (tip.age < B.rivalRaidLead) {
    tip.speed = 0; // it has just appeared: it stands still for a while (the warning), it does not touch anything yet
    return 'ok';
  }
  // touch: a thin hypha within B.rivalRaidTouch of the tip
  let hit = null;
  let hitD = B.rivalRaidTouch * B.rivalRaidTouch;
  eachNodeNear(state, tip.x, tip.y, B.rivalRaidTouch + 20, (n) => {
    const e = raidEdge(state, rival, n);
    if (!e || inBarrier(state, n.x, n.y)) return;
    const p = net.nodes[e.a];
    const d = segDist2(tip.x, tip.y, p.x, p.y, n.x, n.y);
    if (d <= hitD) {
      hitD = d;
      hit = e;
    }
  });
  if (hit) {
    const start = net.nodes[hit.b];
    raid.phase = 'run';
    raid.edge = hit.id;
    raid.at = hit.b;
    raid.s = 0;
    raid.n = 1;
    raid.goal = null;
    tip.x = start.x;
    tip.y = start.y;
    tip.speed = 0;
    overgrow(state, rival, hit);
    rival.stats.raids++;
    state.events.push({ type: 'rival-raid-touch', x: start.x, y: start.y, edge: hit.id });
    return 'ok';
  }
  return steerTip(state, rival, tip, f, goal);
}

/** Moves a raider in phase 'run' by `dt` (already scaled by the season) along the player's hypha; null, or the reason it ends. */
function runRaider(state, rival, tip, dt) {
  const { net, sim } = state;
  const raid = tip.raid;
  raid.s += B.rivalRaidSpeed * dt;
  for (;;) {
    const e = net.edges[raid.edge];
    if (!e.alive) return 'gone';
    const from = net.nodes[raid.at];
    const to = net.nodes[e.a];
    const len = e.len > 0 ? e.len : 1;
    const o = rival.over.find((q) => q.edge === e.id);
    if (raid.s < len) {
      tip.x = from.x + (to.x - from.x) * (raid.s / len);
      tip.y = from.y + (to.y - from.y) * (raid.s / len);
      if (o) o.cover = raid.s / len;
      return null;
    }
    // arrived at the parent end: the next edge towards the spore, if it may be overgrown
    raid.s -= len;
    if (o) o.cover = 1;
    tip.x = to.x;
    tip.y = to.y;
    const ni = sim.parentEdge[to.id];
    if (ni < 0 || to.dist < B.biteImmuneDist) return 'spore';
    const next = net.edges[ni];
    if (!next.alive) return 'gone';
    if (next.w >= B.rivalBlockW) return 'cord';
    if (inBarrier(state, to.x, to.y) || inBarrier(state, net.nodes[next.a].x, net.nodes[next.a].y)) return 'barrier';
    if (raid.n >= B.rivalRaidReach) return 'reach';
    if (overgrown(rival, ni)) return 'gone'; // black lies there already
    overgrow(state, rival, next);
    raid.n++;
    raid.edge = ni;
    raid.at = to.id;
  }
}

/** Overgrown hyphae wither; one a barrier covers is healed, one that has withered through is cut (the branch beyond it dies). */
function stepOver(state, rival, dt) {
  const { net, barriers } = state;
  for (let i = rival.over.length - 1; i >= 0; i--) {
    const o = rival.over[i];
    const e = net.edges[o.edge];
    if (!e.alive) {
      rival.over.splice(i, 1);
      continue;
    }
    const a = net.nodes[e.a];
    const b = net.nodes[e.b];
    if (barriers.some((br) => segDist2(br.x, br.y, a.x, a.y, b.x, b.y) <= br.r * br.r)) {
      rival.over.splice(i, 1); // the barrier dissolves the rhizomorph that grew over the hypha
      rival.stats.raidHealed++;
      continue;
    }
    o.wither = Math.min(1, o.wither + dt / B.rivalRaidWither);
    if (o.wither < 1) continue;
    rival.over.splice(i, 1);
    rival.stats.raidCut++;
    cutEdge(state, e.id, null, 'rival');
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
      if (rival.tips[i].raid) endRaid(state, rival, rival.tips[i], 'barrier');
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

/** The wake keeps clear of the news around it: a breather after the page change, and not in the first seconds of a season. */
function breather(state, rival) {
  if (rival.dormant) return true; // it slept through the late autumn and the winter: spring is its time, at once
  if ((state.chapter ?? 1) >= 2 && rival.wait < B.rivalWakeBreather) return false;
  return !(state.flags.seasons && state.clock && state.clock.seasonFrac < B.rivalWakeSeasonEdge);
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
    else if ((rival.wait >= B.rivalWakeDelay || state.time >= B.rivalWakeBy) && breather(state, rival)) {
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
  stepOver(state, rival, dt);
  sweepTwigs(state, rival, dt);
  stepTips(state, rival, dt, f);
  spawnTips(state, rival, dt, f);
  releaseGrips(state, rival);
  stepInfection(state, rival, dt);
  stepClusters(state, rival, dt);
}

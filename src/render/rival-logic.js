// Pure helpers of the honey-fungus rival's look (no canvas, no DOM, no state mutation): how an infection thins a crown,
// how a withering edge fades, the cache key of the static rhizomorph drawing, barrier and cluster timing. rival.js,
// trees.js and sprites.js use them; tests/render-rival.test.mjs covers them. Fields follow docs/ARCHITECTURE.md
// §«Rival: honey fungus»; a missing field always reads as 0 / false / empty.

export const GROW_TIME = 0.8; // s a new rhizomorph edge takes to grow in, from its `born` (state.time)
export const INF_BUCKETS = 4; // infection 0..1 -> bucket 0..4 (a crown sprite is painted per bucket)
export const MAX_CAPS = 7; // honey caps in one tuft at a trunk base
export const BARRIER_DRAW = 0.9; // s the chalk ring takes to be drawn on
export const BARRIER_FADE = 0.3; // share of the barrier's life spent fading out at the end

export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (u) => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Share 0..1 of an edge that has grown in `time - born` seconds (an unknown time or `born` reads as fully grown). */
export function growFrac(time, born, dur = GROW_TIME) {
  if (!Number.isFinite(time) || !Number.isFinite(born)) return 1;
  return clamp((time - born) / dur, 0, 1);
}

/** Opacity of a withering edge: 1 at wither 0, 0 at wither 1; it drops quickly at first, then crumbles away. */
export function witherAlpha(w) {
  const k = clamp(num(w), 0, 1);
  return Math.pow(1 - k, 1.35);
}

/** An infection value as a whole bucket 0..INF_BUCKETS (0 only for a healthy tree). */
export function infBucket(inf) {
  const v = clamp(num(inf), 0, 1);
  if (v < 0.04) return 0;
  return clamp(Math.round(v * INF_BUCKETS), 1, INF_BUCKETS);
}

/**
 * Crown vitality 0..1 of a tree with health vitality `v` (the crown painter's input) and an infection bucket: the
 * crown thins and its leaves turn sallow through the painter's own «sick» palette. A healthy tree is unchanged.
 */
export function infectedVitality(v, bucket) {
  const b = clamp(Math.round(num(bucket)), 0, INF_BUCKETS);
  if (b === 0) return v;
  const inf = b / INF_BUCKETS;
  return Math.max(0.06, v * (1 - 0.86 * inf * (0.7 + 0.3 * inf)));
}

/** Extra sallow-yellow wash 0..1 laid over an infected crown (0 for a healthy one). */
export function sallowAmount(bucket) {
  const b = clamp(Math.round(num(bucket)), 0, INF_BUCKETS);
  return b === 0 ? 0 : 0.14 + 0.36 * (b / INF_BUCKETS);
}

/** Crown parameters of an infection value, for tests and the gallery legend. */
export function infectionLook(inf) {
  const bucket = infBucket(inf);
  return { bucket, vitality: infectedVitality(1, bucket), sallow: sallowAmount(bucket) };
}

export const isLost = (tree) => !!(tree && tree.lost);
export const mantleOf = (tree) => clamp(num(tree && tree.mantle), 0, 1);

/** Whether a rival exists to draw (an awake or sleeping `state.rival` object). */
export const hasRival = (state) => !!(state && state.rival && typeof state.rival === 'object');

/** Stumps to draw: only with a rival in the state (old saves and ?rival=0 have none); bad rows are dropped. */
export function stumpsOf(state) {
  const list = state && state.world && state.world.stumps;
  if (!hasRival(state) || !Array.isArray(list)) return [];
  return list.filter((s) => s && Number.isFinite(s.x) && Number.isFinite(s.y));
}

/** The rival's arrays with bad rows dropped; every field may be missing. */
export function rivalParts(state) {
  const r = hasRival(state) ? state.rival : null;
  const arr = (a) => (Array.isArray(a) ? a : []);
  return r ? { nodes: arr(r.nodes), edges: arr(r.edges), tips: arr(r.tips), grip: arr(r.grip), clusters: arr(r.clusters) } : { nodes: [], edges: [], tips: [], grip: [], clusters: [] };
}

/** The camera and canvas part of the cache key: the cached rhizomorph canvas is cleared when it changes. */
export function cameraKey(view, canvasW = 0, canvasH = 0) {
  const v = view || {};
  const f = (x, d) => num(x).toFixed(d);
  return `${canvasW}x${canvasH}|${f(v.scale, 4)}|${f(v.ox, 1)}|${f(v.oy, 1)}`;
}

/**
 * Stamp of the whole rhizomorph picture: `ver` (the sim bumps it when nodes or edges are added or an edge dies) plus the
 * camera and canvas. A new stamp means the picture changed; a new cameraKey means the cached canvas must be cleared.
 * `wither` changes do not bump ver: the renderer erases withering edges from the cache by itself.
 */
export function rivalCacheKey(rival, view, canvasW = 0, canvasH = 0) {
  const ver = rival && Number.isFinite(rival.ver) ? rival.ver : `n${rival && Array.isArray(rival.edges) ? rival.edges.length : 0}`;
  return `${ver}|${cameraKey(view, canvasW, canvasH)}`;
}

/** Barrier timing: how much of the chalk ring is drawn on (0..1) and its opacity (1 until the last share of its life). */
export function barrierLook(b) {
  const t = Math.max(0, num(b && b.t));
  const dur = Math.max(0.001, num(b && b.dur, 1));
  const draw = smooth(t / BARRIER_DRAW);
  const left = (dur - t) / (dur * BARRIER_FADE);
  const alpha = clamp(left, 0, 1);
  return { draw, alpha: alpha * alpha * (3 - 2 * alpha), done: t >= dur };
}

/** A honey-mushroom cluster: caps shown (1..MAX_CAPS) and growth 0..1 of the tuft from its age in seconds. */
export function clusterLook(c) {
  const n = clamp(Math.round(num(c && c.n, 1)), 1, MAX_CAPS);
  return { n, grow: smooth(num(c && c.age) / 14) };
}

/** Manifest group and type of the rival's illustrations (ids decor.stump.N, mushroom.honey.N). */
export const RIVAL_SPRITES = { stump: ['decor', 'stump'], honey: ['mushroom', 'honey'] };

/* ------------------------------------------------------------------ smooth chains (Chaikin) */

/**
 * Chaikin corner cutting of a polyline: every round replaces each corner by two points at 1/4 and 3/4 of its two edges, the
 * ends stay put. Its limit is the quadratic B-spline through the edge midpoints, which smoothEdges() draws exactly.
 */
export function chaikin(pts, iterations = 2) {
  let cur = pts.map((p) => ({ x: p.x, y: p.y }));
  for (let it = 0; it < iterations && cur.length > 2; it++) {
    const out = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

const PAIR_MAX_DOT = 0.35; // a fork joins its parent edge with the straightest child only when that child is no sharper than this
export const BACK_COS = -0.17; // a chain node whose two edges turn by more than ~100 degrees (cos below this) is a hairpin: out and back
export const STEP_COS = 0.26; // ... and by more than ~75 degrees is a stair step when one of its edges is short (STEP_LEN): a zig-zag
export const STEP_LEN = 26; // u: the shorter edge of a stair step (real edges are 14..25 u long; a long right-angle bend is a bend)
const BACK_PASSES = 16; // rounds of pulling back-tracking nodes onto their neighbours' midpoint

/**
 * The positions the chains are drawn through. A tip that is sent another way leaves a hairpin in its chain (out, turn, back
 * along itself: the zig-zag "Ч" loops, or stairs of right angles), which no corner cutting can hide. So every node with exactly
 * two alive edges whose turn is sharper than ~100 degrees (~75 with a short edge) is pulled to the midpoint of its two neighbours, round after round, until the chain only bends
 * gently: the out-and-back detour collapses onto the chord between the stretches that stay. Ends, tips, forks and `pinned` nodes
 * (a gripped root point) never move, and only the drawn point moves: the sim's nodes are not touched.
 * `at` is Map(node id -> alive edges there). Returns Map(node id -> { id, x, y }) of the nodes that moved.
 */
export function relaxChains(byId, at, pinned) {
  const moved = new Map();
  const free = (id) => {
    const l = at.get(id);
    return l && l.length === 2 && !(pinned && pinned.has(id));
  };
  const seen = new Set();
  const other = (e, id) => (e.a === id ? e.b : e.a);
  for (const [start, list] of at) {
    if (free(start)) continue;
    for (const first of list) {
      if (seen.has(first)) continue;
      const ids = [start];
      let prev = start;
      let e = first;
      for (;;) {
        seen.add(e);
        const id = other(e, prev);
        ids.push(id);
        if (!free(id)) break;
        const next = at.get(id).find((q) => q !== e);
        if (seen.has(next)) break;
        prev = id;
        e = next;
      }
      if (ids.length < 3) continue;
      const P = ids.map((id) => ({ x: byId.get(id).x, y: byId.get(id).y }));
      for (let pass = 0; pass < BACK_PASSES; pass++) {
        let again = false;
        for (let i = 1; i < P.length - 1; i++) {
          const a = P[i - 1];
          const b = P[i];
          const c = P[i + 1];
          const ux = b.x - a.x;
          const uy = b.y - a.y;
          const vx = c.x - b.x;
          const vy = c.y - b.y;
          const lu = Math.hypot(ux, uy);
          const lv = Math.hypot(vx, vy);
          if (lu < 1e-6 || lv < 1e-6) continue;
          const cos = (ux * vx + uy * vy) / (lu * lv);
          if (cos >= BACK_COS && (cos >= STEP_COS || Math.min(lu, lv) >= STEP_LEN)) continue;
          P[i] = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
          again = true;
        }
        if (!again) break;
      }
      for (let i = 1; i < P.length - 1; i++) {
        const n = byId.get(ids[i]);
        if (P[i].x !== n.x || P[i].y !== n.y) moved.set(ids[i], { id: n.id, x: P[i].x, y: P[i].y });
      }
    }
  }
  return moved;
}

/**
 * The drawn curve of every alive edge, as two quadratic pieces a -> m -> b: the chains of edges are Chaikin-smoothed, so a
 * path turns through a rounded bend instead of a corner (no box-like loops). A node with exactly two alive edges rounds its
 * corner; at a fork the parent edge is joined with the straightest child (the others leave sharply); ends and tips stay put.
 * Back-tracking nodes are first pulled onto their chord (relaxChains), so a chain never doubles back on itself.
 * `pinned` is an optional Set of node ids that must stay where they are. The result depends on whole chains, not on one edge.
 * Returns Map(edge id -> { x0, y0, c1x, c1y, mx, my, c2x, c2y, x1, y1, len }); edges whose nodes are missing are left out.
 */
export function smoothEdges(nodes, edges, pinned) {
  const byId = new Map();
  for (const n of nodes || []) if (n && Number.isFinite(n.x + n.y)) byId.set(n.id, n);
  const at = new Map();
  const alive = [];
  for (const e of edges || []) {
    if (!e || e.alive === false || !byId.has(e.a) || !byId.has(e.b) || e.a === e.b) continue;
    alive.push(e);
    for (const id of [e.a, e.b]) {
      const l = at.get(id);
      if (l) l.push(e);
      else at.set(id, [e]);
    }
  }
  for (const [id, n] of relaxChains(byId, at, pinned)) byId.set(id, n);
  const far = (e, id) => byId.get(e.a === id ? e.b : e.a);
  const unit = (n, o) => {
    const dx = o.x - n.x;
    const dy = o.y - n.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d };
  };
  const partner = new Map(); // `${node}|${edge}` -> the edge it is joined with at that node
  const join = (id, e1, e2) => {
    partner.set(`${id}|${e1.id}`, e2);
    partner.set(`${id}|${e2.id}`, e1);
  };
  for (const [id, list] of at) {
    if (list.length < 2) continue;
    const n = byId.get(id);
    if (list.length === 2) {
      join(id, list[0], list[1]);
      continue;
    }
    const parent = list.find((e) => e.b === id);
    if (!parent) continue;
    const dp = unit(n, far(parent, id));
    let best = null;
    let bestDot = PAIR_MAX_DOT;
    for (const e of list) {
      if (e === parent || e.a !== id) continue;
      const d = unit(n, far(e, id));
      const dot = d.x * dp.x + d.y * dp.y;
      if (dot < bestDot) {
        bestDot = dot;
        best = e;
      }
    }
    if (best) join(id, parent, best);
  }
  /** Where the path passes node `id` on edge `e`: the apex of the rounded corner, or the node itself. */
  const apex = (e, id, here, other) => {
    const pe = partner.get(`${id}|${e.id}`);
    const m = { x: (here.x + other.x) / 2, y: (here.y + other.y) / 2 };
    if (!pe) return { x: here.x, y: here.y, m };
    const p = far(pe, id);
    const pm = { x: (here.x + p.x) / 2, y: (here.y + p.y) / 2 };
    return { x: (pm.x + 2 * here.x + m.x) / 4, y: (pm.y + 2 * here.y + m.y) / 4, m };
  };
  const out = new Map();
  for (const e of alive) {
    const A = byId.get(e.a);
    const B = byId.get(e.b);
    const pa = apex(e, e.a, A, B);
    const pb = apex(e, e.b, B, A);
    const m = pa.m;
    out.set(e.id, {
      x0: pa.x,
      y0: pa.y,
      c1x: (A.x + m.x) / 2,
      c1y: (A.y + m.y) / 2,
      mx: m.x,
      my: m.y,
      c2x: (m.x + B.x) / 2,
      c2y: (m.y + B.y) / 2,
      x1: pb.x,
      y1: pb.y,
      len: Math.hypot(B.x - A.x, B.y - A.y),
    });
  }
  return out;
}

/** The point at k (0..1) along a smoothEdges() curve (its two quadratic pieces take 0..0.5 and 0.5..1). */
export function curveAt(s, k) {
  const kk = clamp(k, 0, 1);
  const first = kk < 0.5;
  const u = first ? kk * 2 : kk * 2 - 1;
  const [p0x, p0y, cx, cy, p2x, p2y] = first ? [s.x0, s.y0, s.c1x, s.c1y, s.mx, s.my] : [s.mx, s.my, s.c2x, s.c2y, s.x1, s.y1];
  const v = 1 - u;
  return { x: v * v * p0x + 2 * v * u * cx + u * u * p2x, y: v * v * p0y + 2 * v * u * cy + u * u * p2y };
}

/* ------------------------------------------------------------------ heading of a tip */

export const HEAD_NEAR = 150; // u: a tip this close to its target root point shows where it is heading

/**
 * The root tip a rhizomorph at a tip is heading for: the same choice as the sim (not held yet, linked ones first, then the
 * nearest, shallow preferred). `tip.target.x/y` win when the sim publishes them. { x, y, d } or null.
 */
export function rootGoal(tip, tree, opts = {}) {
  if (!tip || !tree || tree.lost || !Number.isFinite(tip.x + tip.y)) return null;
  const t = tip.target;
  if (t && Number.isFinite(t.x) && Number.isFinite(t.y)) return { x: t.x, y: t.y, d: Math.hypot(t.x - tip.x, t.y - tip.y) };
  const rows = Array.isArray(tree.tips) ? tree.tips : [];
  const grips = Array.isArray(opts.grips) ? opts.grips : [];
  const claimed = opts.claimed && typeof opts.claimed.has === 'function' ? opts.claimed : null;
  let best = null;
  let bestScore = Infinity;
  let bestLinked = false;
  for (let i = 0; i < rows.length; i++) {
    const tp = rows[i];
    if (!tp || !Number.isFinite(tp.x + tp.y) || num(tp.minStage) > num(tree.stage)) continue;
    if (grips.some((g) => g && g.treeId === tree.id && g.tip === i)) continue;
    const linked = !!(claimed && claimed.has(`${tree.id}:${i}`));
    if (bestLinked && !linked) continue;
    const d = Math.hypot(tp.x - tip.x, tp.y - tip.y);
    const score = d + 0.35 * Math.max(0, tp.y - num(tree.baseY, tp.y));
    if (score < bestScore || (linked && !bestLinked)) {
      bestScore = score;
      bestLinked = linked;
      best = { x: tp.x, y: tp.y, d };
    }
  }
  return best;
}

/** Opacity 0..1 of the dashed heading path for a tip `d` units from its goal: it fades in over the last 50 u before HEAD_NEAR. */
export function headingAlpha(d) {
  if (!Number.isFinite(d) || d >= HEAD_NEAR) return 0;
  return smooth((HEAD_NEAR - d) / 50);
}

/** Slow pulse 0..1 of a tip's bulb (period about 3.4 s, a phase per tip); constant 0.5 when motion is reduced. */
export function tipPulse(t, id, reduced = false) {
  return reduced ? 0.5 : 0.5 + 0.5 * Math.sin(num(t) * 1.85 + num(id) * 1.7);
}

/* ------------------------------------------------------------------ honey tufts and the rot ring */

/**
 * The caps (or `count` clumps) of one honey cluster spread around the trunk foot over a band of half width `spread`: offsets (u)
 * from the cluster point, scale, lean and mirroring.
 * Spread over a flat band (wider than deep), a back row smaller and higher, never stacked in one column. Deterministic per
 * cluster id through `hashFn(a, b) -> uint` (core/rng hash32).
 */
export function tuftLayout(c, hashFn, count = 0, spread = 0) {
  const n = count > 0 ? Math.round(count) : clusterLook(c).n;
  const h = (i, k) => (hashFn(num(c && c.id), i * 11 + k) % 1000) / 1000;
  const caps = [];
  const half = spread > 0 ? spread : 12 + n * 4.5; // half width of the band
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5 + (h(i, 1) - 0.5) * 0.6) / n - 0.5; // -0.5..0.5 along the band
    const row = h(i, 3) < 0.38 ? 1 : 0; // 1 = a second row behind (smaller, a little higher)
    caps.push({
      dx: u * 2 * half,
      dy: row ? -(3 + 3 * h(i, 4)) : 1.5 * h(i, 4),
      scale: (row ? 0.7 : 0.9) * (0.82 + 0.36 * h(i, 5)),
      flip: h(i, 6) < 0.5,
      lean: (h(i, 8) - 0.5) * 0.3 + u * 0.35,
      row,
    });
  }
  caps.sort((a, b) => (a.row !== b.row ? b.row - a.row : a.dx - b.dx)); // the back row first
  return caps;
}

/** The label of an infection mark at the trunk foot: «40 %», rounded to 5, never 0 or 100 while a tree is held. */
export function infectionLabel(inf) {
  const p = Math.round(clamp(num(inf), 0, 1) * 20) * 5;
  return `${clamp(p, 5, 95)} %`;
}

/** Strength 0..1 of the rot ring at a gripped trunk foot: it grows with the grip's age, a little with infection. */
export function ringStrength(age, inf) {
  return clamp(smooth(num(age) / 6) * (0.55 + 0.45 * clamp(num(inf), 0, 1)) + 0.1, 0, 1);
}

/* ------------------------------------------------------------------ the raider and the frozen threads */

export const OVER_W = 5.4; // u: the black cord on a hypha (the rhizomorph itself is 7, the hypha core 1.75 – 4)
export const FREEZE_DRAW = 1.6; // s the frost takes to settle over a new barrier's threads

/**
 * The overgrown stretches of the player's hyphae that can be drawn: state.rival.over entries whose edge still lives in state.net
 * (bad rows, dead edges and missing nodes are skipped). Each row is { o, e, A, B } (the entry, the edge, its parent and child).
 */
export function overList(state) {
  const r = hasRival(state) ? state.rival : null;
  const net = state && state.net;
  if (!r || !Array.isArray(r.over) || !r.over.length || !net || !Array.isArray(net.edges) || !Array.isArray(net.nodes)) return [];
  const out = [];
  for (const o of r.over) {
    if (!o || !Number.isInteger(o.edge) || o.edge < 0) continue;
    const e = net.edges[o.edge];
    if (!e || e.alive === false) continue;
    const A = net.nodes[e.a];
    const B = net.nodes[e.b];
    if (!A || !B || !Number.isFinite(A.x + A.y + B.x + B.y) || A === B) continue;
    out.push({ o, e, A, B });
  }
  return out;
}

/**
 * The curve of a player's hypha the way mycelium.js shapes it (one quadratic from parent to child, tangent-continuous with the
 * parent edge) without the fine meander: { x0, y0, qx, qy, x1, y1, len, parentId, childId } from the parent end to the child end.
 * `noise` (ink.js noise1) adds the same sideways bow; leave it out for a plain curve.
 */
export function hyphaCurve(nodes, e, noise = null) {
  const A = nodes[e.a];
  const B = nodes[e.b];
  let from = A;
  let to = B;
  if (B.parent !== e.a && A.parent === e.b) {
    from = B;
    to = A;
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let tx = ux;
  let ty = uy;
  const par = from.parent;
  const pn = Number.isInteger(par) && par >= 0 && par !== to.id ? nodes[par] : null;
  if (pn) {
    let ix = from.x - pn.x;
    let iy = from.y - pn.y;
    const il = Math.hypot(ix, iy) || 1;
    ix /= il;
    iy /= il;
    if (ix * ux + iy * uy > 0.15) {
      tx = ix + ux;
      ty = iy + uy;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
    }
  }
  const wob = noise ? noise(num(e.id) * 0.73 + 3) * 0.1 * len : 0;
  const flip = from !== A; // the child end is e.a only for a curve stored the other way round
  return { x0: from.x, y0: from.y, qx: from.x + tx * len * 0.5 - uy * wob, qy: from.y + ty * len * 0.5 + ux * wob, x1: to.x, y1: to.y, len, parentId: flip ? e.b : e.a, childId: flip ? e.a : e.b };
}

/**
 * Points [x0, y0, x1, y1, ...] along `curve` from the end named by `fromId` (the entry's `from`: the child end is where a raider
 * running towards the spore enters; an id that is neither end reads as the child end) for the share `cover` 0..1 of its length;
 * about one point per `step` units.
 */
export function overPoints(curve, fromId, cover, step = 5) {
  const fromChild = fromId !== curve.parentId;
  const k = clamp(num(cover), 0, 1);
  const n = Math.max(2, Math.ceil((curve.len * k) / step));
  const out = new Array((n + 1) * 2);
  for (let i = 0; i <= n; i++) {
    const u = (k * i) / n;
    const s = fromChild ? 1 - u : u;
    const v = 1 - s;
    out[i * 2] = v * v * curve.x0 + 2 * s * v * curve.qx + s * s * curve.x1;
    out[i * 2 + 1] = v * v * curve.y0 + 2 * s * v * curve.qy + s * s * curve.y1;
  }
  return out;
}

/** The point at share k 0..1 along a flat point list ([x, y, ...]) by index (the points are evenly spaced). */
export function pointAlong(pts, k) {
  const n = pts.length / 2 - 1;
  if (n < 1) return { x: pts[0], y: pts[1] };
  const f = clamp(num(k), 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const u = f - i;
  return { x: pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * u, y: pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * u };
}

/**
 * The look of one overgrown stretch from its `cover` and `wither` (0 at the touch, 1 when it is cut 8 s later): the black glossy
 * cord shrinks, greys and frays as wither rises. width is in units; every *Alpha is 0..1; `ash` mixes the body to ash grey;
 * `gap` is the share of the cord broken into dashes; `crumbs` how many specks fall off it.
 */
export function overLook(o) {
  const cover = clamp(num(o && o.cover), 0, 1);
  const w = clamp(num(o && o.wither), 0, 1);
  return {
    cover,
    wither: w,
    width: OVER_W * (1 - 0.34 * smooth(w)),
    ash: smooth(w * 1.15),
    bodyAlpha: 1 - 0.5 * smooth((w - 0.3) / 0.7),
    rimAlpha: 1 - smooth(w / 0.7),
    glossAlpha: 1 - smooth(w / 0.55),
    shineAlpha: 1 - smooth(w / 0.35),
    gap: w < 0.45 ? 0 : (w - 0.45) / 0.55,
    crumbs: smooth(w),
  };
}

/** 'seek' | 'run' for a rhizomorph tip that is a raider (tip.raid), else null. */
export function raidPhase(tip) {
  const r = tip && tip.raid;
  if (!r || typeof r !== 'object') return null;
  return r.phase === 'run' ? 'run' : 'seek';
}

/** Where a seeking raider is heading (tip.raid.goal on the player's hypha): { x, y, d } or null. */
export function raidGoal(tip) {
  const g = tip && tip.raid && tip.raid.goal;
  if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y) || !Number.isFinite(num(tip.x, NaN) + num(tip.y, NaN))) return null;
  return { x: g.x, y: g.y, d: Math.hypot(g.x - tip.x, g.y - tip.y) };
}

/**
 * How strongly the frost lies on the threads inside a standing barrier, 0..1: it settles over FREEZE_DRAW seconds and goes
 * together with the ring in the barrier's last seconds. 0 for a missing or finished barrier.
 */
export function freezeLook(b) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return 0;
  return clamp(smooth(Math.max(0, num(b.t)) / FREEZE_DRAW) * barrierLook(b).alpha, 0, 1);
}

/* ------------------------------------------------------------------ the overgrown thread: a pale hypha in a black spiral */

export const SPIRAL_PITCH = [8, 4.2]; // u between two wraps: loose at the touch, tight when the cut comes
export const SPIRAL_MAX = 96; // wraps of one edge, at most
export const SPIRAL_BAND = 2.4; // u: the black ribbon of one wrap
export const HONEY = '#e6a844'; // the amber of the honey tint and of the raider's lead

const lerp = (a, b, k) => a + (b - a) * k;
/** A repeatable 0..1 value for (a, b), no allocation. */
const unit = (a, b) => {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

/**
 * The look of one overgrown hypha: overLook (the greying, the fraying, the specks) plus what the spiral needs. `pitch` is the
 * distance between two wraps in u (it tightens as the thread is strangled: SPIRAL_PITCH[0] at the touch, [1] at the cut),
 * `halo` 0..1 the honey tint round the thread (it dies with the thread), `dim` 0..1 how much the pale core is darkened,
 * `skip` 0..1 the share of wraps that have come undone (a dying spiral frays), `band` the ribbon width in u.
 */
export function spiralLook(o) {
  const look = overLook(o);
  const w = look.wither;
  return {
    ...look,
    pitch: lerp(SPIRAL_PITCH[0], SPIRAL_PITCH[1], smooth(w)),
    halo: 1 - 0.78 * smooth(w),
    dim: 0.62 * smooth((w - 0.15) / 0.85),
    skip: 0.7 * look.gap,
    band: SPIRAL_BAND * (1 - 0.25 * smooth(w)),
  };
}

/**
 * The player's hypha as a polyline the way mycelium.js shapes it (the same quadratic and the same fine meander, so the pale
 * core drawn there lies under this line; keep the two in step): { pts: [x, y, ...] from the parent end to the child end, cum:
 * arc length at every point, n: segments, len: total arc length, parentId }. `curve` comes from hyphaCurve, `id` is the edge id,
 * `noise` is ink.js noise1 (leave it out for a plain quadratic).
 */
export function threadPoints(curve, id, noise = null) {
  const L = curve.len || 1;
  const ux = (curve.x1 - curve.x0) / L;
  const uy = (curve.y1 - curve.y0) / L;
  const n = Math.max(2, Math.ceil(L / 4));
  const amp = Math.min(2.4, L * 0.07);
  const so = num(id) * 3.17 + 11;
  const pts = new Float32Array((n + 1) * 2);
  const cum = new Float32Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const v = 1 - u;
    const off = noise ? amp * Math.sin(Math.PI * u) * (0.7 * noise(so + u * L * 0.09) + 0.3 * noise(so + 40 + u * L * 0.31)) : 0;
    pts[k * 2] = v * v * curve.x0 + 2 * u * v * curve.qx + u * u * curve.x1 - uy * off;
    pts[k * 2 + 1] = v * v * curve.y0 + 2 * u * v * curve.qy + u * u * curve.y1 + ux * off;
    if (k) cum[k] = cum[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
  }
  return { pts, cum, n, len: cum[n], parentId: curve.parentId };
}

/** The point, and the unit tangent (parent to child), at arc length `s` of a thread: writes { x, y, tx, ty } into `out`. */
export function threadAt(th, s, out) {
  const { pts, cum, n } = th;
  const ss = clamp(num(s), 0, th.len);
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= ss) lo = mid;
    else hi = mid - 1;
  }
  const seg = cum[lo + 1] - cum[lo];
  const dx = pts[lo * 2 + 2] - pts[lo * 2];
  const dy = pts[lo * 2 + 3] - pts[lo * 2 + 1];
  const l = Math.hypot(dx, dy) || 1;
  const u = seg > 1e-6 ? (ss - cum[lo]) / seg : 0;
  out.x = pts[lo * 2] + dx * u;
  out.y = pts[lo * 2 + 1] + dy * u;
  out.tx = dx / l;
  out.ty = dy / l;
  return out;
}

const sEnd = {};

/**
 * The covered stretch of a thread as points [x, y, ...] written into `out` (a Float32Array), from the end the raider entered at
 * (`fromChild`) as far as the share `cover` 0..1 of its arc length. Returns how many numbers were written (at least 4).
 */
export function threadSlice(out, th, fromChild, cover) {
  const reach = clamp(num(cover), 0, 1) * th.len;
  const { pts, cum, n } = th;
  const cap = Math.floor(out.length / 2) * 2;
  let c = 0;
  const put = (x, y) => {
    if (c + 2 <= cap) {
      out[c++] = x;
      out[c++] = y;
    }
  };
  if (!fromChild) {
    put(pts[0], pts[1]);
    for (let k = 1; k <= n && cum[k] < reach; k++) put(pts[k * 2], pts[k * 2 + 1]);
    threadAt(th, reach, sEnd);
  } else {
    put(pts[n * 2], pts[n * 2 + 1]);
    for (let k = n - 1; k >= 0 && th.len - cum[k] < reach; k--) put(pts[k * 2], pts[k * 2 + 1]);
    threadAt(th, th.len - reach, sEnd);
  }
  put(sEnd.x, sEnd.y);
  return c;
}

const sP = {};
const sQ = {};
const sM = {};

/**
 * The wraps of the black spiral round a thread: for every one a slightly bowed band across the thread, written as
 * quadratics [x0, y0, cx, cy, x1, y1] into `out` (a Float32Array, 6 numbers a wrap). The wraps are spaced `pitch` apart from
 * the end the raider entered at (`fromChild`), as far as the share `cover` of the arc, each band `half` u to either side of the
 * thread and leaning `0.9 * pitch` along it; the same hand whichever end it entered from. `skip` 0..1 drops that share of the
 * wraps (a dying spiral comes undone); `seed` makes the jitter of the spacing. Returns the number of wraps.
 */
export function spiralBands(out, th, fromChild, cover, pitch, half, seed = 0, skip = 0) {
  const p = Math.max(1.5, num(pitch, SPIRAL_PITCH[0]));
  const reach = clamp(num(cover), 0, 1) * th.len;
  const lean = p * 0.9;
  const lo = fromChild ? th.len - reach : 0;
  const hi = fromChild ? th.len : reach;
  const room = Math.floor(out.length / 6);
  let c = 0;
  for (let k = 0; c < SPIRAL_MAX && c < room; k++) {
    const d = (k + 0.5 + 0.2 * (unit(seed, k) - 0.5)) * p;
    if (d > reach) break;
    if (skip > 0 && unit(seed + 7, k) < skip) continue;
    const mid = fromChild ? th.len - d : d;
    threadAt(th, clamp(mid - lean / 2, lo, hi), sP);
    threadAt(th, clamp(mid + lean / 2, lo, hi), sQ);
    threadAt(th, mid, sM);
    const nx = -sM.ty;
    const ny = sM.tx;
    const x0 = sP.x + nx * half;
    const y0 = sP.y + ny * half;
    const x1 = sQ.x - nx * half;
    const y1 = sQ.y - ny * half;
    const bow = lean * 0.14;
    out[c * 6] = x0;
    out[c * 6 + 1] = y0;
    out[c * 6 + 2] = (x0 + x1) / 2 + sM.tx * bow;
    out[c * 6 + 3] = (y0 + y1) / 2 + sM.ty * bow;
    out[c * 6 + 4] = x1;
    out[c * 6 + 5] = y1;
    c++;
  }
  return c;
}

/* ------------------------------------------------------------------ the raider's lead: where it will go */

export const RAID_LEAD = 12; // s a new raider stands before it creeps (B.rivalRaidLead): the warning
export const LEAD_IN = 1.3; // s the arrow takes to fade in
export const LEAD_OUT = 2.6; // s it takes to fade out before the raider sets off
export const LEAD_LEN = 130; // u: the longest arrow
export const LEAD_DASH = 9; // u: one dash
export const LEAD_GAP = 6.5; // u: between two dashes
export const LEAD_DROP = 7; // u: the size of the honey drop at the tip
export const LEAD_MAX_DASHES = 12;

/** Opacity 0..1 of the raider's arrow at `age` seconds after it appeared: in over LEAD_IN, out over the last LEAD_OUT of `lead`. */
export function leadAlpha(age, lead = RAID_LEAD) {
  if (!Number.isFinite(age) || age < 0) return 0;
  return smooth(age / LEAD_IN) * (1 - smooth((age - (lead - LEAD_OUT)) / LEAD_OUT));
}

/**
 * The arrow of a seeking raider, or null when none is to be drawn: written into `out` as { x0, y0 (where the dashes start),
 * x1, y1 (the tip, where the honey drop sits), ux, uy (unit heading), len, alpha }. It points at the hypha the raider
 * has chosen (tip.raid.goal) or, with no goal, along tip.dir; it is as long as LEAD_LEN, stops 16 u short of the goal, shows
 * during the warning (leadAlpha of tip.age) and, fainter, while the goal is near (headingAlpha), so a creeping raider keeps it.
 */
export function raidLead(tip, startR = 7, out = {}) {
  if (raidPhase(tip) !== 'seek' || !Number.isFinite(num(tip.x, NaN) + num(tip.y, NaN))) return null;
  const g = raidGoal(tip);
  let ux;
  let uy;
  let reach = LEAD_LEN;
  if (g && g.d > 1e-3) {
    ux = (g.x - tip.x) / g.d;
    uy = (g.y - tip.y) / g.d;
    reach = Math.min(LEAD_LEN, g.d - 16);
  } else if (Number.isFinite(tip.dir)) {
    ux = Math.cos(tip.dir);
    uy = Math.sin(tip.dir);
  } else return null;
  const alpha = Math.max(leadAlpha(tip.age), g ? 0.55 * headingAlpha(g.d) : 0);
  const s0 = startR + 4;
  if (alpha < 0.02 || reach - s0 < 20) return null;
  out.x0 = tip.x + ux * s0;
  out.y0 = tip.y + uy * s0;
  out.x1 = tip.x + ux * reach;
  out.y1 = tip.y + uy * reach;
  out.ux = ux;
  out.uy = uy;
  out.len = reach - s0;
  out.alpha = alpha;
  return out;
}

/**
 * The dashes of an arrow, marching towards its tip with `t` (still when `reduced`), written into `out` (a Float32Array) as
 * [x0, y0, x1, y1, width, alpha] a dash: thin and faint at the tail, thicker and stronger towards the drop, which they stop
 * short of. Returns how many dashes.
 */
export function leadDashes(out, lead, t, reduced = false) {
  const period = LEAD_DASH + LEAD_GAP;
  const end = lead.len - LEAD_DROP * 1.5;
  if (end < 4) return 0;
  const phase = reduced ? 0 : ((((num(t) * 8) % period) + period) % period);
  let c = 0;
  for (let i = -1; c < LEAD_MAX_DASHES && out.length >= (c + 1) * 6; i++) {
    const a0 = i * period + phase;
    if (a0 >= end) break;
    const s0 = Math.max(0, a0);
    const s1 = Math.min(end, a0 + LEAD_DASH);
    if (s1 - s0 < 1.2) continue;
    const f = clamp((s0 + s1) / 2 / end, 0, 1);
    out[c * 6] = lead.x0 + lead.ux * s0;
    out[c * 6 + 1] = lead.y0 + lead.uy * s0;
    out[c * 6 + 2] = lead.x0 + lead.ux * s1;
    out[c * 6 + 3] = lead.y0 + lead.uy * s1;
    out[c * 6 + 4] = 1.5 + 1.7 * f;
    out[c * 6 + 5] = 0.3 + 0.7 * f;
    c++;
  }
  return c;
}

/** Where the honey drop at the arrow's tip is drawn: the tip itself, bobbing along the heading by up to 1.4 u (still when `reduced`). { x, y, ang, size } */
export function leadDrop(lead, t, reduced = false, out = {}) {
  const bob = reduced ? 0 : 1.4 * Math.sin(num(t) * 2.4);
  out.x = lead.x1 + lead.ux * bob;
  out.y = lead.y1 + lead.uy * bob;
  out.ang = Math.atan2(lead.uy, lead.ux);
  out.size = LEAD_DROP;
  return out;
}

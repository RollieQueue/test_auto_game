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

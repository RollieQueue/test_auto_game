// Pure parameters of how the honey fungus changes a painted tree (a crown, a killed trunk: no canvas, no DOM, no state). trees-paint.js
// (infectionSteps) paints them, trees.js picks the bucket; tests/render-trees-rival.test.mjs covers them. The bucket is
// rival-logic.js's infBucket(): 0 = healthy (no wash, no holes: the crown is painted exactly as before) .. INF_BUCKETS.

import { INF_BUCKETS } from './rival-logic.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const MAX_WASH = 0.8; // the brown wash never covers the crown completely
export const MAX_COVER = 0.45; // share of the crown that may be erased

// one entry per bucket 0..4
const WASH = [0, 0.26, 0.38, 0.52, 0.66]; // alpha of the rust wash laid over the crown
const COVER = [0, 0.04, 0.1, 0.19, 0.31]; // share of the crown erased (gaps and speckles)
const BLOTCH = [0, 1, 2, 3, 5]; // dark rust patches: a dying sector of the crown
const BLOTCH_A = [0, 0.22, 0.3, 0.38, 0.46];
const DEAD = [0, 0.7, 1.5, 2.6, 3.8]; // dead brown leaves (needle streaks) per 1000 px² of crown
const BARE_DEAD = 0.5; // the share of those that cling to a bare winter crown

const LEAF_BROWN = '#7a4f26';
const SEASON_BROWN = { autumn: '#6a3d1c', spring: '#7a4f26', summer: '#7a4f26', winter: '#8c4a22' }; // winter: rust on the bare twigs
const PINE_BROWN = '#8a4f2a';

const bucketOf = (b) => clamp(Math.round(num(b)), 0, INF_BUCKETS);
const season = (s) => (s === 'spring' || s === 'autumn' || s === 'winter' ? s : 'summer');

/** An oak or a birch in winter has no leaves: only twigs. The infection rusts them, thins them out and leaves a few dead leaves clinging. */
export const isBareCrown = (species, s) => season(s) === 'winter' && species !== 'pine';

/** Alpha 0..MAX_WASH of the rust wash over the crown (0 for a healthy tree). */
export function washAmount(bucket, species, s) {
  const b = bucketOf(bucket);
  if (b === 0) return 0;
  const k = isBareCrown(species, s) ? 0.95 : species === 'pine' ? 1.15 : season(s) === 'autumn' ? 1.12 : 1;
  return Math.min(MAX_WASH, WASH[b] * k);
}

/** Colour of the wash: umber for leaves, rusty for needles. */
export function washColor(species, s) {
  if (species === 'pine') return PINE_BROWN;
  return SEASON_BROWN[season(s)] || LEAF_BROWN;
}

/** Share 0..MAX_COVER of the crown erased as gaps and speckles, so the branches show through. */
export function holeCover(bucket, species, s) {
  const b = bucketOf(bucket);
  if (b === 0) return 0;
  const k = isBareCrown(species, s) ? 0.9 : species === 'pine' ? 0.85 : 1;
  return Math.min(MAX_COVER, COVER[b] * k);
}

/** How many dark rust patches (a sector of the crown dying first). */
export function blotchCount(bucket, species, s) {
  const b = bucketOf(bucket);
  return isBareCrown(species, s) ? 0 : BLOTCH[b];
}

export const blotchAlpha = (bucket) => BLOTCH_A[bucketOf(bucket)];

/** Dead brown leaves (or rusty needle streaks) per 1000 px² of crown; on a bare winter crown only about half as many, hanging on in tufts. */
export function deadDensity(bucket, species, s) {
  const b = bucketOf(bucket);
  return isBareCrown(species, s) ? DEAD[b] * BARE_DEAD : DEAD[b];
}

/** Everything the painter needs for one bucket; `active` is false for a healthy crown (nothing is painted then). */
export function infectionLook(bucket, species, s) {
  const b = bucketOf(bucket);
  return {
    bucket: b,
    active: b > 0,
    bare: isBareCrown(species, s),
    wash: washAmount(b, species, s),
    color: washColor(species, s),
    cover: holeCover(b, species, s),
    blotches: blotchCount(b, species, s),
    blotchAlpha: blotchAlpha(b),
    dead: deadDensity(b, species, s),
  };
}

/* ------------------------------------------------------------------ snag: the broken trunk of a tree the fungus killed */

const lerp = (a, b, t) => a + (b - a) * t;

// the share of the living trunk's points a snag keeps: a birch or pine trunk is a tall mast, so it breaks at about
// half its height; an oak's trunk is a short stem under the crown, so it keeps nearly all of it (and its limb stubs)
const SNAG_KEEP = { birch: [0.38, 0.5], pine: [0.38, 0.5], oak: [0.82, 0.95] };

/** Share 0..1 of the trunk kept for species with `r` in 0..1 (the tree's own random number). */
export function snagKeep(species, r) {
  const k = SNAG_KEEP[species] || SNAG_KEEP.oak;
  return lerp(k[0], k[1], clamp(num(r), 0, 1));
}

/**
 * Widths of the first n points of a trunk with widths `w` and base width w0: thicker than the living stem and less
 * tapered (a broken trunk is a stump of the mast, not its thin top), the base unchanged so the foot sits as before.
 */
export function snagWidths(w, w0, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 0;
    const wi = num(w[Math.min(i, w.length - 1)], w0);
    out.push(Math.max(2.5, lerp(wi, w0, 0.6 * u) * (1.08 + 0.3 * u)));
  }
  return out;
}

/**
 * Heights in px of the k pale spires of a broken top of half-width hw: one tall splinter and the rest lower and
 * different from each other, so the break never looks like a saw blade. `rng` returns 0..1.
 */
export function snagSpires(hw, k, rng) {
  const base = clamp(hw * 0.95, 6, 22);
  const hts = [];
  for (let i = 0; i < k; i++) hts.push(base * (0.35 + 0.85 * rng()));
  const tall = Math.floor(rng() * k) % Math.max(1, k);
  hts[tall] = clamp(hw * (2.2 + 1.2 * rng()) + 10, 20, 60);
  return hts;
}

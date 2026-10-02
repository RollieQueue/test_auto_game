// Fruit bodies stand in clumps, not in a picket fence: each mushroom spot draws a few smaller caps beside the main one.
// Pure and DOM-free (unit-tested). The simulation places one mushroom per spot, at least B.fruitSpacing apart, which on
// the page reads as an evenly spaced row; the clump is drawn only, from a generator of its own keyed by the world seed
// and the mushroom's id (so it never moves between frames or reloads and the world's rng is never touched).
// The main cap stays exactly at the mushroom's x and baseY: hover, click, spores and the card box all anchor there.
import { createRng, hash32 } from '../core/rng.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** The most companions a spot may have (a clump of up to three caps with the main one). */
export const MAX_COMPANIONS = 2;

/**
 * The companions of one mushroom: [{ dx, dy, scale, lean, mirror, start, salt }], 0..2 of them.
 *  dx      offset from the main cap along the ground (world units; |dx| 15..46, about a cap's width)
 *  dy      a hair up or down from the ground line at the companion's own x (the caller adds the ground height there)
 *  scale   size relative to the main cap (about 0.45..0.85)
 *  lean    its own slant, leaning away from the main cap
 *  start   the main cap's growth at which this one pushes up; it then grows over the rest of the main one's growth
 *  salt    picks the illustration among those of its species
 */
export function clusterOf(seed, id) {
  const rng = createRng(hash32('mushroom-cluster', seed >>> 0, id === undefined ? 0 : id));
  const r = rng.next;
  const roll = r();
  const n = roll < 0.2 ? 0 : roll < 0.62 ? 1 : 2;
  const out = [];
  let side = r() < 0.5 ? -1 : 1;
  let reach = 0;
  for (let k = 0; k < n; k++) {
    // the second one usually stands on the other side; otherwise it sits further out on the same side
    if (k === 1) side = r() < 0.7 ? -side : side;
    const same = k === 1 && side === Math.sign(out[0].dx);
    reach = same ? Math.abs(out[0].dx) + lerp(10, 16, r()) : lerp(15, 30, r());
    out.push({
      dx: Math.round(side * reach * 10) / 10,
      dy: Math.round(lerp(-1, 2.5, r()) * 10) / 10,
      scale: Math.round(lerp(k === 0 ? 0.55 : 0.45, k === 0 ? 0.85 : 0.72, r()) * 100) / 100,
      lean: Math.round((side * lerp(0.04, 0.16, r()) + (r() - 0.5) * 0.04) * 1000) / 1000,
      mirror: r() < 0.5,
      start: Math.round(lerp(0.12, 0.34, r()) * 100) / 100 + 0.12 * k,
      salt: Math.floor(r() * 1e9),
    });
  }
  return out;
}

/** The companion's own growth 0..1 while the main cap is at `g`: nothing before `start`, then it catches up. */
export const companionGrowth = (g, c) => clamp((g - c.start) / (1 - c.start), 0, 1);

// How far a drawn cap reaches around its stalk base, world units (main cap: as the old hover box; companions scale it).
const CAP_HALF = 24;
const CAP_UP = 70;
const CAP_DOWN = 8;
const MIN_COMPANION_GROWTH = 0.03; // as in render/mushrooms.js: a companion below this is not drawn

/**
 * Every cap that stands on the page for mushroom `m`: [{ x, y, scale }], the main cap first, then the companions that
 * have pushed up by now. `world` gives the seed, `groundAt(world, x)` the ground height (query.js groundYAt); without either only the main cap is returned.
 */
export function clumpCaps(world, m, groundAt) {
  const caps = [{ x: m.x, y: m.baseY, scale: 1 }];
  if (!world || !groundAt) return caps;
  const seed = Number.isFinite(world.seed) ? world.seed : 0;
  const g = clamp(typeof m.growth === 'number' && Number.isFinite(m.growth) ? m.growth : 1, 0, 1);
  for (const c of clusterOf(seed, m.id)) {
    if (companionGrowth(g, c) < MIN_COMPANION_GROWTH) continue;
    const x = m.x + c.dx;
    caps.push({ x, y: groundAt(world, x) + c.dy, scale: c.scale });
  }
  return caps;
}

/** World box {l, r, t, b} around the whole clump of `m` (hover reach of every cap, widened to the outermost one). */
export function clumpBox(world, m, groundAt) {
  let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
  for (const c of clumpCaps(world, m, groundAt)) {
    l = Math.min(l, c.x - CAP_HALF * c.scale);
    r = Math.max(r, c.x + CAP_HALF * c.scale);
    t = Math.min(t, c.y - CAP_UP * c.scale);
    b = Math.max(b, c.y + CAP_DOWN * c.scale);
  }
  return { l, r, t, b };
}

/** Squared horizontal distance from the point to the nearest cap of the clump of `m` it lies over, or -1 when it lies over none. */
export function clumpHit(world, m, x, y, groundAt) {
  let best = -1;
  for (const c of clumpCaps(world, m, groundAt)) {
    if (Math.abs(x - c.x) > CAP_HALF * c.scale || y < c.y - CAP_UP * c.scale || y > c.y + CAP_DOWN * c.scale) continue;
    const d = (x - c.x) ** 2;
    if (best < 0 || d < best) best = d;
  }
  return best;
}

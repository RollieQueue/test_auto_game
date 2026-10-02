// Fruit bodies stand in groups, not in a picket fence: every mushroom has a look of its own (size, height, slant) and a
// few smaller caps beside the main one, more of them beside a trunk or a stump.
// Pure and DOM-free (unit-tested). The look and the clump are drawn from generators of their own keyed by the world seed
// and the mushroom's id (so nothing moves between frames or reloads and the world's rng is never touched); the only
// thing the simulation reads is the main cap's size (a big cap claims more ground, sim/mushrooms.js).
// The main cap stays exactly at the mushroom's x and baseY: hover, click, spores and the card box all anchor there.
import { createRng, hash32 } from '../core/rng.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** The most companions a spot may have (a clump of up to five caps with the main one; beside a trunk, otherwise at most three). */
export const MAX_COMPANIONS = 4;

/**
 * How one fruit body looks, stable per world and mushroom id (pure; the world's rng is never touched):
 * { size, tall, lean, mirror, phase }.
 *  size    0.62..1.42: mostly about 1, now and then a small one and a big one (a fence is every cap alike)
 *  tall    0.86..1.18: a stalk taller or squatter than its width says
 *  lean    its slant, about +-0.06, one in four noticeably more (up to +-0.16)
 *  mirror  which way the illustration faces
 *  phase   0..40, offsets the idle sway
 * The simulation reads `size` too: a big cap claims more ground (sim/mushrooms.js fruitClaim).
 */
export function lookOf(seed, id) {
  const s = seed >>> 0;
  let byId = LOOKS.get(s);
  if (!byId) {
    if (LOOKS.size > 16) LOOKS.clear();
    LOOKS.set(s, (byId = new Map()));
  }
  const key = id === undefined ? 0 : id;
  let look = byId.get(key);
  if (!look) {
    if (byId.size > 2000) byId.clear();
    byId.set(key, (look = makeLook(s, key)));
  }
  return look;
}
const LOOKS = new Map(); // seed -> id -> look: the sim asks on every hover and every bot thought, so each is rolled once (treat the result as read-only)

function makeLook(seed, id) {
  const r = createRng(hash32('mushroom-look', seed >>> 0, id === undefined ? 0 : id)).next;
  const roll = r();
  const size = roll < 0.2 ? lerp(0.62, 0.82, r()) : roll < 0.78 ? lerp(0.9, 1.12, r()) : lerp(1.2, 1.42, r());
  const tall = lerp(0.86, 1.18, r());
  const bent = r() < 0.25;
  const sign = r() < 0.5 ? -1 : 1;
  const lean = bent ? sign * lerp(0.09, 0.16, r()) : (r() - 0.5) * 0.12;
  return Object.freeze({
    size: Math.round(size * 100) / 100,
    tall: Math.round(tall * 100) / 100,
    lean: Math.round(lean * 1000) / 1000,
    mirror: r() < 0.5,
    phase: Math.round(r() * 400) / 10,
  });
}

/** 0..1: how close x stands to a trunk or a stump (1 within 40 units, 0 beyond 130): mushrooms gather there. */
export function trunkNear(world, x) {
  let d = Infinity;
  for (const t of (world && world.trees) || []) d = Math.min(d, Math.abs(t.x - x));
  for (const s of (world && world.stumps) || []) d = Math.min(d, Math.abs(s.x - x));
  return clamp(1 - (d - 40) / 90, 0, 1);
}

/**
 * The companions of one mushroom: [{ dx, dy, scale, tall, lean, mirror, start, salt }], 0..3 of them (0..4 beside a trunk, `near` 0..1).
 *  dx      offset from the main cap along the ground for a main cap of size 1 (world units; |dx| 15..46, about a cap's width); callers scale it by the main cap's size
 *  dy      a hair up or down from the ground line at the companion's own x (the caller adds the ground height there)
 *  scale   size relative to the main cap (about 0.4..0.92)
 *  tall    its own height stretch (0.86..1.2)
 *  lean    its own slant, leaning away from the main cap
 *  start   the main cap's growth at which this one pushes up; it then grows over the rest of the main one's growth
 *  salt    picks the illustration among those of its species
 * At most two companions stand on one side, each farther out than the one before it.
 */
export function clusterOf(seed, id, near = 0) {
  const rng = createRng(hash32('mushroom-cluster', seed >>> 0, id === undefined ? 0 : id));
  const r = rng.next;
  const t = clamp(Number.isFinite(near) ? near : 0, 0, 1);
  const roll = r();
  const n = roll < lerp(0.24, 0.05, t) ? 0 : roll < lerp(0.62, 0.2, t) ? 1 : roll < lerp(0.93, 0.5, t) ? 2 : roll < lerp(1, 0.82, t) ? 3 : 4;
  const out = [];
  let side = r() < 0.5 ? -1 : 1;
  const reach = { '-1': 0, 1: 0 };
  const count = { '-1': 0, 1: 0 };
  for (let k = 0; k < n; k++) {
    // the next one usually stands on the other side; otherwise it sits further out on the same side (never a third on one side)
    if (k > 0) side = r() < 0.65 ? -side : side;
    if (count[side] >= 2) side = -side;
    const out0 = reach[side];
    reach[side] = out0 > 0 ? out0 + lerp(10, 16, r()) : lerp(15, 30, r());
    count[side]++;
    out.push({
      dx: Math.round(side * reach[side] * 10) / 10,
      dy: Math.round(lerp(-1, 2.5, r()) * 10) / 10,
      scale: Math.round(lerp(k === 0 ? 0.5 : 0.4, k === 0 ? 0.92 : 0.78, r()) * 100) / 100,
      tall: Math.round(lerp(0.86, 1.2, r()) * 100) / 100,
      lean: Math.round((side * lerp(0.04, 0.16, r()) + (r() - 0.5) * 0.04) * 1000) / 1000,
      mirror: r() < 0.5,
      start: Math.round(lerp(0.12, 0.34, r()) * 100) / 100 + 0.12 * k,
      salt: Math.floor(r() * 1e9),
    });
  }
  return out;
}

/** What `m` looks like and which small caps stand beside it in this world: { look, cl } (look: lookOf, cl: clusterOf with the trunk proximity). */
export function clumpLayout(world, m) {
  const seed = world && Number.isFinite(world.seed) ? world.seed : 0;
  const id = m ? m.id : 0;
  return { look: lookOf(seed, id), cl: clusterOf(seed, id, trunkNear(world, m ? m.x : 0)) };
}

/** The companion's own growth 0..1 while the main cap is at `g`: nothing before `start`, then it catches up. */
export const companionGrowth = (g, c) => clamp((g - c.start) / (1 - c.start), 0, 1);

// How far a drawn cap reaches around its stalk base, world units for a cap of size 1 (scaled by its size; the height by its stretch too).
const CAP_HALF = 24;
const CAP_UP = 70;
const CAP_DOWN = 8;
const MIN_COMPANION_GROWTH = 0.03; // as in render/mushrooms.js: a companion below this is not drawn

/**
 * Every cap that stands on the page for mushroom `m`: [{ x, y, scale, tall }], the main cap first (scale = its look's size),
 * then the companions that have pushed up by now (their offsets and scale follow the main cap's size). `world` gives the seed, `groundAt(world, x)` the ground height (query.js groundYAt); without either only the main cap is returned.
 */
export function clumpCaps(world, m, groundAt) {
  if (!world || !groundAt) return [{ x: m.x, y: m.baseY, scale: 1, tall: 1 }];
  const { look, cl } = clumpLayout(world, m);
  const caps = [{ x: m.x, y: m.baseY, scale: look.size, tall: look.tall }];
  const g = clamp(typeof m.growth === 'number' && Number.isFinite(m.growth) ? m.growth : 1, 0, 1);
  for (const c of cl) {
    if (companionGrowth(g, c) < MIN_COMPANION_GROWTH) continue;
    const x = m.x + c.dx * look.size;
    caps.push({ x, y: groundAt(world, x) + c.dy, scale: look.size * c.scale, tall: c.tall });
  }
  return caps;
}

/** World box {l, r, t, b} around the whole clump of `m` (hover reach of every cap, widened to the outermost one). */
export function clumpBox(world, m, groundAt) {
  let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
  for (const c of clumpCaps(world, m, groundAt)) {
    l = Math.min(l, c.x - CAP_HALF * c.scale);
    r = Math.max(r, c.x + CAP_HALF * c.scale);
    t = Math.min(t, c.y - CAP_UP * c.scale * c.tall);
    b = Math.max(b, c.y + CAP_DOWN * c.scale);
  }
  return { l, r, t, b };
}

/** Squared horizontal distance from the point to the nearest cap of the clump of `m` it lies over, or -1 when it lies over none. */
export function clumpHit(world, m, x, y, groundAt) {
  let best = -1;
  for (const c of clumpCaps(world, m, groundAt)) {
    if (Math.abs(x - c.x) > CAP_HALF * c.scale || y < c.y - CAP_UP * c.scale * c.tall || y > c.y + CAP_DOWN * c.scale) continue;
    const d = (x - c.x) ** 2;
    if (best < 0 || d < best) best = d;
  }
  return best;
}

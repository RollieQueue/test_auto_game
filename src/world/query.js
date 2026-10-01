// Spatial queries over the generated world. Pure functions, no DOM.
import { pointInPolygon } from '../core/geom.js';

/** Linear interpolation into a profile sampled every `step` units from x = 0. */
export function sampleProfile(profile, step, x) {
  const f = x / step;
  const i = Math.floor(f);
  if (i <= 0) return profile[0];
  if (i >= profile.length - 1) return profile[profile.length - 1];
  return profile[i] + (profile[i + 1] - profile[i]) * (f - i);
}

export const groundYAt = (world, x) => sampleProfile(world.ground, world.step, x);

/** Index into world.horizons for a point, or -1 above the ground. */
export function horizonIndexAt(world, x, y) {
  const hs = world.horizons;
  if (y < sampleProfile(hs[0].top, world.step, x)) return -1;
  for (let i = hs.length - 1; i > 0; i--) {
    if (y >= sampleProfile(hs[i].top, world.step, x)) return i;
  }
  return 0;
}

export function horizonAt(world, x, y) {
  const i = horizonIndexAt(world, x, y);
  return i < 0 ? null : world.horizons[i];
}

export function rockAt(world, x, y) {
  for (const r of world.rocks) {
    if (x < r.minX || x > r.maxX || y < r.minY || y > r.maxY) continue;
    if (pointInPolygon(x, y, r.poly)) return r;
  }
  return null;
}

/** Sugar cost per unit of hypha length at a point; Infinity where hyphae cannot grow. */
export function costAt(world, x, y) {
  if (x < 4 || x > world.width - 4 || y > world.height - 4) return Infinity;
  const h = horizonIndexAt(world, x, y);
  if (h < 0) return Infinity;
  if (rockAt(world, x, y)) return Infinity;
  return world.horizons[h].cost;
}

export const isPassable = (world, x, y) => Number.isFinite(costAt(world, x, y));

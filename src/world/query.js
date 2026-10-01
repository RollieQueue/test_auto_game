// Spatial queries over the generated world. Pure functions, no DOM.
import { distToPolyline, pointInPolygon } from '../core/geom.js';

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

/**
 * What is under a world point, for tooltips: { kind: 'mushroom'|'tree'|'water'|'mineral'|'rock'|'horizon', id } or null
 * (open sky). `id` is the object id; for 'horizon' it is the horizon id string ('litter', 'humus', ...).
 */
export function targetAt(world, mushrooms, x, y) {
  for (const m of mushrooms) {
    if (Math.abs(x - m.x) <= 24 && y >= m.baseY - 70 && y <= m.baseY + 8) return { kind: 'mushroom', id: m.id };
  }
  const ground = groundYAt(world, x);
  if (y < ground) {
    for (const t of world.trees) if (Math.abs(x - t.x) <= 36 && y >= t.baseY - 420) return { kind: 'tree', id: t.id };
    return null;
  }
  for (const w of world.water) {
    const dx = (x - w.x) / w.rx;
    const dy = (y - w.y) / w.ry;
    if (dx * dx + dy * dy <= 1.1) return { kind: 'water', id: w.id };
  }
  for (const m of world.minerals) {
    if ((x - m.x) ** 2 + (y - m.y) ** 2 <= (m.r + 4) ** 2) return { kind: 'mineral', id: m.id };
  }
  for (const t of world.trees) {
    for (const r of t.roots) {
      if (r.minStage <= t.stage && distToPolyline(x, y, r.points) <= 10) return { kind: 'tree', id: t.id };
    }
  }
  const rock = rockAt(world, x, y);
  if (rock) return { kind: 'rock', id: rock.id };
  const h = horizonAt(world, x, y);
  return h ? { kind: 'horizon', id: h.id } : null;
}

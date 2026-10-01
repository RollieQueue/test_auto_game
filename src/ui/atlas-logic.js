// The finds atlas, without the DOM: which kinds are discovered, how many of each, and which illustration to use.
// Pure data in, pure data out (tested in tests/atlas.test.mjs).
import { FINDS } from '../content/finds.js';
import { groundYAt, horizonAt } from '../world/query.js';
import { clockAt } from '../sim/clock.js';
import { hash32 } from '../core/rng.js';

export const KINDS = Object.keys(FINDS);

const ru = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** «найдено 3 из 11 видов» */
export function progressText(found, total) {
  return `найдено ${found} из ${total} ${ru(total, 'вида', 'видов', 'видов')}`;
}

/**
 * First usable decor illustration per type from the art manifest (`{ assets: [{ group, type, file }] }`), or {} when
 * the manifest is missing or malformed. Entries without a string `file` are skipped.
 */
export function artByKind(manifest) {
  const out = {};
  const assets = manifest && Array.isArray(manifest.assets) ? manifest.assets : [];
  for (const a of assets) {
    if (a && a.group === 'decor' && typeof a.type === 'string' && typeof a.file === 'string' && !(a.type in out)) out[a.type] = a.file;
  }
  return out;
}

/**
 * One entry per kind, in the order of src/content/finds.js (litter first, deepest last).
 * `found`: items of the kind discovered in this game; `total`: items of the kind lying on this glade;
 * `lifetime`: { [kind]: items found over all games } from the atlas store (atlas-store.js), or null.
 * A kind is `discovered` when found in any game; `here` marks the ones found in the current glade; `ever` is the
 * lifetime count (never below `found`).
 */
export function atlasModel(state, art = {}, lifetime = null) {
  const counts = {};
  for (const f of Object.values((state && state.finds) || {})) counts[f.kind] = (counts[f.kind] || 0) + 1;
  const totals = {};
  for (const d of (state && state.world && state.world.decor) || []) totals[d.type] = (totals[d.type] || 0) + 1;
  const entries = KINDS.map((kind) => {
    const f = FINDS[kind];
    const found = counts[kind] || 0;
    const ever = Math.max(found, (lifetime && lifetime[kind]) || 0);
    return {
      kind,
      discovered: ever > 0,
      here: found > 0,
      found,
      ever,
      total: totals[kind] || 0,
      name: f.name,
      latin: f.latin,
      zone: f.zone,
      rarity: f.rarity,
      note: f.note,
      more: f.more || '',
      initial: f.name.charAt(0).toUpperCase(),
      art: art[kind] || null,
    };
  });
  const kinds = entries.filter((e) => e.discovered).length;
  const hereKinds = entries.filter((e) => e.here).length;
  const glade = entries.filter((e) => e.total > 0).length;
  return {
    entries,
    kinds,
    hereKinds,
    gladeKinds: glade,
    total: KINDS.length,
    items: Object.keys((state && state.finds) || {}).length,
    progress: progressText(kinds, KINDS.length),
  };
}

/** Short text for the floating label and the margin note, or null for an unknown kind. */
export function findNames(kind) {
  const f = FINDS[kind];
  if (!f) return null;
  return { name: f.name, lower: f.name.toLowerCase(), rarity: f.rarity };
}

// ---- the specimen page ------------------------------------------------------------------------------------------

export const RARITY_WORDS = ['', 'обычная', 'необычная', 'редкая', 'очень редкая'];
const SEASON_IN = { spring: 'весной', summer: 'летом', autumn: 'осенью', winter: 'зимой' };
const UNITS_PER_CM = 10; // the depth ruler on the plate: 10 world units = 1 cm

/** «4:12» for game seconds. */
export function clockText(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Like `artByKind`, but for a large picture: a 'plate' asset of the kind (type === kind or id 'plate.<kind>…') wins over
 * the small 'decor' cutout. Kinds without either are missing (the page paints them procedurally).
 */
export function plateByKind(manifest) {
  const out = {};
  const assets = manifest && Array.isArray(manifest.assets) ? manifest.assets : [];
  for (const a of assets) {
    if (!a || a.group !== 'plate' || typeof a.file !== 'string') continue;
    const kind = KINDS.find((k) => a.type === k || (typeof a.id === 'string' && a.id.startsWith(`plate.${k}`)));
    if (kind && !(kind in out)) out[kind] = a.file;
  }
  return out;
}

/** Kinds that can be opened (found in any game), in atlas order. */
export const openableKinds = (m) => m.entries.filter((e) => e.discovered).map((e) => e.kind);

/** The neighbour of `kind` among `kinds`, wrapping around; `dir` is 1 or -1. Null when there is nothing to move to. */
export function stepKind(kinds, kind, dir) {
  if (!kinds.length) return null;
  const i = kinds.indexOf(kind);
  if (i < 0) return kinds[dir > 0 ? 0 : kinds.length - 1];
  return kinds[(i + dir + kinds.length) % kinds.length];
}

/** Where and when one find of this glade lay: { id, horizon, depthCm, at, atText, season }. */
function findSpot(state, id, f) {
  const d = ((state.world && state.world.decor) || []).find((x) => x.id === Number(id));
  let horizon = '';
  let depthCm = null;
  if (d && state.world.horizons) {
    const h = horizonAt(state.world, d.x, d.y);
    horizon = h ? h.name : '';
    depthCm = Math.max(0, Math.round((d.y - groundYAt(state.world, d.x)) / UNITS_PER_CM));
  }
  const season = state.flags && state.flags.seasons ? SEASON_IN[clockAt(f.at || 0).season] || '' : '';
  return { id: Number(id), horizon, depthCm, at: f.at || 0, atText: clockText(f.at), season };
}

/**
 * Everything the specimen page shows for `kind` (null for an unknown kind): the texts, what this glade gives
 * (`spots`: finds of the kind in order of time, `total`: items lying here), the lifetime count, and the decor id
 * whose seed paints the procedural picture. `index` / `count` place it among the kinds that can be opened.
 */
export function specimenModel(state, kind, lifetime = null) {
  const f = FINDS[kind];
  if (!f) return null;
  const m = atlasModel(state, {}, lifetime);
  const e = m.entries.find((x) => x.kind === kind);
  const spots = Object.entries((state && state.finds) || {})
    .filter(([, v]) => v && v.kind === kind)
    .map(([id, v]) => findSpot(state, id, v))
    .sort((a, b) => a.at - b.at);
  const decors = ((state && state.world && state.world.decor) || []).filter((d) => d.type === kind);
  const drawId = spots.length ? spots[0].id : decors.length ? decors[0].id : 0;
  const kinds = openableKinds(m);
  return {
    ...e,
    rarityWord: RARITY_WORDS[f.rarity] || '',
    spots,
    drawSeed: hash32((state && state.world && state.world.seed) ?? (state && state.seed) ?? 0, drawId, kind),
    kinds,
    index: kinds.indexOf(kind),
    count: kinds.length,
  };
}

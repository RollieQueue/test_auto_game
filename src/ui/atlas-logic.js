// The finds atlas, without the DOM: which kinds are discovered, how many of each, and which illustration to use.
// Pure data in, pure data out (tested in tests/atlas.test.mjs).
import { FINDS } from '../content/finds.js';

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

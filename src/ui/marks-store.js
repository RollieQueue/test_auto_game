// The marks in the margins outlive a game: earned marks (with the date and the glade) and the lifetime counters
// the marks need (species played, biomes seen) are kept in localStorage, like the atlas's lifetime counts.
//
// Stored value (key roots-threads.marks.v1): { v: 1, earned: { [id]: { at: ms, glade: 'name' } },
//   species: [fungus ids], biomes: [biome ids] }. Everything is tolerant of missing or corrupt storage.
import { FUNGUS_IDS } from '../sim/species.js';
import { BIOME_IDS } from '../world/biomes.js';
import { MARK_IDS, speciesOf } from './marks-logic.js';

export const MARKS_KEY = 'roots-threads.marks.v1';
const MAX_GLADE = 80; // characters of a stored glade name

export const emptyStore = () => ({ v: 1, earned: {}, species: [], biomes: [] });

const onlyKnown = (list, known) => (Array.isArray(list) ? known.filter((id) => list.includes(id)) : []);

/** Anything in, a valid store out: unknown marks, species and biomes, bad dates and names are dropped. */
export function sanitize(raw) {
  const out = emptyStore();
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return out;
  const earned = raw.earned && typeof raw.earned === 'object' ? raw.earned : {};
  for (const id of MARK_IDS) {
    const r = earned[id];
    if (!r || typeof r !== 'object') continue;
    out.earned[id] = {
      at: Number.isFinite(r.at) && r.at > 0 ? Math.floor(r.at) : 0,
      glade: typeof r.glade === 'string' ? r.glade.slice(0, MAX_GLADE) : '',
    };
  }
  out.species = onlyKnown(raw.species, FUNGUS_IDS);
  out.biomes = onlyKnown(raw.biomes, BIOME_IDS);
  return out;
}

/** The name of this game's glade for the record: its own name, else «Поляна №7». */
export function gladeOf(state) {
  const name = state && state.world && typeof state.world.name === 'string' ? state.world.name.trim() : '';
  if (name) return name;
  const seed = state && state.seed !== undefined && state.seed !== null ? state.seed : state && state.world && state.world.seed;
  return seed === undefined || seed === null ? '' : `Поляна №${seed}`;
}

/** Adds the species and the biome of a game to a store; returns { store, changed }. */
export function mergeGame(store, state) {
  const base = sanitize(store);
  let changed = false;
  const species = speciesOf(state);
  if (species && !base.species.includes(species)) {
    base.species = FUNGUS_IDS.filter((id) => id === species || base.species.includes(id));
    changed = true;
  }
  const biome = state && state.world && state.world.biome;
  if (BIOME_IDS.includes(biome) && !base.biomes.includes(biome)) {
    base.biomes = BIOME_IDS.filter((id) => id === biome || base.biomes.includes(id));
    changed = true;
  }
  return { store: base, changed };
}

/** Adds earned marks (ids not earned yet) at `at` ms in `glade`; returns { store, added: [ids] }. */
export function mergeEarned(store, ids, at, glade) {
  const base = sanitize(store);
  const added = [];
  for (const id of ids || []) {
    if (!MARK_IDS.includes(id) || base.earned[id]) continue;
    base.earned[id] = { at: Number.isFinite(at) ? Math.floor(at) : 0, glade: String(glade || '').slice(0, MAX_GLADE) };
    added.push(id);
  }
  return { store: base, added };
}

const defaultStorage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null; // access itself may throw when storage is blocked
  }
};

/** Reads the store; a missing, unreadable or corrupt value gives an empty one. */
export function loadStore(storage = defaultStorage()) {
  try {
    const text = storage && storage.getItem(MARKS_KEY);
    return text ? sanitize(JSON.parse(text)) : emptyStore();
  } catch {
    return emptyStore();
  }
}

/** Writes the store; returns false when storage refuses (private mode, quota). */
export function saveStore(store, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(MARKS_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/**
 * The marks' handle on the store. It keeps a copy in memory (a blocked storage still works for the session), reads the
 * storage again on every call (another tab may have earned marks) and writes only when something changed.
 */
export function createMarksStore(storage, now = () => Date.now()) {
  let memory = emptyStore();
  const st = () => (storage === undefined ? defaultStorage() : storage);
  const read = () => {
    try {
      const s = st();
      const text = s && s.getItem(MARKS_KEY);
      if (text) memory = sanitize(JSON.parse(text));
    } catch {
      // unreadable or corrupt: keep what this session knows
    }
    return memory;
  };
  return {
    /** The whole memory: { earned, species, biomes }. */
    memory: read,
    /** Remembers the species and the biome of a game that has begun; true when something was new. */
    noteGame(state) {
      const { store, changed } = mergeGame(read(), state);
      if (changed) {
        memory = store;
        saveStore(store, st());
      }
      return changed;
    },
    /** Records earned marks with the date and the glade; returns the ids that were new. */
    award(ids, state) {
      const { store, added } = mergeEarned(read(), ids, now(), gladeOf(state));
      if (added.length) {
        memory = store;
        saveStore(store, st());
      }
      return added;
    },
  };
}

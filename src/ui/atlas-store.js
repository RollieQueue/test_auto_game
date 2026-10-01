// The lifetime atlas: kinds of curiosities found in any game are remembered in localStorage, because one glade
// holds only 6-7 of the 11 kinds. state.finds stays per game (the sim does not know about this store).
//
// Stored value (key roots-threads.atlas.v1): { v: 1, kinds: { [kind]: items found over all games },
//   seen: { g<seed>: [decor ids already counted] } }. `seen` makes the merge idempotent: loading a save or
// opening the atlas twice never counts an item twice. Everything is tolerant of missing or corrupt storage.
import { FINDS } from '../content/finds.js';

export const ATLAS_KEY = 'roots-threads.atlas.v1';
const MAX_GLADES = 60; // the oldest glades are forgotten in `seen` (the counts stay)
const MAX_IDS = 400;

export const emptyStore = () => ({ v: 1, kinds: {}, seen: {} });

const isCount = (n) => Number.isInteger(n) && n > 0 && n < 1e6;

/** Anything in, a valid store out: unknown kinds, bad counts and malformed glades are dropped. */
export function sanitize(raw) {
  const out = emptyStore();
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return out;
  const kinds = raw.kinds && typeof raw.kinds === 'object' ? raw.kinds : {};
  for (const kind of Object.keys(FINDS)) if (isCount(kinds[kind])) out.kinds[kind] = kinds[kind];
  const seen = raw.seen && typeof raw.seen === 'object' ? raw.seen : {};
  for (const seed of Object.keys(seen).slice(-MAX_GLADES)) {
    const ids = seen[seed];
    if (Array.isArray(ids)) out.seen[seed] = ids.filter((id) => Number.isInteger(id) && id >= 0).slice(0, MAX_IDS);
  }
  return out;
}

/**
 * Adds the finds of one game (`finds` = state.finds: { [decorId]: { kind } }) to a store. Returns
 * { store, added }: a new store and how many items were new. Items already counted for this seed are skipped.
 */
export function mergeGame(store, seed, finds) {
  const base = sanitize(store);
  const key = `g${seed}`; // not a bare number: integer-like keys would be reordered by the engine
  const had = new Set(base.seen[key] || []);
  const kinds = { ...base.kinds };
  let added = 0;
  for (const [id, f] of Object.entries(finds || {})) {
    const n = Number(id);
    if (!f || !FINDS[f.kind] || !Number.isInteger(n) || n < 0 || had.has(n)) continue;
    had.add(n);
    kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    added++;
  }
  if (added === 0) return { store: base, added };
  const seen = { ...base.seen };
  delete seen[key]; // re-insert: this glade becomes the newest
  seen[key] = [...had].slice(0, MAX_IDS);
  for (const old of Object.keys(seen).slice(0, Math.max(0, Object.keys(seen).length - MAX_GLADES))) delete seen[old];
  return { store: { v: 1, kinds, seen }, added };
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
    const text = storage && storage.getItem(ATLAS_KEY);
    return text ? sanitize(JSON.parse(text)) : emptyStore();
  } catch {
    return emptyStore();
  }
}

/** Writes the store; returns false when storage refuses (private mode, quota). */
export function saveStore(store, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(ATLAS_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/**
 * The HUD's handle on the store. It keeps a copy in memory (a blocked storage still works for the session), reads
 * the storage again on every call (another tab may have added finds) and writes only when something new was counted.
 * `sync(state)` is cheap to call whenever the number of finds changes.
 */
export function createAtlasStore(storage) {
  let memory = emptyStore();
  const read = () => {
    try {
      const s = storage === undefined ? defaultStorage() : storage;
      const text = s && s.getItem(ATLAS_KEY);
      if (text) memory = sanitize(JSON.parse(text));
    } catch {
      // unreadable or corrupt: keep what this session knows
    }
    return memory;
  };
  return {
    /** Lifetime counts per kind: { [kind]: n }. */
    kinds() {
      return read().kinds;
    },
    /** Counts the finds of `state` that are not counted yet; returns how many were new. */
    sync(state) {
      if (!state || !state.finds) return 0;
      const { store, added } = mergeGame(read(), state.seed, state.finds);
      if (added > 0) {
        memory = store;
        saveStore(store, storage === undefined ? defaultStorage() : storage);
      }
      return added;
    },
  };
}

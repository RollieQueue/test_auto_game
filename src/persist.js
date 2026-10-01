// Saving and loading a game in localStorage (format: persist-codec.js).
// The state passed in is never mutated; loadSave() returns a fresh, playable state or null.
// Nothing here throws: no storage, a full quota or a damaged save simply mean «no save».
import { SAVE_VERSION, decodeState, encodeState, validatePayload } from './persist-codec.js';

const KEY = 'roots-threads.save.v1';
const AUTOSAVE_EVERY = 10; // s of real time while playing

/** Last raw string seen and whether it is a usable save, so hasSave() is cheap to call every frame. */
let seen = { raw: null, ok: false };
let autoState = null;
let autoAcc = 0;

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readRaw() {
  try {
    return storage()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

function judge(raw) {
  if (raw === null) return false;
  if (seen.raw !== raw) {
    let ok = false;
    try {
      ok = validatePayload(JSON.parse(raw)) !== null;
    } catch {
      ok = false;
    }
    seen = { raw, ok };
  }
  return seen.ok;
}

/** True when a saved game can be continued. */
export function hasSave() {
  return judge(readRaw());
}

/** The saved game as a full state object (phase 'paused'), or null when there is none or it is unreadable. */
export function loadSave() {
  const raw = readRaw();
  if (!judge(raw)) return null;
  try {
    return decodeState(JSON.parse(raw));
  } catch {
    seen = { raw, ok: false }; // valid on its face but not for this build (e.g. another world generator)
    return null;
  }
}

/** Writes the game now. A failed write leaves the previous save in place. */
export function saveNow(state) {
  if (!state || state.phase === 'title') return;
  try {
    const raw = JSON.stringify(encodeState(state));
    storage()?.setItem(KEY, raw);
    seen = { raw, ok: true };
  } catch {
    // storage unavailable or full: keep playing
  }
}

/** Forgets the saved game. */
export function clearSave() {
  seen = { raw: null, ok: false };
  try {
    storage()?.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Called every frame while playing; autosaves now and then. */
export function tick(state, dtReal) {
  if (!state) return;
  if (state !== autoState) {
    autoState = state;
    autoAcc = 0;
  }
  if (state.phase !== 'playing') return;
  autoAcc += dtReal;
  if (autoAcc < AUTOSAVE_EVERY) return;
  autoAcc = 0;
  saveNow(state);
}

export { SAVE_VERSION, KEY as SAVE_KEY };

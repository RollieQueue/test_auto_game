// Saving and loading a game in localStorage (format: persist-codec.js).
// The state passed in is never mutated; loadSave() returns a fresh, playable state or null.
// Nothing here throws: no storage, a full quota or a damaged save simply mean «no save».
import { SAVE_VERSION, decodeState, encodeState, validatePayload } from './persist-codec.js';
import { gladeNameOf } from './world/generate.js';

const KEY = 'roots-threads.save.v1';
const AUTOSAVE_EVERY = 10; // s of real time while playing
const IDLE_TIMEOUT = 2000; // ms: an autosave waits this long at most for an idle moment of the page

/** Last raw string seen and whether it is a usable save, so hasSave() is cheap to call every frame. `payload` is its parsed JSON (kept for the title page and «Продолжить»). */
let seen = { raw: null, ok: false, payload: null };
let autoState = null;
let autoAcc = 0;
let autoPending = false; // an autosave is waiting for an idle moment

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

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function judge(raw) {
  if (raw === null) return false;
  if (seen.raw !== raw) {
    let ok = false;
    let payload = null;
    try {
      payload = validatePayload(JSON.parse(raw));
      ok = payload !== null;
    } catch {
      ok = false;
    }
    seen = { raw, ok, payload: ok ? payload : null };
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
  if (seen.ok && !seen.payload) seen.payload = safeParse(raw);
  try {
    return decodeState(seen.payload ?? JSON.parse(raw));
  } catch {
    seen = { raw, ok: false, payload: null }; // valid on its face but not for this build (e.g. another world generator)
    return null;
  }
}

/** The saved glade's seed and name (the title page's «Сохранённая поляна: …»), or null. Reads the saved JSON only: no world is generated. */
export function savedGladeInfo() {
  if (!hasSave()) return null;
  if (!seen.payload) seen.payload = safeParse(seen.raw);
  const seed = seen.payload?.seed;
  if (!seed) return null;
  try {
    return { seed, name: gladeNameOf(seed) };
  } catch {
    return null;
  }
}

/** Writes the game now. A failed write leaves the previous save in place. */
export function saveNow(state) {
  if (!state || state.phase === 'title') return;
  try {
    const raw = JSON.stringify(encodeState(state));
    storage()?.setItem(KEY, raw);
    seen = { raw, ok: true, payload: null }; // parsed again when someone needs it: the title page is rare, a save is not
  } catch {
    // storage unavailable or full: keep playing
  }
}

/** Forgets the saved game. */
export function clearSave() {
  seen = { raw: null, ok: false, payload: null };
  autoPending = false;
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
    autoPending = false; // a write queued for the previous game is dropped
  }
  if (state.phase !== 'playing') return;
  autoAcc += dtReal;
  if (autoAcc < AUTOSAVE_EVERY) return;
  autoAcc = 0;
  if (autoPending) return;
  scheduleSave(state);
}

/** Autosaves in an idle moment of the page (encoding and writing take a few ms, which is a visible hitch in the middle of a frame); without requestIdleCallback it writes at once. */
function scheduleSave(state) {
  const idle = globalThis.requestIdleCallback;
  if (typeof idle !== 'function') {
    saveNow(state);
    return;
  }
  autoPending = true;
  idle(
    () => {
      if (!autoPending) return; // cleared meanwhile
      autoPending = false;
      if (state === autoState && (state.phase === 'playing' || state.phase === 'paused')) saveNow(state);
    },
    { timeout: IDLE_TIMEOUT },
  );
}

export { SAVE_VERSION, KEY as SAVE_KEY };

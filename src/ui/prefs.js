// Small UI preferences kept in localStorage (guarded: storage may be blocked, then they live in memory).
// The guide is shown until it is marked done: all objectives completed, or the player turned it off.

const GUIDE_DONE_KEY = 'roots-threads.guide.done';

let memoryDone = false;

function read() {
  try {
    return window.localStorage.getItem(GUIDE_DONE_KEY) === '1';
  } catch {
    return memoryDone;
  }
}

function write(done) {
  memoryDone = done;
  try {
    if (done) window.localStorage.setItem(GUIDE_DONE_KEY, '1');
    else window.localStorage.removeItem(GUIDE_DONE_KEY);
  } catch {
    // storage is unavailable: the in-memory value is enough for this session
  }
}

let cached = null;
const listeners = new Set();

/** True while the first-session guide may show hints. */
export function guideEnabled() {
  if (cached === null) cached = !read();
  return cached;
}

export function setGuideEnabled(on) {
  const value = Boolean(on);
  if (cached === value && read() === !value) return;
  cached = value;
  write(!value);
  for (const fn of listeners) fn(value);
}

/** Calls fn(enabled) whenever the preference changes; returns an unsubscribe function. */
export function onGuideChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// One-time pointer to the finds atlas after the first find ever (kept like the guide flag).
const ATLAS_HINT_KEY = 'roots-threads.atlas.hint';
let memoryHint = false;

export function atlasHintSeen() {
  try {
    return window.localStorage.getItem(ATLAS_HINT_KEY) === '1';
  } catch {
    return memoryHint;
  }
}

export function markAtlasHint() {
  memoryHint = true;
  try {
    window.localStorage.setItem(ATLAS_HINT_KEY, '1');
  } catch {
    // in-memory flag is enough for this session
  }
}

// One-time pointers about the soil threats, once per player: the margin note on the first worm ever, and the
// guide's arrow at it (separate flags: the note is for everyone, the arrow only while the guide is on).
const seenMemory = new Set();

function seen(name) {
  try {
    return window.localStorage.getItem(`roots-threads.seen.${name}`) === '1';
  } catch {
    return seenMemory.has(name);
  }
}

function markSeen(name) {
  seenMemory.add(name);
  try {
    window.localStorage.setItem(`roots-threads.seen.${name}`, '1');
  } catch {
    // in-memory flag is enough for this session
  }
}

export const wormNoteSeen = () => seen('worm-note');
export const markWormNote = () => markSeen('worm-note');
export const wormHintSeen = () => seen('worm-hint');
export const markWormHint = () => markSeen('worm-hint');
// the guide's arrow at the first raider of the honey fungus (rival.js raidHint), once per player
export const raidHintSeen = () => seen('raid-hint');
export const markRaidHint = () => markSeen('raid-hint');

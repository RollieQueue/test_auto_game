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

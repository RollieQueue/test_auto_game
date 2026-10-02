// What a closed page of the notebook gives (state.flags.unlocks = { feed, trap, finds }, saved with the flags):
//   page 1 closed -> feed: tool 5 «Подкормка» (src/sim/feed.js);
//   page 2 closed -> trap: the catching ring digests faster (B.trapDigestSecondsPage2, src/sim/threats.js);
//   page 3 closed -> finds: the find radius grows (B.findRadiusPage3, src/sim/finds.js).
// Without chapters (flags.threats off) every tool is open from the start (isUnlocked) and the better numbers stay the old ones (earned). A state that has no flag for a page it has closed
// (an old save, a hand-made test) counts as unlocked by its chapter; decodeState writes the flags down (syncUnlocks).
import { B } from './balance.js';

/** The page whose closing opens each unlock. */
export const UNLOCK_PAGE = { feed: 1, trap: 2, finds: 3 };

/** The unlock a page opens, or null. */
export const unlockOfPage = (page) => Object.keys(UNLOCK_PAGE).find((k) => UNLOCK_PAGE[k] === page) ?? null;

/** How many pages are closed: the chapter before the current one, one more when the current is closed (the book's last page). */
export function pagesClosed(state) {
  const chapter = Number.isInteger(state.chapter) ? state.chapter : 1;
  const done = Number.isFinite(state.flags.pagesDone) ? state.flags.pagesDone : 0;
  return Math.max(chapter - 1, done, state.flags.bookDone ? chapter : 0);
}

export function isUnlocked(state, key) {
  const f = state.flags;
  if (!f.threats) return true;
  return Boolean(f.unlocks && f.unlocks[key]) || pagesClosed(state) >= UNLOCK_PAGE[key];
}

/** Opens what pages 1..`page` give; returns the keys that were not open before (in page order). */
export function grantUnlocks(state, page) {
  const fresh = [];
  for (const key of Object.keys(UNLOCK_PAGE)) {
    if (UNLOCK_PAGE[key] > page) continue;
    if (!state.flags.unlocks) state.flags.unlocks = {};
    if (state.flags.unlocks[key]) continue;
    state.flags.unlocks[key] = true;
    fresh.push(key);
  }
  return fresh;
}

/** Writes the unlocks a loaded game has earned (by its closed pages and, for feeding, by a tree being fed); returns the keys it added. */
export function syncUnlocks(state) {
  if (!state.flags.threats) return [];
  const fresh = grantUnlocks(state, pagesClosed(state));
  if (state.feed && !state.flags.unlocks?.feed) {
    if (!state.flags.unlocks) state.flags.unlocks = {};
    state.flags.unlocks.feed = true;
    fresh.unshift('feed');
  }
  return fresh;
}

/** A gift that is a reward for a page (a better number, not a tool): only a notebook with pages gives it; without chapters the numbers stay as they were. */
export const earned = (state, key) => Boolean(state.flags.threats) && isUnlocked(state, key);

/** Seconds a ring digests a worm for. */
export const trapDigestSeconds = (state) => (earned(state, 'trap') ? B.trapDigestSecondsPage2 : B.trapDigestSeconds);

/** Multiplier of the find radius. */
export const findRadiusScale = (state) => (earned(state, 'finds') ? B.findRadiusPage3 : 1);

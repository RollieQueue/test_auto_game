// The flow of the margin notes, the pure part (notes.js and the HUD use it; no DOM): how loud a note is, which ones are not worth
// the player's attention right now, and which of the held ones still matter when a page or a card closes.
// The user's report was «надо чуть менее сумбурным сделать луп»: at the minute a page closed up to five messages stood on screen
// at once (the summary page hid three of them), and every rain and clearing wrote its own line.

/** An alert: something to answer (a worm, the honey fungus, a cut thread). Never dropped, and the last to be pushed off the stack. */
export const RANK_ALERT = 0;
/** News: an observation ticked, a season, a tree's stage, an answer to the player's own click. */
export const RANK_NEWS = 1;
/** Ambient: weather, «гриб пошёл в рост», the sugar nudge. Shown only when nothing else is on the stack, and not again too soon. */
export const RANK_AMBIENT = 2;

export const AMBIENT_GAP = 90; // s before the same ambient note may come again
const AMBIENT_KEY = /^(weather:|mush:planted$|nudge:|atlas-hint$)/;

/** The rank of a note `{ key, tone }`. */
export function noteRank(d) {
  const key = (d && d.key) || '';
  if (AMBIENT_KEY.test(key)) return RANK_AMBIENT;
  if ((d && d.tone === 'warn') || /^(raid:|worm:)/.test(key)) return RANK_ALERT;
  return RANK_NEWS;
}

/** A note that says nothing the calendar card does not: the weather has cleared (the calendar shows the weather). */
export const isNoise = (d) => Boolean(d) && d.key === 'weather:clear';

/**
 * What to show of the notes held back while a page, the year or a card was up: every alert, the newest news (older ones are in
 * the page that was just read), no ambient. At most `cap`; the alerts come last, so they are on top of the stack.
 * `held`: [{ d, rank }] in the order they came.
 */
export function releaseHeld(held, cap) {
  const alerts = held.filter((h) => h.rank === RANK_ALERT).slice(-cap);
  const news = held.filter((h) => h.rank === RANK_NEWS).slice(-1);
  return [...news, ...alerts].slice(-cap).map((h) => h.d);
}

/** Index of the note to push off a full stack: the quietest rank first, the oldest of it. `ranks`: oldest first. */
export function victimIndex(ranks) {
  let best = -1;
  for (let i = 0; i < ranks.length; i++) if (best < 0 || ranks[i] > ranks[best]) best = i;
  return best;
}

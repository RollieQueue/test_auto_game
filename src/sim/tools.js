// Which tools of the toolbar have entered the game (state.flags.tools = { fruit, trap, barrier, feed }, saved with the flags).
// A tool's tab, its key and every line that names the key appear only once the tool is revealed; «Нить» (key 1) is there from the start.
//   fruit   -> the first alliance with a tree (the guide's mushroom step asks for a mushroom at the same moment, guide-logic.js);
//   trap    -> the first nematode the player sees (the HUD writes it: ui/callout.js decides when the worm is on screen);
//   barrier -> the honey fungus wakes (ui/rival.js barrierTabShown);
//   feed    -> page 1 is closed and a tree is linked (ui/feed.js feedTabShown).
// The sim calls revealTools after every step (it only writes the record: no rule reads it); a state that has no `tools` yet (an old save)
// gets them derived (syncTools, decodeState). The HUD notices a tool that is new and lets its tab glow.
import { canFeedAny, feedUnlocked } from './feed.js';

export const TOOL_KEYS = ['fruit', 'trap', 'barrier', 'feed'];

/** Is the tool revealed in this game? («Нить» always is.) */
export function toolRevealed(state, key) {
  if (key === 'grow') return true;
  const tools = state && state.flags && state.flags.tools;
  return Boolean(tools && tools[key]);
}

/** Marks a tool revealed; true when it was not before. */
export function revealTool(state, key) {
  if (toolRevealed(state, key)) return false;
  if (!state.flags.tools) state.flags.tools = {};
  state.flags.tools[key] = true;
  return true;
}

/** A tree is allied or a mushroom stands: the game has asked for a mushroom. */
export const fruitAsked = (state) => state.mushrooms.length > 0 || state.net.links.some((l) => l.kind === 'tree');

/** The honey fungus is awake in a game that has threats and a rival. */
export const barrierAsked = (state) => Boolean(state.flags.threats && state.flags.rival && state.rival && state.rival.awake);

/** The tree can be fed (page 1 closed, a tree linked) or one is being fed. */
export const feedAsked = (state) => feedUnlocked(state) && (Boolean(state.feed) || canFeedAny(state));

/** Reveals the tools the state has earned (all but the ring, which the HUD reveals with the first worm seen); returns the new keys. */
export function revealTools(state) {
  const fresh = [];
  if (!toolRevealed(state, 'fruit') && fruitAsked(state) && revealTool(state, 'fruit')) fresh.push('fruit');
  if (!toolRevealed(state, 'barrier') && barrierAsked(state) && revealTool(state, 'barrier')) fresh.push('barrier');
  if (!toolRevealed(state, 'feed') && feedAsked(state) && revealTool(state, 'feed')) fresh.push('feed');
  return fresh;
}

/** A worm has been in this glade, or a later page is open: the ring has been the player's business. */
export const wormsMet = (state) =>
  Boolean(state.flags.threats) && (state.sim.threat.nextWorm > 0 || state.fauna.length > 0 || (Number.isInteger(state.chapter) && state.chapter > 1));

/** A game that has no record of its tools (a save from before they were revealed one by one): what the state shows it has met. */
export function syncTools(state) {
  const fresh = revealTools(state);
  if (wormsMet(state) && revealTool(state, 'trap')) fresh.push('trap');
  return fresh;
}

/** Every tool revealed (a game fast-forwarded by a script has had them all): returns the new keys. */
export function revealAll(state) {
  return TOOL_KEYS.filter((k) => (k === 'trap' && !state.flags.threats ? false : revealTool(state, k)));
}

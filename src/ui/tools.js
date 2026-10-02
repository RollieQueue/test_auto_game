// The toolbar, the pure part: which tabs (and keys) are on it. A tool is shown once it has entered the game (src/sim/tools.js)
// and while the game still has a use for it.
import { toolRevealed } from '../sim/tools.js';
import { feedTabShown } from './feed.js';
import { barrierTabShown } from './rival.js';
import { threatsOn } from './threats.js';

/** The tool tabs in toolbar order: [tool, key, name]. */
export const TOOLS = [
  ['grow', '1', 'нить'],
  ['fruit', '2', 'гриб'],
  ['trap', '3', 'кольцо'],
  ['barrier', '4', 'барьер'],
  ['feed', '5', 'подкормка'],
];

/** The tab of `key` is on the toolbar (and its key works). */
export function toolShown(state, key) {
  if (!state || !toolRevealed(state, key)) return false;
  switch (key) {
    case 'trap':
      return threatsOn(state);
    case 'barrier':
      return barrierTabShown(state);
    case 'feed':
      return feedTabShown(state);
    default:
      return true;
  }
}

/** The tools on the toolbar now, in order: [{ tool, key, name }]. */
export const shownTools = (state) => TOOLS.filter(([tool]) => toolShown(state, tool)).map(([tool, key, name]) => ({ tool, key, name }));

// The folded objectives card: «Глава 2 · 2 / 5 · ближе всего: галечник 255/597». Pure, no DOM. The header keeps the page and the
// ticked count (hud.js); this module writes the rest: the open line that is furthest along, by a short name and its count.
import * as balance from '../sim/balance.js';
import { objectiveCount, pageCounts } from '../sim/objectives.js';

/** A short name of every observation, for the one-line card (the full text is in the open card): it has room for about 32 characters. */
export const SHORT_NAMES = {
  water: 'вода',
  tree: 'союз',
  mushroom: 'гриб',
  treeGrow: 'рост',
  spores: 'споры',
  allies: 'союзы',
  finds: 'находки',
  gravel: 'галечник',
  worms: 'нематоды',
  rivalCut: 'опёнок',
  ancient: 'вековое',
  gladeBirch: 'вода рощи',
  gladeOak: 'дубы',
  gladePine: 'фосфор',
  gladeMixed: 'грибы по видам',
  mushrooms8: 'грибы',
  winter: 'зимний запас',
  reserve: 'запас',
  rivalGuard: 'защита рощи',
  spores500: 'споры',
  spores1500: 'споры',
};

/** [have, need, unit?] of an open line, or null when it has no count. «Опёнок» has two ways: the one that is further along. */
function countOf(state, o) {
  if (o.id === 'rivalCut') {
    const B = balance.B || {};
    const need = B.rivalCutFreed || 2;
    const goal = B.rivalCutGoal || 15;
    let freed = 0;
    let cut = 0;
    try {
      ({ freed, cut } = pageCounts(state || {}));
    } catch {
      // a partial state: nothing done yet
    }
    return freed / need >= cut / goal ? [Math.min(freed, need), need] : [Math.min(cut, goal), goal];
  }
  return objectiveCount(state, o.id);
}

/**
 * The open line that is closest to done: the highest have/need (a line with no count stands at 0), the first on a tie.
 * { o, count } (count is [have, need, unit?] or null), or null when no line is open.
 */
export function nearestObjective(state, list = state && state.objectives) {
  let best = null;
  let bestFrac = -1;
  for (const o of list || []) {
    if (!o || o.done) continue;
    const count = countOf(state, o);
    const frac = count ? count[0] / count[1] : 0;
    if (frac > bestFrac + 1e-9) {
      best = { o, count };
      bestFrac = frac;
    }
  }
  return best;
}

/** The text after the count in the folded card: «ближе всего: галечник 255/597», or «всё отмечено» / '' (no lines). */
export function foldedLine(state, list = state && state.objectives) {
  if (!list || !list.length) return '';
  const near = nearestObjective(state, list);
  if (!near) return 'всё отмечено';
  const name = SHORT_NAMES[near.o.id] || near.o.text;
  // only a percent keeps its unit (the room is short: «ед.», «стадии» and «с» are in the open card)
  const num = near.count ? ` ${near.count[0]}/${near.count[1]}${near.count[2] === ' %' ? ' %' : ''}` : '';
  return `ближе всего: ${name}${num}`;
}

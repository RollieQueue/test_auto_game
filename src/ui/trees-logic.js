// Tree growth for the HUD: progress toward the next stage, the objective line «Помочь дереву подрасти · 40 %»
// and the tooltip of a tree. Pure, no DOM. A tree grows only while it is linked and content (sim/economy.js).
import * as balance from '../sim/balance.js';
import * as sim from '../sim/index.js'; // treeBarred is reached through the namespace: a build without it only loses that line
import { STAGE_WORDS } from './season-logic.js';
import { objectiveCount, pageCounts } from '../sim/objectives.js';
import { rivalAwake, treeRisk } from './rival.js';
import { feedLine } from './feed.js';

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
export const pctText = (v) => `${Math.round(clamp01(v) * 100)} %`;

/** True for a tree that can still grow (the last stage is final). */
export const canGrow = (tree) => Boolean(tree) && (tree.stage || 0) < 3;

/** Seconds a tree needs for its current stage at full health (balance.treeGrowSeconds), or 0. */
export function stageSeconds(tree) {
  const list = balance.B && balance.B.treeGrowSeconds;
  const s = list && list[tree.stage || 0];
  return Number.isFinite(s) ? s : 0;
}

/** The linked trees that are still growing. */
export function growingTrees(state) {
  return ((state && state.world && state.world.trees) || []).filter((t) => t.linked && canGrow(t));
}

/** The tree the «Помочь дереву подрасти» line speaks of: the growing, linked tree closest to its next stage (or null). */
export function leadingTree(state) {
  let best = null;
  for (const t of growingTrees(state)) if (!best || clamp01(t.growth) > clamp01(best.growth)) best = t;
  return best;
}

/**
 * Progress to append to an objective line, or '' when there is none: ` · 40 %` for «treeGrow», ` · 212/500` for a count
 * (sim/objectives.js COUNTS: spores, allies, finds, worms, the glade and page 3 observations; «вековое дерево» says
 * ` · 2/3 стадии`). The three first acts of page 1 (water, a tree, a mushroom) have no number.
 * `o` = { id, text, done }; a ticked-off line shows no progress.
 */
export function objectiveProgress(state, o) {
  if (!o || o.done) return '';
  if (o.id === 'treeGrow') {
    const t = leadingTree(state);
    return t ? ` · ${pctText(t.growth)}` : '';
  }
  if (o.id === 'rivalCut') {
    // two ways to finish it: trees freed, or segments cut (since the page opened): «1/2 дерева или 7/15 тяжей»
    const B = balance.B || {};
    const need = B.rivalCutFreed || 2;
    const last = need % 10;
    const trees = need % 100 >= 11 && need % 100 <= 14 ? 'деревьев' : last === 1 ? 'дерево' : last >= 2 && last <= 4 ? 'дерева' : 'деревьев';
    let freed = 0;
    let cut = 0;
    try {
      ({ freed, cut } = pageCounts(state || {}));
    } catch {
      // a partial state: nothing done yet
    }
    return ` · ${Math.min(freed, need)}/${need} ${trees} или ${Math.min(cut, B.rivalCutGoal || 15)}/${B.rivalCutGoal || 15} тяжей`;
  }
  const c = objectiveCount(state, o.id);
  return c ? ` · ${c[0]}/${c[1]}${c[2] || ''}` : '';
}

/** The text of an objective line with its progress. */
export const objectiveText = (state, o) => `${o.text}${objectiveProgress(state, o)}`;

/** Infection share from which the tree's name turns warn-red in the tooltip. */
const INFECTION_WARN = 0.5;

/**
 * Tooltip lines of a tree: { main, sub, sub2?, warn? }. With the honey-fungus rival: `sub2` says «заражение N % · защита N %»
 * once the rival is awake (given `state`) while either is above zero; without `state` (the old call) only when the tree is
 * infected. A lost tree is told to have been killed by the fungus and to stand as a snag.
 */
export function describeTree(tree, state) {
  if (tree.lost) {
    return { main: `${tree.name} · сухостой`, sub: 'дерево погубил опёнок · стоит сухостоем', warn: true };
  }
  const stage = STAGE_WORDS[tree.stage] || '';
  const health = pctText(tree.health);
  const main = `${tree.name} · ${stage} · довольство ${health}`;
  const out = { main, sub: '' };
  if (!tree.linked) out.sub = 'нить сюда ещё не дошла';
  else if (!canGrow(tree)) out.sub = 'союз заключён · выше уже не вырастет';
  else out.sub = `союз заключён · рост ${pctText(tree.growth)}`;
  if (state !== undefined && typeof sim.treeBarred === 'function' && sim.treeBarred(state, tree)) out.sub = 'все корни в барьере: дерево замерло';
  const fed = state === undefined ? null : feedLine(state, tree);
  if (fed) out.feed = fed;
  const risk = state === undefined ? (tree.infection > 0 ? treeRisk(tree) : null) : rivalAwake(state) ? treeRisk(tree) : null;
  if (risk) {
    out.sub2 = risk.text;
    if (risk.infection >= INFECTION_WARN) out.warn = true;
  }
  return out;
}

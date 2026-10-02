// The HUD side of feeding a tree («Подкормка», src/sim/feed.js): the tool tab, the tooltips and the margin notes. Pure, no DOM.
// The tool is key 5: with it a click on a linked tree (crown, trunk or roots) feeds it; a click on the fed tree stops it.
import * as sim from '../sim/index.js';
import * as balance from '../sim/balance.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const DATIVE = { birch: 'берёзе', oak: 'дубу', pine: 'сосне' };

/** «берёзе» (dative, lower case) for a tree: by species, else «дереву». */
export const treeDative = (tree) => (tree && DATIVE[tree.species]) || 'дереву';

/** «Берёза» (the tree's name, capitalised), else «Дерево». */
const treeName = (tree) => (tree && tree.name ? String(tree.name) : 'Дерево');

/** «1,2» for a rate: one decimal below 10. */
export const rateText = (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v))).replace('.', ',');

/** The tree being fed, or null. */
export const fedTreeOf = (state) => {
  const f = state && state.feed;
  return f && state.world ? state.world.trees[f.treeId] || null : null;
};

/** The «Подкормка» tab and key 5 exist once page 1 is closed (sim.feedUnlocked) and a tree is linked (or is being fed). */
export function feedTabShown(state) {
  if (!state || !state.world || !state.sim) return false;
  return sim.feedUnlocked(state) && (Boolean(state.feed) || sim.canFeedAny(state));
}

/** Title (tooltip) of the tool tab. */
export function feedTabTitle(state) {
  const from = Math.round((balance.B.feedFrom ?? 0.8) * 100);
  const t = fedTreeOf(state);
  const now = t ? ` Сейчас: ${t.name.toLowerCase()}.` : '';
  return `Подкормка (5): щёлкни по дереву, и сахар сверх ${from} % кладовой пойдёт ему по сети; ещё раз — прекратить.${now}`;
}

/** The line of a fed tree's tooltip: «подкармливается · +1,2/с», or why nothing flows yet; null for a tree that is not fed. */
export function feedLine(state, tree) {
  const f = state && state.feed;
  if (!f || !tree || f.treeId !== tree.id) return null;
  if (isNum(f.rate) && f.rate >= 0.05) return `подкармливается · +${rateText(f.rate)}/с`;
  if (!sim.feedUseful(state, tree)) return 'подкармливается · ей больше не нужно';
  return 'подкармливается · ждёт излишка сахара';
}

/**
 * The tooltip of a tree under the feeding tool: { main, sub, ... } for a tree target (query.js targetAt), null for anything else.
 * `describe` is the ordinary tree tooltip, whose main line it keeps; the second line says what a click does.
 */
export function describeFeedPick(state, target, describe) {
  if (!target || target.kind !== 'tree') return null;
  const tree = state.world.trees.find((t) => t.id === target.id);
  if (!tree) return null;
  const base = describe(tree, state);
  const f = state.feed;
  if (f && f.treeId === tree.id) return { ...base, sub: 'щёлкни: перестать подкармливать' };
  switch (sim.feedDenial(state, tree.id)) {
    case 'lost':
      return { ...base, sub: 'сухостой не подкормить', warn: true };
    case 'unlinked':
      return { ...base, sub: 'нить сюда не дошла: сахар не донести', warn: true };
    default: {
      const other = fedTreeOf(state);
      return { ...base, sub: other ? `щёлкни: сахар пойдёт ей, не ${treeDative(other)}` : 'щёлкни: лишний сахар пойдёт ей' };
    }
  }
}

/** The sugar tooltip's own lines: what happens to the surplus. { full, extra } — `full` replaces the «полна» line, `extra` follows the cap line. */
export function sugarFeedText(state, full) {
  const tree = fedTreeOf(state);
  if (tree) {
    const dat = treeDative(tree);
    if (!sim.feedUseful(state, tree)) return full ? { full: `Кладовая полна. ${treeName(tree)} сыта, и лишний сахар пропадает: выбери другое дерево или тяни нити.` } : {};
    const from = Math.round((balance.B.feedFrom ?? 0.8) * 100);
    if (full) return { full: `Кладовая полна: лишний сахар уходит ${dat}. Её корни крепнут, а сама она быстрее растёт.` };
    return { extra: `Всё, что выше ${from} % кладовой, уходит ${dat}.` };
  }
  if (full && sim.canFeedAny(state)) return { full: 'Кладовая полна: лишний сахар пропадает. Подкорми дерево (5), тяни нити, расти грибы.' };
  return {};
}

/** Margin note for a feeding event: { key, text, tone, icon } or null (a stop by the player's own click is silent). */
export function feedNote(state, ev) {
  const tree = isNum(ev.treeId) ? state.world.trees[ev.treeId] : null;
  switch (ev.type) {
    case 'feed-start': {
      const from = Math.round((balance.B.feedFrom ?? 0.8) * 100);
      return { key: `feed:start:${ev.treeId}`, text: `Сахар сверх ${from} % кладовой пойдёт ${treeDative(tree)}`, tone: 'good', icon: 'feed', life: 7 };
    }
    case 'feed-stop':
      if (ev.reason === 'lost') return { key: 'feed:lost', text: `${treeName(tree)}: подкормка прервалась, дерево погибло`, tone: 'warn', icon: 'feed', life: 8 };
      if (ev.reason === 'unlinked') return { key: 'feed:unlinked', text: `${treeName(tree)}: нить оборвана, подкормка прервалась`, tone: 'warn', icon: 'feed', life: 8 };
      return null;
    case 'feed-denied':
      if (ev.reason === 'lost') return { key: 'feed:denied:lost', text: 'Сухостой не подкормить', tone: 'warn', icon: 'feed' };
      if (ev.reason === 'unlinked') return { key: 'feed:denied:unlinked', text: 'Нить сюда ещё не дошла: сахар не донести', tone: 'warn', icon: 'feed' };
      return null;
    default:
      return null;
  }
}

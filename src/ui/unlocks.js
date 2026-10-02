// What a closed page gives (src/sim/unlocks.js), in words: the slip at the closing, the line of the summary page, and the lines of
// the help page. Pure, no DOM; the numbers come from balance.js.
import * as balance from '../sim/balance.js';
import { UNLOCK_PAGE, isUnlocked, unlockOfPage } from '../sim/unlocks.js';

const ORDINAL = { 1: 'первую', 2: 'вторую', 3: 'третью' };

/** The numbers the texts quote. */
function numbers(B = balance.B) {
  return {
    from: Math.round((B.feedFrom ?? 0.8) * 100),
    digestNow: Math.round(B.trapDigestSecondsPage2),
    digestWas: Math.round(B.trapDigestSeconds),
    wider: Math.round((B.findRadiusPage3 - 1) * 100),
  };
}

/** { title, line (the slip's one line), summary (the closed page's page), help (an item of the help page, HTML) } of an unlock key. */
export function unlockTexts(key, B = balance.B) {
  const n = numbers(B);
  switch (key) {
    case 'feed':
      return {
        title: 'Новое умение: подкормка (5)',
        line: 'Щёлкни по дереву: лишний сахар пойдёт ему, и оно быстрее растёт.',
        summary: 'Открыто: подкормка (5) — лишний сахар пойдёт дереву, и оно быстрее растёт',
        help: `<b>Подкормка</b> (<kbd>5</kbd>): щёлкни по дереву, и сахар сверх ${n.from} % кладовой пойдёт ему`,
      };
    case 'trap':
      return {
        title: `Кольцо крепче: снова готово через ${n.digestNow} с`,
        line: `Ловчее кольцо переваривает нематоду за ${n.digestNow} с вместо ${n.digestWas}.`,
        summary: `Открыто: кольцо крепче — после улова оно снова готово через ${n.digestNow} с, а не ${n.digestWas}`,
        help: `<b>Крепкое кольцо</b>: после улова ловчее кольцо снова готово через ${n.digestNow} с, а не ${n.digestWas}`,
      };
    case 'finds':
      return {
        title: 'Зоркий глаз: находки заметны дальше',
        line: `Нить замечает находки на ${n.wider} % дальше, чем раньше.`,
        summary: `Открыто: зоркий глаз — нить замечает находки на ${n.wider} % дальше`,
        help: `<b>Зоркий глаз</b>: нить замечает находки на ${n.wider} % дальше`,
      };
    default:
      return null;
  }
}

/** The paper slip of an unlock: { id, icon, title, line, kicker, life } for slips.js, or null for an unknown key. */
export function unlockSlip(key, B = balance.B) {
  const t = unlockTexts(key, B);
  if (!t) return null;
  const icon = { feed: 'feed', trap: 'ring', finds: 'find' }[key];
  return { id: `unlock:${key}`, icon, title: t.title, line: t.line, kicker: 'Страница закрыта', life: 7 };
}

/** The line of the summary of page `completed` when it gave something (chapters on), else ''. */
export function summaryUnlockLine(state, completed) {
  if (!(state && state.flags && state.flags.threats)) return '';
  const key = unlockOfPage(completed);
  const t = key && unlockTexts(key);
  return t ? t.summary : '';
}

/** The items of the help page's list «Что открывает страница»: [{ page, open, html }]; `open` says whether the game has it. */
export function unlockHelpItems(state, B = balance.B) {
  return Object.keys(UNLOCK_PAGE).map((key) => ({
    key,
    page: UNLOCK_PAGE[key],
    open: isUnlocked(state, key),
    html: unlockTexts(key, B).help,
  }));
}

/** «первую», «вторую», «третью» (the page's ordinal, accusative: «за первую страницу»). */
export const pageOrdinal = (page) => ORDINAL[page] ?? String(page);

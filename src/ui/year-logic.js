// The words of the stakes (sim/stakes.js): the grade of a year, its reason and hint, the closed page and the warning slip.
// Pure data in, pure data out (tested in tests/stakes.test.mjs).
import { B } from '../sim/balance.js';
import { allies, gradeClosed, gradeYear, pageClosed, stakesOn } from '../sim/stakes.js';
import { ruPlural } from './threats.js';

const nf = new Intl.NumberFormat('ru-RU');

/** The grades in the voice of the notebook: the title, the one-line verdict and the word on the seal. */
export const GRADE_WORDS = {
  poor: { title: 'Тяжёлый год', verdict: 'поляна едва держится', seal: 'тяжело' },
  fair: { title: 'Удовлетворительно', verdict: 'поляна держится', seal: 'сносно' },
  good: { title: 'Хорошо', verdict: 'союзы крепнут', seal: 'хорошо' },
  great: { title: 'Отлично', verdict: 'лес запомнит', seal: 'отлично' },
};

/** What each part of the grade says in favour, from the facts of the grade: «за: …». */
const PRAISE = {
  alive: (f) => (f.alive === f.total ? 'все деревья живы' : `живы ${f.alive} из ${f.total}`),
  allies: (f) => (f.allied === f.total ? 'союз с каждым деревом' : `союзов: ${f.allied}`),
  growth: () => 'деревья подросли',
  spores: (f) => `+${nf.format(f.spores)} спор`,
  mushrooms: (f) => `${f.mature} ${ruPlural(f.mature, 'гриб', 'гриба', 'грибов')} созрело`,
  pages: (f) => (f.pagesDone > 0 ? 'страница дописана' : 'страница почти готова'),
  rival: (f) => (f.savedNow > 0 ? `опёнок отбит, освобождено ${f.savedNow}` : 'опёнок не взял ни одного дерева'),
};

/** What would raise the grade next year: one clause per part. */
const ADVICE = {
  alive: 'береги деревья от опёнка: барьер (4) и подкормка водой',
  allies: 'подружись с каждым деревом поляны',
  growth: 'корми деревья водой и минералами, чтобы они росли',
  spores: 'выращивай больше грибов: осенью спор втрое больше',
  mushrooms: 'вырасти больше грибов у корней деревьев',
  pages: 'доведи страницу наблюдений до конца',
  rival: 'не отдавай деревья опёнку, освобождай их барьером (4)',
};

/** A part that is full or nearly (ratio from here on) is a reason «за». */
const PRAISED = 0.6;

/** «за: все деревья живы, +420 спор» (at most three reasons, the biggest first), or a line for a year with nothing to praise. */
export function gradeReason(g) {
  const good = g.parts.filter((p) => p.ratio >= PRAISED).sort((a, b) => b.pts - a.pts || b.ratio - a.ratio).slice(0, 3);
  if (!good.length) return 'записать пока нечего';
  return `за: ${good.map((p) => PRAISE[p.id](g.facts)).join(', ')}`;
}

/** «На будущий год: …»: the part that lost the most points, or what holds the grade back. */
export function gradeNext(g) {
  let id;
  if (g.capped === 'lost' || g.capped === 'ruin') id = 'alive';
  else {
    const gap = (p) => p.max - p.pts;
    const worst = g.parts.slice().sort((a, b) => gap(b) - gap(a))[0];
    id = gap(worst) >= 0.5 ? worst.id : null;
  }
  return id ? `На будущий год: ${ADVICE[id]}` : 'На будущий год: так держать, береги рощу';
}

/** Everything the year page and the closed page print about a grade. */
export function gradeLines(g) {
  const w = GRADE_WORDS[g.grade];
  return { ...w, grade: g.grade, score: g.score, reason: gradeReason(g), next: gradeNext(g) };
}

/** The grade of the year that has ended (the sim stored it at the year end: it survives a reload), else of the year so far. */
export function yearGrade(state, year) {
  const stored = ((state.flags && state.flags.yearGrades) || []).find((g) => g.year === year);
  return stored && stored.parts && stored.facts ? stored : gradeYear(state);
}

const minutes = (sec) => {
  const m = Math.max(1, Math.round(sec / 60));
  return `${m} ${ruPlural(m, 'минуту', 'минуты', 'минут')}`;
};

/** The cause of the closed page in words (for the sub-title). */
export function closedCause(state) {
  const c = pageClosed(state);
  if (!c) return '';
  if (c.cause === 'grove') {
    const byRival = Boolean(state.flags.rival && state.rival && state.rival.stats.lost > 0);
    return byRival ? 'Роща пала: опёнок взял последнее дерево' : 'Роща пала: не осталось ни одного дерева';
  }
  return `Сеть осталась без союзника на ${B.stakes.noAllySeconds} с`;
}

/** What to do differently, for the closed page. */
export function closedAdvice(state) {
  const c = pageClosed(state);
  if (!c) return '';
  return c.cause === 'grove'
    ? 'На будущий раз: опёнок идёт к деревьям, которым ты помогаешь; барьер (4) и подкормка не дают ему прорасти.'
    : 'На будущий раз: корень дерева — единственный союзник, потерянную связь тяни заново сразу.';
}

/** The numbers of the closed page. */
export function closedStats(state) {
  const trees = state.world.trees;
  const g = gradeClosed(state);
  return {
    cause: closedCause(state),
    advice: closedAdvice(state),
    time: minutes(state.time),
    spores: Math.floor(state.res.spores),
    length: Math.round(state.stats.hyphaeLength),
    lost: trees.filter((t) => t.lost).length,
    total: trees.length,
    grade: gradeLines(g),
  };
}

/**
 * The warning slip while the page may close: { key, text, tone } or null. It names the cause and the way out; the no-ally clock
 * counts down only while no hypha is growing. Silent in page 1, before the clock has run for B.stakes.noAllyShow s, and after the close.
 */
export function stakesSlip(state) {
  if (!state || !state.flags || !stakesOn(state) || pageClosed(state)) return null;
  const living = state.world.trees.filter((t) => !t.lost);
  const noAlly = state.flags.noAlly ?? 0;
  if (living.length > 0 && allies(state) === 0 && noAlly >= B.stakes.noAllyShow) {
    const left = Math.max(0, Math.ceil(B.stakes.noAllySeconds - noAlly));
    const growing = state.net.growing.length > 0;
    return {
      key: 'no-ally',
      tone: left <= 30 ? 'danger' : 'warn',
      text: growing ? 'Сеть без союзника: нить тянется, время стоит' : `Сеть без союзника: страница закроется через ${left} с`,
      hint: 'дотянись нитью до корня дерева',
    };
  }
  if (living.length === 1 && (living[0].infection ?? 0) >= B.stakes.lastTreeShow) {
    const pct = Math.round((living[0].infection ?? 0) * 100);
    return { key: 'last-tree', tone: 'danger', text: `Последнее дерево рощи гибнет (${pct} %): без него страница закроется`, hint: 'барьер (4) у захвата' };
  }
  return null;
}

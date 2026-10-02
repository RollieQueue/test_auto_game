// The words of the stakes (sim/stakes.js): the grade of a year, its reason and hint, the closed page and the warning slip.
// Pure data in, pure data out (tested in tests/stakes.test.mjs).
import { B } from '../sim/balance.js';
import { allies, gradeClosed, gradeYear, pageClosed, stakesOn } from '../sim/stakes.js';
import { isUnlocked } from '../sim/unlocks.js';
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
  alive: 'береги деревья от опёнка: барьер (4) и подкормка (5): сахар из полной кладовой — дереву',
  allies: 'подружись с каждым деревом поляны',
  growth: 'корми деревья водой и минералами, чтобы они росли',
  spores: 'выращивай больше грибов: осенью спор втрое больше',
  mushrooms: 'вырасти больше грибов у корней деревьев',
  pages: 'доведи страницу наблюдений до конца',
  rival: 'не отдавай деревья опёнку, освобождай их барьером (4)',
};
/** The same advice while «Подкормка» is still closed (page 1 not written yet): it names what opens the tool instead. */
const ADVICE_LOCKED = {
  alive: 'береги деревья от опёнка барьером (4); допиши первую страницу — она откроет подкормку',
};

/** A part that is full or nearly (ratio from here on) is a reason «за». */
const PRAISED = 0.6;

/** «за: все деревья живы, +420 спор» (at most three reasons, the biggest first), or a line for a year with nothing to praise. */
export function gradeReason(g) {
  const good = g.parts.filter((p) => p.ratio >= PRAISED).sort((a, b) => b.pts - a.pts || b.ratio - a.ratio).slice(0, 3);
  if (!good.length) return 'записать пока нечего';
  return `за: ${good.map((p) => PRAISE[p.id](g.facts)).join(', ')}`;
}

/** «На будущий год: …»: the part that lost the most points, or what holds the grade back. `feedOpen` false: «Подкормка» is still locked. */
export function gradeNext(g, feedOpen = true) {
  let id;
  if (g.capped === 'lost' || g.capped === 'ruin') id = 'alive';
  else {
    const gap = (p) => p.max - p.pts;
    const worst = g.parts.slice().sort((a, b) => gap(b) - gap(a))[0];
    id = gap(worst) >= 0.5 ? worst.id : null;
  }
  return id ? `На будущий год: ${(!feedOpen && ADVICE_LOCKED[id]) || ADVICE[id]}` : 'На будущий год: так держать, береги рощу';
}

/** Everything the year page and the closed page print about a grade (`state`, when given, tells whether «Подкормка» is open). */
export function gradeLines(g, state = null) {
  const w = GRADE_WORDS[g.grade];
  return { ...w, grade: g.grade, score: g.score, reason: gradeReason(g), next: gradeNext(g, !state || isUnlocked(state, 'feed')) };
}

/** The grade of the year that has ended (the sim stored it at the year end: it survives a reload), else of the year so far. */
export function yearGrade(state, year) {
  const stored = ((state.flags && state.flags.yearGrades) || []).find((g) => g.year === year);
  return stored && stored.parts && stored.facts ? stored : gradeYear(state);
}

/** What a part is short of, in the genitive after «не хватает»: from the facts of the grade. */
const MISSING = {
  alive: 'живых деревьев',
  allies: 'союзов',
  growth: 'роста деревьев',
  spores: 'спор',
  mushrooms: 'грибов',
  pages: 'дописанной страницы',
  rival: 'отпора опёнку',
};

/** A part that is short of at least this many points (of 100) is named; at most MISSING_MAX of them, the biggest first. */
const MISSING_GAP = 2;
const MISSING_MAX = 2;

/** The words of what the year so far lacks, the biggest gap first; a lost grove (the cap of the grade) comes first of all. */
export function gradeMissing(g) {
  const gap = (p) => p.max - p.pts;
  let ids = g.parts.filter((p) => gap(p) >= MISSING_GAP).sort((a, b) => gap(b) - gap(a)).map((p) => p.id);
  if (g.capped === 'lost' || g.capped === 'ruin') ids = ['alive', ...ids.filter((id) => id !== 'alive')];
  return ids.slice(0, MISSING_MAX).map((id) => MISSING[id]);
}

/** The grade of the year under way: { grade, seal, missing: [words] }, or null with the seasons off or after the page has closed. */
export function runningGrade(state) {
  if (!state || !state.flags || !state.flags.seasons || pageClosed(state)) return null;
  const g = gradeYear(state);
  return { grade: g.grade, seal: GRADE_WORDS[g.grade].seal, missing: gradeMissing(g) };
}

/** The calendar's tooltip line: «Отметка года пока: сносно · не хватает: спор» (null with the seasons off). */
export function gradeLine(state) {
  const r = runningGrade(state);
  if (!r) return null;
  return `Отметка года пока: ${r.seal} · ${r.missing.length ? `не хватает: ${r.missing.join(', ')}` : 'всё как надо'}`;
}

const TO_SEASON = { summer: 'К лету', autumn: 'К осени', winter: 'К зиме' };

/** The margin note at a season change: { key, text, tone } or null: «К зиме: сносно — не хватает спор». Calm: green when the year is fair or better, plain ink when it is poor. */
export function seasonGradeNote(state, season) {
  const r = TO_SEASON[season] && runningGrade(state);
  if (!r) return null;
  const tail = r.missing.length ? `не хватает ${r.missing.join(', ')}` : 'всё как надо';
  return { key: `grade:${season}`, text: `${TO_SEASON[season]}: ${r.seal} — ${tail}`, tone: r.grade === 'poor' ? '' : 'good', icon: 'check' };
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
  if (c.cause === 'grove' && !isUnlocked(state, 'feed')) {
    return 'На будущий раз: опёнок идёт к деревьям, которым ты помогаешь; барьер (4) бережёт их корни, а дописанная первая страница откроет подкормку.';
  }
  return c.cause === 'grove'
    ? 'На будущий раз: опёнок идёт к деревьям, которым ты помогаешь; барьер (4) и подкормка (5) берегут их корни.'
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
    grade: gradeLines(g, state),
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

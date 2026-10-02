// The HUD side of the soil threats (nematodes, trapping rings, chapters): the pure part, no DOM.
// Everything is read defensively: the sim may omit any field of the contract and the text must still make sense.
import * as balance from '../sim/balance.js';
import { mushroomCost } from '../sim/mushrooms.js';

/** What the next mushroom really costs (it grows with threats on and with every mushroom standing). */
export function fruitCostOf(state) {
  try {
    if (state && Array.isArray(state.mushrooms)) return Math.round(mushroomCost(state));
  } catch {
    // a partial state (tests, help page before a game): fall back to the base price
  }
  return Math.round(balance.B?.mushroomCost ?? 24);
}

export const DEFAULT_TRAP_COST = 30;
export const LAST_CHAPTER = balance.B?.chapterCount ?? 4; // pages of observations in the sim; `state.chapterCount` overrides it

/** Russian plural: 1 узел, 2 узла, 5 узлов. */
export function ruPlural(n, one, few, many) {
  const a = Math.abs(Math.round(n));
  const m10 = a % 10;
  const m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const count = (n, one, few, many) => `${Math.round(n)} ${ruPlural(n, one, few, many)}`;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const threatsOn = (state) => Boolean(state && state.flags && state.flags.threats);

/** Price of a trapping ring in sugar. */
export function trapCost(B = balance.B) {
  const v = B && B.trapCost;
  return isNum(v) && v > 0 ? Math.round(v) : DEFAULT_TRAP_COST;
}

/** «30 сахара» (genitive after any number). */
const sugarWord = (n) => `${n} сахара`;

/**
 * The pointer tooltip of the trap tool, from `state.ui.trapPick` = null | { ok, reason }.
 * Returns { main, sub, warn } (never null: in trap mode the tooltip always says something).
 */
export function describeTrapPick(pick, cost, sugarHave) {
  if (!pick) {
    return { main: 'Ловчее кольцо', sub: `цена ${sugarWord(cost)} · поставь на нить`, warn: false };
  }
  const have = Math.floor(sugarHave || 0);
  if (pick.ok && have < cost) {
    return { main: 'Не хватает сахара на кольцо', sub: `нужно ${cost}, есть ${have}`, warn: true };
  }
  if (pick.ok) {
    return { main: `Ловчее кольцо · цена ${sugarWord(cost)}`, sub: 'щёлкни: нематоды у этого места застрянут', warn: false };
  }
  switch (pick.reason) {
    case 'sugar':
      return { main: 'Не хватает сахара на кольцо', sub: `нужно ${cost}, есть ${have}`, warn: true };
    case 'crowded':
      return { main: 'Рядом уже есть кольцо', sub: 'поставь следующее подальше', warn: true };
    case 'dead':
      return { main: 'Эта нить отмерла', sub: 'кольцо держится только на живой нити', warn: true };
    case 'off':
      return { main: 'Кольцо ставят на нить', sub: 'подведи курсор ближе к нити', warn: true };
    default:
      return { main: 'Здесь кольцо не поставить', sub: '', warn: true };
  }
}

/** The title of the tool tab; `digest` (s) is given once page 2 is closed: the ring is ready again that soon after a catch. */
export function trapTabTitle(cost, digest = 0) {
  const more = digest > 0 ? `. Крепкое кольцо: после улова снова готово через ${Math.round(digest)} с` : '';
  return `Ловчее кольцо (3): цена ${sugarWord(cost)}. Нематоды застревают в нём, а ты получаешь их минералы${more}`;
}

// ---- chapters --------------------------------------------------------------------------------------------

/** The chapter the player is on (1 when the sim has none). */
export function chapterOf(state) {
  const c = state && state.chapter;
  return isNum(c) && c >= 1 ? Math.floor(c) : 1;
}

export function chapterTotal(state) {
  const c = state && state.chapterCount;
  return isNum(c) && c >= 1 ? Math.floor(c) : LAST_CHAPTER;
}

/** Heading of the objectives card: «Глава 2» with threats, «Наблюдения» without. */
export function objectivesTitle(state) {
  return threatsOn(state) ? `Глава ${chapterOf(state)}` : 'Наблюдения';
}

/**
 * Texts of the «page complete» summary for the chapter that was just finished (`completed`).
 * Without threats it is the old page; the last chapter keeps «continue» (there is no further page to turn to).
 */
export function summaryTexts(state, completed = chapterOf(state)) {
  if (!threatsOn(state)) {
    return {
      overline: 'Тетрадь натуралиста · итог',
      title: 'Поляна изучена',
      sub: 'все наблюдения отмечены',
      seal: 'наблюдения<br />завершены',
      button: 'Продолжить наблюдения',
      hasNext: false,
    };
  }
  const total = chapterTotal(state);
  const hasNext = completed < total;
  return {
    overline: `Тетрадь натуралиста · глава ${completed}`,
    title: 'Страница наблюдений заполнена',
    sub: hasNext ? `глава ${completed} из ${total} · дальше труднее` : `глава ${completed} из ${total} · все страницы заполнены`,
    seal: hasNext ? `глава ${completed}<br />пройдена` : 'тетрадь<br />заполнена',
    button: hasNext ? 'Перевернуть страницу' : 'Продолжить наблюдения',
    hasNext,
  };
}

// ---- labels and notes ------------------------------------------------------------------------------------

/** Threat events that get a floating label at their place on the map. */
export const THREAT_LOCAL = new Set([
  'bite',
  'severed',
  'worm-caught',
  'trap-placed',
  'trap-ready',
  'trap-spent',
  'trap-denied',
  'mushroom-wilted',
]);

/** Local threat events that also leave a margin note (the loss or gain matters beyond the spot). */
export const THREAT_BOTH = new Set(['severed', 'worm-caught', 'trap-spent', 'mushroom-wilted']);

const nodesLost = (ev) => (isNum(ev.nodes) ? ev.nodes : isNum(ev.lost) ? ev.lost : null);
const mineralsOf = (ev) => (isNum(ev.minerals) ? Math.max(0, Math.round(ev.minerals)) : null);

/**
 * Why the net was cut in this frame: the cause of the first 'severed' event ('worm' when it says nothing). The
 * 'mushroom-wilted' events of the same cut do not carry it, and a mushroom lost to starvation did not meet a worm.
 */
export function cutCause(events) {
  for (const e of events || []) if (e && e.type === 'severed') return e.cause === 'starved' || e.cause === 'rival' ? e.cause : 'worm';
  return 'worm';
}

/** Floating label for a threat event: { key, text, tone, icon } or null. Bite throttling is the caller's job. `cause`: see cutCause. */
export function threatLabel(ev, cause = 'worm') {
  switch (ev.type) {
    case 'bite':
      return { key: 'bite', text: 'укус', tone: 'bite', icon: 'worm' };
    case 'severed': {
      const n = nodesLost(ev);
      if (ev.cause === 'starved') return { key: 'severed:starved', text: n ? `отмерло: −${n}` : 'нить отмерла', tone: 'warn', icon: 'snip' };
      if (ev.cause === 'rival') return { key: 'severed:rival', text: n ? `съедено ризоморфом: −${n}` : 'нить съедена ризоморфом', tone: 'warn', icon: 'snip' };
      return { key: 'severed', text: n ? `перекушено: −${n}` : 'перекушено', tone: 'warn', icon: 'snip' };
    }
    case 'worm-caught': {
      const m = mineralsOf(ev);
      return { key: 'caught', text: m ? `+${count(m, 'минерал', 'минерала', 'минералов')}` : 'поймана!', tone: 'mineral', icon: 'ring' };
    }
    case 'trap-placed':
      return { key: 'trap:placed', text: 'кольцо', tone: 'good', icon: 'ring' };
    case 'trap-ready':
      return { key: 'trap:ready', text: 'кольцо готово', tone: 'good', icon: 'ring' };
    case 'trap-spent':
      return { key: 'trap:spent', text: 'истощилось', tone: 'warn', icon: 'ring' };
    case 'trap-denied': {
      const text =
        ev.reason === 'sugar'
          ? 'на кольцо не хватает сахара'
          : ev.reason === 'crowded'
            ? 'рядом уже есть кольцо'
            : ev.reason === 'dead'
              ? 'нить здесь отмерла'
              : 'кольцо ставят на нить';
      return { key: `trap:denied:${ev.reason}`, text, tone: 'warn', icon: ev.reason === 'sugar' ? 'sugar' : 'ring' };
    }
    case 'mushroom-wilted':
      return { key: 'wilted', text: cause === 'starved' ? 'гриб погиб: нить отмерла' : cause === 'rival' ? 'гриб погиб: нить съедена' : 'гриб погиб: нить перекушена', tone: 'warn', icon: 'mushroom' };
    default:
      return null;
  }
}

/** Margin note for a threat event: { key, text, tone, icon, life? } or null. `cause`: see cutCause. */
export function threatNote(ev, cause = 'worm') {
  switch (ev.type) {
    case 'severed': {
      const n = nodesLost(ev);
      if (ev.cause === 'starved') {
        const text = n ? `Нить отмерла без сахара: отмерло ${count(n, 'узел', 'узла', 'узлов')}` : 'Нить отмерла без сахара: часть сети погибла';
        return { key: 'threat:starved', text, tone: 'warn', icon: 'snip' };
      }
      if (ev.cause === 'rival') {
        const text = n ? `Ризоморф съел нить: отмерло ${count(n, 'узел', 'узла', 'узлов')}` : 'Ризоморф съел нить: часть сети отмерла';
        return { key: 'threat:rival-cut', text, tone: 'warn', icon: 'snip' };
      }
      const text = n ? `Нить перекушена: отмерло ${count(n, 'узел', 'узла', 'узлов')}` : 'Нить перекушена: часть сети отмерла';
      return { key: 'threat:severed', text, tone: 'warn', icon: 'snip' };
    }
    case 'worm-caught': {
      const m = mineralsOf(ev);
      return {
        key: 'threat:caught',
        text: m ? `Кольцо поймало нематоду: +${count(m, 'минерал', 'минерала', 'минералов')}` : 'Кольцо поймало нематоду',
        tone: 'good',
        icon: 'ring',
      };
    }
    case 'trap-spent':
      return { key: 'threat:spent', text: 'Кольцо истощилось', tone: 'warn', icon: 'ring' };
    case 'mushroom-wilted':
      return {
        key: 'threat:wilted',
        text: cause === 'starved' ? 'Гриб погиб: нить отмерла без сахара' : cause === 'rival' ? 'Гриб погиб: нить съедена ризоморфом' : 'Гриб погиб: нить перекушена',
        tone: 'warn',
        icon: 'mushroom',
      };
    case 'chapter': {
      const n = isNum(ev.chapter) ? Math.floor(ev.chapter) : null;
      return {
        key: 'threat:chapter',
        text: n ? `Глава ${n}: новая страница, наблюдения труднее` : 'Новая страница наблюдений',
        tone: 'good',
        icon: 'find',
        life: 9,
      };
    }
    default:
      return null;
  }
}

export const WORM_SENSE_NOTE = 'Нематода учуяла нить — поставь ловчее кольцо (3) у неё на пути';

/**
 * Rate limit of the «нематода учуяла нить» note: at most `max` times per game and `gap` seconds of game time
 * apart (every worm senses once, and a glade can hold several). `take(now)` says whether to show it now.
 */
export function createSenseGate(max = 3, gap = 30) {
  let shown = 0;
  let last = -Infinity;
  return {
    take(now) {
      if (shown >= max || now - last < gap) return false;
      shown += 1;
      last = now;
      return true;
    },
    reset() {
      shown = 0;
      last = -Infinity;
    },
  };
}

/** The margin note that opens the ring for a player who has met the worms before (the first time ever it is the card, ui/callout.js). */
export const FIRST_WORM_NOTE = 'В почве нематоды: они перекусывают тонкие нити. Поставь ловчее кольцо — клавиша 3';

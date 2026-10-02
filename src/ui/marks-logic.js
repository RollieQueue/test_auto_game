// «Пометки на полях»: achievements written as the naturalist's ink marks. Pure data in, pure data out (tested in
// tests/marks.test.mjs). A mark is earned from three kinds of signals:
//   - the game's state (linked trees, mature mushrooms),
//   - the events of the frame (state.events: severed, tree-freed, season, year-end ...) folded into a per-game tracker,
//   - the lifetime memory (species played, biomes seen, the atlas's finds) that outlives a game (marks-store.js).
import { FUNGUS_IDS, fungusId } from '../sim/species.js';
import { BIOME_IDS } from '../world/biomes.js';
import { KINDS } from './atlas-logic.js';

export const FUNGAL_YEAR = 6; // mature mushrooms grown in one year for «Грибной год»
export const TEN_FINDS = 10; // finds over all games for «Десять находок»
export const TREES_UNION = 3; // trees linked for «Союз трёх деревьев»

/**
 * The marks, easiest first. `kind`: 'game' (earned in a game) or 'life' (counted over all games). `icon` names an icon
 * of icons.js (markIcons at its end). `line` is the naturalist's remark, `cond` what has to be done.
 */
export const MARKS = [
  { id: 'first_fruit', kind: 'game', icon: 'mk_fruit', title: 'Первый плод', line: 'Нить вышла к свету и стала шляпкой. Записываю день, когда подземное стало видимым.', cond: 'Вырастить первый зрелый гриб.' },
  { id: 'union3', kind: 'game', icon: 'mk_trio', title: 'Союз трёх деревьев', line: 'Три ствола и одна сеть. Лес говорит, а я подслушиваю под корнями.', cond: 'Связать нитью три дерева на одной поляне.' },
  { id: 'year2', kind: 'game', icon: 'mk_year', title: 'Второй год наблюдений', line: 'Один год это случай, два уже наблюдение. Кольцо в тетради легло рядом с первым.', cond: 'Прожить на поляне целый год и начать второй (нужны времена года).' },
  { id: 'trap', kind: 'game', icon: 'mk_trap', title: 'Червь в кольце', line: 'Нематода сунулась в ловушку и сама стала удобрением. Минералов в тот день хватило.', cond: 'Поймать червя кольцом-ловушкой.' },
  { id: 'freed', kind: 'game', icon: 'mk_freed', title: 'Освобождённое дерево', line: 'Барьер лёг вовремя, и ствол вздохнул свободнее. Опёнок отступил ни с чем.', cond: 'Освободить барьером дерево из хватки опёнка.' },
  { id: 'ten_finds', kind: 'life', icon: 'mk_ten', title: 'Десять находок', line: 'Десять диковин под страницами. Земля щедра к тому, кто копает осторожно.', cond: 'Записать в атлас десять находок за все игры.' },
  { id: 'forests3', kind: 'life', icon: 'mk_forests', title: 'Три леса', line: 'Берёзы, дубы, сосны. Чужая почва учит больше своей.', cond: 'Побывать на полянах трёх разных лесов.' },
  { id: 'fungal_year', kind: 'game', icon: 'mk_basket', title: 'Грибной год', line: 'Шесть шляпок за один год: лес был щедр, а я успевал собирать наблюдения.', cond: `Вырастить ${FUNGAL_YEAR} зрелых грибов за один год (нужны времена года).` },
  { id: 'winter', kind: 'game', icon: 'mk_frost', title: 'Зима без потерь', line: 'Снег лёг на поляну, а нити под ним уцелели. Холод ничего не взял.', cond: 'Пережить зиму, не потеряв ни ветви, ни дерева (нужны времена года).' },
  { id: 'chapter', kind: 'game', icon: 'mk_page', title: 'Глава без укусов', line: 'Черви бродили целую страницу, а нить осталась цела. Ни одного надкуса на полях.', cond: 'Закончить страницу наблюдений, пока черви были рядом, но не отгрызли ни одной ветви.' },
  { id: 'honey_year', kind: 'game', icon: 'mk_honey', title: 'Год без потерь опёнку', line: 'Опёнок ходил кругами целый год и хватал, но ни один ствол ему не достался.', cond: 'Прожить целый год рядом с опёнком, не потеряв ни одного дерева; он должен хоть раз схватить дерево.' },
  { id: 'union_all', kind: 'game', icon: 'mk_net', title: 'Вся поляна в сети', line: 'Ни одного одинокого ствола. Под травой всё уже связано, как в хорошем гербарии.', cond: 'Связать нитью все деревья поляны, не потеряв ни одного.' },
  { id: 'four', kind: 'life', icon: 'mk_four', title: 'Четыре гриба', line: 'Мухомор, белый, рыжик, лисичка: у каждого свой нрав, свой партнёр и своя страница.', cond: 'Сыграть всеми четырьмя видами гриба.' },
  { id: 'atlas_full', kind: 'life', icon: 'mk_atlas', title: 'Полный атлас', line: 'Все виды на страницах. Теперь тетрадь можно перелистать с начала и не пропустить ничего.', cond: `Открыть в атласе все ${KINDS.length} видов находок.` },
];

export const MARK_IDS = MARKS.map((m) => m.id);
export const markById = (id) => MARKS.find((m) => m.id === id) || null;

/** The lifetime memory of nothing (marks-store.js keeps the real one): earned marks, species played, biomes seen. */
export const emptyMemory = () => ({ earned: {}, species: [], biomes: [] });

/** A fresh per-game tracker: what the events of this game have said so far. A new game makes a new one. */
export function newTracker() {
  return {
    winter: null, // { clean } while a winter runs: no branch and no tree lost
    chapterWorms: 0, // worms that came this page
    chapterCuts: 0, // branches they cut this page
    yearMature: 0, // mushrooms that matured this year
    yearLost: 0, // trees the honey fungus took this year
    yearGrips: 0, // trees it gripped this year
    yearRival: null, // was the honey fungus awake when the year began (null: not seen yet)
  };
}

/** Trees the player's network reaches (linked and alive), and all the trees of the glade. */
const linkedTrees = (state) => ((state && state.world && state.world.trees) || []).filter((t) => t.linked && !t.lost).length;

const rivalAwake = (state) => Boolean(state && state.flags && state.flags.rival && state.rival && state.rival.awake);

/** Folds one frame's events into the tracker; returns the ids of the marks the events earned. */
function foldEvents(state, events, tracker, earn) {
  if (tracker.yearRival === null) tracker.yearRival = rivalAwake(state);
  for (const ev of events || []) {
    switch (ev && ev.type) {
      case 'mushroom-mature':
        earn('first_fruit');
        tracker.yearMature++;
        break;
      case 'worm-caught':
        earn('trap');
        break;
      case 'worm-spawn':
        tracker.chapterWorms++;
        break;
      case 'severed':
        if (ev.cause === 'worm') tracker.chapterCuts++;
        if (tracker.winter) tracker.winter.clean = false;
        break;
      case 'tree-lost':
        tracker.yearLost++;
        if (tracker.winter) tracker.winter.clean = false;
        break;
      case 'rival-grip':
        tracker.yearGrips++;
        break;
      case 'tree-freed':
        earn('freed');
        break;
      case 'season':
        if (tracker.winter && ev.season !== 'winter') {
          if (tracker.winter.clean && linkedTrees(state) > 0) earn('winter');
          tracker.winter = null;
        }
        if (ev.season === 'winter') tracker.winter = { clean: true };
        break;
      case 'year-end':
        earn('year2');
        if (tracker.yearMature >= FUNGAL_YEAR) earn('fungal_year');
        if (state.flags && state.flags.rival && tracker.yearRival && rivalAwake(state) && tracker.yearGrips > 0 && tracker.yearLost === 0) earn('honey_year');
        tracker.yearMature = 0;
        tracker.yearLost = 0;
        tracker.yearGrips = 0;
        tracker.yearRival = rivalAwake(state);
        break;
      case 'all-objectives':
        if (state.flags && state.flags.threats && tracker.chapterWorms > 0 && tracker.chapterCuts === 0) earn('chapter');
        tracker.chapterWorms = 0;
        tracker.chapterCuts = 0;
        break;
      default:
    }
  }
}

/** Species of this glade's game that count for «Четыре гриба» (a game without a pick plays the generalist and counts for none). */
export const speciesOf = (state) => {
  const id = fungusId(state);
  return id === 'common' ? null : id;
};

/** Lifetime progress for the marks counted over all games: { n, of }. `kinds` is the atlas store's { [kind]: count }. */
export function lifetimeProgress(id, memory, kinds = {}) {
  const mem = memory || emptyMemory();
  switch (id) {
    case 'four':
      return { n: FUNGUS_IDS.filter((s) => mem.species.includes(s)).length, of: FUNGUS_IDS.length };
    case 'forests3':
      return { n: Math.min(3, BIOME_IDS.filter((b) => mem.biomes.includes(b)).length), of: 3 };
    case 'ten_finds':
      return { n: Math.min(TEN_FINDS, KINDS.reduce((s, k) => s + (Number.isInteger(kinds[k]) ? kinds[k] : 0), 0)), of: TEN_FINDS };
    case 'atlas_full':
      return { n: KINDS.filter((k) => kinds[k] > 0).length, of: KINDS.length };
    default:
      return null;
  }
}

/**
 * The marks this frame earned. `state` is the game state, `events` its events of the frame, `tracker` the per-game
 * tracker (newTracker(), mutated here), `memory` the lifetime memory (marks-store.js) and `kinds` the atlas's lifetime
 * counts. Marks already in memory.earned are never returned again. The result is in the order of MARKS.
 */
export function checkMarks(state, events, tracker, memory, kinds = {}) {
  if (!state || !state.world) return [];
  const mem = memory || emptyMemory();
  const got = new Set();
  const earn = (id) => {
    if (!mem.earned[id]) got.add(id);
  };
  foldEvents(state, events, tracker, earn);

  // state signals
  if ((state.mushrooms || []).some((m) => m.mature)) earn('first_fruit');
  const trees = state.world.trees || [];
  if (linkedTrees(state) >= TREES_UNION) earn('union3');
  if (trees.length >= TREES_UNION && trees.every((t) => t.linked && !t.lost)) earn('union_all');

  // lifetime signals
  for (const id of ['four', 'forests3', 'ten_finds', 'atlas_full']) {
    const p = lifetimeProgress(id, mem, kinds);
    if (p.n >= p.of) earn(id);
  }
  return MARK_IDS.filter((id) => got.has(id));
}

// ---- texts for the page and the note ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

/** «02.10.2026» for a time in ms; '' for a bad value. */
export function dateText(ms) {
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` : '';
}

/** «Пометка на полях: «Союз трёх деревьев»» */
export const noteText = (mark) => `Пометка на полях: «${mark.title}»`;

/** «Отмечено 3 из 13» */
export const marksProgress = (n, total = MARKS.length) => `отмечено ${n} из ${total}`;

/**
 * One row per mark for the page, in the order of MARKS: the definition plus `earned` ({ at, glade } or null), `date`,
 * `glade` and, for a lifetime mark not earned yet, `progress` ({ n, of } and `progressText` «2 из 4»).
 */
export function marksModel(memory, kinds = {}) {
  const mem = memory || emptyMemory();
  const entries = MARKS.map((m) => {
    const rec = mem.earned[m.id] || null;
    const p = !rec && m.kind === 'life' ? lifetimeProgress(m.id, mem, kinds) : null;
    return {
      ...m,
      earned: rec,
      date: rec ? dateText(rec.at) : '',
      glade: rec ? rec.glade || '' : '',
      progress: p,
      progressText: p ? `${p.n} из ${p.of}` : '',
    };
  });
  const n = entries.filter((e) => e.earned).length;
  return { entries, earned: n, total: MARKS.length, progress: marksProgress(n) };
}

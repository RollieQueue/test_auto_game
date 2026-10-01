// The «Наблюдения» of the notebook. Page 1 is the five first observations (always). With state.flags.threats the
// notebook goes on: when a page is complete the next one opens (chapters 2 and 3, harder ones), and the last page
// closes the book. state.objectives always holds the current page; state.chapter says which.
import { B } from './balance.js';

export const OBJECTIVES = [
  { id: 'water', text: 'Дотянуться до воды' },
  { id: 'tree', text: 'Заключить союз с деревом' },
  { id: 'mushroom', text: 'Вырастить первый гриб' },
  { id: 'treeGrow', text: 'Помочь дереву подрасти' },
  { id: 'spores', text: 'Собрать 100 спор' },
];

/** Page titles, for the HUD (chapter 3 differs with and without seasons only in its first observation). */
export const CHAPTER_TITLES = { 1: 'Первые нити', 2: 'Тревожная почва', 3: 'Большая грибница' };

/** The observations of a chapter (1..3); `seasons` picks the winter observation for page 3, a sugar reserve without it. */
export function pageObjectives(chapter, seasons = false) {
  if (chapter === 2) {
    return [
      { id: 'allies', text: 'Подружиться со всеми деревьями поляны' },
      { id: 'ancient', text: 'Вырастить вековое дерево' },
      { id: 'gravel', text: 'Протянуть нить до галечника' },
      { id: 'finds', text: `Записать в тетрадь ${B.chapter2Finds} вида находок` },
      { id: 'worms', text: `Поймать ${B.chapter2Worms} нематод в ловчие кольца` },
      { id: 'spores500', text: `Собрать ${B.chapter2Spores} спор` },
    ];
  }
  if (chapter === 3) {
    return [
      seasons
        ? { id: 'winter', text: `Дожить до весны с запасом в ${B.winterSugar} сахара` }
        : { id: 'reserve', text: `Накопить запас в ${B.reserveSugar} сахара` },
      { id: 'mushrooms8', text: `Вырастить ${B.chapter3Mushrooms} грибов разом` },
      { id: 'spores1500', text: `Собрать ${B.chapter3Spores} спор` },
    ];
  }
  return OBJECTIVES;
}

export function createObjectives(chapter = 1, seasons = false) {
  return pageObjectives(chapter, seasons).map((o) => ({ ...o, done: false }));
}

/** Depth (below the surface) at which the gravel horizon begins in this world. */
const gravelDepth = (world) => world.horizons[world.horizons.length - 1].depth;

const CHECKS = {
  water: (state) => state.net.links.some((l) => l.kind === 'water'),
  tree: (state) => state.net.links.some((l) => l.kind === 'tree'),
  mushroom: (state) => state.mushrooms.some((m) => m.mature),
  treeGrow: (state) => state.sim.treeStageUps > 0,
  spores: (state) => state.res.spores >= B.sporesGoal,
  // chapter 2
  allies: (state) => state.world.trees.every((t) => state.sim.contacts[t.id].length > 0),
  ancient: (state) => state.world.trees.some((t) => t.stage >= 3),
  gravel: (state) => state.stats.maxDepth >= gravelDepth(state.world),
  finds: (state) => new Set(Object.values(state.finds ?? {}).map((f) => f.kind)).size >= B.chapter2Finds,
  worms: (state) => state.sim.threat.caught >= B.chapter2Worms,
  spores500: (state) => state.res.spores >= B.chapter2Spores,
  // chapter 3
  winter: (state) => state.clock.season === 'winter' && state.clock.seasonFrac >= 0.9 && state.res.sugar >= B.winterSugar,
  reserve: (state) => state.res.sugar >= B.reserveSugar,
  mushrooms8: (state) => state.mushrooms.filter((m) => m.mature).length >= B.chapter3Mushrooms,
  spores1500: (state) => state.res.spores >= B.chapter3Spores,
};

/**
 * Ticks the current page. When it is complete: `all-objectives { chapter }`; with threats on, the next page opens
 * (`chapter { chapter }`, state.chapter, state.objectives) or, after the last, flags.bookDone. flags.allObjectivesDone
 * means «page 1 is complete» and stays true (without threats there is only page 1, as before); flags.pagesDone counts
 * the completed pages (threats only).
 */
export function stepObjectives(state) {
  const { flags, events } = state;
  const chapters = Boolean(flags.threats);
  if (flags.bookDone || (flags.allObjectivesDone && !chapters)) return;
  let all = true;
  for (const o of state.objectives) {
    if (!o.done && CHECKS[o.id](state)) {
      o.done = true;
      events.push({ type: 'objective', id: o.id, text: o.text });
    }
    all = all && o.done;
  }
  if (!all) return;
  const n = state.chapter ?? 1;
  if (n === 1) flags.allObjectivesDone = true;
  events.push({ type: 'all-objectives', chapter: n });
  if (!chapters) return;
  flags.pagesDone = n;
  if (n < B.chapterCount) {
    state.chapter = n + 1;
    state.objectives = createObjectives(n + 1, Boolean(flags.seasons));
    events.push({ type: 'chapter', chapter: n + 1 });
  } else {
    flags.bookDone = true;
  }
}

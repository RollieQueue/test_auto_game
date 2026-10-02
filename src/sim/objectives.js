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

/** Page titles, for the HUD (page 3 differs with and without seasons only in its winter observation). */
export const CHAPTER_TITLES = { 1: 'Первые нити', 2: 'Тревожная почва', 3: 'Большая грибница', 4: 'Урожайный год' };

/** The one observation of page 3 that belongs to the glade (its biome), as a function of B.glade. */
const GLADE_OBJECTIVES = {
  birch: () => ({ id: 'gladeBirch', text: `Напоить рощу: держать ${B.glade.birchWater} воды в запасе ${B.glade.holdSeconds} с подряд` }),
  oak: () => ({ id: 'gladeOak', text: 'Довести каждый дуб поляны до зрелости' }),
  pine: () => ({ id: 'gladePine', text: `Освоить ${B.glade.pinePhosphorus} фосфорных кристалла` }),
  mixed: () => ({ id: 'gladeMixed', text: 'Вырастить гриб у корней дерева каждого вида' }),
};

/** The glade observation that must be kept up for B.glade.holdSeconds in a row (state.sim.holdT counts the seconds). */
const HOLDS = {
  gladeBirch: (state) => state.res.water >= B.glade.birchWater,
};

/**
 * The observations of a chapter (1..4), never more than five on a page and, inside a page, from the quick to the slow ones.
 * Page 2 is the alarming soil: allies, finds, the gravel, worms and, with the honey fungus (`rival` = state.flags.rival), the
 * answer to it. Page 3 is the long look: the glade's own observation (`biome` = world.biome), an ancient tree, eight mushrooms,
 * a winter reserve (`seasons` picks the winter, a sugar stock without it) and the mantle of every tree against the honey
 * fungus. Page 4 is the harvest of spores. (Until run 8 page 2 held eight observations, among them the ancient tree and 500
 * spores: a bot got through it in 1500 s on one seed of eight.)
 */
export function pageObjectives(chapter, seasons = false, biome = null, rival = false) {
  if (chapter === 2) {
    return [
      { id: 'allies', text: 'Подружиться со всеми деревьями поляны' },
      { id: 'finds', text: `Записать в тетрадь ${B.chapter2Finds} вида находок` },
      { id: 'gravel', text: 'Протянуть нить до галечника' },
      { id: 'worms', text: `Поймать ${B.chapter2Worms} нематод в ловчие кольца` },
      ...(rival ? [{ id: 'rivalCut', text: `Спасти ${B.rivalCutFreed} дерева от опёнка или перерезать ${B.rivalCutGoal} тяжей (клавиша 4)` }] : []),
    ];
  }
  if (chapter === 3) {
    const glade = GLADE_OBJECTIVES[biome]?.();
    return [
      ...(glade ? [glade] : []),
      { id: 'ancient', text: 'Вырастить вековое дерево' },
      { id: 'mushrooms8', text: `Вырастить ${B.chapter3Mushrooms} грибов разом` },
      seasons
        ? { id: 'winter', text: `Дожить до весны с запасом в ${B.winterSugar} сахара` }
        : { id: 'reserve', text: `Накопить запас в ${B.reserveSugar} сахара` },
      ...(rival ? [{ id: 'rivalGuard', text: `Укрепить защиту рощи: у каждого дерева не меньше ${Math.round(B.mantleGoal * 100)} % защиты от опёнка` }] : []),
    ];
  }
  if (chapter === 4) {
    return [
      { id: 'spores500', text: `Собрать ${B.chapter2Spores} спор` },
      { id: 'spores1500', text: `Собрать ${B.chapter3Spores} спор` },
    ];
  }
  return OBJECTIVES;
}

export function createObjectives(chapter = 1, seasons = false, biome = null, rival = false) {
  return pageObjectives(chapter, seasons, biome, rival).map((o) => ({ ...o, done: false }));
}

/** Depth (below the surface) at which the gravel horizon begins in this world. */
const gravelDepth = (world) => world.horizons[world.horizons.length - 1].depth;

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * What the player did since the current page opened: trees freed and rhizomorph segments cut (the honey fungus wakes in
 * page 1, so its stats run from game start) and worms caught (rings catch them on page 1 as well). The numbers at the
 * moment the page opened are in state.sim.pageBase = { chapter, freed, cut, caught } (it is in sim.rest, so a save keeps
 * it); a state without one for this page (an old save, a hand-made test) counts from zero.
 */
export function pageCounts(state) {
  const b = state.sim?.pageBase;
  const base = b && b.chapter === (state.chapter ?? 1) ? b : {};
  const st = state.rival?.stats ?? {};
  return {
    freed: Math.max(0, num(st.freedTrees) - num(base.freed)),
    cut: Math.max(0, num(st.cut) - num(base.cut)),
    caught: Math.max(0, num(state.sim?.threat?.caught) - num(base.caught)),
  };
}

/** Opens page `n`: its observations, and the baseline of pageCounts. */
function openPage(state, n) {
  const st = state.rival?.stats ?? {};
  state.sim.pageBase = { chapter: n, freed: num(st.freedTrees), cut: num(st.cut), caught: num(state.sim.threat?.caught) };
  state.chapter = n;
  state.objectives = createObjectives(n, Boolean(state.flags.seasons), state.world.biome, Boolean(state.flags.rival));
  state.events.push({ type: 'chapter', chapter: n });
}

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
  worms: (state) => pageCounts(state).caught >= B.chapter2Worms,
  spores500: (state) => state.res.spores >= B.chapter2Spores,
  gladeBirch: (state) => state.sim.holdT >= B.glade.holdSeconds,
  gladeOak: (state) => state.world.trees.filter((t) => t.species === 'oak' && !t.lost).every((t) => t.stage >= 2),
  gladePine: (state) =>
    new Set(state.net.links.filter((l) => l.kind === 'mineral' && state.world.minerals[l.targetId].kind === 'phosphorus').map((l) => l.targetId)).size >=
    B.glade.pinePhosphorus,
  // a grown mushroom within B.glade.mixedReach (horizontally) of a tree of every species of the glade
  gladeMixed: (state) => {
    const grown = state.mushrooms.filter((m) => m.mature);
    return [...new Set(state.world.trees.map((t) => t.species))].every((sp) =>
      state.world.trees.some((t) => t.species === sp && grown.some((m) => Math.abs(m.x - t.x) <= B.glade.mixedReach)),
    );
  },
  // chapter 3
  winter: (state) => state.clock.season === 'winter' && state.clock.seasonFrac >= 0.9 && state.res.sugar >= B.winterSugar,
  reserve: (state) => state.res.sugar >= B.reserveSugar,
  // the honey fungus: trees freed by barriers or segments cut by them (the player can always grow to a rhizomorph and cut it);
  // a mantle on every living tree (a lost tree is no longer the player's to keep, so it does not count)
  rivalCut: (state) => pageCounts(state).freed >= B.rivalCutFreed || pageCounts(state).cut >= B.rivalCutGoal,
  rivalGuard: (state) => {
    const living = state.world.trees.filter((t) => !t.lost);
    return living.length > 0 && living.every((t) => (t.mantle ?? 0) >= B.mantleGoal);
  },
  mushrooms8: (state) => state.mushrooms.filter((m) => m.mature).length >= B.chapter3Mushrooms,
  spores1500: (state) => state.res.spores >= B.chapter3Spores,
};

const clampN = (v, max) => Math.max(0, Math.min(max, Math.floor(Number.isFinite(v) ? v : 0)));

/**
 * How far an observation is, as [have, need, unit?] (whole numbers, have <= need) or null where it has no count (the three first
 * steps of page 1 are single acts). The HUD writes it behind the line: «Собрать 500 спор · 212/500». Reads the same facts as
 * CHECKS, so a line that says need/need is the one that is ticked.
 */
export const COUNTS = {
  spores: (s) => [clampN(s.res.spores, B.sporesGoal), B.sporesGoal],
  spores500: (s) => [clampN(s.res.spores, B.chapter2Spores), B.chapter2Spores],
  spores1500: (s) => [clampN(s.res.spores, B.chapter3Spores), B.chapter3Spores],
  allies: (s) => [s.world.trees.filter((t) => s.sim.contacts[t.id].length > 0).length, s.world.trees.length],
  finds: (s) => [clampN(new Set(Object.values(s.finds ?? {}).map((f) => f.kind)).size, B.chapter2Finds), B.chapter2Finds],
  worms: (s) => [clampN(pageCounts(s).caught, B.chapter2Worms), B.chapter2Worms],
  // the first of the two ways (trees); the line shows both: see trees-logic.js
  rivalCut: (s) => [clampN(pageCounts(s).freed, B.rivalCutFreed), B.rivalCutFreed],
  gravel: (s) => {
    const need = Math.ceil(gravelDepth(s.world));
    return [clampN(s.stats.maxDepth, need), need, ' ед.'];
  },
  ancient: (s) => [Math.min(3, Math.max(0, ...s.world.trees.map((t) => t.stage || 0))), 3, ' стадии'],
  gladeBirch: (s) => [clampN(s.sim.holdT, B.glade.holdSeconds), B.glade.holdSeconds, ' с'],
  gladeOak: (s) => {
    const oaks = s.world.trees.filter((t) => t.species === 'oak' && !t.lost);
    return [oaks.filter((t) => t.stage >= 2).length, oaks.length];
  },
  gladePine: (s) => [
    Math.min(B.glade.pinePhosphorus, new Set(s.net.links.filter((l) => l.kind === 'mineral' && s.world.minerals[l.targetId].kind === 'phosphorus').map((l) => l.targetId)).size),
    B.glade.pinePhosphorus,
  ],
  gladeMixed: (s) => {
    const grown = s.mushrooms.filter((m) => m.mature);
    const kinds = [...new Set(s.world.trees.map((t) => t.species))];
    const covered = kinds.filter((sp) => s.world.trees.some((t) => t.species === sp && grown.some((m) => Math.abs(m.x - t.x) <= B.glade.mixedReach)));
    return [covered.length, kinds.length];
  },
  mushrooms8: (s) => [Math.min(B.chapter3Mushrooms, s.mushrooms.filter((m) => m.mature).length), B.chapter3Mushrooms],
  winter: (s) => [clampN(s.res.sugar, B.winterSugar), B.winterSugar],
  reserve: (s) => [clampN(s.res.sugar, B.reserveSugar), B.reserveSugar],
  rivalGuard: (s) => {
    const living = s.world.trees.filter((t) => !t.lost);
    return [living.filter((t) => (t.mantle ?? 0) >= B.mantleGoal).length, living.length];
  },
};

/** [have, need] of observation `id` in `state`, or null (no count for it, or the state lacks what it reads). */
export function objectiveCount(state, id) {
  try {
    const f = COUNTS[id];
    const c = f ? f(state) : null;
    return c && Number.isFinite(c[0]) && Number.isFinite(c[1]) && c[1] > 0 ? c : null;
  } catch {
    return null;
  }
}

/**
 * Ticks the current page. When it is complete: `all-objectives { chapter }`; with threats on, the next page opens
 * (`chapter { chapter }`, state.chapter, state.objectives) or, after the last, flags.bookDone. flags.allObjectivesDone
 * means «page 1 is complete» and stays true (without threats there is only page 1, as before); flags.pagesDone counts
 * the completed pages (threats only).
 */
export function stepObjectives(state, dt = 0) {
  const { flags, events } = state;
  const chapters = Boolean(flags.threats);
  if (flags.bookDone && chapters && (state.chapter ?? 1) < B.chapterCount) {
    // a save of a book that had fewer pages (three until run 8) and was closed: the page it lacks opens
    delete flags.bookDone;
    openPage(state, (state.chapter ?? 1) + 1);
    return;
  }
  if (flags.bookDone || (flags.allObjectivesDone && !chapters)) return;
  const holding = state.objectives.find((o) => !o.done && HOLDS[o.id]);
  if (holding) state.sim.holdT = HOLDS[holding.id](state) ? state.sim.holdT + dt : 0;
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
    openPage(state, n + 1);
  } else {
    flags.bookDone = true;
  }
}

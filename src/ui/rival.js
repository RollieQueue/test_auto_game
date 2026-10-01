// The HUD side of the honey-fungus rival (docs/ARCHITECTURE.md «Rival: honey fungus»): the pure part, no DOM.
// The sim lands in parallel, so everything is read defensively: any field or function of the contract may be missing
// and the text must still make sense. The sim is reached through a namespace import and every call is guarded.
import * as sim from '../sim/index.js';
import * as balance from '../sim/balance.js';
import { createSenseGate, ruPlural, threatsOn } from './threats.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pctOf = (v) => `${Math.round(Math.max(0, Math.min(1, isNum(v) ? v : 0)) * 100)} %`;
const sugarWord = (n) => `${n} сахара`;

export const DEFAULT_BARRIER_COST = 30;

// ---- the tool tab -----------------------------------------------------------------------------------------

/** The flag is on and the rival has a state (it may still sleep). */
export const rivalOn = (state) => Boolean(state && state.flags && state.flags.rival && state.rival);

/** The rival is awake: from then on the «Барьер» tab and key 4 exist. */
export const rivalAwake = (state) => rivalOn(state) && Boolean(state.rival.awake);

/** The barrier tab (and key 4) is shown: threats on, rival flag on, rival awake. */
export const barrierTabShown = (state) => threatsOn(state) && rivalAwake(state);

/** What a barrier costs now: sim.barrierCost(state), else B.barrierCost, else 30. */
export function barrierCostOf(state, B = balance.B) {
  try {
    if (typeof sim.barrierCost === 'function') {
      const v = sim.barrierCost(state);
      if (isNum(v) && v > 0) return Math.round(v);
    }
  } catch {
    // a partial state (tests, help page before a game): fall back to the base price
  }
  const base = B && B.barrierCost;
  return isNum(base) && base > 0 ? Math.round(base) : DEFAULT_BARRIER_COST;
}

/** Title (tooltip) of the tool tab. */
export function barrierTabTitle(cost) {
  return `Барьер (4): цена ${sugarWord(cost)}. Растворяет ризоморфы опёнка рядом с нитью, пока держится`;
}

/**
 * The pointer tooltip of the barrier tool, from `state.ui.barrierPick` = null | { ok, reason, cost }.
 * Returns { main, sub, warn } (never null: in barrier mode the tooltip always says something).
 */
export function describeBarrierPick(pick, cost, sugarHave, B = balance.B) {
  const have = Math.floor(sugarHave || 0);
  const price = pick && isNum(pick.cost) && pick.cost > 0 ? Math.round(pick.cost) : cost;
  if (!pick) {
    return { main: 'Барьер', sub: `цена ${sugarWord(price)} · поставь на нить`, warn: false };
  }
  if (pick.ok && have < price) {
    return { main: `Не хватает сахара (нужно ${price})`, sub: `есть ${have}`, warn: true };
  }
  if (pick.ok) {
    return { main: `Барьер: −${sugarWord(price)}`, sub: 'растворяет ризоморфы рядом · щёлкни', warn: false };
  }
  switch (pick.reason) {
    case 'sugar':
      return { main: `Не хватает сахара (нужно ${price})`, sub: `есть ${have}`, warn: true };
    case 'crowded':
      return { main: 'Рядом уже стоит барьер', sub: 'поставь следующий подальше', warn: true };
    case 'dead':
      return { main: 'Эта нить отмерла', sub: 'барьер держится только на живой нити', warn: true };
    case 'max': {
      const n = B && isNum(B.barrierMax) && B.barrierMax > 0 ? Math.round(B.barrierMax) : 0;
      return { main: 'Больше барьеров не удержать', sub: n ? `одновременно не больше ${n}` : 'дождись, пока один растворится', warn: true };
    }
    case 'off':
      return { main: 'Барьер ставят на нить', sub: 'подведи курсор ближе к нити', warn: true };
    default:
      return { main: 'Здесь барьер не поставить', sub: '', warn: true };
  }
}

// ---- trees: names in the cases the notes need, tooltip lines ----------------------------------------------

const CASES = {
  birch: { gen: 'берёзы', gender: 'f' },
  oak: { gen: 'дуба', gender: 'm' },
  pine: { gen: 'сосны', gender: 'f' },
};

const findTree = (state, id) => ((state && state.world && state.world.trees) || []).find((t) => t.id === id);

/** «берёзы» (genitive, lower case) for a tree: by species, else the lower-cased name, else «дерева». */
export function treeGen(tree) {
  if (!tree) return 'дерева';
  const c = tree.species && CASES[tree.species];
  if (c) return c.gen;
  return tree.name ? String(tree.name).toLowerCase() : 'дерева';
}

/** «берёза» (nominative, lower case). */
const treeNom = (tree) => (tree && tree.name ? String(tree.name).toLowerCase() : 'дерево');

/** Infection and protection of a tree, or null when both are zero. { infection, mantle, text: «заражение 40 % · защита 20 %» } */
export function treeRisk(tree) {
  if (!tree || tree.lost) return null;
  const inf = isNum(tree.infection) ? Math.max(0, Math.min(1, tree.infection)) : 0;
  const man = isNum(tree.mantle) ? Math.max(0, Math.min(1, tree.mantle)) : 0;
  if (!(inf > 0) && !(man > 0)) return null;
  return { infection: inf, mantle: man, text: `заражение ${pctOf(inf)} · защита ${pctOf(man)}` };
}

// ---- events -> notes and labels ---------------------------------------------------------------------------

/** Rival events a floating label is made for (they carry x, y). */
export const RIVAL_LOCAL = new Set(['rival-wake', 'rival-grip', 'tree-freed', 'tree-lost', 'rival-fruit', 'rival-cut', 'barrier-placed', 'barrier-denied']);

/** Rival events that also leave a margin note (the news matters beyond the spot). */
export const RIVAL_BOTH = new Set(['rival-wake', 'rival-grip', 'tree-freed', 'tree-lost', 'rival-fruit']);

/** Every event type of the rival that notes.js or labels.js may turn into text. */
export const RIVAL_EVENTS = new Set([...RIVAL_LOCAL, 'tree-infected']);

export const RIVAL_WAKE_NOTE = 'Под старым пнём проснулся опёнок: чёрные шнуры-ризоморфы потянутся к корням. Против них — барьер (4)';

/** Which of the two infection notes a level belongs to: 'half' (0.5), 'most' (0.75) or null (0.25 and the rest are silent). */
export function infectionStep(level) {
  if (!isNum(level)) return null;
  if (level >= 0.7) return 'most';
  if (level >= 0.45 && level < 0.6) return 'half';
  return null;
}

/** Margin note for a rival event: { key, text, tone, icon, life? } or null. Pure: the rate limit is createRivalTexts. */
export function rivalNote(state, ev) {
  const tree = isNum(ev.treeId) ? findTree(state, ev.treeId) : null;
  switch (ev.type) {
    case 'rival-wake':
      return { key: 'rival:wake', text: RIVAL_WAKE_NOTE, tone: 'warn', icon: 'honey', life: 12 };
    case 'rival-grip':
      return { key: `rival:grip:${ev.treeId}`, text: `Опёнок вцепился в корни ${treeGen(tree)}`, tone: 'warn', icon: 'honey', life: 8 };
    case 'tree-infected': {
      const step = infectionStep(ev.level);
      if (!step) return null;
      const who = tree ? tree.name : 'Дерево';
      const text = step === 'half' ? `${who}: заражена половина корней, они гниют` : `${who}: заражено три четверти корней, дерево тает`;
      return { key: `rival:infected:${ev.treeId}:${step}`, text, tone: 'warn', icon: 'honey', life: 8 };
    }
    case 'tree-freed':
      return { key: `rival:freed:${ev.treeId}`, text: `Корни ${treeGen(tree)} освободились от опёнка`, tone: 'good', icon: 'thread', life: 7 };
    case 'tree-lost':
      return {
        key: `rival:lost:${ev.treeId}`,
        text: `Опёнок съел корни ${treeGen(tree)}: дерево погибло и стоит сухостоем`,
        tone: 'warn',
        icon: 'honey',
        life: 11,
      };
    case 'rival-fruit':
      return { key: `rival:fruit:${ev.treeId}`, text: `У ${treeGen(tree)} высыпали опята`, tone: 'warn', icon: 'honey', life: 8 };
    default:
      return null;
  }
}

/** Floating label for a rival event: { key, text, tone, icon } or null. Pure. */
export function rivalLabel(state, ev) {
  const tree = isNum(ev.treeId) ? findTree(state, ev.treeId) : null;
  switch (ev.type) {
    case 'rival-wake':
      return { key: 'rival:wake', text: 'опёнок проснулся', tone: 'warn', icon: 'honey' };
    case 'rival-grip':
      return { key: 'rival:grip', text: `захват: ${treeNom(tree)}`, tone: 'warn', icon: 'honey' };
    case 'tree-freed':
      return { key: 'rival:freed', text: 'освобождено', tone: 'good', icon: 'thread' };
    case 'tree-lost':
      return { key: 'rival:lost', text: 'погибло', tone: 'warn', icon: 'honey' };
    case 'rival-fruit':
      return { key: 'rival:fruit', text: 'опята!', tone: 'warn', icon: 'honey' };
    case 'rival-cut':
      return { key: 'rival:cut', text: 'ризоморф растворён', tone: 'good', icon: 'barrier' };
    case 'barrier-placed':
      return { key: 'barrier:placed', text: 'барьер', tone: 'good', icon: 'barrier' };
    case 'barrier-denied': {
      const text =
        ev.reason === 'sugar'
          ? 'на барьер не хватает сахара'
          : ev.reason === 'crowded'
            ? 'рядом уже барьер'
            : ev.reason === 'dead'
              ? 'нить здесь отмерла'
              : ev.reason === 'max'
                ? 'больше барьеров не удержать'
                : 'барьер ставят на нить';
      return { key: `barrier:denied:${ev.reason}`, text, tone: 'warn', icon: ev.reason === 'sugar' ? 'sugar' : 'barrier' };
    }
    default:
      return null;
  }
}

// The rate limits (createSenseGate: at most `max` per game, `gap` s of game time apart), one per kind of news. The
// loss of a tree and the wake-up are rare and always told. Notes and labels each own a set (they run on separate
// clocks of the same events and must not eat each other's allowance).
const GATES = {
  'rival-grip': [5, 12],
  'tree-infected': [8, 10],
  'tree-freed': [5, 8],
  'rival-fruit': [4, 20],
  'rival-cut': [Infinity, 3],
};

/** Text maker with the rate limits: `note(state, ev)` / `label(state, ev)` return null when the news is held back. */
export function createRivalTexts() {
  const make = () => Object.fromEntries(Object.entries(GATES).map(([k, [max, gap]]) => [k, createSenseGate(max, gap)]));
  let noteGates = make();
  let labelGates = make();
  const pass = (gates, state, ev) => {
    const g = gates[ev.type];
    return !g || g.take(isNum(state.time) ? state.time : 0);
  };
  return {
    note(state, ev) {
      const d = rivalNote(state, ev);
      return d && pass(noteGates, state, ev) ? d : null;
    },
    label(state, ev) {
      const d = rivalLabel(state, ev);
      return d && pass(labelGates, state, ev) ? d : null;
    },
    reset() {
      noteGates = make();
      labelGates = make();
    },
  };
}

// ---- the guide's pointer at the first grip ------------------------------------------------------------------

export const RIVAL_HINT_TIME = 14; // s the arrow at the first grip stays

/** The oldest grip of the rival: the one the hint points at. */
export function pickGrip(state) {
  const grips = (rivalAwake(state) && Array.isArray(state.rival.grip) && state.rival.grip) || [];
  let best = null;
  for (const g of grips) {
    if (!g || !isNum(g.x) || !isNum(g.y)) continue;
    if (!best || (g.since ?? 0) < (best.since ?? 0)) best = g;
  }
  return best;
}

/** A guide hint ({ id, title, text, ring, key }) pointing at the gripped roots, or null. */
export function rivalHint(state) {
  const g = pickGrip(state);
  if (!g) return null;
  const tree = findTree(state, g.treeId);
  return {
    id: 'rival',
    title: 'Опёнок',
    text: `Опёнок держит корни ${treeGen(tree)}. Поставь барьер {4} на узел рядом: толстые нити тоже не пропускают ризоморфы.`,
    ring: { x: g.x, y: g.y, rx: 58, ry: 40 },
    key: `rival:${g.treeId}`,
  };
}

// «Once per player» flags of the hint, kept like prefs.js keeps the worm ones (guarded: storage may be blocked).
const RIVAL_HINT_KEY = 'roots-threads.seen.rival-hint';
let hintMemory = false;

export function rivalHintSeen() {
  try {
    return window.localStorage.getItem(RIVAL_HINT_KEY) === '1';
  } catch {
    return hintMemory;
  }
}

/** Marks the hint as seen (shown, or the player turned the hints off by hand). */
export function markRivalHint() {
  hintMemory = true;
  try {
    window.localStorage.setItem(RIVAL_HINT_KEY, '1');
  } catch {
    // the in-memory flag is enough for this session
  }
}

// ---- summary and year pages --------------------------------------------------------------------------------

/** { freed, lost, clusters } of this game: `freed` is counted by the HUD from tree-freed events. */
export function rivalStats(state, freed = 0) {
  const trees = (state && state.world && state.world.trees) || [];
  return {
    freed: Math.max(0, Math.round(freed || 0)),
    lost: trees.filter((t) => t && t.lost).length,
    clusters: state && state.rival && Array.isArray(state.rival.clusters) ? state.rival.clusters.length : 0,
  };
}

/** One line about the rival for the summary and year pages: «спасено 2, погибло 1, кучек опят: 3». */
export function rivalSummaryLine(stats) {
  const word = (n, a, b, c) => ruPlural(n, a, b, c);
  const { freed, lost, clusters } = stats;
  if (!freed && !lost && !clusters) return 'не успел навредить';
  const parts = [];
  if (freed) parts.push(`спасено ${freed} ${word(freed, 'дерево', 'дерева', 'деревьев')}`);
  if (lost) parts.push(`погибло ${lost}`);
  if (clusters) parts.push(`${clusters} ${word(clusters, 'кучка', 'кучки', 'кучек')} опят`);
  return parts.join(', ');
}

// ---- help page ---------------------------------------------------------------------------------------------

const pos = (v, fallback) => (isNum(v) && v > 0 ? v : fallback);

/** The numbers the help page quotes, from B with fallbacks (the fallbacks only matter while the sim lacks a value). */
export function rivalNumbers(B = balance.B) {
  const b = B || {};
  return {
    cost: pos(b.barrierCost, DEFAULT_BARRIER_COST),
    radius: Math.round(pos(b.barrierRadius, 70)),
    seconds: Math.round(pos(b.barrierDur, 90)),
    max: Math.round(pos(b.barrierMax, 3)),
    protect: Math.round(Math.min(1, pos(b.mantleProtect, 0.6)) * 100),
  };
}

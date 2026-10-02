// Stakes: the grade of a year and the fair loss «страница закрыта». Pure data in state.flags (saved with the game, no codec change):
//   flags.yearSnap   the counters at the end of the last year (what «this year» is measured from)
//   flags.yearGrades the grades of the years that ended, newest last: { year, score, grade, ... }
//   flags.gradeNoteAt the serial of the last season that said the running grade in a margin note (event 'season-grade')
//   flags.noAlly     seconds the network has had no living ally (see allies)
//   flags.pageClosed { cause: 'grove' | 'allies', time, year, chapter } once the page has closed; the sim stands still after that
// The numbers are B.stakes in balance.js. Nothing here fires before chapter B.stakes.fromChapter.
import { B } from './balance.js';

export const GRADES = ['poor', 'fair', 'good', 'great'];

/**
 * The seasons that open with the running grade in a margin note ('season-grade' event). Not spring (a year ends there and its page
 * speaks) and not summer (a quarter of a year in, nothing is earned yet and every grade would read «тяжело»).
 */
export const GRADE_NOTE_SEASONS = ['autumn', 'winter'];

/** Stakes are on with threats from page `fromChapter` of the notebook on (page 1 is for learning). */
export const stakesOn = (state) => Boolean(state.flags && state.flags.threats) && (state.chapter ?? 1) >= B.stakes.fromChapter;

/** The page has closed (the state survives a reload, so the HUD asks the state, not an event). */
export const pageClosed = (state) => (state.flags && state.flags.pageClosed) || null;

/** Living trees that are linked to the network: its allies. */
export function allies(state) {
  const { trees } = state.world;
  let n = 0;
  for (const t of trees) if (!t.lost && state.sim.contacts[t.id].length > 0) n++;
  return n;
}

const livingTrees = (state) => state.world.trees.reduce((n, t) => n + (t.lost ? 0 : 1), 0);

/** The counters a year is measured from. */
export function snapshot(state) {
  const r = state.rival ? state.rival.stats : null;
  return {
    spores: Math.floor(state.res.spores),
    stageUps: state.sim.treeStageUps,
    pages: state.flags.pagesDone ?? 0,
    lost: state.world.trees.filter((t) => t.lost).length,
    freed: r ? r.freedTrees ?? 0 : 0,
    cut: r ? r.cut ?? 0 : 0,
    caught: state.sim.threat ? state.sim.threat.caught : 0,
  };
}

export const START_SNAPSHOT = { spores: 0, stageUps: 0, pages: 0, lost: 0, freed: 0, cut: 0, caught: 0 };

/** The snapshot the current year is measured from (a new game: all zeros). */
export const yearBase = (state) => (state.flags && state.flags.yearSnap) || START_SNAPSHOT;

/**
 * The grade of the year that is under way, from what the state holds and what it was at the last year end (`base`).
 * Returns { score (0..100), grade, parts: [{ id, ratio, pts, max, value }], capped, facts }: `capped` says which rule held
 * the grade back ('lost' | 'ruin' | 'edge'), if any. Deterministic and cheap.
 */
export function gradeYear(state, base = yearBase(state)) {
  const S = B.stakes;
  const trees = state.world.trees;
  const total = Math.max(1, trees.length);
  const now = snapshot(state);
  const alive = livingTrees(state);
  const allied = allies(state);
  const rivalOn = Boolean(state.flags.rival && state.rival);
  const mature = state.mushrooms.filter((m) => m.mature).length;
  const stageUps = now.stageUps - base.stageUps;
  const spores = now.spores - base.spores;
  const pagesDone = now.pages - base.pages;
  const page = state.objectives || [];
  const pageFrac = page.length ? page.filter((o) => o.done).length / page.length : 0;
  const lostNow = now.lost - base.lost;
  const savedNow = now.freed - base.freed;
  const cutNow = now.cut - base.cut;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const parts = [
    { id: 'alive', ratio: alive / total, value: alive },
    { id: 'allies', ratio: allied / total, value: allied },
    { id: 'growth', ratio: clamp01(stageUps / (S.growthFull * total)), value: stageUps },
    { id: 'spores', ratio: clamp01(spores / S.sporesYear), value: spores },
    { id: 'mushrooms', ratio: clamp01(mature / S.mushroomsFull), value: mature },
    // a finished page is the whole mark; an unfinished one counts what is done of it, at most 0.6
    { id: 'pages', ratio: pagesDone > 0 ? 1 : 0.6 * pageFrac, value: pagesDone },
  ];
  if (rivalOn) {
    // no tree lost to the honey fungus this year is most of it; a tree freed (or cords cut) with a barrier is the rest
    const answered = clamp01(Math.max(savedNow / B.rivalCutFreed, cutNow / B.rivalCutGoal));
    parts.push({ id: 'rival', ratio: (lostNow === 0 ? 0.6 : 0) + 0.4 * answered, value: savedNow });
  }
  let earned = 0;
  let possible = 0;
  for (const p of parts) {
    p.max = S.max[p.id];
    p.pts = p.max * p.ratio;
    earned += p.pts;
    possible += p.max;
  }
  const score = Math.round((100 * earned) / possible);
  let level = S.cuts.filter((c) => score >= c).length; // 0 poor .. 3 great
  let capped = null;
  const cap = (max, why) => {
    if (level > max) {
      level = max;
      capped = why;
    }
  };
  if (lostNow >= 1) cap(GRADES.indexOf(S.lostCap), 'lost');
  if (alive * 2 <= total) cap(0, 'ruin'); // half the grove or less still stands
  return {
    score,
    grade: GRADES[level],
    parts,
    capped,
    facts: { total, alive, allied, mature, stageUps, spores, pagesDone, lostNow, savedNow, cutNow, rivalOn },
  };
}

/** The grade of the partial year on the page that has closed: a year not finished is never better than «fair». */
export function gradeClosed(state) {
  const g = gradeYear(state);
  if (GRADES.indexOf(g.grade) > 1) {
    g.grade = GRADES[1];
    g.capped = 'edge';
  }
  return g;
}

function closePage(state, cause) {
  state.flags.pageClosed = { cause, time: Math.round(state.sim.clock), year: state.clock ? state.clock.year : 0, chapter: state.chapter ?? 1 };
  state.events.push({ type: 'page-closed', cause });
}

/**
 * One sim step (after stepObjectives): records the grade at a year end, keeps the no-ally clock and closes the page. The no-ally
 * clock runs only while the stakes are on and no hypha is growing (a player reaching for a root is not left to run out), is
 * reset at once by an ally, and closes the page at B.stakes.noAllySeconds.
 */
export function stepStakes(state, dt) {
  const { flags, events } = state;
  const notes = [];
  for (const ev of events) {
    if (ev.type === 'season' && GRADE_NOTE_SEASONS.includes(ev.season)) {
      // once per season (the serial of the season is saved, so a reload inside it never says it again)
      const at = state.sim && state.sim.marks ? state.sim.marks.season : NaN;
      if (!(at <= (flags.gradeNoteAt ?? -1))) {
        if (Number.isFinite(at)) flags.gradeNoteAt = at;
        notes.push({ type: 'season-grade', season: ev.season });
      }
    }
    if (ev.type !== 'year-end') continue;
    const g = gradeYear(state);
    const grades = flags.yearGrades || [];
    grades.push({ year: ev.year, score: g.score, grade: g.grade, capped: g.capped, parts: g.parts.map((p) => ({ id: p.id, ratio: Math.round(p.ratio * 100) / 100, value: p.value, max: p.max, pts: Math.round(p.pts * 10) / 10 })), facts: g.facts });
    flags.yearGrades = grades.slice(-8);
    flags.yearSnap = snapshot(state);
  }
  events.push(...notes);
  if (!stakesOn(state) || flags.pageClosed) return;
  if (livingTrees(state) === 0) {
    closePage(state, 'grove');
    return;
  }
  if (allies(state) > 0) {
    flags.noAlly = 0;
    return;
  }
  if (state.net.growing.length > 0) return;
  flags.noAlly = (flags.noAlly ?? 0) + dt;
  if (flags.noAlly >= B.stakes.noAllySeconds) closePage(state, 'allies');
}

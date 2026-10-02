// The running grade of the year, said before the year ends: the calendar's tooltip line and the margin note at a season change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { restoreTime } from '../src/sim/clock.js';
import { B } from '../src/sim/balance.js';
import { GRADES, GRADE_NOTE_SEASONS, gradeYear } from '../src/sim/stakes.js';
import { decodeState, encodeState } from '../src/persist-codec.js';
import { GRADE_WORDS, gradeLine, gradeMissing, runningGrade, seasonGradeNote } from '../src/ui/year-logic.js';
import { describeNote } from '../src/ui/notes.js';

const DT = 1 / 60;

/** A game of seed 7 with the flags of the real game (seasons, threats, the honey fungus off) in page 2. */
function game({ seasons = true } = {}) {
  const s = createState(7);
  Object.assign(s.flags, { seasons, threats: true });
  s.chapter = 2;
  return s;
}

/** Fills the counters the grade reads: what the year so far gave. */
function year(s, o = {}) {
  s.sim.treeStageUps = o.stageUps ?? 0;
  s.res.spores = o.spores ?? 0;
  s.flags.pagesDone = o.pages ?? 0;
  s.mushrooms = Array.from({ length: o.mushrooms ?? 0 }, () => ({ mature: true }));
  for (const t of s.world.trees) {
    s.sim.contacts[t.id] = o.allied ? [1000 + t.id] : [];
    t.linked = Boolean(o.allied);
  }
  return s;
}

const n = createState(7).world.trees.length;
const FULL = { stageUps: Math.ceil(B.stakes.growthFull * n) + 1, spores: B.stakes.sporesYear, pages: 1, mushrooms: B.stakes.mushroomsFull, allied: true };

// ---- the words --------------------------------------------------------------------------------------------

test('the line has the grade of the year so far for every grade, in the seal words of the year page', () => {
  const cases = [
    [{}, 'poor'],
    [{ allied: true, spores: 400, mushrooms: 3 }, 'fair'],
    [{ allied: true, pages: 1, spores: 800, mushrooms: 6 }, 'good'],
    [FULL, 'great'],
  ];
  for (const [o, want] of cases) {
    const s = year(game(), o);
    assert.equal(gradeYear(s).grade, want, JSON.stringify(o));
    const r = runningGrade(s);
    assert.equal(r.grade, want);
    assert.equal(r.seal, GRADE_WORDS[want].seal);
    assert.ok(gradeLine(s).startsWith(`Отметка года пока: ${GRADE_WORDS[want].seal} · `), gradeLine(s));
  }
  assert.deepEqual(GRADES.map((g) => GRADE_WORDS[g].seal), ['тяжело', 'сносно', 'хорошо', 'отлично']);
});

test('the line names what is missing, the biggest gap first and two at most; a full year misses nothing', () => {
  // spores and growth: a fair year with the trees allied, a page done and the mushrooms grown
  const s = year(game(), { allied: true, pages: 1, mushrooms: B.stakes.mushroomsFull, spores: 0, stageUps: 0 });
  assert.equal(gradeLine(s), 'Отметка года пока: сносно · не хватает: роста деревьев, спор');
  const t = year(game(), { ...FULL, spores: 100 });
  assert.equal(gradeLine(t), 'Отметка года пока: хорошо · не хватает: спор');
  assert.equal(gradeLine(year(game(), FULL)), 'Отметка года пока: отлично · всё как надо');
  // nothing done: at most two words, whatever is short
  assert.equal(gradeMissing(gradeYear(year(game(), {}))).length, 2);
});

test('each part has its word', () => {
  const part = (id, ratio) => ({ id, ratio, max: 20, pts: 20 * ratio });
  const word = (id) => gradeMissing({ parts: [part(id, 0)], capped: null })[0];
  assert.equal(word('alive'), 'живых деревьев');
  assert.equal(word('allies'), 'союзов');
  assert.equal(word('growth'), 'роста деревьев');
  assert.equal(word('spores'), 'спор');
  assert.equal(word('mushrooms'), 'грибов');
  assert.equal(word('pages'), 'дописанной страницы');
  assert.equal(word('rival'), 'отпора опёнку');
  // a small gap is not worth a word
  assert.deepEqual(gradeMissing({ parts: [part('spores', 0.95)], capped: null }), []);
  // a lost grove is named first, even when another part has the bigger gap
  const lost = { parts: [{ id: 'spores', ratio: 0, max: 20, pts: 0 }, { id: 'alive', ratio: 0.9, max: 20, pts: 18 }], capped: 'lost' };
  assert.deepEqual(gradeMissing(lost), ['живых деревьев', 'спор']);
});

test('no seasons, no line and no note; a closed page has no year to grade', () => {
  const s = year(game({ seasons: false }), FULL);
  assert.equal(gradeLine(s), null);
  assert.equal(runningGrade(s), null);
  assert.equal(seasonGradeNote(s, 'autumn'), null);
  const c = year(game(), FULL);
  c.flags.pageClosed = { cause: 'grove', time: 10, year: 0, chapter: 2 };
  assert.equal(gradeLine(c), null);
  assert.equal(gradeLine(null), null);
});

test('the season note: «К зиме: сносно — не хватает спор», plain ink when the year is poor', () => {
  const s = year(game(), { allied: true, pages: 1, mushrooms: B.stakes.mushroomsFull, stageUps: 3, spores: 100 });
  assert.equal(gradeYear(s).grade, 'good');
  const note = seasonGradeNote(s, 'winter');
  assert.deepEqual(note, { key: 'grade:winter', text: 'К зиме: хорошо — не хватает спор', tone: 'good', icon: 'check' });
  assert.equal(seasonGradeNote(year(game(), FULL), 'autumn').text, 'К осени: отлично — всё как надо');
  const poor = seasonGradeNote(year(game(), {}), 'autumn');
  assert.equal(poor.tone, '');
  assert.match(poor.text, /^К осени: тяжело — не хватает /);
  assert.ok(poor.text.length <= 60, 'a note of two lines at most');
  assert.equal(seasonGradeNote(s, 'monsoon'), null);
  // the notes stack gets it from the event, with a life of its own
  const d = describeNote(s, { type: 'season-grade', season: 'winter' });
  assert.equal(d.text, note.text);
  assert.ok(d.life > 5);
});

// ---- once per season --------------------------------------------------------------------------------------

/** Puts the clock `before` s ahead of the start of season `k` (a load does the same) and steps `seconds`; returns the events seen. */
function across(s, k, before, seconds) {
  s.sim.clock = k * B.seasonSeconds - before;
  restoreTime(s);
  s.events.length = 0;
  const seen = [];
  for (let t = 0; t < seconds; t += DT) {
    sim.updateSim(s, DT);
    s.time += DT;
    seen.push(...s.events.filter((e) => e.type === 'season' || e.type === 'season-grade' || e.type === 'year-end'));
    s.events.length = 0;
  }
  return seen;
}

test('one note per season: autumn and winter, never summer, never the spring that ends the year', () => {
  assert.deepEqual(GRADE_NOTE_SEASONS, ['autumn', 'winter']);
  const s = year(game(), { allied: true });
  const all = [];
  for (const k of [1, 2, 3, 4]) all.push(...across(s, k, 0.5, 1.5));
  const grades = all.filter((e) => e.type === 'season-grade').map((e) => e.season);
  assert.deepEqual(grades, ['autumn', 'winter']);
  assert.deepEqual(all.filter((e) => e.type === 'season').map((e) => e.season), ['summer', 'autumn', 'winter', 'spring']);
  assert.ok(all.some((e) => e.type === 'year-end'), 'the year end is spoken by its own page');
  // the event comes right after its season, and the same step
  const i = all.findIndex((e) => e.type === 'season-grade' && e.season === 'autumn');
  assert.equal(all[i - 1].type, 'season');
});

test('a reload inside the season never says it again; the next season still does', () => {
  const s = year(game(), { allied: true });
  assert.deepEqual(across(s, 2, 0.5, 1.5).filter((e) => e.type === 'season-grade').map((e) => e.season), ['autumn']);
  assert.equal(s.flags.gradeNoteAt, 2);
  const copy = decodeState(JSON.parse(JSON.stringify(encodeState(s))));
  assert.equal(copy.flags.gradeNoteAt, 2, 'the flag is saved');
  // the clock runs on in the same season: nothing
  copy.events.length = 0;
  for (let t = 0; t < 30; t += DT) {
    sim.updateSim(copy, DT);
    copy.time += DT;
  }
  assert.equal(copy.events.filter((e) => e.type === 'season-grade').length, 0);
  // the same season entered again (a clock jumped back across its start) stays silent
  assert.deepEqual(across(copy, 2, 0.5, 1.5).filter((e) => e.type === 'season-grade'), []);
  // winter is a new season: it speaks
  assert.deepEqual(across(copy, 3, 0.5, 1.5).filter((e) => e.type === 'season-grade').map((e) => e.season), ['winter']);
});

test('an old save without the flag loads, and its next autumn speaks', () => {
  const s = year(game(), { allied: true });
  const p = JSON.parse(JSON.stringify(encodeState(s)));
  assert.equal(JSON.stringify(p).includes('gradeNoteAt'), false, 'a game that has not said it carries no flag');
  const copy = decodeState(p);
  assert.equal(copy.flags.gradeNoteAt, undefined);
  assert.deepEqual(across(copy, 2, 0.5, 1.5).filter((e) => e.type === 'season-grade').map((e) => e.season), ['autumn']);
});

test('without seasons nothing changes: no event, no flag', () => {
  const s = year(game({ seasons: false }), { allied: true });
  s.sim.clock = 2 * B.seasonSeconds - 0.5;
  restoreTime(s);
  s.events.length = 0;
  for (let t = 0; t < 2; t += DT) {
    sim.updateSim(s, DT);
    s.time += DT;
  }
  assert.equal(s.events.filter((e) => e.type === 'season-grade' || e.type === 'season').length, 0);
  assert.equal(s.flags.gradeNoteAt, undefined);
});

// Stakes: the grade of a year and «страница закрыта» (src/sim/stakes.js, src/ui/year-logic.js, the year and closed pages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { B } from '../src/sim/balance.js';
import { createObjectives } from '../src/sim/objectives.js';
import { GRADES, allies, gradeClosed, gradeYear, pageClosed, snapshot, stakesOn, stepStakes } from '../src/sim/stakes.js';
import { decodeState, encodeState } from '../src/persist-codec.js';
import { GRADE_WORDS, closedCause, closedStats, gradeLines, gradeNext, gradeReason, stakesSlip, yearGrade } from '../src/ui/year-logic.js';
import { buildClosedPage, buildYearPage } from '../src/ui/year.js';

const DT = 1 / 60;

/** A game of seed 7 with the flags of the real game, in page `chapter`. */
function game({ chapter = 2, rival = true, seed = 7 } = {}) {
  const s = createState(seed);
  Object.assign(s.flags, { seasons: true, threats: true, rival });
  if (rival) s.rival = null;
  s.chapter = chapter;
  if (chapter !== 1) s.objectives = createObjectives(chapter, true, s.world.biome, Boolean(rival));
  return s;
}

/** Makes every living tree an ally (a fake root contact) or none. */
function setAllies(s, on) {
  for (const t of s.world.trees) {
    s.sim.contacts[t.id] = on && !t.lost ? [1000 + t.id] : [];
    t.linked = on && !t.lost;
  }
}

function step(s, seconds) {
  for (let t = 0; t < seconds; t += DT) {
    sim.updateSim(s, DT);
    s.time += DT;
  }
}

const rivalStub = (s, stats = {}) => {
  s.rival = { stats: { freedTrees: 0, cut: 0, lost: 0, ...stats } };
};

/** What a year gave: fill the counters the grade reads. */
function year(s, o = {}) {
  s.sim.treeStageUps = o.stageUps ?? 0;
  s.res.spores = o.spores ?? 0;
  s.flags.pagesDone = o.pages ?? 0;
  s.mushrooms = Array.from({ length: o.mushrooms ?? 0 }, () => ({ mature: true }));
  setAllies(s, o.allied ?? false);
  return s;
}

// ---- the grade ---------------------------------------------------------------------------------------------

test('grade table: what a year earns', () => {
  const n = createState(7).world.trees.length; // 2 trees in the glade of seed 7
  const full = { stageUps: Math.ceil(B.stakes.growthFull * n) + 1, spores: B.stakes.sporesYear, pages: 1, mushrooms: B.stakes.mushroomsFull, allied: true };
  const cases = [
    ['an idle year (nothing done, the trees alive)', {}, 'poor'],
    ['allies only', { allied: true }, 'poor'],
    ['allies, mushrooms, no growth or spores', { allied: true, mushrooms: 4, pages: 1 }, 'fair'],
    ['a fair year: allies, a page, some spores', { allied: true, mushrooms: 4, pages: 1, spores: 300, stageUps: 1 }, 'good'],
    ['the full year', full, 'great'],
    ['everything but the page and most spores', { ...full, pages: 0, spores: 400 }, 'good'],
  ];
  for (const [name, o, want] of cases) {
    const s = year(game({ rival: false }), o);
    const g = gradeYear(s);
    assert.equal(g.grade, want, `${name}: ${g.grade} (${g.score})`);
  }
  assert.equal(gradeYear(year(game({ rival: false }), full)).score, 100);
});

test('grade: never handed out - a passive year cannot reach the top and the score only rises with what is done', () => {
  const idle = gradeYear(year(game(), {}));
  assert.ok(idle.score < B.stakes.cuts[0], `idle ${idle.score}`);
  let last = -1;
  for (const spores of [0, 100, 300, 600, 800, 2000]) {
    const g = gradeYear(year(game(), { allied: true, mushrooms: 2, pages: 1, stageUps: 1, spores }));
    assert.ok(g.score >= last, `${spores} spores: ${g.score} after ${last}`);
    last = g.score;
  }
  for (const g of Object.values(GRADES)) assert.ok(GRADE_WORDS[g], g);
});

test('grade: a lost tree holds the year at «fair» and a ruined grove at «poor», however much else is done', () => {
  const s = year(game({ rival: false }), { stageUps: 5, spores: 2000, pages: 1, mushrooms: 8, allied: true });
  assert.equal(gradeYear(s).grade, 'great');
  const base = snapshot(s);
  s.flags.yearSnap = { ...base, lost: 0, spores: 0, stageUps: 0, pages: 0 };
  s.world.trees[0].lost = true;
  setAllies(s, true);
  const g = gradeYear(s);
  assert.equal(g.capped, 'ruin'); // 1 of 2 trees: half the grove or less stands
  assert.equal(g.grade, 'poor');
  const five = game({ rival: false, seed: 5 }); // a glade of five trees (generator 2)
  assert.equal(five.world.trees.length, 5);
  year(five, { stageUps: 9, spores: 2000, pages: 1, mushrooms: 8, allied: true });
  five.world.trees[0].lost = true;
  setAllies(five, true);
  five.flags.yearSnap = { spores: 0, stageUps: 0, pages: 0, lost: 0, freed: 0, cut: 0, caught: 0 };
  const g5 = gradeYear(five);
  assert.equal(g5.capped, 'lost');
  assert.equal(g5.grade, B.stakes.lostCap);
  // the same loss in an earlier year does not hold this year back
  five.flags.yearSnap.lost = 1;
  assert.equal(gradeYear(five).grade, 'great');
});

test('grade: the rival part counts only with the rival on, and a tree freed or cords cut earn the rest of it', () => {
  const off = gradeYear(year(game({ rival: false }), { allied: true }));
  assert.ok(!off.parts.some((p) => p.id === 'rival'));
  const s = year(game(), { allied: true });
  rivalStub(s);
  const quiet = gradeYear(s).parts.find((p) => p.id === 'rival');
  assert.equal(quiet.ratio, 0.6); // no tree lost, nothing answered
  s.rival.stats.freedTrees = B.rivalCutFreed;
  assert.equal(gradeYear(s).parts.find((p) => p.id === 'rival').ratio, 1);
  s.rival.stats.freedTrees = 0;
  s.rival.stats.cut = B.rivalCutGoal;
  assert.equal(gradeYear(s).parts.find((p) => p.id === 'rival').ratio, 1);
});

test('grade of a closed page is never better than «fair»', () => {
  const s = year(game({ rival: false }), { stageUps: 5, spores: 2000, pages: 1, mushrooms: 8, allied: true });
  assert.equal(gradeYear(s).grade, 'great');
  const c = gradeClosed(s);
  assert.equal(c.grade, 'fair');
  assert.equal(c.capped, 'edge');
});

test('the words: reason lists what was earned, the next line names the biggest gap', () => {
  const s = year(game({ rival: false }), { allied: true, spores: 400, pages: 1, mushrooms: 6 });
  const lines = gradeLines(gradeYear(s));
  assert.match(lines.reason, /^за: /);
  assert.match(lines.reason, /все деревья живы/);
  assert.match(lines.next, /^На будущий год: /);
  assert.ok(lines.title && lines.verdict && lines.seal);
  const idle = gradeLines(gradeYear(year(game({ rival: false }), {})));
  assert.match(idle.reason, /за: .*деревья живы|живы/);
  const full = gradeYear(year(game({ rival: false }), { stageUps: 5, spores: 2000, pages: 1, mushrooms: 8, allied: true }));
  assert.match(gradeNext(full), /так держать/);
  const dead = game({ rival: false });
  for (const t of dead.world.trees) t.lost = true;
  assert.match(gradeReason(gradeYear(dead)), /записать пока нечего/);
});

// ---- the year page and the stored grade ----------------------------------------------------------------------

test('a year end stores the grade and moves the year snapshot', () => {
  const s = game({ rival: false });
  year(s, { allied: true, spores: 300, pages: 1, mushrooms: 3, stageUps: 1 });
  const expected = gradeYear(s);
  s.events.push({ type: 'year-end', year: 0 });
  sim.updateSim(s, DT);
  assert.equal(s.flags.yearGrades.length, 1);
  assert.equal(s.flags.yearGrades[0].year, 0);
  assert.equal(s.flags.yearGrades[0].grade, expected.grade);
  assert.equal(s.flags.yearSnap.spores, 300);
  // the next year starts from zero: the spores of year 1 are the spores gained since
  assert.equal(gradeYear(s).facts.spores, 0);
  assert.equal(yearGrade(s, 0), s.flags.yearGrades[0]);
});

test('the year page shows the grade, why and what next; it fits the rows it had', () => {
  const s = game({ rival: false });
  year(s, { allied: true, spores: 300, pages: 1, mushrooms: 3, stageUps: 1 });
  s.events.push({ type: 'year-end', year: 0 });
  sim.updateSim(s, DT);
  const html = buildYearPage(s, 0);
  assert.match(html, /Отметка года/);
  assert.match(html, /year-mark g-(fair|good|great)/);
  assert.match(html, /за: /);
  assert.match(html, /На будущий год/);
  assert.match(html, /data-act="year-continue"/);
  assert.match(html, /stamp-seal g-/);
  // a state with no stored grade (an old save) gets the grade of the year so far
  const old = game({ rival: false });
  assert.match(buildYearPage(old, 0), /Отметка года/);
});

// ---- the loss ---------------------------------------------------------------------------------------------

test('page 1 never closes: no stakes before chapter 2, whatever happens to the trees', () => {
  const s = game({ chapter: 1 });
  assert.equal(stakesOn(s), false);
  for (const t of s.world.trees) t.lost = true;
  step(s, B.stakes.noAllySeconds * 2);
  assert.equal(pageClosed(s), null);
  assert.equal(s.flags.noAlly ?? 0, 0);
  const without = game({ chapter: 2 });
  without.flags.threats = false;
  assert.equal(stakesOn(without), false, 'the notebook has no pages without threats');
});

test('a normal start does not close: a new game plays three minutes in page 1 without a tremor', () => {
  const s = createState(23);
  Object.assign(s.flags, { seasons: true, threats: true, rival: true });
  step(s, 180);
  assert.equal(pageClosed(s), null);
  assert.equal(stakesSlip(s), null);
  assert.deepEqual(s.events.filter((e) => e.type === 'page-closed'), []);
});

test('every tree lost closes the page at once; the glade stands still after that', () => {
  const s = game();
  setAllies(s, true);
  step(s, 1);
  assert.equal(pageClosed(s), null);
  for (const t of s.world.trees) t.lost = true;
  step(s, DT);
  const c = pageClosed(s);
  assert.equal(c.cause, 'grove');
  assert.equal(c.chapter, 2);
  assert.ok(s.events.some((e) => e.type === 'page-closed' && e.cause === 'grove'));
  const clock = s.sim.clock;
  const sugar = s.res.sugar;
  step(s, 30);
  assert.equal(s.sim.clock, clock, 'the clock stands');
  assert.equal(s.res.sugar, sugar);
  assert.equal(s.events.filter((e) => e.type === 'page-closed').length, 1, 'it closes once');
  assert.match(closedCause(s), /Роща пала/);
});

test('no ally for B.stakes.noAllySeconds closes the page; an ally or a growing hypha stops the clock', () => {
  const s = game({ rival: false });
  setAllies(s, false);
  step(s, B.stakes.noAllyShow - 0.5);
  assert.equal(stakesSlip(s), null, 'a link lost and found again at once shows nothing');
  step(s, 5);
  const slip = stakesSlip(s);
  assert.equal(slip.key, 'no-ally');
  assert.match(slip.text, /страница закроется через \d+ с/);
  // a growing hypha holds the clock
  s.net.growing.push({ from: 0, lastNode: 0 });
  const held = s.flags.noAlly;
  for (let i = 0; i < 40; i++) stepStakes(s, 1);
  assert.equal(s.flags.noAlly, held);
  assert.match(stakesSlip(s).text, /время стоит/);
  s.net.growing.length = 0;
  // an ally resets it
  setAllies(s, true);
  step(s, 1);
  assert.equal(s.flags.noAlly, 0);
  assert.equal(allies(s), s.world.trees.length);
  // and without one it runs out at the limit, not before
  setAllies(s, false);
  step(s, B.stakes.noAllySeconds - 2);
  assert.equal(pageClosed(s), null);
  assert.equal(stakesSlip(s).tone, 'danger');
  step(s, 3);
  assert.equal(pageClosed(s).cause, 'allies');
  assert.match(closedCause(s), new RegExp(`${B.stakes.noAllySeconds}.с`));
});

test('the last tree rotting shows the slip; with the stakes on the rival may rot it through, in page 1 it stops at B.rivalLastTree', () => {
  const s = game();
  for (const t of s.world.trees.slice(1)) t.lost = true;
  setAllies(s, true);
  s.world.trees[0].infection = 0.3;
  assert.equal(stakesSlip(s), null);
  s.world.trees[0].infection = B.stakes.lastTreeShow;
  assert.equal(stakesSlip(s).key, 'last-tree');
  assert.ok(B.rivalLastTree < 1, 'the old cap is still in page 1');
});

test('a closed game survives a reload: the flags come back and the page is still closed', () => {
  const s = game();
  year(s, { allied: true, spores: 120, pages: 1 });
  s.events.push({ type: 'year-end', year: 0 });
  sim.updateSim(s, DT);
  for (const t of s.world.trees) t.lost = true;
  step(s, DT);
  assert.ok(pageClosed(s));
  const copy = decodeState(JSON.parse(JSON.stringify(encodeState(s))));
  assert.deepEqual(pageClosed(copy), pageClosed(s));
  assert.deepEqual(copy.flags.yearGrades, s.flags.yearGrades);
  assert.deepEqual(copy.flags.yearSnap, s.flags.yearSnap);
  // the sim of the reloaded state stands still and the page can be built again
  const clock = copy.sim.clock;
  sim.updateSim(copy, DT);
  assert.equal(copy.sim.clock, clock);
  assert.match(buildClosedPage(copy), /Страница закрыта/);
  // the no-ally clock is saved as well
  const w = game({ rival: false });
  setAllies(w, false);
  step(w, 20);
  const back = decodeState(JSON.parse(JSON.stringify(encodeState(w))));
  assert.ok(Math.abs(back.flags.noAlly - w.flags.noAlly) < 1e-6);
});

test('the closed page: cause, numbers, grade of the partial year, both buttons', () => {
  const s = game();
  year(s, { allied: true, spores: 250, pages: 0, mushrooms: 2 });
  for (const t of s.world.trees) t.lost = true;
  step(s, DT);
  const c = closedStats(s);
  assert.equal(c.lost, c.total);
  assert.ok(GRADES.indexOf(c.grade.grade) <= 1);
  const html = buildClosedPage(s);
  assert.match(html, /Страница закрыта/);
  assert.match(html, /data-act="retry"[^>]*>Попробовать снова/);
  assert.match(html, /data-act="restart"[^>]*>Новая поляна/);
  assert.doesNotMatch(html, /year-continue/);
  assert.match(html, /Год не дописан/);
  assert.match(html, /0 из \d/);
});

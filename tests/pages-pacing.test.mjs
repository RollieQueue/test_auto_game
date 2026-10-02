// Pages that close in a reasonable time: five observations at most on a page, a number on every line, and saves made when
// page 2 still held eight observations (and the book three pages) load without throwing and without a page closing by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { B } from '../src/sim/balance.js';
import { createObjectives, pageObjectives, objectiveCount } from '../src/sim/objectives.js';
import { objectiveProgress, objectiveText } from '../src/ui/trees-logic.js';
import { encodeState, decodeState } from '../src/persist-codec.js';
import { DT, playBot } from './bot.mjs';

function fresh(seed = 7, flags = { threats: true }) {
  const s = createState(seed);
  s.phase = 'playing';
  Object.assign(s.flags, flags);
  return s;
}

function step(s, seconds = DT) {
  const seen = [];
  for (let i = 0, n = Math.max(1, Math.round(seconds / DT)); i < n; i++) {
    sim.updateSim(s, DT);
    s.time += DT;
    seen.push(...s.events);
    s.events.length = 0;
  }
  return seen;
}

const roundTrip = (s) => decodeState(JSON.parse(JSON.stringify(encodeState(s))));
const ids = (s) => s.objectives.map((o) => o.id);
const line = (s, id, extra = {}) => {
  const o = { id, text: 'Строка', done: false, ...extra };
  return objectiveProgress(s, o);
};

// ---- a number on every line -------------------------------------------------------------------------------------------

test('every observation of every page shows a progress number, except the three first acts', () => {
  const s = fresh(7, { threats: true, seasons: true, rival: true });
  const bare = new Set(['water', 'tree', 'mushroom']);
  for (const chapter of [1, 2, 3, 4]) {
    for (const biome of ['birch', 'oak', 'pine', 'mixed']) {
      const w = createState(biome === 'birch' ? 13 : biome === 'oak' ? 42 : biome === 'pine' ? 23 : 7);
      w.phase = 'playing';
      Object.assign(w.flags, { threats: true, seasons: true, rival: true });
      for (const o of pageObjectives(chapter, true, w.world.biome, true)) {
        const text = objectiveText(w, { ...o, done: false });
        assert.ok(text.startsWith(o.text), o.id);
        if (bare.has(o.id)) continue;
        assert.match(text.slice(o.text.length), /^ · .*\d/, `${o.id} has a number: «${text}»`);
        assert.equal(objectiveProgress(w, { ...o, done: true }), '', `${o.id}: a ticked line shows nothing`);
        assert.ok(text.length <= 125, `${o.id} is ${text.length} characters long`);
      }
    }
  }
  assert.ok(s);
});

test('progress numbers: spores, allies, finds, worms, depth, ancient tree', () => {
  const s = fresh(7);
  s.res.spores = B.sporesGoal - 15.3;
  assert.equal(line(s, 'spores'), ` · ${B.sporesGoal - 16}/${B.sporesGoal}`);
  s.res.spores = 212.4;
  assert.equal(line(s, 'spores500'), ` · 212/${B.chapter2Spores}`);
  assert.equal(line(s, 'spores1500'), ` · 212/${B.chapter3Spores}`);
  s.res.spores = 5000;
  assert.equal(line(s, 'spores500'), ` · ${B.chapter2Spores}/${B.chapter2Spores}`, 'never above the goal');
  const n = s.world.trees.length;
  assert.equal(line(s, 'allies'), ` · 0/${n}`);
  s.sim.contacts[s.world.trees[0].id] = [{ tip: 0 }];
  assert.equal(line(s, 'allies'), ` · 1/${n}`);
  s.finds = { 0: { kind: 'bone', at: 1 }, 1: { kind: 'bone', at: 2 }, 2: { kind: 'shell', at: 3 } };
  assert.equal(line(s, 'finds'), ` · 2/${B.chapter2Finds}`);
  s.sim.threat.caught = 3;
  assert.equal(line(s, 'worms'), ` · 3/${B.chapter2Worms}`);
  const need = Math.ceil(s.world.horizons[s.world.horizons.length - 1].depth);
  s.stats.maxDepth = 140.9;
  assert.equal(line(s, 'gravel'), ` · 140/${need} ед.`);
  s.world.trees.forEach((t) => (t.stage = 1));
  s.world.trees[0].stage = 2;
  assert.equal(line(s, 'ancient'), ' · 2/3 стадии');
  s.world.trees[0].stage = 3;
  assert.equal(line(s, 'ancient'), ' · 3/3 стадии');
});

test('progress numbers: the glade observation of each biome and the long page', () => {
  const birch = fresh(13);
  assert.equal(birch.world.biome, 'birch');
  birch.sim.holdT = 12.9;
  assert.equal(line(birch, 'gladeBirch'), ` · 12/${B.glade.holdSeconds} с`);

  const oak = fresh(42);
  assert.equal(oak.world.biome, 'oak');
  const oaks = oak.world.trees.filter((t) => t.species === 'oak');
  oaks.forEach((t) => (t.stage = 1));
  oaks[0].stage = 2;
  assert.equal(line(oak, 'gladeOak'), ` · 1/${oaks.length}`);

  const pine = fresh(23);
  assert.equal(pine.world.biome, 'pine');
  assert.equal(line(pine, 'gladePine'), ` · 0/${B.glade.pinePhosphorus}`);
  const crystals = pine.world.minerals.filter((m) => m.kind === 'phosphorus');
  pine.net.links.push({ kind: 'mineral', targetId: crystals[0].id, nodeId: 0 });
  assert.equal(line(pine, 'gladePine'), ` · 1/${B.glade.pinePhosphorus}`);
  pine.net.links.push({ kind: 'mineral', targetId: crystals[0].id, nodeId: 1 });
  assert.equal(line(pine, 'gladePine'), ` · 1/${B.glade.pinePhosphorus}`, 'one crystal twice is still one');

  const mixed = fresh(7);
  assert.equal(mixed.world.biome, 'mixed');
  const kinds = new Set(mixed.world.trees.map((t) => t.species)).size;
  assert.equal(line(mixed, 'gladeMixed'), ` · 0/${kinds}`);
  const t0 = mixed.world.trees[0];
  mixed.mushrooms.push({ id: 1, nodeId: 0, x: t0.x + 10, baseY: t0.baseY, mature: true, growth: 1, variant: 0, age: 99, spores: 0, burst: 0, burstT: 0 });
  assert.equal(line(mixed, 'gladeMixed'), ` · 1/${kinds}`);

  const s = fresh(7);
  const grown = (i) => ({ id: i, nodeId: 0, x: 0, baseY: 0, mature: true, growth: 1, variant: 0, age: 99, spores: 0, burst: 0, burstT: 0 });
  for (let i = 0; i < 3; i++) s.mushrooms.push(grown(i));
  s.mushrooms.push({ ...grown(9), mature: false });
  assert.equal(line(s, 'mushrooms8'), ` · 3/${B.chapter3Mushrooms}`);
  s.res.sugar = 64.5;
  assert.equal(line(s, 'winter'), ` · 64/${B.winterSugar}`);
  assert.equal(line(s, 'reserve'), ` · 64/${B.reserveSugar}`);
  s.world.trees.forEach((t) => (t.mantle = 0));
  s.world.trees[0].mantle = B.mantleGoal;
  assert.equal(line(s, 'rivalGuard'), ` · 1/${s.world.trees.length}`);
  s.world.trees[1].lost = true;
  assert.equal(line(s, 'rivalGuard'), ` · 1/${s.world.trees.length - 1}`, 'a lost tree is not counted');
});

test('a count needs a state it can read: a partial state gives no number and no throw', () => {
  assert.equal(objectiveProgress({}, { id: 'allies', text: 'x', done: false }), '');
  assert.equal(objectiveProgress(null, { id: 'spores', text: 'x', done: false }), '');
  assert.equal(objectiveCount({ res: { spores: 3 } }, 'spores')[0], 3);
  assert.equal(objectiveCount({ res: { spores: 3 } }, 'unknown'), null);
});

// ---- saves from before the five-observation pages -----------------------------------------------------------------------

const OLD_PAGE_2 = ['allies', 'ancient', 'gravel', 'finds', 'worms', 'spores500'];

test('an old save on page 2 (eight observations, some done) loads on the new page 2 and keeps what still applies', () => {
  for (const [seed, flags] of [[7, {}], [13, { rival: true, seasons: true }], [42, { rival: true }]]) {
    const s = fresh(seed, { threats: true, ...flags });
    s.chapter = 2;
    s.objectives = createObjectives(2, Boolean(s.flags.seasons), s.world.biome, Boolean(s.flags.rival));
    s.flags.allObjectivesDone = true;
    s.flags.pagesDone = 1;
    const payload = JSON.parse(JSON.stringify(encodeState(s)));
    // the shape of the old save: the done ones of the old page, among them ones that moved to later pages
    payload.objectives = ['allies', 'ancient', 'gravel', 'spores500', `glade${s.world.biome[0].toUpperCase()}${s.world.biome.slice(1)}`];
    const back = decodeState(payload);
    assert.equal(back.chapter, 2);
    assert.deepEqual(ids(back), ids(s), 'the page is the new page 2');
    assert.ok(ids(back).length <= 5);
    assert.deepEqual(back.objectives.filter((o) => o.done).map((o) => o.id), ['allies', 'gravel'], 'only what is still on the page stays ticked');
    const seen = step(back, 2);
    assert.ok(!seen.some((e) => e.type === 'all-objectives'), 'the page does not close by itself');
    assert.equal(back.chapter, 2);
    assert.equal(back.flags.pagesDone, 1);
  }
});

test('an old save whose page-2 ticks are the new page 2 closes it honestly: every line really done', () => {
  const s = fresh(7, { threats: true });
  s.chapter = 2;
  s.objectives = createObjectives(2, false, s.world.biome, false);
  const payload = JSON.parse(JSON.stringify(encodeState(s)));
  payload.objectives = ['allies', 'finds', 'gravel', 'worms', 'ancient', 'spores500', 'gladeMixed'];
  const back = decodeState(payload);
  assert.deepEqual(back.objectives.every((o) => o.done), true);
  const seen = step(back, 1);
  assert.equal(seen.filter((e) => e.type === 'all-objectives').length, 1);
  assert.equal(back.chapter, 3);
  assert.deepEqual(ids(back), ['gladeMixed', 'ancient', 'mushrooms8', 'reserve']);
  assert.ok(back.objectives.every((o) => !o.done || ['ancient'].includes(o.id)), 'the new page starts open, except what is already true');
});

test('an old save on page 3 keeps its done lines; an old finished book (page 3 of 3) turns to the new last page', () => {
  const s = fresh(7, { threats: true, seasons: true });
  s.chapter = 3;
  s.objectives = createObjectives(3, true, s.world.biome, false);
  s.flags.pagesDone = 2;
  const payload = JSON.parse(JSON.stringify(encodeState(s)));
  payload.objectives = ['winter', 'mushrooms8'];
  const half = decodeState(payload);
  assert.deepEqual(half.objectives.filter((o) => o.done).map((o) => o.id), ['mushrooms8', 'winter']);
  assert.ok(!step(half, 1).some((e) => e.type === 'all-objectives'));
  assert.equal(half.chapter, 3);

  const closed = fresh(7, { threats: true, seasons: true });
  closed.chapter = 3;
  closed.objectives = createObjectives(3, true, closed.world.biome, false);
  closed.flags.pagesDone = 3;
  closed.flags.bookDone = true;
  const old = JSON.parse(JSON.stringify(encodeState(closed)));
  old.objectives = ['winter', 'mushrooms8', 'spores1500'];
  const book = decodeState(old);
  assert.equal(book.flags.bookDone, true);
  const seen = step(book, 1);
  assert.deepEqual(seen.filter((e) => e.type === 'chapter'), [{ type: 'chapter', chapter: 4 }]);
  assert.equal(book.chapter, 4);
  assert.ok(!book.flags.bookDone);
  assert.deepEqual(ids(book), ['spores500', 'spores1500']);
  // and the last page closes the book for good
  book.res.spores = B.chapter3Spores;
  step(book, 1);
  assert.equal(book.flags.bookDone, true);
  assert.equal(book.flags.pagesDone, 4);
  assert.equal(step(book, 3).filter((e) => e.type === 'chapter' || e.type === 'all-objectives').length, 0);
  const again = roundTrip(book);
  assert.equal(again.chapter, 4);
  assert.equal(again.flags.bookDone, true);
});

test('a new game after the cut: page 2 is quick to read, five lines at most, with the stakes grade untouched', () => {
  const s = fresh(7, { threats: true, rival: true, seasons: true });
  s.chapter = 2;
  s.objectives = createObjectives(2, true, s.world.biome, true);
  assert.deepEqual(ids(s), ['allies', 'finds', 'gravel', 'worms', 'rivalCut']);
  assert.equal(B.stakes.max.pages, 15);
  // the pages part of a year: a closed page is the whole mark, an open one counts what is done of it (the share of five, not of eight)
  s.objectives.slice(0, 2).forEach((o) => (o.done = true));
  assert.equal(s.objectives.filter((o) => o.done).length / s.objectives.length, 0.4);
});

// ---- what happened on page 1 does not count on page 2 ------------------------------------------------------------------------

/** A game with the rival whose page 1 closes with the rival's stats and the worm count already high. */
function openPageTwo(highFreed = 2, highCut = 20, highCaught = 7) {
  const s = fresh(7, { threats: true, rival: true });
  step(s, 0.2); // the first step creates the rival
  assert.ok(s.rival, 'the rival exists');
  s.rival.stats.freedTrees = highFreed;
  s.rival.stats.cut = highCut;
  s.sim.threat.caught = highCaught;
  for (const o of s.objectives.slice(0, 4)) o.done = true;
  s.res.spores = B.sporesGoal;
  step(s, 0.2);
  assert.equal(s.chapter, 2);
  return s;
}
const doneIds = (s) => s.objectives.filter((o) => o.done).map((o) => o.id);

test('page 2 opens with the rival and the worms already at high counts: neither line is ticked, and the line says zero', () => {
  const s = openPageTwo();
  assert.deepEqual(s.sim.pageBase, { chapter: 2, freed: 2, cut: 20, caught: 7 });
  step(s, 1);
  assert.ok(!doneIds(s).includes('rivalCut') && !doneIds(s).includes('worms'), doneIds(s).join());
  const rc = s.objectives.find((o) => o.id === 'rivalCut');
  assert.equal(objectiveProgress(s, rc), ` · 0/${B.rivalCutFreed} · 0/${B.rivalCutGoal}`);
  assert.equal(objectiveProgress(s, s.objectives.find((o) => o.id === 'worms')), ` · 0/${B.chapter2Worms}`);
});

test('after the page opened, rivalCut ticks with enough trees freed or enough segments cut, worms with five new catches', () => {
  const trees = openPageTwo();
  trees.rival.stats.freedTrees += B.rivalCutFreed - 1;
  step(trees, 0.2);
  assert.ok(!doneIds(trees).includes('rivalCut'));
  assert.match(objectiveProgress(trees, trees.objectives.find((o) => o.id === 'rivalCut')), new RegExp(`^ · ${B.rivalCutFreed - 1}/`));
  trees.rival.stats.freedTrees += 1;
  step(trees, 0.2);
  assert.ok(doneIds(trees).includes('rivalCut'), 'trees freed on the page');

  const cuts = openPageTwo();
  cuts.rival.stats.cut += B.rivalCutGoal - 1;
  step(cuts, 0.2);
  assert.ok(!doneIds(cuts).includes('rivalCut'));
  cuts.rival.stats.cut += 1;
  step(cuts, 0.2);
  assert.ok(doneIds(cuts).includes('rivalCut'), 'segments cut on the page');

  const worms = openPageTwo();
  worms.sim.threat.caught += B.chapter2Worms - 1;
  step(worms, 0.2);
  assert.ok(!doneIds(worms).includes('worms'), `${B.chapter2Worms - 1} new catches are not ${B.chapter2Worms}`);
  worms.sim.threat.caught += 1;
  step(worms, 0.2);
  assert.ok(doneIds(worms).includes('worms'));
});

test('the baseline survives a save in the middle of the page; an old save without one counts from zero, as before', () => {
  const s = openPageTwo();
  s.rival.stats.freedTrees += 1;
  s.sim.threat.caught += 3;
  step(s, 0.2);
  const payload = JSON.parse(JSON.stringify(encodeState(s)));
  const back = decodeState(payload);
  assert.deepEqual(back.sim.pageBase, { chapter: 2, freed: 2, cut: 20, caught: 7 });
  assert.equal(back.rival.stats.freedTrees, 3);
  assert.equal(objectiveProgress(back, back.objectives.find((o) => o.id === 'rivalCut')), ` · 1/${B.rivalCutFreed} · 0/${B.rivalCutGoal}`);
  assert.equal(objectiveProgress(back, back.objectives.find((o) => o.id === 'worms')), ` · 3/${B.chapter2Worms}`);
  back.rival.stats.freedTrees += 1;
  back.sim.threat.caught += 2;
  step(back, 0.2);
  assert.ok(doneIds(back).includes('rivalCut') && doneIds(back).includes('worms'), 'the count goes on after the load');

  // an old save: page 2 with the rival's stats high and no baseline in the file
  delete payload.sim.rest.pageBase;
  const old = decodeState(payload);
  assert.equal(old.sim.pageBase, undefined);
  assert.equal(old.chapter, 2);
  assert.equal(objectiveProgress(old, old.objectives.find((o) => o.id === 'rivalCut')), ` · ${B.rivalCutFreed}/${B.rivalCutFreed} · ${B.rivalCutGoal}/${B.rivalCutGoal}`, 'the whole game counts');
  step(old, 0.2);
  assert.ok(doneIds(old).includes('rivalCut'), 'counted from zero, so the freed trees count');
  assert.ok(doneIds(old).includes('worms'), 'and so do the catches');
  // pages 3 and 4 have a baseline too, and a page that is not the baseline page ignores it
  old.sim.pageBase = { chapter: 3, freed: 99, cut: 99, caught: 99 };
  assert.equal(objectiveProgress(old, { id: 'worms', text: 'x', done: false }), ` · ${B.chapter2Worms}/${B.chapter2Worms}`);
});

// ---- page 1: «Подрастить деревья» is an amount of growth, not a stage-up ---------------------------------------------------

test('page 1 reads «Подрастить деревья · N/25 %», and the goal is a fraction of one stage', () => {
  const s = fresh(7, { threats: true });
  const line = s.objectives.find((o) => o.id === 'treeGrow');
  assert.equal(line.text, 'Подрастить деревья');
  assert.ok(B.treeGrowGoal > 0 && B.treeGrowGoal < 1, 'less than one stage-up');
  assert.deepEqual(objectiveCount(s, 'treeGrow'), [0, Math.round(B.treeGrowGoal * 100), ' %']);
  assert.match(objectiveText(s, line), / · 0\/\d+ %$/);
});

test("the trees' growth is counted as the trees themselves grow: stage-ups and the growth under way, nothing twice", () => {
  const was = createState(9).world.trees.map((t) => [t.stage, t.growth]);
  const run = playBot(9, { seasons: true, threats: true, maxSeconds: 200, runOn: true }).state;
  const total = run.sim.treeGrowTotal;
  const delta = run.world.trees.reduce((a, t, i) => a + (t.stage - was[i][0]) + (t.stage < 3 ? t.growth : 0) - (was[i][0] < 3 ? was[i][1] : 0), 0);
  assert.ok(total > 0, 'the bot grew something');
  assert.ok(Math.abs(total - delta) < 0.06, `counted ${total.toFixed(3)} against the trees' own ${delta.toFixed(3)}`);
});

test('treeGrow ticks at the goal, not before, and it needs no stage-up and no feeding', () => {
  const s = fresh(7, { threats: true });
  s.sim.treeGrowTotal = B.treeGrowGoal - 0.011;
  step(s, 0.2);
  assert.ok(!s.objectives.find((o) => o.id === 'treeGrow').done);
  s.sim.treeGrowTotal = B.treeGrowGoal;
  const seen = step(s, 0.2);
  assert.ok(s.objectives.find((o) => o.id === 'treeGrow').done);
  assert.ok(seen.some((e) => e.type === 'objective' && e.id === 'treeGrow'));
  assert.equal(s.sim.treeStageUps, 0, 'no stage-up needed');
  assert.equal(s.feed ?? null, null, 'no feeding needed');
});

test('a bot closes page 1 in 150-450 s without feeding, on a spread of glades (seasons and threats on)', () => {
  const closed = [];
  for (const seed of [2, 5, 9, 42]) {
    const { state, stats } = playBot(seed, { seasons: true, threats: true, rival: true, maxSeconds: 600 });
    const t1 = stats.chapterDone[1];
    closed.push(`${seed}:${Math.round(t1)}`);
    assert.ok(t1 >= 150 && t1 <= 450, `seed ${seed}: page 1 closed at ${t1}`);
    assert.equal(state.feed ?? null, null, 'the bot never fed a tree');
    assert.ok(!stats.events['feed-start'], 'no feeding event');
  }
  console.log(`# page 1 closes at: ${closed.join(' ')}`);
});

test('saves: the growth total round-trips, and a save from before it is reckoned from the stages and growth it holds', () => {
  const s = fresh(7, { threats: true });
  s.sim.treeGrowTotal = 0.2;
  const back = roundTrip(s);
  assert.equal(back.sim.treeGrowTotal, 0.2);
  assert.equal(objectiveProgress(back, back.objectives.find((o) => o.id === 'treeGrow')), ` · 20/${Math.round(B.treeGrowGoal * 100)} %`);

  // an old save made on page 1: no total in the file, a stage already grown
  const t = s.world.trees.find((x) => x.stage < 3);
  t.growth = 0.1;
  s.sim.treeStageUps = 1;
  const payload = JSON.parse(JSON.stringify(encodeState(s)));
  delete payload.sim.rest.treeGrowTotal;
  const old = decodeState(payload);
  assert.ok(old.sim.treeGrowTotal >= 1.1 - 1e-9, `the stage-up so far and the growth under way: ${old.sim.treeGrowTotal}`);
  step(old, 0.2);
  assert.ok(old.objectives.find((o) => o.id === 'treeGrow').done, 'a tree that had already grown a stage keeps the line');

  // an old save from the very start: nothing grown, nothing ticked
  const start = fresh(7, { threats: true });
  const p0 = JSON.parse(JSON.stringify(encodeState(start)));
  delete p0.sim.rest.treeGrowTotal;
  const young = decodeState(p0);
  step(young, 0.2);
  assert.ok(!young.objectives.find((o) => o.id === 'treeGrow').done);

  // an old save whose treeGrow was ticked under the old rule stays ticked
  const ticked = JSON.parse(JSON.stringify(encodeState(start)));
  delete ticked.sim.rest.treeGrowTotal;
  ticked.objectives = ['water', 'tree', 'mushroom', 'treeGrow'];
  assert.ok(decodeState(ticked).objectives.find((o) => o.id === 'treeGrow').done);
});

test('rivalCut is a short line: two ways, two numbers', () => {
  const text = pageObjectives(2, true, 'oak', true).find((o) => o.id === 'rivalCut').text;
  assert.equal(text, `Опёнок: спасти ${B.rivalCutFreed} дерева или перерезать ${B.rivalCutGoal} тяжей`);
  assert.ok(text.length <= 50, `${text.length} characters`);
  const s = fresh(7, { threats: true, rival: true });
  assert.equal(objectiveProgress(s, { id: 'rivalCut', text, done: false }), ` · 0/${B.rivalCutFreed} · 0/${B.rivalCutGoal}`);
});

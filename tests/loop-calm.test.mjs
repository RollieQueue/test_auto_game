// «Менее сумбурный луп»: the message flow (src/ui/flow.js, the slip queue's gift priority) and the honey fungus's breather after
// the page change (src/sim/rival.js). Expected numbers come from B (src/sim/balance.js), never from literals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANK_ALERT, RANK_AMBIENT, RANK_NEWS, isNoise, noteRank, releaseHeld, victimIndex } from '../src/ui/flow.js';
import { describeNote } from '../src/ui/notes.js';
import { createSlipQueue } from '../src/ui/slips-logic.js';
import { createState } from '../src/state.js';
import { B } from '../src/sim/balance.js';
import { clockAt } from '../src/sim/clock.js';
import { stepRival } from '../src/sim/rival.js';

const DT = 1 / 60;

test('ranks: threats and warnings are alerts, weather and growth chatter are ambient, the rest is news', () => {
  assert.equal(noteRank({ key: 'rival:wake', tone: 'warn' }), RANK_ALERT);
  assert.equal(noteRank({ key: 'threat:sense', tone: 'warn' }), RANK_ALERT);
  assert.equal(noteRank({ key: 'severed', tone: 'warn' }), RANK_ALERT);
  assert.equal(noteRank({ key: 'weather:rain' }), RANK_AMBIENT);
  assert.equal(noteRank({ key: 'weather:drought', tone: 'warn' }), RANK_AMBIENT, 'ambient is checked first');
  assert.equal(noteRank({ key: 'mush:planted' }), RANK_AMBIENT);
  assert.equal(noteRank({ key: 'nudge:fruit', tone: 'good' }), RANK_AMBIENT);
  assert.equal(noteRank({ key: 'rival:freed:1', tone: 'good' }), RANK_NEWS, 'good news of the honey fungus is news');
  assert.equal(noteRank({ key: 'threat:chapter', tone: 'good' }), RANK_NEWS);
  assert.equal(noteRank({ key: 'obj:water', tone: 'good' }), RANK_NEWS);
  assert.equal(noteRank({ key: 'season:summer', tone: 'good' }), RANK_NEWS);
});

test('the real notes: «дождь кончился» and «небо прояснилось» are noise, a drought and a rain are not', () => {
  const s = createState(7);
  const note = (type, kind, prev) => describeNote(s, { type, kind }, prev);
  assert.equal(isNoise(note('weather', 'clear', 'rain')), true);
  assert.equal(isNoise(note('weather', 'clear', 'drought')), true);
  assert.equal(isNoise(note('weather', 'rain', 'clear')), false);
  assert.equal(isNoise(note('weather', 'drought', 'clear')), false);
  assert.equal(isNoise(null), false);
});

test('notes held behind a page: every alert, only the newest news, no ambient, never more than the cap', () => {
  const h = (key, tone) => ({ d: { key }, rank: noteRank({ key, tone }) });
  const held = [h('obj:water', 'good'), h('weather:rain'), h('threat:sense', 'warn'), h('threat:chapter', 'good'), h('obj:spores', 'good')];
  assert.deepEqual(releaseHeld(held, 2).map((d) => d.key), ['obj:spores', 'threat:sense'], 'the newest news first, the alert on top');
  assert.deepEqual(releaseHeld([h('weather:rain'), h('mush:planted')], 2), []);
  const many = ['rival:grip:1', 'rival:grip:2', 'rival:grip:3'].map((k) => h(k, 'warn'));
  assert.deepEqual(releaseHeld(many, 2).map((d) => d.key), ['rival:grip:2', 'rival:grip:3'], 'the newest alerts when more than the cap');
});

test('a full stack pushes off the quietest note first, the oldest of its rank', () => {
  assert.equal(victimIndex([RANK_ALERT, RANK_NEWS, RANK_AMBIENT]), 2);
  assert.equal(victimIndex([RANK_NEWS, RANK_ALERT, RANK_NEWS]), 0);
  assert.equal(victimIndex([RANK_ALERT, RANK_ALERT]), 0);
  assert.equal(victimIndex([]), -1);
});

test('slip queue: a page gift (kicker) goes first and a mark waits until the gift has gone', () => {
  const q = createSlipQueue();
  q.push({ id: 'mark-a' });
  q.push({ id: 'mark-b' });
  q.push({ id: 'unlock:feed', kicker: 'Страница закрыта', life: 7 });
  let r = q.tick(0);
  assert.deepEqual(r.enter.map((x) => x.id), ['unlock:feed'], 'the gift alone: no mark shares the screen with it');
  assert.deepEqual(q.snapshot(), { showing: ['unlock:feed'], waiting: ['mark-a', 'mark-b'] });
  q.tick(7.1); // leaving
  r = q.tick(1);
  assert.deepEqual(r.gone.map((x) => x.id), ['unlock:feed']);
  assert.deepEqual(r.enter.map((x) => x.id), ['mark-a', 'mark-b']);
});

// ---- the honey fungus's breather ------------------------------------------------------------------------------------------------

function fresh(seed = 13) {
  const s = createState(seed, 2);
  s.phase = 'playing';
  s.flags.rival = true;
  return s;
}
function wakeTime(s, limit) {
  for (let t = 0; t < limit; t += DT) {
    stepRival(s, DT);
    s.time += DT;
    const woke = s.events.some((e) => e.type === 'rival-wake');
    s.events.length = 0;
    if (woke) return s.time;
  }
  return null;
}

test('a page that closes late: the honey fungus wakes B.rivalWakeBreather s after it, not at the 420 s mark', () => {
  const s = fresh();
  s.chapter = 2;
  s.time = B.rivalWakeBy - 40; // page 2 opened 40 s ago, and the 420 s mark is near
  const at = wakeTime(s, 200);
  assert.ok(at !== null);
  assert.ok(at >= B.rivalWakeBy - 40 + B.rivalWakeBreather - 0.1, `woke at ${at}: the breather after the page change is kept`);
  assert.ok(at < B.rivalWakeBy - 40 + B.rivalWakeBreather + 1, `woke at ${at}: and no later than it needs to`);
});

test('a page that closed early is not slowed: chapter 2 + B.rivalWakeDelay still wakes it', () => {
  const s = fresh();
  s.chapter = 2;
  s.time = 100;
  const at = wakeTime(s, B.rivalWakeDelay + 5);
  assert.ok(at !== null && Math.abs(at - (100 + B.rivalWakeDelay)) < 0.1, `woke at ${at}`);
});

test('with seasons on it does not wake in the first seconds of a season, but at once after them', () => {
  const s = fresh();
  s.flags.seasons = true;
  s.time = B.rivalWakeBy + 1;
  Object.assign(s.clock, clockAt(B.seasonSeconds * 2 + 0.5 * B.rivalWakeSeasonEdge * B.seasonSeconds)); // autumn, the edge of it
  stepRival(s, DT);
  assert.equal(s.rival.awake, false, 'the first seconds of autumn: wait');
  Object.assign(s.clock, clockAt(B.seasonSeconds * 2 + 2 * B.rivalWakeSeasonEdge * B.seasonSeconds));
  stepRival(s, DT);
  assert.equal(s.rival.awake, true);
});

test('slip queue: with two notes on the stack a mark waits (canEnter false), a page gift does not', () => {
  const q = createSlipQueue();
  q.push({ id: 'mark' });
  assert.deepEqual(q.tick(0, false).enter, [], 'a full note stack: the mark waits');
  q.push({ id: 'unlock:feed', kicker: 'Страница закрыта', life: 7 });
  assert.deepEqual(q.tick(0, false).enter.map((x) => x.id), ['unlock:feed'], 'the gift comes in anyway');
  assert.deepEqual(q.tick(7.7, false).enter, [], 'the gift is gone, but the stack is still full');
  assert.deepEqual(q.tick(0, true).enter.map((x) => x.id), ['mark'], 'the stack has room: the mark comes');
});

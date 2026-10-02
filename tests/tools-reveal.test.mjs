// Tools enter the toolbar one by one (src/sim/tools.js, ui/tools.js) and the first nematode / honey-fungus waking open a card (ui/callout-logic.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { revealAll, revealTool, revealTools, syncTools, toolRevealed } from '../src/sim/tools.js';
import { decodeState, encodeState } from '../src/persist-codec.js';
import { shownTools, toolShown } from '../src/ui/tools.js';
import { pointClear, rivalDue, visibleWorm, wormDue } from '../src/ui/callout-logic.js';
import { buildHelp, toolKeyRows } from '../src/ui/help.js';
import { sporesGoalOf } from '../src/ui/resources-logic.js';

const roundTrip = (s) => decodeState(JSON.parse(JSON.stringify(encodeState(s))));
const fresh = (flags = { threats: true }) => {
  const s = createState(13, 2);
  s.phase = 'playing';
  Object.assign(s.flags, flags);
  return s;
};
const VIEW = { cssW: 1600, cssH: 900, scale: 0.83, ox: 0, oy: 0 };
const worm = (o = {}) => ({ id: 1, x: 900, y: 600, mode: 'wander', fade: 1, age: 3, ...o });

test('a new game shows only «Нить»; the other tools are hidden until they enter the game', () => {
  const s = fresh();
  assert.deepEqual(shownTools(s).map((t) => t.tool), ['grow']);
  assert.equal(toolRevealed(s, 'grow'), true);
  for (const k of ['fruit', 'trap', 'barrier', 'feed']) assert.equal(toolShown(s, k), false, k);
});

test('the mushroom tool is revealed by the first tree alliance (the guide asks for a mushroom then)', () => {
  const s = fresh();
  assert.deepEqual(revealTools(s), []);
  s.net.links.push({ kind: 'tree' });
  assert.deepEqual(revealTools(s), ['fruit']);
  assert.equal(toolShown(s, 'fruit'), true);
  assert.deepEqual(revealTools(s), [], 'once');
});

test('the barrier is revealed when the honey fungus wakes, and never without a rival', () => {
  const s = fresh({ threats: true, rival: true });
  sim.updateSim(s, 1 / 60);
  assert.equal(toolShown(s, 'barrier'), false);
  s.rival.awake = true;
  assert.ok(revealTools(s).includes('barrier'));
  assert.equal(toolShown(s, 'barrier'), true);
  const t = fresh({ threats: true });
  t.rival = { awake: true };
  assert.equal(revealTools(t).includes('barrier'), false);
});

test('feeding is revealed only once page 1 has opened it and a tree can be fed', () => {
  const s = fresh();
  s.flags.unlocks = { feed: true };
  s.feed = { treeId: 0 };
  assert.ok(revealTools(s).includes('feed'));
  const locked = fresh();
  locked.feed = { treeId: 0 };
  assert.equal(revealTools(locked).includes('feed'), false, 'locked while page 1 is open');
});

test('the ring never shows with the threats off, even when revealed', () => {
  const s = fresh({});
  revealTool(s, 'trap');
  assert.equal(toolShown(s, 'trap'), false);
  assert.equal(revealAll(s).includes('trap'), false);
  const t = fresh();
  assert.equal(revealTool(t, 'trap'), true);
  assert.equal(toolShown(t, 'trap'), true);
  assert.equal(revealTool(t, 'trap'), false);
});

test('the revealed tools are saved; an old save derives them from the state', () => {
  const s = fresh();
  revealTool(s, 'trap');
  revealTool(s, 'fruit');
  assert.deepEqual(roundTrip(s).flags.tools, { trap: true, fruit: true });
  // a new save with nothing revealed stays so: an unseen worm does not reveal the ring on load
  const young = fresh();
  young.sim.threat.nextWorm = 2;
  assert.deepEqual(roundTrip(young).flags.tools, {});
  // an old save has no record: worms met, an ally
  const old = JSON.parse(JSON.stringify(encodeState(fresh())));
  delete old.flags.tools;
  assert.equal(toolRevealed(decodeState(old), 'trap'), false, 'a fresh old save');
  const met = fresh();
  met.sim.threat.nextWorm = 3;
  met.net.links.push({ nodeId: 0, kind: 'tree', targetId: 0, born: 0, tip: 0 });
  const p = JSON.parse(JSON.stringify(encodeState(met)));
  delete p.flags.tools;
  const loaded = decodeState(p);
  assert.equal(toolRevealed(loaded, 'trap'), true);
  assert.equal(toolRevealed(loaded, 'fruit'), true);
  const later = fresh();
  later.chapter = 2;
  assert.ok(syncTools(later).includes('trap'), 'a later page has met the worms');
});

test('the card is due for a worm that is fully on screen, clear of the HUD cards', () => {
  const s = fresh();
  s.fauna = [worm()];
  assert.deepEqual(wormDue(s, VIEW, [], false), { x: 900, y: 600 });
  assert.equal(wormDue(s, VIEW, [], true), null, 'a page is open');
  s.phase = 'paused';
  assert.equal(wormDue(s, VIEW, [], false), null);
  s.phase = 'playing';
  s.ui.card = 'rival';
  assert.equal(wormDue(s, VIEW, [], false), null, 'another card is up');
  s.ui.card = null;
  assert.equal(wormDue(fresh({}), VIEW, [], false), null);
  revealTool(s, 'trap');
  assert.equal(wormDue(s, VIEW, [], false), null, 'once the ring is there the card has been');
});

test('a worm that is leaving, fading in, off screen or under a HUD card gets no card', () => {
  const s = fresh();
  for (const w of [worm({ mode: 'leave' }), worm({ fade: 0.3 }), worm({ x: 5 }), worm({ y: 1100 })]) {
    s.fauna = [w];
    assert.equal(visibleWorm(s, VIEW, []), null);
  }
  const p = { x: 900 * VIEW.scale, y: 600 * VIEW.scale };
  const card = [{ l: p.x - 40, t: p.y - 40, r: p.x + 40, b: p.y + 40 }];
  assert.equal(pointClear(VIEW, card, p), false);
  s.fauna = [worm()];
  assert.equal(visibleWorm(s, VIEW, card), null);
  s.fauna = [worm({ id: 2, x: 5, age: 9 }), worm({ id: 3 })];
  assert.equal(visibleWorm(s, VIEW, []).id, 3, 'the hidden one is skipped, the visible one is taken');
});

test('the honey fungus waking gets a card only in a game that has begun', () => {
  const s = fresh({ threats: true, rival: true });
  s.time = 200;
  const ev = { type: 'rival-wake', x: 700, y: 400 };
  assert.deepEqual(rivalDue(s, VIEW, [], ev, false), { x: 700, y: 400, spot: true });
  assert.equal(rivalDue(s, VIEW, [], ev, true), null);
  assert.equal(rivalDue(s, VIEW, [], { type: 'worm-spawn' }, false), null);
  s.time = 1;
  assert.equal(rivalDue(s, VIEW, [], ev, false), null, '?rival=1 wakes it at once');
});

test('the help page lists only the open tools and says more will come; a bare state lists them all', () => {
  const s = fresh();
  const rows = toolKeyRows(s);
  assert.match(rows, /<kbd>1<\/kbd><\/span><span>нить</);
  assert.match(rows, /откроются позже/);
  assert.doesNotMatch(rows, /<kbd>3<\/kbd>/);
  revealTool(s, 'trap');
  revealTool(s, 'fruit');
  assert.match(toolKeyRows(s), /<kbd>1<\/kbd> <kbd>2<\/kbd> <kbd>3<\/kbd>/);
  assert.doesNotMatch(buildHelp(s), /Нажми <kbd>4<\/kbd>/);
  assert.match(toolKeyRows({}), /<kbd>5<\/kbd>/);
});

test('the sim run by a bot or a fast-forward never pauses or opens a card by itself', () => {
  const s = fresh();
  s.fauna = [worm()];
  for (let i = 0; i < 120; i++) sim.updateSim(s, 1 / 60);
  assert.equal(s.phase, 'playing');
  assert.equal(s.ui.card, null);
});

test('the spores row says what the open page asks for', () => {
  const s = fresh();
  s.objectives = [{ id: 'spores', done: false }];
  assert.ok(sporesGoalOf(s) > 0);
  s.objectives = [{ id: 'spores', done: true }];
  assert.equal(sporesGoalOf(s), 0);
});

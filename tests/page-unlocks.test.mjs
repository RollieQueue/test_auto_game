// A closed page gives something new (src/sim/unlocks.js): page 1 -> tool 5 «Подкормка», page 2 -> a sturdier catching ring, page 3 -> a
// wider find radius. The flag state.flags.unlocks is saved; chapters off = every tool open, the better numbers stay the old ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { B } from '../src/sim/balance.js';
import { addNode } from '../src/sim/network.js';
import { checkFinds, findRadius } from '../src/sim/finds.js';
import { spawnWormAt } from '../src/sim/threats.js';
import { createObjectives } from '../src/sim/objectives.js';
import { isUnlocked, syncUnlocks, trapDigestSeconds } from '../src/sim/unlocks.js';
import { decodeState, encodeState } from '../src/persist-codec.js';
import { feedTabShown } from '../src/ui/feed.js';
import { resourceTip } from '../src/ui/resources-logic.js';
import { buildHelp } from '../src/ui/help.js';
import { trapTabTitle } from '../src/ui/threats.js';
import { createSlipQueue } from '../src/ui/slips-logic.js';
import { summaryUnlockLine, unlockSlip, unlockTexts } from '../src/ui/unlocks.js';

const DT = 1 / 60;
const evs = (events, type) => events.filter((e) => e.type === type);
const roundTrip = (s) => decodeState(JSON.parse(JSON.stringify(encodeState(s))));

function fresh(seed = 13, flags = { threats: true }) {
  const s = createState(seed);
  s.phase = 'playing';
  Object.assign(s.flags, flags);
  return s;
}

function run(s, seconds) {
  const seen = [];
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    sim.updateSim(s, DT);
    s.time += DT;
    seen.push(...s.events);
    s.events.length = 0;
  }
  return seen;
}

/** Every observation of the current page is ticked: the next step closes it. */
function closePage(s) {
  for (const o of s.objectives) o.done = true;
  const seen = [];
  sim.updateSim(s, DT);
  seen.push(...s.events);
  s.events.length = 0;
  return seen;
}

/** Every tree an ally by a fake root contact, healthy, a full pantry. */
function linked(s) {
  for (const t of s.world.trees) {
    s.sim.contacts[t.id] = [1000 + t.id];
    t.linked = true;
    t.health = 1;
  }
  sim.updateSim(s, DT);
  s.events.length = 0;
  s.res.sugar = s.cap.sugar;
  return s;
}

/** The spore's network plus a thin hypha of `n` nodes to the right, old enough to bite. */
function arena(seed = 7, n = 14) {
  const s = fresh(seed);
  const o = s.net.nodes[s.net.originId];
  const ids = [];
  let prev = s.net.originId;
  for (let i = 1; i <= n; i++) {
    prev = addNode(s, o.x + 16 * i, o.y, prev).id;
    ids.push(prev);
  }
  s.time = 100;
  return { s, ids };
}

// ---- page 1: «Подкормка» -----------------------------------------------------------------------------------------------

test('page 1 closed: the flag is set, the event comes before the next page, and feeding opens', () => {
  const s = linked(fresh());
  assert.equal(s.flags.unlocks, undefined, 'a new game has none');
  const seen = closePage(s);
  assert.deepEqual(s.flags.unlocks, { feed: true });
  assert.deepEqual(evs(seen, 'unlock'), [{ type: 'unlock', key: 'feed', page: 1 }]);
  assert.ok(seen.findIndex((e) => e.type === 'unlock') < seen.findIndex((e) => e.type === 'chapter'));
  assert.equal(s.chapter, 2);
});

test('before page 1 closes: no tab, no key 5, no hint in the full pantry, and commandFeed is refused', () => {
  const s = linked(fresh());
  assert.equal(isUnlocked(s, 'feed'), false);
  assert.equal(sim.canFeedAny(s), false);
  assert.equal(feedTabShown(s), false);
  const tip = resourceTip(s, 'sugar').body.join(' ');
  assert.doesNotMatch(tip, /Подкорми/);
  assert.equal(sim.commandFeed(s, 0), false);
  assert.equal(s.feed, null);
  assert.deepEqual(s.events.splice(0).map((e) => [e.type, e.reason]), [['feed-denied', 'locked']]);
  // the help page does not list key 5 yet
  assert.doesNotMatch(buildHelp(s), /<kbd>5<\/kbd><\/span><span>подкормка/);
});

test('after page 1 closes: the tab is shown, the hint and the key are on the help page, and commandFeed works', () => {
  const s = linked(fresh());
  closePage(s);
  s.res.sugar = s.cap.sugar;
  assert.equal(isUnlocked(s, 'feed'), true);
  assert.equal(feedTabShown(s), true);
  assert.match(resourceTip(s, 'sugar').body.join(' '), /Подкорми дерево \(5\)/);
  assert.match(buildHelp(s), /<kbd>5<\/kbd><\/span><span>подкормка/);
  assert.equal(sim.commandFeed(s, 0), 'on');
  assert.deepEqual(s.feed && s.feed.treeId, 0);
});

test('chapters off: feeding is open from the start, and the better numbers stay the old ones', () => {
  const s = linked(fresh(13, {}));
  for (const key of ['feed', 'trap', 'finds']) assert.equal(isUnlocked(s, key), true, key);
  assert.equal(feedTabShown(s), true);
  assert.equal(sim.commandFeed(s, 0), 'on');
  assert.equal(trapDigestSeconds(s), B.trapDigestSeconds);
  const decor = s.world.decor[0];
  assert.equal(findRadius(decor, s), B.findRadiusBase + B.findRadiusPerScale * decor.scale);
  assert.equal(s.flags.unlocks, undefined);
  assert.deepEqual(syncUnlocks(s), []);
  // and no page closes by itself into an unlock event
  assert.equal(evs(closePage(s), 'unlock').length, 0);
});

// ---- page 2: the ring -------------------------------------------------------------------------------------------------

/** Catches one worm in a ring on the arena and returns the ring (cool = what it has to digest now). */
function catchOne(s, ids) {
  s.res.sugar = 60;
  assert.ok(sim.commandTrap(s, ids[6]));
  const trap = s.traps[0];
  run(s, B.trapGrowSeconds + 0.3);
  const t = s.net.nodes[ids[6]];
  const w = spawnWormAt(s, t.x, t.y + B.trapRadius - 10);
  w.base = 0.001;
  w.life = 1e6;
  w.grazer = true;
  w.full = 100;
  for (let i = 0; i < 50 && trap.charges === B.trapCharges; i++) run(s, 0.1);
  assert.equal(trap.charges, B.trapCharges - 1, 'caught');
  return trap;
}

test('the ring digests for the old time until page 2 closes, then for the shorter one', () => {
  const a = arena();
  const before = catchOne(a.s, a.ids);
  assert.ok(before.cool > B.trapDigestSeconds - 0.3 && before.cool <= B.trapDigestSeconds, `before: ${before.cool}`);
  assert.equal(trapDigestSeconds(a.s), B.trapDigestSeconds);

  const b = arena();
  b.s.chapter = 3; // pages 1 and 2 are closed
  b.s.flags.pagesDone = 2;
  assert.equal(trapDigestSeconds(b.s), B.trapDigestSecondsPage2);
  const after = catchOne(b.s, b.ids);
  assert.ok(after.cool > B.trapDigestSecondsPage2 - 0.3 && after.cool <= B.trapDigestSecondsPage2, `after: ${after.cool}`);
  assert.ok(B.trapDigestSecondsPage2 < B.trapDigestSeconds);
});

test('page 2 closed: the flag, the event, and a ring that is digesting speeds up at once', () => {
  const { s, ids } = arena();
  s.chapter = 2;
  s.objectives = createObjectives(2, false, s.world.biome, false);
  s.flags.unlocks = { feed: true };
  s.flags.pagesDone = 1;
  const trap = catchOne(s, ids);
  assert.ok(trap.cool > B.trapDigestSecondsPage2);
  const seen = closePage(s);
  assert.deepEqual(s.flags.unlocks, { feed: true, trap: true });
  assert.deepEqual(evs(seen, 'unlock'), [{ type: 'unlock', key: 'trap', page: 2 }]);
  sim.updateSim(s, DT);
  assert.ok(trap.cool <= B.trapDigestSecondsPage2 + 1e-9, `${trap.cool}`);
});

test('the trap tab title says the shorter digestion once page 2 is closed', () => {
  assert.doesNotMatch(trapTabTitle(16), /Крепкое/);
  assert.match(trapTabTitle(16, B.trapDigestSecondsPage2), new RegExp(`снова готово через ${B.trapDigestSecondsPage2} с`));
});

// ---- page 3: the find radius ------------------------------------------------------------------------------------------

test('the find radius is wider once page 3 is closed, and the closing takes in what the net already touches', () => {
  const s = fresh(7);
  const d = s.world.decor.find((x) => x.scale > 0) ?? s.world.decor[0];
  const base = findRadius(d);
  const spot = { x: d.x + base * 1.25, y: d.y };
  assert.equal(findRadius(d, s), base, 'not yet');
  checkFinds(s, spot);
  assert.equal(s.finds[d.id], undefined, 'outside the old radius');
  s.chapter = 3;
  s.objectives = createObjectives(3, false, s.world.biome, false);
  s.flags.unlocks = { feed: true, trap: true };
  s.flags.pagesDone = 2;
  // a node of the net lies in the new ring (and outside the old one)
  const node = addNode(s, spot.x, spot.y, s.net.originId);
  assert.equal(s.finds[d.id], undefined);
  s.events.length = 0;
  const seen = closePage(s);
  assert.deepEqual(evs(seen, 'unlock').map((e) => e.key), ['finds']);
  assert.equal(findRadius(d, s), base * B.findRadiusPage3);
  assert.ok(s.finds[d.id], 'found at the closing');
  assert.ok(evs(seen, 'find').some((e) => e.id === d.id));
  assert.ok(node);
});

// ---- the save ---------------------------------------------------------------------------------------------------------

test('the flags round-trip through the codec', () => {
  const s = linked(fresh());
  closePage(s);
  assert.deepEqual(s.flags.unlocks, { feed: true });
  const back = roundTrip(s);
  assert.deepEqual(back.flags.unlocks, { feed: true });
  assert.equal(sim.feedUnlocked(back), true);
  const none = roundTrip(fresh(7));
  assert.equal(none.flags.unlocks, undefined, 'a page-1 save has none');
  assert.equal(isUnlocked(none, 'feed'), false);
});

test('an old save past a page gets the unlocks of its closed pages', () => {
  for (const [chapter, want] of [
    [2, { feed: true }],
    [3, { feed: true, trap: true }],
    [4, { feed: true, trap: true, finds: true }],
  ]) {
    const s = fresh(7);
    s.chapter = chapter;
    s.objectives = createObjectives(chapter, false, s.world.biome, false);
    s.flags.allObjectivesDone = true;
    s.flags.pagesDone = chapter - 1;
    assert.equal(s.flags.unlocks, undefined);
    const payload = JSON.parse(JSON.stringify(encodeState(s)));
    assert.equal(payload.flags.unlocks, undefined, 'the old save has no flag');
    const back = decodeState(payload);
    assert.deepEqual(back.flags.unlocks, want, `chapter ${chapter}`);
    for (const key of Object.keys(want)) assert.equal(isUnlocked(back, key), true);
  }
  // a save of page 1 in which a tree is already fed keeps feeding
  const s = linked(fresh());
  s.feed = { treeId: 0, rate: 0 };
  const back = roundTrip(s);
  assert.deepEqual(back.flags.unlocks, { feed: true });
  assert.ok(back.feed);
  // the book closed on its last page: all three
  const book = fresh(7);
  book.chapter = 4;
  book.objectives = createObjectives(4, false, book.world.biome, false);
  book.flags.pagesDone = 4;
  book.flags.bookDone = true;
  assert.deepEqual(roundTrip(book).flags.unlocks, { feed: true, trap: true, finds: true });
});

// ---- the words --------------------------------------------------------------------------------------------------------

test('the slip says it in a title and one line; the summary has a line for pages 1-3 and none for 4 or without chapters', () => {
  const slip = unlockSlip('feed');
  assert.equal(slip.title, 'Новое умение: подкормка (5)');
  for (const key of ['feed', 'trap', 'finds']) {
    const t = unlockTexts(key);
    const item = unlockSlip(key);
    assert.ok(t.title.length > 10 && t.line.length > 20 && t.line.length <= 78, `${key}: ${t.line.length}`);
    assert.equal(item.id, `unlock:${key}`);
    assert.ok(item.life > 4 && item.kicker);
  }
  assert.equal(unlockSlip('nope'), null);
  const s = fresh(7);
  assert.match(summaryUnlockLine(s, 1), /подкормка \(5\)/);
  assert.match(summaryUnlockLine(s, 2), /кольцо/);
  assert.match(summaryUnlockLine(s, 3), /находки/);
  assert.equal(summaryUnlockLine(s, 4), '');
  assert.equal(summaryUnlockLine(fresh(7, {}), 1), '');
  // the slip queue keeps an item's own life
  const q = createSlipQueue();
  q.push(slip);
  q.tick(0);
  assert.equal(q.tick(5).leave.length, 0, 'still there after the usual 4 s');
  assert.equal(q.tick(2.1).leave.length, 1);
});

test('the help page lists what each page gives, the closed ones marked', () => {
  const s = fresh(7);
  const html = buildHelp(s);
  assert.match(html, /За первую страницу/);
  assert.match(html, /Ещё закрыто/);
  s.chapter = 4;
  s.flags.pagesDone = 3;
  assert.doesNotMatch(buildHelp(s), /Ещё закрыто/);
});

test('year and closed-page advice name «подкормка (5)» only once it is open, else the page that opens it (no key yet)', async () => {
  const { closedAdvice, gradeNext } = await import('../src/ui/year-logic.js');
  const lost = { capped: 'lost', parts: [] };
  assert.match(gradeNext(lost), /барьер \(4\) и подкормка \(5\)/);
  assert.match(gradeNext(lost, false), /допиши первую страницу — она откроет подкормку$/);
  const s = fresh();
  s.flags.pageClosed = { cause: 'grove', time: 500, year: 0, chapter: 1 };
  assert.equal(isUnlocked(s, 'feed'), false);
  assert.match(closedAdvice(s), /дописанная первая страница откроет подкормку\./);
  s.flags.unlocks = { feed: true };
  assert.match(closedAdvice(s), /барьер \(4\) и подкормка \(5\) берегут/);
});

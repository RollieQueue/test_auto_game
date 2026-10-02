// Feeding a tree («Подкормка»): src/sim/feed.js, the sugar clamp in economy.js, the save field and the HUD texts (src/ui/feed.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { B } from '../src/sim/balance.js';
import { stepEconomy } from '../src/sim/economy.js';
import { feedThreshold, feedUseful, stepFeed } from '../src/sim/feed.js';
import { decodeState, encodeState, validatePayload } from '../src/persist-codec.js';
import { resourceTip } from '../src/ui/resources-logic.js';
import { describeTree } from '../src/ui/trees-logic.js';
import { describeNote } from '../src/ui/notes.js';
import { describeFeedPick, feedLine, feedNote, feedTabShown, treeDative } from '../src/ui/feed.js';

const DT = 0.1;

/** Seed 13 (birch, 4 trees): every tree an ally by a fake root contact, healthy, a full pantry. */
function game({ rival = false, sugar = 1 } = {}) {
  const s = createState(13);
  s.flags.rival = rival;
  for (const t of s.world.trees) {
    s.sim.contacts[t.id] = [1000 + t.id];
    t.linked = true;
    t.health = 1;
  }
  s.phase = 'playing';
  stepEconomy(s, DT); // settles cap.sugar
  s.res.sugar = sugar * s.cap.sugar;
  s.res.water = s.cap.pool;
  s.res.minerals = s.cap.pool;
  return s;
}

function run(s, seconds, keep = null) {
  for (let t = 0; t < seconds; t += DT) {
    if (keep !== null) s.res.sugar = Math.max(s.res.sugar, keep * s.cap.sugar);
    stepEconomy(s, DT);
    s.time += DT;
  }
}

// ---- where the sugar comes from ---------------------------------------------------------------------------------------

test('feed: nothing is given below the threshold', () => {
  const a = game({ sugar: 0.5 });
  const b = game({ sugar: 0.5 });
  sim.commandFeed(a, 0);
  for (let i = 0; i < 100; i++) {
    stepEconomy(a, DT);
    stepEconomy(b, DT);
    assert.ok(a.res.sugar < feedThreshold(a), 'stays below the line');
  }
  assert.equal(a.feed.rate, 0);
  assert.equal(a.res.sugar, b.res.sugar, 'the stock is the same as an unfed twin');
  assert.equal(a.world.trees[0].growth, b.world.trees[0].growth, 'and the tree did not grow faster');
});

test('feed: stepFeed gives at most feedRate x dt and only what lies above the line', () => {
  const s = game();
  sim.commandFeed(s, 0);
  const T = feedThreshold(s);
  assert.ok(Math.abs(stepFeed(s, T + 0.05, DT) - 0.05) < 1e-9, 'a little above the line: just that little');
  assert.equal(stepFeed(s, T - 1, DT), 0, 'below the line: nothing');
  assert.equal(stepFeed(s, T, DT), 0);
  assert.ok(Math.abs(stepFeed(s, s.cap.sugar * 3, DT) - B.feedRate * DT) < 1e-9, 'a flood: capped by the rate');
});

test('feed: the stock is never pushed under the threshold, and the cap still holds', () => {
  const s = game({ sugar: 0.9 });
  sim.commandFeed(s, 1);
  const T = () => feedThreshold(s);
  let moved = 0;
  for (let i = 0; i < 600; i++) {
    const before = s.res.sugar;
    stepEconomy(s, DT);
    if (before >= T()) assert.ok(s.res.sugar >= Math.min(before, T()) - 1e-6, `step ${i}: ${s.res.sugar} fell under ${T()}`);
    assert.ok(s.res.sugar <= s.cap.sugar + 1e-9);
    moved += s.feed.rate;
  }
  assert.ok(moved > 0, 'something was fed');
});

test('feed: the surplus the clamp would throw away is what feeds the tree', () => {
  const s = game({ sugar: 1 });
  sim.commandFeed(s, 0);
  const free = game({ sugar: 1 });
  stepEconomy(s, DT);
  stepEconomy(free, DT);
  assert.equal(free.res.sugar, free.cap.sugar, 'unfed: the clamp holds the stock at the cap');
  assert.equal(s.res.sugar, s.cap.sugar, 'fed from the overflow: the stock is still at the cap');
  assert.ok(s.world.trees[0].growth > free.world.trees[0].growth, 'yet the tree has grown more');
});

// ---- what it does -------------------------------------------------------------------------------------------------

test('feed: a fed tree grows faster than an unfed twin, but no faster than 1 + feedGrowSeconds x feedRate', () => {
  const fed = game();
  const twin = game();
  const start = fed.world.trees[0].stage + fed.world.trees[0].growth;
  sim.commandFeed(fed, 0);
  run(fed, 60, 1);
  run(twin, 60, 1);
  const gFed = fed.world.trees[0].stage + fed.world.trees[0].growth - start;
  const gTwin = twin.world.trees[0].stage + twin.world.trees[0].growth - start;
  assert.ok(gTwin > 0, 'the twin grows too');
  assert.ok(gFed > gTwin * 1.5, `fed ${gFed} vs twin ${gTwin}`);
  assert.ok(gFed <= gTwin * (1 + B.feedGrowSeconds * B.feedRate) + 1e-6, 'a bounded boost: the long stages stay long');
  // the others are not fed
  assert.equal(fed.world.trees[1].growth, twin.world.trees[1].growth);
});

test('feed: enough of it moves the tree up a stage (event, counter, cap)', () => {
  const s = game();
  s.world.trees[0].growth = 0.995;
  sim.commandFeed(s, 0);
  s.events.length = 0;
  const stage = s.world.trees[0].stage;
  run(s, 3, 1);
  assert.equal(s.world.trees[0].stage, stage + 1);
  assert.ok(s.events.some((e) => e.type === 'tree-stage' && e.treeId === 0));
  assert.ok(s.sim.treeStageUps >= 1);
});

test('feed: with the rival on the mantle rises faster than an unfed twin\'s', () => {
  const fed = game({ rival: true });
  const twin = game({ rival: true });
  sim.commandFeed(fed, 0);
  run(fed, 90, 1);
  run(twin, 90, 1);
  const mFed = fed.world.trees[0].mantle;
  const mTwin = twin.world.trees[0].mantle;
  assert.ok(mFed > mTwin + 0.1, `mantle ${mFed} vs ${mTwin}`);
  assert.ok(mFed <= 1);
  assert.equal(fed.world.trees[1].mantle, twin.world.trees[1].mantle, 'only the fed tree');
});

test('feed: without the rival there is no mantle to thicken, and a grown tree takes nothing', () => {
  const s = game();
  const t = s.world.trees[0];
  t.stage = 3;
  assert.equal(feedUseful(s, t), false);
  sim.commandFeed(s, 0);
  const free = game();
  free.world.trees[0].stage = 3;
  run(s, 20, 1);
  run(free, 20, 1);
  assert.equal(s.feed.rate, 0);
  assert.equal(s.res.sugar, free.res.sugar, 'the surplus stays in the pantry');
  assert.equal(t.mantle ?? 0, 0);
  s.flags.rival = true;
  assert.equal(feedUseful(s, t), true, 'with the honey fungus about a mantle is still worth it');
});

// ---- the command --------------------------------------------------------------------------------------------------

test('feed: toggle and switch', () => {
  const s = game();
  assert.equal(s.feed, null);
  assert.equal(sim.commandFeed(s, 0), 'on');
  assert.equal(s.feed.treeId, 0);
  assert.equal(sim.commandFeed(s, 2), 'switch');
  assert.equal(s.feed.treeId, 2);
  assert.equal(sim.commandFeed(s, 2), 'off');
  assert.equal(s.feed, null);
  assert.deepEqual(
    s.events.filter((e) => e.type.startsWith('feed')).map((e) => [e.type, e.treeId, e.reason]),
    [['feed-start', 0, undefined], ['feed-start', 2, undefined], ['feed-stop', 2, 'player']],
  );
});

test('feed: an unlinked, lost or missing tree cannot be fed', () => {
  const s = game();
  s.sim.contacts[1] = [];
  s.world.trees[1].linked = false;
  s.world.trees[2].lost = true;
  assert.equal(sim.commandFeed(s, 1), false);
  assert.equal(sim.commandFeed(s, 2), false);
  assert.equal(sim.commandFeed(s, 99), false);
  assert.equal(s.feed, null);
  assert.deepEqual(s.events.filter((e) => e.type === 'feed-denied').map((e) => e.reason), ['unlinked', 'lost', 'none']);
});

test('feed: losing the link or the tree stops the feeding with an event', () => {
  const s = game();
  sim.commandFeed(s, 0);
  s.events.length = 0;
  s.sim.contacts[0] = [];
  stepEconomy(s, DT);
  assert.equal(s.feed, null);
  assert.deepEqual(s.events.filter((e) => e.type === 'feed-stop'), [{ type: 'feed-stop', treeId: 0, reason: 'unlinked' }]);

  sim.commandFeed(s, 1);
  s.events.length = 0;
  s.world.trees[1].lost = true;
  stepEconomy(s, DT);
  assert.equal(s.feed, null);
  assert.deepEqual(s.events.filter((e) => e.type === 'feed-stop'), [{ type: 'feed-stop', treeId: 1, reason: 'lost' }]);
});

// ---- the save ---------------------------------------------------------------------------------------------------

test('feed: the fed tree survives a save, and an old save without the field loads with none', () => {
  const s = game();
  sim.commandFeed(s, 2);
  run(s, 2, 1);
  const p = JSON.parse(JSON.stringify(encodeState(s)));
  assert.equal(p.feed, 2);
  const back = decodeState(p);
  assert.deepEqual(back.feed, { treeId: 2, rate: 0 });

  const old = JSON.parse(JSON.stringify(encodeState(s)));
  delete old.feed;
  assert.equal(decodeState(old).feed, null);

  const none = JSON.parse(JSON.stringify(encodeState(game())));
  assert.equal(none.feed, null);
  assert.equal(decodeState(none).feed, null);
});

test('feed: a bad field in a save is refused', () => {
  const p = JSON.parse(JSON.stringify(encodeState(game())));
  for (const bad of [-1, 4, 1.5, '2', true, {}]) {
    assert.throws(() => validatePayload({ ...p, feed: bad }), /feed/, String(bad));
  }
  assert.doesNotThrow(() => validatePayload({ ...p, feed: 3 }));
});

// ---- the texts ----------------------------------------------------------------------------------------------------

test('feed texts: the tree tooltip says what is happening', () => {
  const s = game();
  const tree = s.world.trees[0];
  assert.equal(describeTree(tree, s).feed, undefined);
  sim.commandFeed(s, 0);
  assert.equal(feedLine(s, tree), 'подкармливается · ждёт излишка сахара');
  s.feed.rate = 1.24;
  assert.equal(describeTree(tree, s).feed, 'подкармливается · +1,2/с');
  assert.equal(feedLine(s, s.world.trees[1]), null);
  assert.equal(describeTree(tree).feed, undefined, 'the old call without a state');
});

test('feed texts: the feeding tool says what a click does', () => {
  const s = game();
  const target = { kind: 'tree', id: 0 };
  assert.equal(describeFeedPick(s, { kind: 'water', id: 1 }, describeTree), null);
  assert.match(describeFeedPick(s, target, describeTree).sub, /щёлкни: лишний сахар пойдёт ей/);
  sim.commandFeed(s, 0);
  assert.match(describeFeedPick(s, target, describeTree).sub, /перестать/);
  assert.match(describeFeedPick(s, { kind: 'tree', id: 1 }, describeTree).sub, /не берёзе/);
  s.sim.contacts[1] = [];
  assert.match(describeFeedPick(s, { kind: 'tree', id: 1 }, describeTree).sub, /нить сюда не дошла/);
  s.world.trees[1].lost = true;
  assert.match(describeFeedPick(s, { kind: 'tree', id: 1 }, describeTree).sub, /сухостой/);
});

test('feed texts: the sugar tooltip speaks of the fed tree instead of «пропадает»', () => {
  const s = game();
  const body = () => resourceTip(s, 'sugar').body.join(' ');
  assert.match(body(), /лишний сахар пропадает.*Подкорми дерево \(5\)/, 'full and idle: a hint');
  sim.commandFeed(s, 0);
  assert.match(body(), /лишний сахар уходит берёзе/);
  assert.doesNotMatch(body(), /пропадает/);
  assert.equal(resourceTip(s, 'sugar').warn, false);
  s.world.trees[0].species = 'oak';
  assert.match(body(), /уходит дубу/);
  s.res.sugar = 0.5 * s.cap.sugar;
  assert.match(body(), /выше 80 % кладовой, уходит дубу/);
  s.world.trees[0].species = 'pine';
  assert.match(body(), /сосне/);
  // a tree that wants nothing: the surplus does vanish, and the text does not lie
  s.res.sugar = s.cap.sugar;
  s.world.trees[0].stage = 3;
  assert.match(body(), /сыта, и лишний сахар пропадает/);
  // water has no feeding line
  assert.doesNotMatch(resourceTip(s, 'water').body.join(' '), /уходит/);
});

test('feed texts: the sugar tooltip hints at nothing when no tree can be fed', () => {
  const s = createState(13);
  s.cap.sugar = 100;
  s.res.sugar = 100;
  assert.doesNotMatch(resourceTip(s, 'sugar').body.join(' '), /Подкорми/);
  assert.equal(feedTabShown(s), false);
});

test('feed texts: notes for the start and for a stop by itself, none for the player\'s own stop', () => {
  const s = game();
  const note = (ev) => describeNote(s, ev);
  assert.match(note({ type: 'feed-start', treeId: 0 }).text, /пойдёт берёзе/);
  assert.equal(note({ type: 'feed-stop', treeId: 0, reason: 'player' }), null);
  assert.match(note({ type: 'feed-stop', treeId: 0, reason: 'lost' }).text, /дерево погибло/);
  assert.match(note({ type: 'feed-stop', treeId: 0, reason: 'unlinked' }).text, /нить оборвана/);
  assert.equal(feedNote(s, { type: 'feed-denied', treeId: 0, reason: 'unlinked' }).tone, 'warn');
  assert.equal(treeDative({ species: 'oak' }), 'дубу');
  assert.equal(treeDative(null), 'дереву');
});

test('feed texts: the tab is there once a tree is linked, or while one is fed', () => {
  const s = game();
  assert.equal(feedTabShown(s), true);
  for (const t of s.world.trees) s.sim.contacts[t.id] = [];
  assert.equal(feedTabShown(s), false);
  s.feed = { treeId: 0, rate: 0 };
  assert.equal(feedTabShown(s), true);
});

test('feed texts: a tree with every root inside a barrier says so (when the sim knows of barriers)', () => {
  const s = game();
  assert.doesNotMatch(describeTree(s.world.trees[0], s).sub, /барьер/);
  if (typeof sim.treeBarred === 'function') {
    s.barriers = [{ id: 1, nodeId: 0, x: s.world.trees[0].x, y: s.world.trees[0].baseY, r: 9999, t: 0, dur: 40 }];
    assert.match(describeTree(s.world.trees[0], s).sub, /все корни в барьере/);
  }
});

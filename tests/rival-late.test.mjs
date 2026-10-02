// «Опёнок: налёты чаще, толстый тяж через подкормку» (src/sim/rival.js, flows.js, ui/rival.js):
//  1. from page B.rivalRaidFromChapter the raids come every B.rivalRaidEveryLate-th tip, up to B.rivalRaidMaxLate at once;
//  2. once per page a deep tip starts under the gravel and goes for a root tip out of reach of a ring on the player's nodes;
//  3. a fed tree's path thickens to B.rivalBlockW in about a minute at the full feeding rate;
//  4. the raid note and the raider hint name feeding only when the tool is there (feedTabShown).
// Expected numbers come from B (src/sim/balance.js), never from literals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { B } from '../src/sim/balance.js';
import { addNode } from '../src/sim/network.js';
import { recomputeFlows } from '../src/sim/flows.js';
import { commandFeed } from '../src/sim/feed.js';
import { createRival, raidEvery, raidMax, raiders, spawnTipAt, stepRival } from '../src/sim/rival.js';
import { costAt, groundYAt } from '../src/world/query.js';
import { decodeState, encodeState } from '../src/persist-codec.js';
import { RIVAL_RAID_FEED_NOTE, RIVAL_RAID_NOTE, raidHint, rivalHint, rivalNote } from '../src/ui/rival.js';
import { feedTabShown } from '../src/ui/feed.js';

const DT = 1 / 60;

function fresh(seed = 7, chapter = 1) {
  const s = createState(seed, 2);
  s.phase = 'playing';
  s.flags.rival = true;
  s.chapter = chapter;
  return s;
}

/** An awake rival whose timer fires at once: the tips it makes come from the stump(s). */
function awake(s, over = {}) {
  const r = (s.rival ??= createRival(s));
  Object.assign(r, { awake: true, age: 1000, spawnT: 0 }, over);
  return r;
}

function run(s, seconds, each = null) {
  const seen = [];
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    stepRival(s, DT);
    s.time += DT;
    for (const e of s.events) seen.push({ ...e, at: s.time });
    s.events.length = 0;
    if (each) each(s);
  }
  return seen;
}

function withB(over, fn) {
  const old = {};
  for (const k of Object.keys(over)) old[k] = B[k];
  Object.assign(B, over);
  try {
    return fn();
  } finally {
    Object.assign(B, old);
  }
}

/** A level stretch of open soil: a thin hypha of the player along y (a few nodes, so there is a thin hypha to raid far from the spore). */
function corridor(world) {
  const free = (x, y) => Number.isFinite(costAt(world, x, y)) && y - groundYAt(world, x) >= B.rivalDepthMin + 10;
  for (let xm = 300; xm <= world.width - 300; xm += 40) {
    for (let y = groundYAt(world, xm) + 30; y < world.height - 60; y += 20) {
      let ok = true;
      for (let x = xm - 260; x <= xm + 260 && ok; x += 10) for (let dy = -16; dy <= 16; dy += 8) if (!free(x, y + dy)) ok = false;
      if (ok) return { x: xm, y };
    }
  }
  throw new Error('no corridor');
}

// ---- 1. the cadence by page ----------------------------------------------------------------------------------------------

test('cadence: every B.rivalRaidEvery-th tip and one raider before page B.rivalRaidFromChapter, every B.rivalRaidEveryLate-th and two from it', () => {
  for (let ch = 1; ch < B.rivalRaidFromChapter; ch++) {
    const s = fresh(7, ch);
    assert.equal(raidEvery(s), B.rivalRaidEvery);
    assert.equal(raidMax(s), B.rivalRaidMax);
  }
  for (const ch of [B.rivalRaidFromChapter, B.rivalRaidFromChapter + 1]) {
    const s = fresh(7, ch);
    assert.equal(raidEvery(s), B.rivalRaidEveryLate);
    assert.equal(raidMax(s), B.rivalRaidMaxLate);
  }
  assert.ok(B.rivalRaidEveryLate < B.rivalRaidEvery && B.rivalRaidMaxLate > B.rivalRaidMax, 'the later pages press harder');
  assert.equal(raidEvery({ flags: {} }), B.rivalRaidEvery, 'a state with no chapter is page 1');
});

/** Plays the rival with a thin hypha to raid; raiders stand at their source (a huge lead) so they pile up. Returns { raiders, maxAlive, timerTips }. */
function raidPlay(chapter) {
  return withB({ rivalRaidLead: 1e9, rivalTipEvery: 6 }, () => {
    const s = fresh(7, chapter);
    const { x, y } = corridor(s.world);
    let prev = addNode(s, x - 250, y, -1).id;
    for (let k = 1; k <= 13; k++) prev = addNode(s, x - 250 + k * 16, y, prev).id;
    const r = awake(s, { spawnT: 0 });
    s.rival.deepPage = 99; // no deep tip: only the plain and raiding ones
    let maxAlive = 0;
    run(s, 900, () => {
      maxAlive = Math.max(maxAlive, raiders(s).length);
      for (const t of r.tips) if (!t.raid) t.speed = 0; // plain tips stay where they start: the tip budget is for raiders
    });
    return { raiders: r.stats.raiders, maxAlive, timerTips: r.raidCount };
  });
}

test('cadence in play: a raid every 3rd timer tip and at most 1 alive on page 1, every 2nd and 2 alive from page 3', () => {
  const early = raidPlay(1);
  assert.ok(early.timerTips >= 6, `${early.timerTips} timer tips`);
  assert.ok(early.raiders >= 1 && early.raiders <= Math.floor(early.timerTips / B.rivalRaidEvery), `${early.raiders} raiders of ${early.timerTips} tips`);
  assert.equal(early.maxAlive, B.rivalRaidMax);
  const late = raidPlay(B.rivalRaidFromChapter);
  assert.ok(late.raiders <= Math.floor(late.timerTips / B.rivalRaidEveryLate));
  assert.equal(late.maxAlive, B.rivalRaidMaxLate, 'a second raider can stand beside the first');
});

// ---- 2. the deep tip -------------------------------------------------------------------------------------------------------

const gravelDepth = (world) => world.horizons[world.horizons.length - 1].depth;

/** A page-2 game with a linked tree (so the deep tip has someone to go for) and the rival's timer about to fire. */
function deepScene(seed = 7, chapter = 2) {
  const s = fresh(seed, chapter);
  for (const t of s.world.trees) t.linked = true;
  awake(s, { age: 0 });
  const st = s.world.stumps[0];
  spawnTipAt(s, st.x, st.y + 14, 1); // a live rhizomorph, so the timer (not the regrowth after a cut-back) makes the next tip
  return s;
}

test('deep tip: once per page one tip starts below the gravel, pinned to a deep root tip no player node is near', () => {
  const s = deepScene();
  const seen = run(s, 10);
  const deep = seen.filter((e) => e.type === 'rival-deep');
  assert.equal(deep.length, 1, 'one per page');
  const tip = s.rival.tips.find((t) => t.deep);
  assert.ok(tip, 'a deep tip lives');
  assert.equal(s.rival.deepPage, 2);
  const root = s.rival.nodes[0] && s.rival.nodes.find((n) => n.x === deep[0].x && n.y === deep[0].y);
  assert.ok(root, 'it has a root node of its own');
  assert.ok(root.y - groundYAt(s.world, root.x) >= gravelDepth(s.world), 'the start lies under the top of the gravel');
  const tree = s.world.trees[tip.deep.treeId];
  const tp = tree.tips[tip.deep.i];
  assert.ok(tp.y - groundYAt(s.world, tp.x) >= B.rivalDeepTipMin, 'a deep root tip');
  for (const n of s.net.nodes) if (n.alive) assert.ok(Math.hypot(n.x - tp.x, n.y - tp.y) >= B.rivalDeepClear, 'out of reach of a ring on any node');
  assert.ok(B.rivalDeepClear > B.barrierRadius, 'out of reach of a ring means beyond the ring');
  assert.deepEqual(tip.target, { kind: 'tree', id: tree.id });
  // not again on the same page
  assert.equal(run(s, 600, () => (s.rival.spawnT = Math.min(s.rival.spawnT, 0))).filter((e) => e.type === 'rival-deep').length, 0);
  // a later page has its own (a fresh game on page 3), and a game that already had page 2's deep tip gets another when page 3 opens
  const p3 = deepScene(7, 3);
  assert.equal(run(p3, 10).filter((e) => e.type === 'rival-deep').length, 1, 'page 3 gets one');
  assert.equal(p3.rival.deepPage, 3);
  const moved = deepScene(7, 2);
  moved.rival.deepPage = 2;
  moved.chapter = 3;
  assert.equal(run(moved, 10).filter((e) => e.type === 'rival-deep').length, 1, 'page 3 after page 2');
});

test('deep tip: none on page 1, none without a linked tree, none when every deep root tip has a node near', () => {
  const p1 = deepScene(7, 1);
  assert.equal(run(p1, 10).filter((e) => e.type === 'rival-deep').length, 0, 'page 1');
  const unlinked = deepScene();
  for (const t of unlinked.world.trees) t.linked = false;
  assert.equal(run(unlinked, 10).filter((e) => e.type === 'rival-deep').length, 0, 'no tree of the player');
  const covered = deepScene();
  for (const t of covered.world.trees) for (const tp of t.tips) addNode(covered, tp.x, tp.y, -1);
  assert.equal(run(covered, 10).filter((e) => e.type === 'rival-deep').length, 0, 'a node by every root tip');
});

test('deep tip: it climbs to its root tip and grips it without waiting for a node in reach; the grip is marked deep', () => {
  const s = deepScene();
  const grips = [];
  run(s, 400, () => {
    s.rival.spawnT = 1e9; // only the deep tip of the first turn
    for (const e of s.events) if (e.type === 'rival-grip') grips.push(e);
  });
  const g = s.rival.grip.find((x) => x.deep);
  assert.ok(g, `the deep tip gripped (${s.rival.grip.length} grips, tips ${s.rival.tips.length})`);
  assert.ok(!s.net.nodes.some((n) => n.alive && Math.hypot(n.x - g.x, n.y - g.y) < B.barrierRadius), 'no node of ours within the ring of the grip');
  // the guide tells the player to stretch a thread down
  const hint = rivalHint(s);
  assert.ok(hint && /снизу/.test(hint.text) && /нить/.test(hint.text), hint && hint.text);
});

test('deep tip: the new fields survive a save (rival.deepPage, tip.deep, grip.deep) and an old save gets deepPage 0', () => {
  const s = deepScene();
  run(s, 400, () => (s.rival.spawnT = 1e9));
  const back = decodeState(JSON.parse(JSON.stringify(encodeState(s))));
  assert.ok(back, 'accepted');
  assert.equal(back.rival.deepPage, 2);
  assert.deepEqual(back.rival.tips.map((t) => t.deep ?? null), s.rival.tips.map((t) => t.deep ?? null));
  assert.deepEqual(back.rival.grip.map((g) => g.deep ?? false), s.rival.grip.map((g) => g.deep ?? false));
  const old = JSON.parse(JSON.stringify(encodeState(s)));
  const rv = typeof old.rival === 'string' ? JSON.parse(old.rival) : old.rival;
  if (rv && typeof rv === 'object') delete rv.deepPage;
  const loaded = decodeState(old);
  assert.ok(loaded);
  // the first step of an old save gets the default (and its deep tip is made for the page it is on)
  loaded.flags.rival = true;
  stepRival(loaded, DT);
  assert.ok(Number.isInteger(loaded.rival.deepPage));
});

// ---- 3. feeding makes a cord -----------------------------------------------------------------------------------------------

/** A straight hypha of n nodes from the spore; tree 0 touches its last node. Returns { s, ids, tree }. */
function feedScene(n = 20) {
  const s = createState(13, 2);
  s.phase = 'playing';
  const o = s.net.nodes[s.net.originId];
  const ids = [s.net.originId];
  for (let k = 1; k <= n; k++) ids.push(addNode(s, o.x + k * 16, o.y, ids[k - 1]).id);
  const tree = s.world.trees[0];
  tree.linked = true;
  for (const t of s.world.trees) s.sim.contacts[t.id] = t === tree ? [ids[n]] : [];
  return { s, ids, tree };
}

/** The widths of the edges along a hypha given by its node ids (the spore first). */
const pathW = (s, ids) => ids.slice(1).map((id) => s.net.edges[s.sim.parentEdge[id]].w);

/** Seconds until every edge of the path is at least B.rivalBlockW thick (null: not within `limit`). The flow step is the game's (B.flowEvery). */
function secondsToCord(rate, limit = 400) {
  const { s, ids, tree } = feedScene();
  commandFeed(s, tree.id);
  s.feed.rate = rate;
  for (let t = 0; t < limit; t += B.flowEvery) {
    recomputeFlows(s, B.flowEvery);
    if (pathW(s, ids).every((w) => w >= B.rivalBlockW)) return t + B.flowEvery;
  }
  return null;
}

test('feeding: at the full feeding rate the path to the fed tree reaches B.rivalBlockW in 45-75 s', () => {
  const t = secondsToCord(B.feedRate);
  assert.ok(t !== null && t >= 45 && t <= 75, `${t} s`);
});

test('feeding: a lower rate thickens slower, and the thickening stops at B.feedThickW', () => {
  const full = secondsToCord(B.feedRate);
  const half = secondsToCord(B.feedRate / 2, 800);
  assert.ok(half > full * 1.5, `half rate ${half} s, full ${full} s`);
  assert.ok(B.feedThickW > B.rivalBlockW, 'the target is above the line the raider cannot cross');
  const { s, ids, tree } = feedScene();
  commandFeed(s, tree.id);
  s.feed.rate = B.feedRate;
  for (let i = 0; i < 1000; i++) recomputeFlows(s, B.flowEvery);
  const w = pathW(s, ids);
  assert.ok(Math.max(...w) <= B.feedThickW + 0.05 && Math.min(...w) >= B.feedThickW - 0.1, `${w.slice(0, 3)}`);
});

test('feeding: the sugar accounting is untouched (the flow carries no extra edge load), and no feed means no thickening', () => {
  const { s, ids } = feedScene();
  for (let i = 0; i < 500; i++) recomputeFlows(s, B.flowEvery);
  assert.ok(pathW(s, ids).every((w) => w === 1), 'no flow at all: thin');
  const f = feedScene();
  commandFeed(f.s, f.tree.id);
  f.s.feed.rate = B.feedFlowMin / 2;
  for (let i = 0; i < 500; i++) recomputeFlows(f.s, B.flowEvery);
  assert.ok(pathW(f.s, f.ids).every((w) => w === 1), 'a feed below B.feedFlowMin shows no flow and thickens nothing');
});

// ---- 4. the texts -----------------------------------------------------------------------------------------------------------

function hintState(fed) {
  const s = fresh(7, 3);
  s.flags.threats = true;
  const tip = { x: 400, y: 500, raid: { phase: 'seek' }, target: null };
  s.rival = { awake: true, nodes: [], edges: [], tips: [tip], grip: [], clusters: [], spores: 0, ver: 0, rs: 1 };
  if (fed) s.feed = { treeId: 0, rate: 0 };
  return s;
}

test('raid texts: feeding is named only when the feed tool is there', () => {
  const without = hintState(false);
  const withFeed = hintState(true);
  assert.equal(feedTabShown(without), false);
  assert.equal(feedTabShown(withFeed), true);

  const h0 = raidHint(without);
  assert.ok(!/\{5\}|Подкорм/.test(h0.text), h0.text);
  assert.match(h0.text, /барьер \{4\}/);
  const h1 = raidHint(withFeed);
  assert.match(h1.text, /Подкорми дерево \{5\}/);
  assert.match(h1.text, /толстым тяжом/);
  assert.match(h1.text, /налётчик не пройдёт/);
  assert.match(h1.text, /барьер \{4\}/, 'the barrier is still named');
  assert.ok(h1.text.length < 170, 'short');

  const n0 = rivalNote(without, { type: 'rival-raid-seek', x: 1, y: 2 });
  assert.equal(n0.text, RIVAL_RAID_NOTE);
  assert.ok(!/Подкорм/.test(n0.text));
  const n1 = rivalNote(withFeed, { type: 'rival-raid-seek', x: 1, y: 2 });
  assert.equal(n1.text, RIVAL_RAID_FEED_NOTE);
  assert.match(n1.text, /Подкорми дерево \(5\)/);
  assert.match(n1.text, /толстым тяжом, и налётчик не пройдёт/);
  assert.equal(rivalNote(withFeed, { type: 'rival-raid-touch', x: 1, y: 2, edge: 1 }).text, RIVAL_RAID_FEED_NOTE, 'the touch tells the same');
});

test('deep texts: the note names the tree and the thread, the event is a note only', () => {
  const s = hintState(false);
  const n = rivalNote(s, { type: 'rival-deep', x: 5, y: 900, treeId: 0 });
  assert.match(n.text, /галечника/);
  assert.match(n.text, /нить/);
  assert.equal(n.tone, 'warn');
});

test('help: the raider line names feeding (5) only once page 1 has opened it', async () => {
  const { rivalSection } = await import('../src/ui/help.js');
  const s = createState(13, 2);
  Object.assign(s.flags, { threats: true, rival: true });
  assert.match(rivalSection(s), /Толстый тяж он не пройдёт/);
  assert.doesNotMatch(rivalSection(s), /Подкорми дерево/);
  s.flags.unlocks = { feed: true };
  assert.match(rivalSection(s), /Подкорми дерево \(<kbd>5<\/kbd>\) из полной кладовой — путь к нему станет толстым тяжом/);
});

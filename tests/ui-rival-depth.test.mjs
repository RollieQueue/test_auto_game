// «Барьер как выбор» and «Ризоморф-налётчик», the HUD side: the cost line of the barrier tooltip, the refusal of a thread by
// a ring, the one margin note of the first raider, the guide's hint at it, the help page. Pure logic over hand-made states
// (the pinned contract: sim.barrierEffects, state.barriers, state.rival.tips[i].raid, the events rival-raid-* / grow-denied).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { barrierEffects } from '../src/sim/rival.js';
import { pickHint } from '../src/ui/guide-logic.js';
import { buildHelp, rivalSection } from '../src/ui/help.js';
import { markRaidHint, raidHintSeen } from '../src/ui/prefs.js';
import { cutCause, threatLabel, threatNote } from '../src/ui/threats.js';
import { describePreview } from '../src/ui/tooltip.js';
import {
  RIVAL_BOTH,
  RIVAL_EVENTS,
  RIVAL_LOCAL,
  RIVAL_RAID_NOTE,
  barrierCostLine,
  barrierTabTitle,
  createRivalTexts,
  describeBarrierPick,
  raidHint,
  raidersOf,
  rivalHint,
  rivalLabel,
  rivalNote,
} from '../src/ui/rival.js';

const B = { barrierDur: 40, barrierMax: 3, barrierRadius: 85 };

function rivalState(tips = []) {
  const s = createState(7);
  s.phase = 'playing';
  s.flags.threats = true;
  s.flags.rival = true;
  s.rival = { awake: true, nodes: [], edges: [], tips, grip: [], clusters: [], spores: 0, ver: 0, rs: 1 };
  return s;
}

const raider = (x = 400, y = 500) => ({ x, y, raid: { phase: 'seek' }, target: null });

// ---- the cost of a barrier in the tooltip ------------------------------------------------------------------

test('a barrier tooltip says what it freezes: one tree by name, several by number, else the threads', () => {
  const s = rivalState();
  s.world.trees[0] = { ...s.world.trees[0], id: 0, name: 'Дуб' };
  s.world.trees[1] = { ...s.world.trees[1], id: 1, name: 'Берёза' };
  const one = describeBarrierPick({ ok: true, cost: 20, effects: { frozen: 9, trees: [{ id: 0, pay: 1.23 }] } }, 20, 80, B, s);
  assert.equal(one.main, 'Барьер: −20 сахара');
  assert.match(one.sub, /растворяет ризоморфы рядом/);
  assert.equal(one.sub2, 'замрёт дуб: −1,2 сахара/с на 40 с');
  assert.equal(one.warn, false);

  const two = describeBarrierPick({ ok: true, cost: 20, effects: { frozen: 9, trees: [{ id: 0, pay: 1.23 }, { id: 1, pay: 0.8 }] } }, 20, 80, B, s);
  assert.equal(two.sub2, 'замрут 2 дерева: −2,0 сахара/с на 40 с');
  const five = barrierCostLine({ frozen: 30, trees: [1, 2, 3, 4, 5].map((id) => ({ id, pay: 0.5 })) }, B, s);
  assert.match(five, /^замрут 5 деревьев: −2,5 сахара\/с/);

  const threads = describeBarrierPick({ ok: true, cost: 20, effects: { frozen: 7, trees: [] } }, 20, 80, B, s);
  assert.equal(threads.sub2, 'замрут нити: 7 узлов на 40 с');
  assert.equal(barrierCostLine({ frozen: 1, trees: [] }, B), 'замрут нити: 1 узел на 40 с');
  assert.equal(barrierCostLine({ frozen: 22, trees: [] }, B), 'замрут нити: 22 узла на 40 с');
  assert.equal(barrierCostLine({ frozen: 5, trees: [] }, {}), 'замрут нити: 5 узлов', 'no duration in B: none quoted');

  // a tree the world does not know is still a tree; a tiny rate never reads as zero
  assert.equal(barrierCostLine({ frozen: 3, trees: [{ id: 99, pay: 0.02 }] }, B, s), 'замрёт дерево: −0,1 сахара/с на 40 с');
});

test('without effects the tooltip still states the rule; refusals carry no cost line', () => {
  const plain = describeBarrierPick({ ok: true, cost: 30 }, 30, 80);
  assert.equal(plain.main, 'Барьер: −30 сахара');
  assert.match(plain.sub2, /нити не растут и не носят соки/);
  const idle = describeBarrierPick(null, 30, 80);
  assert.match(idle.sub, /цена 30 сахара/);
  assert.match(idle.sub2, /не растут и не носят соки/);
  assert.equal(describeBarrierPick({ ok: true, effects: { frozen: 0, trees: [] } }, 30, 80).sub2, 'внутри нити не растут и не носят соки');

  assert.equal(describeBarrierPick({ ok: true, cost: 30, effects: { frozen: 4, trees: [] } }, 30, 5).sub2, undefined, 'too poor: the lack of sugar speaks');
  for (const reason of ['sugar', 'crowded', 'dead', 'max', 'off', 'odd']) {
    assert.equal(describeBarrierPick({ ok: false, reason }, 30, 80).sub2, undefined, reason);
  }
  const title = barrierTabTitle(20, B);
  assert.match(title, /^Барьер \(4\): цена 20 сахара/);
  assert.match(title, /на 40 с/);
  assert.match(title, /не растут и не носят соки/);
  assert.match(title, /все корни которого внутри, не платит/);
  assert.match(barrierTabTitle(20, {}), /Растворяет ризоморфы опёнка рядом\./, 'no duration in B: no «на N с»');
});

test('the cost line is built from the real barrierEffects', () => {
  const s = rivalState();
  s.world.trees[0].name = 'Берёза';
  s.sim.contacts[0] = [0]; // the tree's only root contact is the spore's node: a barrier on it freezes the tree
  const fx = barrierEffects(s, 0);
  assert.equal(fx.trees.length, 1);
  assert.ok(fx.trees[0].pay > 0);
  const line = barrierCostLine(fx, { barrierDur: 40 }, s);
  assert.match(line, /^замрёт берёза: −\d,\d сахара\/с на 40 с$/);
  s.sim.contacts[0] = [];
  assert.match(barrierCostLine(barrierEffects(s, 0), B, s), /^замрут нити: \d+ /, 'no contacts: only threads freeze');
});

// ---- a thread refused by a ring ------------------------------------------------------------------------------

test('a thread the ring refuses: «Здесь нити не растут», with the seconds left, before the rock case', () => {
  const s = rivalState();
  s.res.sugar = 80;
  s.barriers = [{ id: 1, nodeId: 0, x: 500, y: 400, r: 85, t: 17.2, dur: 40 }];
  const empty = describePreview(s, { from: 0, points: [], blocked: { x: 500, y: 400 }, length: 0, cost: 0, affordable: false, denied: 'barrier' });
  assert.equal(empty.main, 'Здесь нити не растут');
  assert.equal(empty.sub, 'барьер держит кольцо · ещё 23 с');
  assert.equal(empty.warn, true);

  const partial = describePreview(s, {
    from: 0,
    points: [{ x: 300, y: 400 }, { x: 400, y: 400 }],
    blocked: { x: 430, y: 400 },
    length: 100,
    cost: 12,
    affordable: true,
    denied: 'barrier',
  });
  assert.equal(partial.main, 'Нить упрётся в барьер');
  assert.match(partial.sub, /до кольца: 12 сахара · ещё 23 с/);
  assert.equal(partial.warn, true);

  // the ring over the point is the one whose time counts; none over it: the plain sentence
  s.barriers.push({ id: 2, nodeId: 1, x: 1500, y: 400, r: 85, t: 0, dur: 40 });
  assert.equal(describePreview(s, { points: [], blocked: { x: 500, y: 400 }, cost: 0, denied: 'barrier' }).sub, 'барьер держит кольцо · ещё 23 с');
  assert.equal(describePreview(s, { points: [], blocked: { x: 900, y: 900 }, cost: 0, denied: 'barrier' }).sub, 'барьер держит кольцо');
  s.barriers = [];
  assert.equal(describePreview(s, { points: [], blocked: { x: 500, y: 400 }, cost: 0, denied: 'barrier' }).main, 'Здесь нити не растут', 'the ring ended between two frames');

  // the other cases are as they were
  const rock = describePreview(s, { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], blocked: { x: 2, y: 2 }, cost: 5, affordable: true, denied: null });
  assert.equal(rock.main, 'Путь упирается в камень');
  assert.equal(describePreview(s, { points: [], blocked: null, denied: null }), null);
  assert.equal(describePreview(s, null), null);
  assert.equal(describePreview(s, { points: [{ x: 0, y: 0 }, { x: 9, y: 9 }], blocked: null, cost: 9, length: 12, affordable: true, denied: null }).main, '9 сахара');
});

test('the refused drag has a small label, throttled', () => {
  const s = rivalState();
  assert.ok(RIVAL_LOCAL.has('grow-denied') && RIVAL_EVENTS.has('grow-denied'));
  assert.equal(rivalLabel(s, { type: 'grow-denied', reason: 'barrier', x: 1, y: 2 }).text, 'барьер держит нити');
  assert.equal(rivalLabel(s, { type: 'grow-denied', reason: 'other', x: 1, y: 2 }), null, 'only the ring has a label');
  assert.equal(rivalNote(s, { type: 'grow-denied', reason: 'barrier' }), null, 'a refusal is a label, not a note');
  const texts = createRivalTexts();
  const ev = { type: 'grow-denied', reason: 'barrier', x: 1, y: 2 };
  let n = 0;
  for (let t = 0; t < 30; t += 0.5) {
    s.time = t;
    if (texts.label(s, ev)) n++;
  }
  assert.equal(n, 6, 'one label every 5 s of a held drag, not 60');
});

// ---- the one note of the first raider -------------------------------------------------------------------------------

test('the first raider leaves one note, by its first event; later raiders say nothing', () => {
  const s = rivalState();
  const texts = createRivalTexts();
  s.time = 100;
  const first = texts.note(s, { type: 'rival-raid-seek', x: 400, y: 500 });
  assert.ok(first);
  assert.equal(first.text, RIVAL_RAID_NOTE);
  assert.match(first.text, /тонким нитям/);
  assert.match(first.text, /толстый тяж/);
  assert.match(first.text, /барьер \(4\)/);
  assert.equal(first.tone, 'warn');
  // the touch of the same raider, other raiders later: silence
  s.time = 110;
  assert.equal(texts.note(s, { type: 'rival-raid-touch', x: 400, y: 500, edge: 3 }), null);
  for (let t = 200; t < 2000; t += 40) {
    s.time = t;
    assert.equal(texts.note(s, { type: 'rival-raid-seek', x: 1, y: 2 }), null);
    assert.equal(texts.note(s, { type: 'rival-raid-touch', x: 1, y: 2, edge: 1 }), null);
  }
  // a raider that touches before it was «seen» tells it by the touch
  const touchFirst = createRivalTexts();
  assert.ok(touchFirst.note(s, { type: 'rival-raid-touch', x: 1, y: 2, edge: 1 }));
  assert.equal(touchFirst.note(s, { type: 'rival-raid-seek', x: 1, y: 2 }), null);
  // a new game (notes.reset) tells it again
  touchFirst.reset();
  assert.ok(touchFirst.note(s, { type: 'rival-raid-seek', x: 1, y: 2 }));
  // the other raid events have no note
  for (const type of ['rival-raid-end', 'grow-denied']) assert.equal(rivalNote(s, { type, reason: 'barrier' }), null);
  assert.ok(RIVAL_EVENTS.has('rival-raid-seek') && !RIVAL_LOCAL.has('rival-raid-seek'), 'the seek is a note only');
  assert.ok(RIVAL_BOTH.has('rival-raid-touch') && RIVAL_LOCAL.has('rival-raid-touch'), 'the touch has a label and may carry the note');
});

test('the raid labels: the touch, the end by a barrier or a cord, nothing for the quiet ends', () => {
  const s = rivalState();
  assert.equal(rivalLabel(s, { type: 'rival-raid-touch', x: 1, y: 2, edge: 3 }).text, 'ризоморф на нити');
  assert.equal(rivalLabel(s, { type: 'rival-raid-end', reason: 'barrier', x: 1, y: 2 }).text, 'налёт остановлен');
  assert.equal(rivalLabel(s, { type: 'rival-raid-end', reason: 'cord', x: 1, y: 2 }).text, 'тяж не пустил ризоморф');
  for (const reason of ['reach', 'spore', 'gone']) assert.equal(rivalLabel(s, { type: 'rival-raid-end', reason, x: 1, y: 2 }), null, reason);
});

test('a thread eaten by a rhizomorph is named so (severed { cause: rival })', () => {
  const ev = { type: 'severed', cause: 'rival', nodes: 4, x: 1, y: 2 };
  assert.equal(cutCause([ev]), 'rival');
  assert.equal(cutCause([{ type: 'severed' }]), 'worm');
  assert.match(threatLabel(ev, 'rival').text, /съедено ризоморфом: −4/);
  assert.match(threatLabel({ ...ev, nodes: undefined }, 'rival').text, /съедена ризоморфом/);
  assert.match(threatNote(ev, 'rival').text, /^Ризоморф съел нить: отмерло 4 узла$/);
  assert.match(threatLabel({ type: 'mushroom-wilted' }, 'rival').text, /нить съедена/);
  assert.match(threatNote({ type: 'mushroom-wilted' }, 'rival').text, /съедена ризоморфом/);
  assert.match(threatLabel({ type: 'severed', nodes: 2 }, 'worm').text, /перекушено/, 'a worm bite is as it was');
});

// ---- the guide's hint ---------------------------------------------------------------------------------------------

test('the raid hint exists only while a raider does, and names both answers', () => {
  const s = rivalState([raider(420, 510)]);
  assert.equal(raidersOf(s).length, 1);
  const h = raidHint(s);
  assert.equal(h.id, 'raid');
  assert.deepEqual([h.ring.x, h.ring.y], [420, 510]);
  assert.match(h.text, /тонким нитям/);
  assert.match(h.text, /потолстеть/);
  assert.match(h.text, /барьер \{4\}/, 'the key token the guide draws as a key');
  assert.match(h.text, /нити внутри замрут/);
  assert.ok(h.text.length < 170, 'short');

  // the guide step: only when the caller asks (it has the «seen» flag)
  assert.equal(pickHint(s, null, 'grow', { raidHint: true }).id, 'raid');
  assert.notEqual(pickHint(s, null, 'grow', { raidHint: false }).id, 'raid');
  assert.notEqual(pickHint(s, null, 'grow', {}).id, 'raid');

  // no raider (tips without raid), not awake, no flag, no threats: nothing
  const none = rivalState([{ x: 1, y: 2, target: { kind: 'tree', id: 0 } }]);
  assert.equal(raidHint(none), null);
  assert.notEqual(pickHint(none, null, 'grow', { raidHint: true }).id, 'raid');
  const asleep = rivalState([raider()]);
  asleep.rival.awake = false;
  assert.equal(raidHint(asleep), null);
  const off = rivalState([raider()]);
  off.flags.rival = false;
  assert.equal(raidHint(off), null);
  assert.notEqual(pickHint(off, null, 'grow', { raidHint: true }).id, 'raid');
  const noThreats = rivalState([raider()]);
  noThreats.flags.threats = false;
  assert.equal(raidHint(noThreats), null, 'no key 4 without threats');
  assert.equal(raidHint(createState(7)), null, 'a plain game');
});

test('a grip is told before a raider; and the raid hint is once per player', () => {
  const s = rivalState([raider()]);
  s.rival.grip = [{ treeId: 0, tip: 0, x: 300, y: 300, since: 1 }];
  s.world.trees[0].name = 'Берёза';
  assert.equal(rivalHint(s).id, 'rival');
  assert.equal(pickHint(s, null, 'grow', { rivalHint: true, raidHint: true }).id, 'rival');
  s.rival.grip = [];
  assert.equal(pickHint(s, null, 'grow', { rivalHint: true, raidHint: true }).id, 'raid');
  // the flag lives in prefs.js (like the worm's): once marked, the guide stops asking
  assert.equal(raidHintSeen(), false);
  markRaidHint();
  assert.equal(raidHintSeen(), true);
});

// ---- help ------------------------------------------------------------------------------------------------------------

test('the help page quotes the freeze and the raider', () => {
  const s = rivalState();
  const sec = rivalSection(s);
  assert.match(sec, /Внутри кольца нити замирают: не растут и не носят соки/);
  assert.match(sec, /не платит/);
  assert.match(sec, /по тонким нитям сети/);
  assert.match(buildHelp(s), /нити замирают/);
  const plain = createState(7);
  assert.equal(rivalSection(plain), '');
  assert.doesNotMatch(buildHelp(plain), /замирают/);
});

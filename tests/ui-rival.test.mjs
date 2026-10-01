// The HUD side of the honey-fungus rival: pure helpers in src/ui/rival.js, the tree tooltip, the help page, the
// guide's arrow at the first grip. Built against the contract in docs/ARCHITECTURE.md with synthetic state and events
// (the sim lands in parallel), so nothing here needs the rival's own code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { pickHint } from '../src/ui/guide-logic.js';
import { buildHelp, rivalSection } from '../src/ui/help.js';
import { describeTree } from '../src/ui/trees-logic.js';
import { buildYearPage } from '../src/ui/year.js';
import {
  RIVAL_BOTH,
  RIVAL_EVENTS,
  RIVAL_LOCAL,
  barrierCostOf,
  barrierTabShown,
  barrierTabTitle,
  createRivalTexts,
  describeBarrierPick,
  infectionStep,
  pickGrip,
  rivalHint,
  rivalLabel,
  rivalNote,
  rivalNumbers,
  rivalOn,
  rivalStats,
  rivalSummaryLine,
  treeGen,
  treeRisk,
} from '../src/ui/rival.js';

const REAL_RIVAL = { awake: true, nodes: [], edges: [], tips: [], grip: [], clusters: [], spores: 0, ver: 0, rs: 1 };

/** A game state with the rival's flag and state in the shape the contract pins. */
function rivalState(over = {}) {
  const s = createState(7);
  s.phase = 'playing';
  s.flags.threats = true;
  s.flags.rival = true;
  s.rival = { ...REAL_RIVAL, ...over };
  return s;
}

test('the barrier tab shows only with threats, the flag and an awake rival', () => {
  const s = createState(7);
  assert.equal(barrierTabShown(s), false, 'a plain game');
  s.flags.threats = true;
  s.flags.rival = true;
  assert.equal(barrierTabShown(s), false, 'the flag without a rival state');
  s.rival = { ...REAL_RIVAL, awake: false };
  assert.equal(rivalOn(s), true);
  assert.equal(barrierTabShown(s), false, 'asleep');
  s.rival.awake = true;
  assert.equal(barrierTabShown(s), true);
  s.flags.threats = false;
  assert.equal(barrierTabShown(s), false, 'threats off: no tab');
  s.flags.threats = true;
  s.flags.rival = false;
  assert.equal(barrierTabShown(s), false, 'rival flag off');
  assert.equal(barrierTabShown(null), false);
  assert.equal(barrierTabShown({}), false);
});

test('the barrier price comes from the sim, else B.barrierCost, else 30', () => {
  const s = rivalState();
  // the sim function may be missing or not (it lands in parallel): any answer must be a sane price
  const live = barrierCostOf(s);
  assert.ok(Number.isInteger(live) && live > 0);
  assert.equal(barrierCostOf(s, { barrierCost: 42.4 }) > 0, true);
  // no sim answer: the fallbacks (a state the sim cannot price)
  const bare = { flags: { threats: true, rival: true } };
  assert.equal(barrierCostOf(bare, {}), 30);
  assert.equal(barrierCostOf(bare, undefined) > 0, true);
  assert.equal(barrierCostOf(bare, { barrierCost: 'many' }), 30);
  assert.match(barrierTabTitle(25), /Барьер \(4\): цена 25 сахара/);
});

test('the cursor tooltip names the price, or says why a barrier cannot go here', () => {
  const ok = describeBarrierPick({ ok: true, cost: 30 }, 30, 80);
  assert.equal(ok.main, 'Барьер: −30 сахара');
  assert.match(ok.sub, /растворяет ризоморфы рядом/);
  assert.equal(ok.warn, false);

  const idle = describeBarrierPick(null, 30, 80);
  assert.match(idle.sub, /цена 30 сахара/);

  const poor = describeBarrierPick({ ok: true }, 30, 12);
  assert.match(poor.main, /Не хватает сахара \(нужно 30\)/);
  assert.match(poor.sub, /есть 12/);
  assert.equal(poor.warn, true);

  const sugar = describeBarrierPick({ ok: false, reason: 'sugar', cost: 34 }, 30, 5);
  assert.match(sugar.main, /нужно 34/, 'the pick carries the price at the cursor');

  assert.match(describeBarrierPick({ ok: false, reason: 'crowded' }, 30, 80).main, /Рядом уже стоит барьер/);
  assert.match(describeBarrierPick({ ok: false, reason: 'dead' }, 30, 80).main, /Эта нить отмерла/);
  const max = describeBarrierPick({ ok: false, reason: 'max' }, 30, 80, { barrierMax: 3 });
  assert.match(max.main, /Больше барьеров не удержать/);
  assert.match(max.sub, /не больше 3/);
  assert.doesNotMatch(describeBarrierPick({ ok: false, reason: 'max' }, 30, 80, {}).sub, /\d/, 'no number when B has none');
  assert.match(describeBarrierPick({ ok: false, reason: 'off' }, 30, 80).main, /ставят на нить/);
  const odd = describeBarrierPick({ ok: false, reason: 'odd' }, 30, 80);
  assert.ok(odd.main && odd.warn);
  for (const r of ['sugar', 'crowded', 'dead', 'max', 'off']) assert.equal(describeBarrierPick({ ok: false, reason: r }, 30, 80).warn, true);
});

test('a tree tooltip says infection and protection, and a lost tree is a snag killed by the fungus', () => {
  const tree = { id: 0, species: 'birch', name: 'Берёза', stage: 1, health: 0.8, linked: true, growth: 0.4 };
  const healthy = describeTree(tree);
  assert.equal(healthy.sub2, undefined, 'both zero: nothing extra');
  assert.match(describeTree({ ...tree, infection: 0.4, mantle: 0.2 }).sub2, /^заражение 40 % · защита 20 %$/);
  assert.match(describeTree({ ...tree, infection: 0, mantle: 0.55 }).sub2, /заражение 0 % · защита 55 %/, 'protection alone is shown too');
  assert.equal(describeTree({ ...tree, infection: 0.3, mantle: 0 }).warn, undefined, 'a light infection does not alarm');
  assert.equal(describeTree({ ...tree, infection: 0.6, mantle: 0.1 }).warn, true);
  assert.ok(describeTree({ ...tree, infection: 0.4 }).main.includes('Берёза'), 'the usual lines stay');
  const lost = describeTree({ ...tree, lost: true, infection: 1, mantle: 0.3 });
  assert.match(lost.main, /сухостой/);
  assert.match(lost.sub, /опёнок/);
  assert.equal(lost.sub2, undefined);
  assert.deepEqual(treeRisk({ infection: 0, mantle: 0 }), null);
  assert.deepEqual(treeRisk({ lost: true, infection: 1, mantle: 1 }), null);
  assert.equal(treeRisk({ infection: 1.7, mantle: -3 }).text, 'заражение 100 % · защита 0 %', 'out-of-range values are clamped');
});

test('trees are named by their species in the cases the notes need', () => {
  assert.equal(treeGen({ species: 'birch', name: 'Берёза' }), 'берёзы');
  assert.equal(treeGen({ species: 'oak', name: 'Дуб' }), 'дуба');
  assert.equal(treeGen({ species: 'pine', name: 'Сосна' }), 'сосны');
  assert.equal(treeGen({ name: 'Ель' }), 'ель', 'unknown species: the lower-cased name');
  assert.equal(treeGen(undefined), 'дерева');
});

test('notes and labels of the rival events use the pinned fields and name the tree', () => {
  const s = rivalState();
  s.world.trees[0] = { ...s.world.trees[0], id: 0, species: 'birch', name: 'Берёза' };
  const wake = rivalNote(s, { type: 'rival-wake', x: 100, y: 200, stumpId: 0 });
  assert.match(wake.text, /Под старым пнём проснулся опёнок/);
  assert.match(wake.text, /\(4\)/, 'the note names the key');
  assert.equal(wake.tone, 'warn');
  assert.match(rivalLabel(s, { type: 'rival-wake', x: 1, y: 2 }).text, /опёнок/);

  assert.match(rivalNote(s, { type: 'rival-grip', treeId: 0, x: 1, y: 2 }).text, /корни берёзы/);
  assert.match(rivalLabel(s, { type: 'rival-grip', treeId: 0, x: 1, y: 2 }).text, /берёза/);
  assert.match(rivalNote(s, { type: 'rival-fruit', treeId: 0, x: 1, y: 2, n: 3 }).text, /^У берёзы высыпали опята$/);
  assert.match(rivalNote(s, { type: 'tree-freed', treeId: 0, x: 1, y: 2 }).text, /берёзы освободились/);
  assert.equal(rivalNote(s, { type: 'tree-freed', treeId: 0 }).tone, 'good');
  const lost = rivalNote(s, { type: 'tree-lost', treeId: 0, x: 1, y: 2 });
  assert.match(lost.text, /погибло и стоит сухостоем/);
  assert.equal(rivalLabel(s, { type: 'tree-lost', treeId: 0 }).text, 'погибло');
  // a tree the world does not know: still a sentence
  assert.match(rivalNote(s, { type: 'rival-grip', treeId: 99 }).text, /корни дерева/);

  // barrier: placed is a quiet label, gone says nothing, denials are labels by reason
  assert.equal(rivalLabel(s, { type: 'barrier-placed', id: 1, x: 1, y: 2 }).text, 'барьер');
  assert.equal(rivalNote(s, { type: 'barrier-placed', id: 1 }), null);
  assert.equal(rivalLabel(s, { type: 'barrier-gone', id: 1 }), null);
  assert.equal(rivalNote(s, { type: 'barrier-gone', id: 1 }), null);
  assert.match(rivalLabel(s, { type: 'barrier-denied', reason: 'sugar' }).text, /не хватает сахара/);
  assert.equal(rivalLabel(s, { type: 'barrier-denied', reason: 'sugar' }).icon, 'sugar');
  assert.match(rivalLabel(s, { type: 'barrier-denied', reason: 'crowded' }).text, /рядом уже барьер/);
  assert.match(rivalLabel(s, { type: 'barrier-denied', reason: 'dead' }).text, /отмерла/);
  assert.match(rivalLabel(s, { type: 'barrier-denied', reason: 'max' }).text, /больше барьеров/);
  assert.match(rivalLabel(s, { type: 'barrier-denied' }).text, /ставят на нить/);
  assert.equal(rivalNote(s, { type: 'barrier-denied', reason: 'sugar' }), null, 'a denial is a label, not a note');

  // every local event has a label, every «both» event a note too
  for (const type of RIVAL_LOCAL) assert.ok(rivalLabel(s, { type, treeId: 0, reason: 'off' }), `a label for ${type}`);
  for (const type of RIVAL_BOTH) assert.ok(rivalNote(s, { type, treeId: 0 }), `a note for ${type}`);
  assert.ok(RIVAL_EVENTS.has('tree-infected') && !RIVAL_LOCAL.has('tree-infected'), 'infection has no place: a note only');
  assert.equal(rivalNote(s, { type: 'link' }), null);
  assert.equal(rivalLabel(s, { type: 'link' }), null);
});

test('tree-infected speaks only at 0.5 and 0.75', () => {
  const s = rivalState();
  s.world.trees[0] = { ...s.world.trees[0], id: 0, species: 'oak', name: 'Дуб' };
  assert.equal(infectionStep(0.25), null);
  assert.equal(infectionStep(0.5), 'half');
  assert.equal(infectionStep(0.75), 'most');
  assert.equal(infectionStep(undefined), null);
  assert.equal(rivalNote(s, { type: 'tree-infected', treeId: 0, level: 0.25 }), null);
  assert.match(rivalNote(s, { type: 'tree-infected', treeId: 0, level: 0.5 }).text, /^Дуб: заражена половина корней/);
  assert.match(rivalNote(s, { type: 'tree-infected', treeId: 0, level: 0.75 }).text, /три четверти/);
  const a = rivalNote(s, { type: 'tree-infected', treeId: 0, level: 0.5 });
  const b = rivalNote(s, { type: 'tree-infected', treeId: 0, level: 0.75 });
  assert.notEqual(a.key, b.key, 'each step is its own note');
});

test('the rival notes are rate-limited like the worm notes: no spam', () => {
  const s = rivalState();
  const texts = createRivalTexts();
  const at = (t) => {
    s.time = t;
  };
  // the wake-up and the loss of a tree are always told
  for (let i = 0; i < 5; i++) {
    at(i);
    assert.ok(texts.note(s, { type: 'rival-wake' }));
    assert.ok(texts.note(s, { type: 'tree-lost', treeId: 0 }));
  }
  // grips: one per 12 s, five per game
  let told = 0;
  for (let t = 0; t < 400; t += 1) {
    at(t);
    if (texts.note(s, { type: 'rival-grip', treeId: t % 3 })) told += 1;
  }
  assert.equal(told, 5, 'at most five grip notes in a game');
  // infections: a burst in one frame lets only the first through
  const infected = createRivalTexts();
  at(100);
  assert.ok(infected.note(s, { type: 'tree-infected', treeId: 0, level: 0.5 }));
  assert.equal(infected.note(s, { type: 'tree-infected', treeId: 1, level: 0.5 }), null, 'too soon after the first');
  at(111);
  assert.ok(infected.note(s, { type: 'tree-infected', treeId: 1, level: 0.5 }), 'after the gap');
  // silent levels do not use up the allowance
  const quiet = createRivalTexts();
  at(0);
  for (let i = 0; i < 20; i++) assert.equal(quiet.note(s, { type: 'tree-infected', treeId: 0, level: 0.25 }), null);
  assert.ok(quiet.note(s, { type: 'tree-infected', treeId: 0, level: 0.5 }));
  // reset: a new game starts with a full allowance; notes and labels do not eat each other's
  const t2 = createRivalTexts();
  at(0);
  assert.ok(t2.note(s, { type: 'rival-fruit', treeId: 0 }));
  assert.ok(t2.label(s, { type: 'rival-fruit', treeId: 0 }));
  at(1);
  assert.equal(t2.note(s, { type: 'rival-fruit', treeId: 0 }), null);
  t2.reset();
  at(2);
  assert.ok(t2.note(s, { type: 'rival-fruit', treeId: 0 }));
  // rival-cut labels are spaced 3 s apart but never run out
  const cuts = createRivalTexts();
  let cutLabels = 0;
  for (let t = 0; t < 30; t += 0.5) {
    at(t);
    if (cuts.label(s, { type: 'rival-cut', x: 1, y: 2 })) cutLabels += 1;
  }
  assert.ok(cutLabels >= 9 && cutLabels <= 10, `cut labels spaced out (${cutLabels})`);
  // barrier labels pass untouched (the label layer merges repeats near one place)
  assert.ok(createRivalTexts().label(s, { type: 'barrier-denied', reason: 'sugar' }));
});

test('the guide points at the oldest grip once the rival holds a tree', () => {
  const s = rivalState();
  s.world.trees[0] = { ...s.world.trees[0], id: 0, species: 'birch', name: 'Берёза' };
  assert.equal(pickGrip(s), null);
  assert.equal(rivalHint(s), null);
  s.rival.grip = [
    { treeId: 1, node: 5, x: 700, y: 400, since: 90 },
    { treeId: 0, node: 4, x: 500, y: 380, since: 60 },
  ];
  assert.equal(pickGrip(s).treeId, 0);
  const h = rivalHint(s);
  assert.equal(h.id, 'rival');
  assert.match(h.text, /Опёнок держит корни берёзы/);
  assert.match(h.text, /\{4\}/, 'the key renders as a key cap');
  assert.match(h.text, /толстые нити/);
  assert.deepEqual([h.ring.x, h.ring.y], [500, 380]);
  assert.ok(h.ring.rx > 20);
  assert.equal(h.key, 'rival:0');
  // the normal steps go on unless the one-time arrow is asked for
  assert.notEqual(pickHint(s).id, 'rival');
  const o = s.net.nodes[s.net.originId];
  s.net.nodes[s.net.originId] = { ...o, born: 1 }; // the game has started
  assert.equal(pickHint(s, null, 'grow', { rivalHint: true }).id, 'rival');
  // no grip: nothing to point at, even when asked
  s.rival.grip = [];
  assert.notEqual(pickHint(s, null, 'grow', { rivalHint: true }).id, 'rival');
  // asleep or flag off: no hint
  s.rival.grip = [{ treeId: 0, node: 4, x: 500, y: 380, since: 60 }];
  s.rival.awake = false;
  assert.equal(rivalHint(s), null);
});

test('the help page has a section on the rival, with its numbers from B', () => {
  const s = rivalState();
  const html = buildHelp(s);
  assert.match(html, /<h3>Опёнок<\/h3>/);
  assert.match(html, /Armillaria/);
  assert.match(html, /ризоморф/);
  assert.match(html, /микориз/);
  assert.match(html, /мантия/, 'why mycorrhiza protects');
  assert.match(html, /<kbd>4<\/kbd>/);
  assert.match(html, /нить \/ гриб \/ кольцо \/ барьер/, 'the key list names the barrier');

  const B = { barrierCost: 41, barrierRadius: 95, barrierDur: 75, barrierMax: 4, mantleProtect: 0.7 };
  const sec = rivalSection(s, B);
  assert.match(sec, /до 70 % заражения/);
  assert.match(sec, /на 95 ед\. вокруг/);
  assert.match(sec, /около 75 с/);
  assert.match(sec, /не больше 4 сразу/);
  // the price: the sim's own function when it exists, else B.barrierCost
  assert.match(sec, new RegExp(`Барьер: ${barrierCostOf(s, B)} сахара`));

  // fallbacks: every number is still there when B has none of them
  const bare = rivalSection({ flags: { threats: true, rival: true } }, {});
  assert.match(bare, /до 60 % заражения/);
  assert.match(bare, /\d+ ед\./);
  assert.match(bare, /около \d+ с/);
  assert.match(bare, /не больше \d+ сразу/);
  assert.match(bare, /\d+ сахара/);
  assert.deepEqual(rivalNumbers({}), { cost: 30, radius: 70, seconds: 90, max: 3, protect: 60 });

  // no flag, no rival section and no fourth key
  const plain = createState(7);
  plain.flags.threats = true;
  assert.doesNotMatch(buildHelp(plain), /<h3>Опёнок<\/h3>/);
  assert.doesNotMatch(buildHelp(plain), /барьер/);
  assert.equal(rivalSection(plain), '');
});

test('the summary line counts freed and lost trees and the honey clusters', () => {
  const s = rivalState({ clusters: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  s.world.trees[0] = { ...s.world.trees[0], lost: true };
  const stats = rivalStats(s, 2);
  assert.deepEqual(stats, { freed: 2, lost: 1, clusters: 3 });
  assert.equal(rivalSummaryLine(stats), 'спасено 2 дерева, погибло 1, 3 кучки опят');
  assert.equal(rivalSummaryLine({ freed: 0, lost: 0, clusters: 0 }), 'не успел навредить');
  assert.equal(rivalSummaryLine({ freed: 5, lost: 0, clusters: 1 }), 'спасено 5 деревьев, 1 кучка опят');
  assert.deepEqual(rivalStats(createState(7)), { freed: 0, lost: 0, clusters: 0 }, 'an old game: zeros');

  const year = buildYearPage(s, 0, { freed: 2 });
  assert.match(year, /Опёнок/);
  assert.match(year, /спасено 2 дерева/);
  assert.match(year, /сухостой/, 'the lost tree stands as a snag in the list of trees');
  const plain = createState(7);
  assert.doesNotMatch(buildYearPage(plain, 0), /Опёнок/);
});

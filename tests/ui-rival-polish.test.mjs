// Run 5 polish of the rival's HUD text: the truthful grip hint, the dormant / retreat / turn news, the stump tooltip and its
// hover target, the infection line that waits for the wake-up, the page-2 progress, built on hand-made events and states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { generateWorld } from '../src/world/generate.js';
import { targetAt } from '../src/world/query.js';
import { B } from '../src/sim/balance.js';
import { describeTree, objectiveProgress, objectiveText } from '../src/ui/trees-logic.js';
import {
  RIVAL_BOTH,
  RIVAL_EVENTS,
  RIVAL_LOCAL,
  createRivalTexts,
  describeStump,
  nearestPlayerNode,
  rivalHint,
  rivalLabel,
  rivalNote,
} from '../src/ui/rival.js';

function rivalState(over = {}) {
  const s = createState(7);
  s.phase = 'playing';
  s.flags.threats = true;
  s.flags.rival = true;
  s.rival = { awake: true, nodes: [], edges: [], tips: [], grip: [], clusters: [], spores: 0, ver: 0, rs: 1, ...over };
  s.world.trees[0] = { ...s.world.trees[0], id: 0, species: 'birch', name: 'Берёза' };
  return s;
}

const GRIP = { treeId: 0, node: 0, x: 900, y: 500, since: 10 };

test('the grip hint says to extend a thread when no player node is within the barrier radius', () => {
  const s = rivalState({ grip: [GRIP] });
  s.net.nodes = [
    { id: 0, x: 100, y: 400, alive: true, born: 0 },
    { id: 1, x: 880, y: 500, alive: false, born: 0 }, // dead: does not count
  ];
  const far = rivalHint(s);
  assert.match(far.text, /Протяни нить к этому дереву — барьер ставят на свою нить/);
  assert.match(far.text, /корни берёзы/);
  assert.ok(!far.text.includes('{4}'));
  assert.deepEqual(far.from, { x: 100, y: 400 }, 'the nearest alive node starts the dotted line');
  assert.deepEqual([far.ring.x, far.ring.y], [900, 500]);

  // a node just inside the radius: the old text with the key cap, no dotted line
  s.net.nodes.push({ id: 2, x: 900 + B.barrierRadius - 1, y: 500, alive: true, born: 0 });
  const near = rivalHint(s);
  assert.match(near.text, /Поставь барьер \{4\} на узел рядом/);
  assert.equal(near.from, undefined);
  // just outside: back to the thread hint
  s.net.nodes[2].x = 900 + B.barrierRadius + 1;
  assert.match(rivalHint(s).text, /Протяни нить/);
});

test('the grip hint copes with no player nodes at all and with partial states', () => {
  const s = rivalState({ grip: [GRIP] });
  s.net.nodes = [];
  const h = rivalHint(s);
  assert.match(h.text, /Протяни нить/);
  assert.equal(h.from, undefined);
  assert.equal(nearestPlayerNode(s, 0, 0), null);
  delete s.net;
  assert.match(rivalHint(s).text, /Протяни нить/);
  assert.equal(rivalHint(rivalState()), null, 'no grip: no hint');
  // the radius comes from B, with a fallback for a B without one
  const t = rivalState({ grip: [GRIP] });
  t.net.nodes = [{ id: 0, x: 900, y: 590, alive: true, born: 0 }];
  assert.match(rivalHint(t, { barrierRadius: 100 }).text, /\{4\}/);
  assert.match(rivalHint(t, { barrierRadius: 80 }).text, /Протяни/);
  assert.match(rivalHint(t, {}).text, /Протяни/);
});

test('rival-dormant, rival-retreat and rival-turn have their notes and labels', () => {
  const s = rivalState();
  assert.match(rivalNote(s, { type: 'rival-dormant', x: 1, y: 2 }).text, /дремлет до весны/);
  assert.equal(rivalLabel(s, { type: 'rival-dormant', x: 1, y: 2 }), null, 'no label for the dormant news');
  const back = rivalNote(s, { type: 'rival-retreat', treeId: 0, x: 1, y: 2 });
  assert.equal(back.text, 'Барьер растворился, ризоморфы отступили от корней берёзы');
  assert.equal(rivalLabel(s, { type: 'rival-retreat', treeId: 0, x: 1, y: 2 }).text, 'ризоморфы отступили');
  assert.match(rivalNote(s, { type: 'rival-turn', x: 1, y: 2 }).text, /Толстая нить не пускает ризоморф/);
  assert.equal(rivalLabel(s, { type: 'rival-turn', x: 1, y: 2 }).text, 'нить не пускает');
  assert.match(rivalNote(s, { type: 'rival-retreat', treeId: 99 }).text, /корней дерева/, 'an unknown tree is still a sentence');
  for (const type of ['rival-retreat', 'rival-turn']) assert.ok(RIVAL_LOCAL.has(type) && RIVAL_BOTH.has(type) && RIVAL_EVENTS.has(type));
  assert.ok(RIVAL_EVENTS.has('rival-dormant') && !RIVAL_LOCAL.has('rival-dormant'), 'dormant is a note only');
});

test('the new news is rate limited: dormant once, retreat 4 per game 20 s apart, turn note once and label twice', () => {
  const s = rivalState();
  const at = (t) => (s.time = t);
  const texts = createRivalTexts();
  let dormant = 0;
  for (let t = 0; t < 100; t += 5) {
    at(t);
    if (texts.note(s, { type: 'rival-dormant' })) dormant++;
  }
  assert.equal(dormant, 1);
  let retreat = 0;
  let labels = 0;
  for (let t = 0; t < 400; t += 1) {
    at(t);
    if (texts.note(s, { type: 'rival-retreat', treeId: 0 })) retreat++;
    if (texts.label(s, { type: 'rival-retreat', treeId: 0 })) labels++;
  }
  assert.equal(retreat, 4);
  assert.equal(labels, 4);
  const spaced = createRivalTexts();
  at(0);
  assert.ok(spaced.note(s, { type: 'rival-retreat', treeId: 0 }));
  at(19);
  assert.equal(spaced.note(s, { type: 'rival-retreat', treeId: 0 }), null, 'too soon');
  at(20);
  assert.ok(spaced.note(s, { type: 'rival-retreat', treeId: 0 }));
  const turn = createRivalTexts();
  let notes = 0;
  let lbl = 0;
  const times = [];
  for (let t = 0; t < 300; t += 1) {
    at(t);
    if (turn.note(s, { type: 'rival-turn' })) notes++;
    if (turn.label(s, { type: 'rival-turn' })) {
      lbl++;
      times.push(t);
    }
  }
  assert.equal(notes, 1, 'the turn note once per game');
  assert.equal(lbl, 2, 'the turn label twice');
  assert.ok(times[1] - times[0] >= 30);
  turn.reset();
  at(400);
  assert.ok(turn.note(s, { type: 'rival-turn' }), 'a new game tells it again');
});

test('describeStump foreshadows the rival before it wakes and names its state after', () => {
  const s = rivalState({ awake: false });
  const asleep = describeStump(s, { kind: 'stump', id: 0 });
  assert.equal(asleep.main, 'Старый пень');
  assert.match(asleep.sub, /под ним кто-то спит/);
  assert.deepEqual(describeStump({ flags: {} }, { kind: 'stump', id: 0 }), { main: 'Старый пень' }, 'no rival in this game');
  assert.deepEqual(describeStump(createState(3), { kind: 'stump', id: 0 }), { main: 'Старый пень' });
  const early = createState(3);
  early.flags.rival = true; // the flag is on, the first step has not made the rival yet
  assert.match(describeStump(early, { kind: 'stump', id: 0 }).sub, /кто-то спит/);
  s.rival.dormant = true;
  assert.equal(describeStump(s, { kind: 'stump', id: 0 }).main, 'Старый пень · опёнок дремлет до весны');
  s.rival.dormant = false;
  s.rival.awake = true;
  const awake = describeStump(s, { kind: 'stump', id: 0 });
  assert.equal(awake.main, 'Старый пень · опёнок проснулся');
  assert.equal(awake.sub, 'ризоморфы идут от него к корням');
});

test('targetAt finds a stump above the ground, lets trees win and works on worlds without stumps', () => {
  const s = createState(7);
  const w = s.world;
  assert.ok(w.stumps.length >= 1);
  const st = w.stumps[0];
  assert.deepEqual(targetAt(w, [], st.x, st.y - 10), { kind: 'stump', id: st.id });
  assert.deepEqual(targetAt(w, [], st.x + st.r + 6, st.y - 4), { kind: 'stump', id: st.id });
  assert.equal(targetAt(w, [], st.x + st.r + 20, st.y - 10), null, 'beside the stump: open sky');
  assert.equal(targetAt(w, [], st.x, st.y - st.r * 3), null, 'far above it');
  // a trunk within reach wins
  const tree = w.trees[0];
  const fake = { ...w, stumps: [{ id: 5, x: tree.x + 5, y: tree.baseY, r: 30 }] };
  assert.deepEqual(targetAt(fake, [], tree.x + 5, tree.baseY - 10), { kind: 'tree', id: tree.id });
  // a world from before stumps
  const old = { ...w };
  delete old.stumps;
  assert.doesNotThrow(() => targetAt(old, [], st.x, st.y - 10));
  assert.equal(targetAt(old, [], st.x, st.y - 10), null);
  // every glade's stump can be hovered at its base
  for (let seed = 1; seed <= 40; seed++) {
    const g = generateWorld(seed);
    for (const t of g.stumps) assert.equal(targetAt(g, [], t.x, t.y - 8).kind, 'stump', `seed ${seed}`);
  }
});

test('the infection line of a tree waits for the awake rival', () => {
  const tree = { id: 0, species: 'birch', name: 'Берёза', stage: 1, health: 0.8, linked: true, growth: 0.4, infection: 0, mantle: 0.5 };
  const sleeping = rivalState({ awake: false });
  const awake = rivalState();
  // chapter 1: mantle grows but no rival: no line
  assert.equal(describeTree(tree).sub2, undefined);
  assert.equal(describeTree(tree, sleeping).sub2, undefined);
  assert.equal(describeTree(tree, createState(3)).sub2, undefined);
  assert.equal(describeTree(tree, awake).sub2, 'заражение 0 % · защита 50 %');
  // the old call keeps working for an infected tree
  assert.equal(describeTree({ ...tree, infection: 0.3 }).sub2, 'заражение 30 % · защита 50 %');
  assert.equal(describeTree({ ...tree, infection: 0.3 }, sleeping).sub2, undefined, 'a state that says the rival sleeps wins');
  assert.equal(describeTree({ ...tree, infection: 0.6 }, awake).warn, true);
});

test('the rivalCut objective shows freed trees and cut edges', () => {
  const o = { id: 'rivalCut', text: 'Спаси деревья от опёнка', done: false };
  const s = rivalState({ stats: { freedTrees: 1, cut: 7 } });
  assert.equal(objectiveProgress(s, o), ` · 1/${B.rivalCutFreed || 2} дерева или 7/${B.rivalCutGoal || 15} тяжей`);
  assert.match(objectiveText(s, o), /^Спаси деревья от опёнка · 1\/\d+ дерева или 7\/\d+ тяжей$/);
  assert.equal(objectiveProgress(s, { ...o, done: true }), '', 'a ticked line shows nothing');
  const bare = rivalState();
  assert.match(objectiveProgress(bare, o), /0\/\d+ дерева или 0\/\d+ тяжей/, 'missing stats count as zero');
  delete bare.rival;
  assert.match(objectiveProgress(bare, o), /^ · 0\//);
  assert.match(objectiveProgress(createState(3), o), /или 0\/\d+ тяжей/);
});

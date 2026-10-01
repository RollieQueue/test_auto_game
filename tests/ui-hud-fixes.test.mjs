// Fixes from the playtest, pure parts: cards over mushrooms, tree growth text, guide targets, label and tooltip
// placement, texts, the sugar nudge and the worm-sense gate. No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { B } from '../src/sim/balance.js';
import { groundYAt } from '../src/world/query.js';
import { pickHint, mineralsDry } from '../src/ui/guide-logic.js';
import { coverage, cardMode, mushroomRect, crownRect, pointerIn } from '../src/ui/cards-logic.js';
import { describeTree, objectiveText, objectiveProgress, leadingTree, pctText } from '../src/ui/trees-logic.js';
import { placeTip } from '../src/ui/tip-logic.js';
import { placeLabelY, sweptRect, LABEL_LIFE } from '../src/ui/labels-logic.js';
import { createSugarNudge, NUDGE } from '../src/ui/resources-logic.js';
import { WORM_SENSE_NOTE, createSenseGate, cutCause, threatLabel, threatNote } from '../src/ui/threats.js';
import { describeLabel, PARTIAL_TEXT } from '../src/ui/labels.js';
import { describeNote } from '../src/ui/notes.js';

const VIEW = { scale: 1600 / 1920, ox: 0, oy: 0, cssW: 1600, cssH: 900 };

function mushroom(x, baseY, id = 0) {
  return { id, nodeId: 0, x, baseY, species: 'common', variant: 0, age: 0, growth: 1, mature: true, spores: 0 };
}

// ---- 1. cards over the game --------------------------------------------------------------------------------------

test('a mushroom under the resources card is found; one far from it is not', () => {
  const s = createState(23);
  const card = { l: 10, t: 14, r: 270, b: 560 }; // top-left card at 1600x900
  const under = mushroom(180, 330);
  const away = mushroom(900, 330, 1);
  s.mushrooms.push(under, away);
  assert.deepEqual(coverage(s, VIEW, card), { mushrooms: 1, crowns: coverage(s, VIEW, card).crowns });
  const r = mushroomRect(under, VIEW);
  assert.ok(r.l < r.r && r.t < r.b);
  s.mushrooms.pop();
  s.mushrooms.length = 0;
  s.mushrooms.push(away);
  assert.equal(coverage(s, VIEW, card).mushrooms, 0);
});

test('a tree crown is under a card when it reaches it; a sapling far below is not', () => {
  const s = createState(23);
  const t = s.world.trees[0];
  t.stage = 3;
  t.x = 1500;
  t.baseY = 300;
  const crown = crownRect(t, VIEW);
  const card = { l: crown.l + 10, t: crown.t + 10, r: crown.l + 200, b: crown.t + 80 };
  assert.equal(coverage(s, VIEW, card).crowns >= 1, true);
  const far = { l: 0, t: 0, r: 40, b: 40 };
  const sapling = { ...t, stage: 0, x: 1000, baseY: 700 };
  s.world.trees = [sapling];
  assert.equal(coverage(s, VIEW, far).crowns, 0);
});

test('the card mode follows what is under it and the pointer', () => {
  assert.equal(cardMode({ mushrooms: 0, crowns: 0 }, false), 'solid');
  assert.equal(cardMode({ mushrooms: 0, crowns: 0 }, true), 'pointer');
  assert.equal(cardMode({ mushrooms: 1, crowns: 0 }, false), 'behind');
  assert.equal(cardMode({ mushrooms: 0, crowns: 2 }, true), 'pointed');
  assert.equal(cardMode(null, false), 'solid');
  assert.equal(pointerIn({ sx: 50, sy: 50 }, { l: 0, t: 0, r: 100, b: 100 }), true);
  assert.equal(pointerIn(null, { l: 0, t: 0, r: 100, b: 100 }), false);
});

// ---- 2. tree growth ----------------------------------------------------------------------------------------------

test('the tree tooltip says growth in percent while a linked tree can still grow', () => {
  const tree = { name: 'Дуб', stage: 1, health: 0.84, growth: 0.4, linked: true };
  const t = describeTree(tree);
  assert.match(t.main, /Дуб · молодое · довольство 84 %/);
  assert.match(t.sub, /рост 40 %/);
  assert.match(describeTree({ ...tree, linked: false }).sub, /нить сюда ещё не дошла/);
  assert.doesNotMatch(describeTree({ ...tree, stage: 3 }).sub, /рост \d/);
  assert.equal(pctText(1.4), '100 %');
  assert.equal(pctText(NaN), '0 %');
});

test('the «Помочь дереву подрасти» line carries the progress of the leading linked tree', () => {
  const s = createState(7);
  const obj = { id: 'treeGrow', text: 'Помочь дереву подрасти', done: false };
  assert.equal(objectiveText(s, obj), 'Помочь дереву подрасти', 'no linked tree: no number');
  for (const t of s.world.trees) {
    t.stage = 1;
    t.linked = false;
  }
  s.world.trees[0].linked = true;
  s.world.trees[0].growth = 0.37;
  if (s.world.trees[1]) {
    s.world.trees[1].linked = true;
    s.world.trees[1].growth = 0.62;
  }
  const lead = s.world.trees[1] ? 62 : 37;
  assert.equal(objectiveText(s, obj), `Помочь дереву подрасти · ${lead} %`);
  assert.equal(leadingTree(s).growth, lead / 100);
  assert.equal(objectiveProgress(s, { ...obj, done: true }), '', 'a ticked line shows nothing');
  assert.equal(objectiveText(s, { id: 'water', text: 'Дотянуться до воды', done: false }), 'Дотянуться до воды');
  s.world.trees.forEach((t) => (t.stage = 3));
  assert.equal(objectiveProgress(s, obj), '', 'full-grown trees do not grow');
});

// ---- 2b/3. the guide ---------------------------------------------------------------------------------------------

function linkedToWater(seed) {
  const s = createState(seed);
  s.phase = 'playing';
  const o = s.net.nodes[s.net.originId];
  s.net.growing = [{}]; // started
  const pocket = s.world.water[0];
  s.net.links.push({ nodeId: o.id, kind: 'water', targetId: pocket.id, born: 0 });
  return { s, o };
}

test('the root-tip hint leads to the youngest growing tree', () => {
  let checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { s } = linkedToWater(seed);
    const stages = s.world.trees.map((t) => t.stage);
    if (new Set(stages).size < 2 || Math.min(...stages) >= 3) continue;
    const h = pickHint(s);
    assert.equal(h.id, 'tree');
    const [, treeId] = h.key.match(/^tip:(\d+):/);
    const tree = s.world.trees.find((t) => t.id === Number(treeId));
    const youngest = Math.min(...stages.filter((st) => st < 3));
    // normally the youngest; the exception is a far youngest tree with an old one close by
    if (tree.stage !== youngest) {
      const o = s.net.nodes[s.net.originId];
      const d = (t) => Math.min(...t.tips.filter((tip) => tip.minStage <= t.stage).map((tip) => Math.hypot(tip.x - o.x, tip.y - o.y)));
      const young = s.world.trees.filter((t) => t.stage === youngest);
      assert.ok(Math.min(...young.map(d)) > d(tree) + 300, `seed ${seed}: skipped the youngest tree without a reason`);
    } else {
      assert.match(h.text, /самого молодого дерева/);
    }
    checked++;
  }
  assert.ok(checked >= 10, `only ${checked} seeds had trees of different stages`);
});

function atWait(seed) {
  const { s, o } = linkedToWater(seed);
  s.net.links.push({ nodeId: o.id, kind: 'tree', targetId: s.world.trees[0].id, born: 0 });
  s.mushrooms.push(mushroom(o.x, o.y));
  const dep = s.world.minerals[0];
  s.net.links.push({ nodeId: o.id, kind: 'mineral', targetId: dep.id, born: 0 });
  s.time = 100;
  return { s, dep };
}

test('«Теперь жди…» shows only while minerals flow', () => {
  const { s } = atWait(42);
  s.res.minerals = 30;
  s.rates.minerals = 0.4;
  assert.equal(pickHint(s).id, 'wait');
  s.res.minerals = 0.2;
  s.rates.minerals = 0;
  assert.equal(mineralsDry(s), true);
  assert.notEqual(pickHint(s)?.id, 'wait');
  s.res.minerals = 0.2;
  s.rates.minerals = 0.3;
  assert.equal(pickHint(s).id, 'wait', 'minerals are coming in');
});

test('dry minerals: the hint points at a deposit that still has some, not at the empty linked one', () => {
  const { s, dep } = atWait(42);
  s.res.minerals = 0;
  s.rates.minerals = 0;
  dep.amount = 0; // the linked deposit ran dry
  const spare = s.world.minerals.filter((m) => m !== dep && m.amount > 0);
  const h = pickHint(s);
  if (spare.length) {
    assert.equal(h.id, 'mineral-dry');
    assert.ok(spare.some((m) => h.key === `mineral:${m.id}`), 'a non-empty deposit');
    assert.notEqual(h.key, `mineral:${dep.id}`);
  } else {
    assert.equal(h, null, 'nothing left to point at: stay quiet instead of waiting');
  }
  // a still-full linked deposit that nobody drinks from: the other one is suggested, never the linked one
  const { s: s2, dep: dep2 } = atWait(7);
  s2.res.minerals = 0;
  s2.rates.minerals = 0;
  const h2 = pickHint(s2);
  if (h2 && h2.id === 'mineral-dry') assert.notEqual(h2.key, `mineral:${dep2.id}`);
  assert.notEqual(h2?.id, 'wait');
});

test('a fresh mineral link is not «dry» yet', () => {
  const { s } = atWait(42);
  s.res.minerals = 0;
  s.rates.minerals = 0;
  s.net.links[s.net.links.length - 1].born = s.time - 1;
  assert.equal(mineralsDry(s), false);
});

// ---- 4. texts and placement --------------------------------------------------------------------------------------

test('a mushroom lost to a cut says it died of the cut, not that it wilted', () => {
  const ev = { type: 'mushroom-wilted' };
  assert.match(threatLabel(ev).text, /погиб: нить перекушена/);
  assert.equal(threatNote(ev).text, 'Гриб погиб: нить перекушена');
  assert.doesNotMatch(JSON.stringify([threatLabel(ev), threatNote(ev)]), /завял/);
  // starved: no worm was there
  assert.equal(cutCause([{ type: 'bite' }, { type: 'severed', cause: 'starved' }]), 'starved');
  assert.equal(cutCause([{ type: 'severed', cause: 'worm' }]), 'worm');
  assert.equal(cutCause([]), 'worm');
  assert.match(threatNote(ev, 'starved').text, /без сахара/);
  assert.match(threatNote({ type: 'severed', cause: 'starved', nodes: 3 }).text, /без сахара.*3 узла/);
  assert.equal(threatNote({ type: 'severed', nodes: 3 }).text, 'Нить перекушена: отмерло 3 узла');
});

test('labels floating from nearby events do not overlap each other', () => {
  const win = { w: 1600, h: 900 };
  const h = 30;
  const w = 150;
  const placed = [];
  for (let i = 0; i < 5; i++) {
    const y = placeLabelY({ x: 800, y: 500, w, h }, placed.map((l) => ({ ...l, age: 0 })), [], win);
    placed.push({ x: 800, y, w, h });
  }
  const ys = placed.map((l) => l.y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= h, `labels ${i - 1} and ${i} overlap`);
});

test('a label keeps out of the column of notes, over its whole float', () => {
  const win = { w: 1600, h: 900 };
  const zone = { l: 560, t: 15, r: 975, b: 175 };
  const w = 160;
  const h = 30;
  for (const wanted of [60, 120, 190, 230, 300]) {
    const y = placeLabelY({ x: 800, y: wanted, w, h }, [], [zone], win);
    const s = sweptRect(800, y, w, h);
    assert.ok(s.t >= zone.b || s.b <= zone.t, `wanted ${wanted} → ${y}: the label sweeps ${s.t}..${s.b} through the notes`);
  }
  // away from the column nothing moves
  assert.equal(placeLabelY({ x: 200, y: 400, w, h }, [], [zone], win), 400);
});

test('an older label that has floated up still counts when the next one is placed', () => {
  const win = { w: 1600, h: 900 };
  const h = 30;
  const old = { x: 800, y: 500, w: 150, h, age: LABEL_LIFE / 2 }; // half way up: 16 px above its spawn point
  const y = placeLabelY({ x: 800, y: 500 - 0.55 * h, w: 150, h }, [old], [], win);
  assert.ok(Math.abs(y - (500 - 0.55 * h)) >= h + 2 - 1e-6, 'moved off the old label');
});

test('the cursor tooltip keeps clear of the guide note when it can, and says so when it cannot', () => {
  const win = { vw: 1600, vh: 900 };
  const note = { l: 700, t: 300, r: 940, b: 400 };
  const size = { w: 160, h: 60 };
  // pointer just left of the note: the usual spot (right and below) would cover it
  const a = placeTip({ x: 650, y: 330 }, size, win, [note]);
  assert.equal(a.covers, false);
  assert.ok(a.rect.r <= note.l || a.rect.l >= note.r || a.rect.b <= note.t || a.rect.t >= note.b);
  // no note: the usual place
  const b = placeTip({ x: 650, y: 330 }, size, win, []);
  assert.deepEqual([b.x, b.y], [666, 350]);
  // the pointer is deep inside a note that fills the window: no free spot, `covers` says so
  const c = placeTip({ x: 800, y: 450 }, size, win, [{ l: 0, t: 0, r: 1600, b: 900 }]);
  assert.equal(c.covers, true);
  // near the right edge it flips to the left of the pointer as before
  const d = placeTip({ x: 1590, y: 100 }, size, win, []);
  assert.ok(d.rect.r <= 1594);
  // an anchored tooltip (a resources row) sits at its anchor
  const e = placeTip({ x: 280, y: 100 }, size, win, [], true);
  assert.deepEqual([e.x, e.y], [280, 100]);
});

// ---- 5. sugar at its cap -----------------------------------------------------------------------------------------

test('sugar at the cap for a while nudges once, then rests', () => {
  const s = createState(42);
  s.phase = 'playing';
  const o = s.net.nodes[s.net.originId];
  s.cap.sugar = 90;
  s.res.sugar = 90;
  // a node at the ground, so there is a place to click
  o.y = groundYAt(s.world, o.x) + 10;
  const n = createSugarNudge();
  let fires = 0;
  let t = 0;
  for (; t < NUDGE.fullFor - 1; t += 0.5) {
    s.time = t;
    assert.equal(n.update(s, 0.5).fire, false, `too early at ${t}`);
  }
  for (; t < NUDGE.fullFor + 2; t += 0.5) {
    s.time = t;
    const r = n.update(s, 0.5);
    if (r.fire) fires++;
  }
  assert.equal(fires, 1);
  s.time += 1;
  assert.equal(n.update(s, 0.5).active, true, 'the tab stays lit for a while');
  // still full, but within the cooldown: no second note
  for (; t < NUDGE.cooldown - 5; t += 0.5) {
    s.time = t;
    assert.equal(n.update(s, 0.5).fire, false);
  }
  // after the cooldown it may speak again
  for (t = NUDGE.cooldown + 2; t < NUDGE.cooldown + 2 + NUDGE.fullFor + 2; t += 0.5) {
    s.time = t;
    if (n.update(s, 0.5).fire) fires++;
  }
  assert.equal(fires, 2);
});

test('no nudge: sugar below the cap, winter, nothing near the ground, or the game paused', () => {
  const run = (prep) => {
    const s = createState(42);
    s.phase = 'playing';
    s.cap.sugar = 90;
    s.res.sugar = 90;
    const o = s.net.nodes[s.net.originId];
    o.y = groundYAt(s.world, o.x) + 10;
    prep(s, o);
    const n = createSugarNudge();
    let fired = false;
    for (let t = 0; t < 30; t += 0.5) {
      s.time = t;
      if (n.update(s, 0.5).fire) fired = true;
    }
    return fired;
  };
  assert.equal(run(() => {}), true, 'the baseline fires');
  assert.equal(run((s) => (s.res.sugar = 60)), false, 'not at the cap');
  assert.equal(run((s) => { s.flags.seasons = true; s.clock = { season: 'winter' }; }), false, 'winter');
  assert.equal(run((s, o) => { o.y = groundYAt(s.world, o.x) + (B.fruitMaxDepth ?? 45) + 80; }), false, 'too deep');
  assert.equal(run((s) => (s.phase = 'paused')), false, 'paused');
});

// ---- 7. event contracts ------------------------------------------------------------------------------------------

test('a hypha that grew only as far as the sugar allowed says so; a plain «insufficient» keeps its text', () => {
  const s = createState(42);
  const partial = { type: 'insufficient', x: 10, y: 20, partial: true, got: 80, want: 200 };
  assert.equal(describeLabel(s, partial, false).text, 'Сахара хватило на часть пути');
  assert.equal(describeLabel(s, partial, false).text, PARTIAL_TEXT);
  assert.equal(describeNote(s, partial).text, 'Сахара хватило на часть пути');
  assert.equal(describeLabel(s, { type: 'insufficient', x: 1, y: 2 }, false).text, 'не хватает сахара');
  assert.equal(describeNote(s, { type: 'insufficient', x: 1, y: 2 }).text, 'Не хватает сахара');
  assert.notEqual(describeLabel(s, partial, false).key, describeLabel(s, { type: 'insufficient' }, false).key);
});

test('the worm-sense note is rate-limited: a few times per game, apart in time', () => {
  assert.match(WORM_SENSE_NOTE, /Нематода учуяла нить/);
  assert.match(WORM_SENSE_NOTE, /ловчее кольцо \(3\)/);
  const g = createSenseGate(3, 30);
  assert.equal(g.take(10), true);
  assert.equal(g.take(20), false, 'too soon');
  assert.equal(g.take(45), true);
  assert.equal(g.take(80), true);
  assert.equal(g.take(200), false, 'three is enough');
  g.reset();
  assert.equal(g.take(5), true, 'a new game starts over');
});

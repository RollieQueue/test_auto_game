// HUD-CALM: cards never go see-through (fold instead), at most 3 margin notes (2 in a short window), one refusal label
// per action, and a paper slip for an earned mark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createState } from '../src/state.js';
import { CARD_OPACITY, FOLD_AFTER, MIN_CARD_OPACITY, UNFOLD_AFTER, cardMode, foldStep, wantFold } from '../src/ui/cards-logic.js';
import { MAX_NOTES, MAX_NOTES_SMALL, noteCap, notesToPush } from '../src/ui/notes.js';
import { DENIAL_WINDOW, denialFamily, findRepeat, tooltipDenialFamily } from '../src/ui/labels-logic.js';
import { SLIP_LEAVE, SLIP_LIFE, SLIP_MAX, createSlipQueue, slipLine, slipOf } from '../src/ui/slips-logic.js';
import { MARKS } from '../src/ui/marks-logic.js';
import { createMarks } from '../src/ui/marks.js';

// ---- cards -----------------------------------------------------------------------------------------------------------

test('cards: every look keeps at least 0.85 opacity, in the table and in hud.css', () => {
  for (const mode of ['solid', 'pointer', 'behind', 'pointed']) assert.ok(CARD_OPACITY[mode] >= MIN_CARD_OPACITY, mode);
  assert.equal(MIN_CARD_OPACITY, 0.85);
  const css = readFileSync(new URL('../src/ui/hud.css', import.meta.url), 'utf8');
  for (const mode of ['pointer', 'behind', 'pointed']) {
    for (const card of ['res-card', 'obj-card']) {
      const m = new RegExp(`\\.${card}\\.m-${mode}[^{]*\\{([^}]*)\\}`).exec(css);
      assert.ok(m, `${card}.m-${mode} rule`);
      const op = /opacity:\s*([\d.]+)/.exec(m[1]);
      assert.ok(op, `${card}.m-${mode} has an opacity`);
      assert.equal(Number(op[1]), CARD_OPACITY[mode], `${card}.m-${mode}`);
    }
  }
});

test('cardMode still tells the four looks apart', () => {
  assert.equal(cardMode({ mushrooms: 0, crowns: 0 }, false), 'solid');
  assert.equal(cardMode({ mushrooms: 0, crowns: 1 }, false), 'behind');
  assert.equal(cardMode({ mushrooms: 1, crowns: 0 }, true), 'pointed');
  assert.equal(cardMode(null, true), 'pointer');
});

test('wantFold: fold only when folding frees something', () => {
  assert.equal(wantFold({ mushrooms: 0, crowns: 0 }, { mushrooms: 0, crowns: 0 }), false);
  assert.equal(wantFold({ mushrooms: 1, crowns: 0 }, { mushrooms: 0, crowns: 0 }), true);
  assert.equal(wantFold({ mushrooms: 0, crowns: 2 }, { mushrooms: 0, crowns: 1 }), true);
  assert.equal(wantFold({ mushrooms: 0, crowns: 1 }, { mushrooms: 0, crowns: 1 }), false, 'the header alone covers it: folding does not help');
  assert.equal(wantFold(null, null), false);
});

test('foldStep: folds after a while, opens after a shorter while, and at once under the pointer', () => {
  let f = { folded: false, t: 0 };
  f = foldStep(f, true, false, FOLD_AFTER - 0.1);
  assert.equal(f.folded, false, 'a passing crown does not fold it');
  f = foldStep(f, false, false, 0.5);
  assert.deepEqual(f, { folded: false, t: 0 }, 'the wish went away: the timer starts over');
  f = foldStep(f, true, false, FOLD_AFTER - 0.1);
  f = foldStep(f, true, false, 0.2);
  assert.equal(f.folded, true);
  f = foldStep(f, false, false, UNFOLD_AFTER - 0.1);
  assert.equal(f.folded, true);
  f = foldStep(f, false, false, 0.2);
  assert.equal(f.folded, false);
  assert.ok(UNFOLD_AFTER < FOLD_AFTER);
  f = foldStep({ folded: true, t: 0 }, true, true, 0.1);
  assert.deepEqual(f, { folded: false, t: 0 }, 'the pointer on a folded card opens it at once');
});

// ---- margin notes ----------------------------------------------------------------------------------------------------

test('notes: three at most, two when the window is 720 high or less', () => {
  assert.equal(MAX_NOTES, 3);
  assert.equal(MAX_NOTES_SMALL, 2);
  assert.equal(noteCap(900), 3);
  assert.equal(noteCap(721), 3);
  assert.equal(noteCap(720), 2);
  assert.equal(noteCap(600), 2);
  assert.equal(noteCap(0), 3, 'a window of unknown size is a big one');
  assert.equal(notesToPush(4, 900), 1);
  assert.equal(notesToPush(7, 720), 5);
  assert.equal(notesToPush(2, 720), 0);
  assert.equal(notesToPush(3, 900), 0);
});

// ---- refusal labels --------------------------------------------------------------------------------------------------

test('denialFamily: every lack of sugar is one family, other refusals are their own', () => {
  for (const key of ['insufficient', 'insufficient:partial', 'denied:sugar', 'barrier:denied:sugar', 'trap:denied:sugar']) assert.equal(denialFamily(key), 'sugar', key);
  assert.equal(denialFamily('denied:crowded'), 'denied:crowded');
  assert.equal(denialFamily('barrier:denied:max'), 'barrier:denied:max');
  assert.equal(denialFamily('link:tree'), null);
  assert.equal(denialFamily(undefined), null);
});

test('tooltipDenialFamily: the cursor tooltip that says «не хватает сахара» is a sugar refusal', () => {
  assert.equal(tooltipDenialFamily('Не хватает сахара (нужно 20)'), 'sugar');
  assert.equal(tooltipDenialFamily('Не хватает сахара на гриб'), 'sugar');
  assert.equal(tooltipDenialFamily('Тесно: рядом уже гриб'), null);
  assert.equal(tooltipDenialFamily(''), null);
  assert.equal(tooltipDenialFamily(null), null);
});

test('findRepeat: a second sugar refusal of one action folds into the first, wherever it is', () => {
  const first = { key: 'barrier:denied:sugar', sx: 400, sy: 300, age: 0.3 };
  assert.equal(findRepeat([first], 'insufficient', 700, 500), first, 'another text, another place, same action');
  assert.equal(findRepeat([first], 'denied:sugar', 410, 305), first);
  assert.equal(findRepeat([{ ...first, age: DENIAL_WINDOW + 0.1 }], 'insufficient', 700, 500), null, 'an old refusal is a different action');
  assert.equal(findRepeat([first], 'denied:crowded', 700, 500), null, 'another kind of refusal stays');
  const link = { key: 'link:tree', sx: 100, sy: 100, age: 2 };
  assert.equal(findRepeat([link], 'link:tree', 120, 110), link, 'the same label near the same place counts up');
  assert.equal(findRepeat([link], 'link:tree', 400, 400), null);
  assert.equal(findRepeat([], 'insufficient', 1, 1), null);
});

// ---- slips -----------------------------------------------------------------------------------------------------------

test('slipLine: one short line from the first sentence of the remark', () => {
  assert.equal(slipLine({ line: 'Нить вышла к свету и стала шляпкой. Записываю день.' }), 'Нить вышла к свету и стала шляпкой.');
  assert.equal(slipLine({}), '');
  const long = slipLine({ line: `${'слово '.repeat(30)}конец.` });
  assert.ok(long.length <= 78 && long.endsWith('…'), long);
  for (const m of MARKS) {
    const s = slipOf(m);
    assert.ok(s.line.length > 0 && s.line.length <= 78, m.id);
    assert.ok(!s.line.includes('\n'));
    assert.deepEqual([s.id, s.icon, s.title], [m.id, m.icon, m.title]);
  }
});

test('slip queue: two at a time, they leave after about 4 s, the rest wait and nothing repeats', () => {
  assert.ok(SLIP_LIFE >= 3.5 && SLIP_LIFE <= 4.5);
  const q = createSlipQueue();
  assert.equal(q.push({ id: 'a' }), true);
  assert.equal(q.push({ id: 'a' }), false, 'the same mark is not queued twice');
  q.push({ id: 'b' });
  q.push({ id: 'c' });
  let r = q.tick(0);
  assert.deepEqual(r.enter.map((x) => x.id), ['a', 'b']);
  assert.deepEqual(q.snapshot(), { showing: ['a', 'b'], waiting: ['c'] });
  assert.equal(SLIP_MAX, 2);
  r = q.tick(SLIP_LIFE - 0.1);
  assert.deepEqual(r, { enter: [], leave: [], gone: [] });
  r = q.tick(0.2);
  assert.deepEqual(r.leave.map((x) => x.id), ['a', 'b']);
  assert.equal(r.enter.length, 0, 'a leaving slip still holds its place');
  r = q.tick(SLIP_LEAVE + 0.01);
  assert.deepEqual(r.gone.map((x) => x.id), ['a', 'b']);
  assert.deepEqual(r.enter.map((x) => x.id), ['c']);
  assert.equal(q.push({ id: 'c' }), false, 'showing now');
  q.tick(SLIP_LIFE + SLIP_LEAVE + 0.1);
  assert.deepEqual(q.snapshot(), { showing: [], waiting: [] });
  assert.equal(q.push({ id: 'a' }), true, 'gone for good: it may come again');
  q.reset();
  assert.deepEqual(q.snapshot(), { showing: [], waiting: [] });
});

test('marks watcher: with slips an earned mark goes to the slip, not to a margin note', () => {
  const slipped = [];
  const said = [];
  const data = new Map();
  const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => void data.set(k, String(v)) };
  const marks = createMarks({ notes: { say: (d) => said.push(d) }, slips: { show: (d) => slipped.push(d) }, storage, now: () => 1700000000000 });
  const s = createState(2);
  s.phase = 'playing';
  s.world.trees.forEach((t, i) => (t.linked = i < 3));
  s.events.push({ type: 'worm-caught' });
  marks.update(s, 0.016);
  marks.update(s, 0.016);
  assert.equal(said.length, 0);
  assert.deepEqual(slipped.map((x) => x.id).sort(), ['trap', 'union3'], 'two at once, no waiting between them');
  assert.equal(slipped.find((x) => x.id === 'union3').title, 'Союз трёх деревьев');
});

// HUD clarity batch: glade names, one denial label per click, the cursor tooltip clear of the cards, the margin-note stack.
// (The DOM parts were checked in a browser; this file covers the pure logic.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/world/generate.js';
import { BIOMES, NAME_MAX, TERRAIN_FEATURES } from '../src/world/biomes.js';
import { gladeLabel } from '../src/ui/glade.js';
import { describeLabel } from '../src/ui/labels.js';
import { nearAny, notesShift, sugarDenialSpots } from '../src/ui/labels-logic.js';
import { placeTip } from '../src/ui/tip-logic.js';
import { smallWindow } from '../src/ui/notes.js';

test('300 seeds give at least 250 distinct glade names, none too long, each a base plus a ground phrase', () => {
  const names = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const w = generateWorld(seed);
    names.add(w.name);
    assert.ok(w.name.length <= NAME_MAX, `${w.name} is ${w.name.length} long`);
    assert.ok(BIOMES[w.biome].bases.some((b) => w.name.startsWith(b)), w.name);
    assert.ok(TERRAIN_FEATURES[w.terrain].some((f) => w.name.endsWith(f)), w.name);
    assert.ok(!/ у .* у /.test(w.name), `two «у»: ${w.name}`);
  }
  assert.ok(names.size >= 250, `${names.size} distinct names`);
});

test('a glade keeps its name: the same seed gives the same name', () => {
  for (const seed of [3, 42, 987654321]) assert.equal(generateWorld(seed).name, generateWorld(seed).name);
});

test('the title says «Сохранённая поляна» for a save, with its seed', () => {
  assert.equal(gladeLabel({ seed: 7, world: { name: 'Сосняк у ручья на холме' } }, 'Сохранённая поляна'), 'Сохранённая поляна: Сосняк у ручья на холме · №7');
});

test('a refusal for sugar is told once: the plain «не хватает сахара» steps aside for the specific label', () => {
  const events = [
    { type: 'insufficient', x: 100, y: 200 },
    { type: 'barrier-denied', reason: 'sugar', x: 100, y: 200 },
  ];
  const spots = sugarDenialSpots(events);
  assert.equal(spots.length, 1);
  assert.ok(nearAny(spots, events[0]));
  assert.ok(!nearAny(spots, { x: 400, y: 200 }), 'a growth shortfall elsewhere still speaks');
  const state = { world: {} };
  assert.equal(describeLabel(state, events[0], true), null);
  assert.equal(describeLabel(state, events[0], false).text, 'не хватает сахара');
  // other reasons are not sugar refusals
  assert.equal(sugarDenialSpots([{ type: 'trap-denied', reason: 'crowded', x: 1, y: 1 }]).length, 0);
  assert.equal(sugarDenialSpots([{ type: 'trap-denied', reason: 'sugar', x: 1, y: 1 }]).length, 1);
  assert.equal(sugarDenialSpots([{ type: 'fruit-denied', reason: 'sugar', x: 1, y: 1 }]).length, 1);
});

test('the pointer tooltip keeps off the HUD cards, sliding to the nearest free spot when the pointer is on one', () => {
  const win = { vw: 1280, vh: 720 };
  const size = { w: 240, h: 40 };
  const obj = { l: 986, t: 12, r: 1267, b: 238 };
  const res = { l: 12, t: 12, r: 250, b: 225 };
  const tools = { l: 10, t: 655, r: 560, b: 710 };
  const cards = [obj, res, tools];
  const touches = (rect) => cards.some((c) => rect.l < c.r && rect.r > c.l && rect.t < c.b && rect.b > c.t);
  for (const pt of [{ x: 1100, y: 60 }, { x: 1200, y: 150 }, { x: 150, y: 100 }, { x: 300, y: 690 }, { x: 1262, y: 230 }]) {
    const spot = placeTip(pt, size, win, [], false, cards);
    assert.ok(!touches(spot.rect), `at ${pt.x},${pt.y}: ${JSON.stringify(spot.rect)}`);
    assert.ok(spot.rect.l >= 4 && spot.rect.r <= win.vw && spot.rect.b <= win.vh);
  }
  // no cards: the usual place right and below the pointer
  const plain = placeTip({ x: 600, y: 300 }, size, win, []);
  assert.deepEqual([plain.x, plain.y], [616, 320]);
  // an anchored tooltip (a resources row) is not pushed off its own card
  const anchored = placeTip({ x: 260, y: 100 }, size, win, [], true, []);
  assert.equal(anchored.x, 260);
});

test('the note stack slides between the cards to where it hides the fewest crowns', () => {
  const box = { cx: 640, w: 390, t: 12, h: 100 };
  const span = { l: 255, r: 915 };
  assert.equal(notesShift(box, span, []), 0, 'nothing to dodge: centred');
  const crown = { l: 450, r: 520, t: 30, b: 90, w: 2 }; // under the left half of the stack
  const dx = notesShift(box, span, [crown]);
  assert.ok(dx > 0, `slid right: ${dx}`);
  const l = box.cx + dx - box.w / 2;
  assert.ok(l >= crown.r && l + box.w <= span.r, 'clear of the crown and inside the span');
  assert.equal(notesShift(box, { l: 400, r: 800 }, [crown]), 0, 'no room: stays');
  // heavier things are dodged first
  const tree = { l: 250, r: 440, t: 30, b: 90, w: 2 };
  const mush = { l: 700, r: 760, t: 40, b: 100, w: 3 };
  const d2 = notesShift(box, span, [tree, mush]);
  const l2 = box.cx + d2 - box.w / 2;
  assert.ok(l2 + box.w <= mush.l || l2 >= mush.r, 'the mushroom is not covered');
});

test('a short window is one of 720 px or less', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    globalThis.window = { innerHeight: 720 };
    assert.equal(smallWindow(), true);
    globalThis.window = { innerHeight: 900 };
    assert.equal(smallWindow(), false);
  } finally {
    if (had) Object.defineProperty(globalThis, 'window', had);
    else delete globalThis.window;
  }
});

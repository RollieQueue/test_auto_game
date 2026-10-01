import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { RESOURCES, resourceView, resourceTip } from '../src/ui/resources-logic.js';
import { RESOURCE_INFO, fillWords } from '../src/content/resources.js';
import { buildHelp } from '../src/ui/help.js';

const game = (res, cap) => {
  const s = createState(7);
  Object.assign(s.res, res);
  Object.assign(s.cap, cap);
  return s;
};

test('resources: sugar is capped by cap.sugar, water and minerals each by cap.pool, spores not at all', () => {
  const s = game({ sugar: 64, water: 71, minerals: 20, spores: 5 }, { pool: 90, sugar: 220 });
  assert.deepEqual(RESOURCES.map((r) => r.cap), ['sugar', 'pool', 'pool', null]);
  assert.deepEqual(resourceView(s, 'sugar'), { value: 64, cap: 220, frac: 64 / 220, full: false, capped: true });
  assert.equal(resourceView(s, 'water').cap, 90);
  assert.equal(resourceView(s, 'minerals').value, 20);
  assert.deepEqual(resourceView(s, 'spores'), { value: 5, cap: 0, frac: 0, full: false, capped: false });
});

test('resources: the shown number never exceeds the cap, even when the stock does', () => {
  const s = game({ sugar: 500, water: 91.7, minerals: 90.4, spores: 3 }, { pool: 90.9, sugar: 220.5 });
  for (const k of ['sugar', 'water', 'minerals']) {
    const v = resourceView(s, k);
    assert.ok(v.value <= v.cap, `${k}: ${v.value} / ${v.cap}`);
    assert.ok(v.frac <= 1);
    assert.equal(v.full, true);
    assert.equal(v.value, v.cap, 'a full stock reads «cap / cap»');
  }
  assert.equal(resourceView(s, 'water').cap, 90);
});

test('resources: almost full counts as full, a fraction below does not; no cap yet gives no bar', () => {
  assert.equal(resourceView(game({ water: 89.5 }, { pool: 90 }), 'water').full, true);
  assert.equal(resourceView(game({ water: 80 }, { pool: 90 }), 'water').full, false);
  const none = resourceView(game({ water: 5 }, { pool: 0 }), 'water');
  assert.equal(none.cap, 0);
  assert.equal(none.frac, 0);
  assert.equal(none.full, false);
  assert.equal(resourceView(game({ water: -3 }, { pool: 90 }), 'water').value, 0);
});

test('resources: the tooltip explains the stock and says what a full cap means', () => {
  const s = game({ sugar: 64, water: 90, minerals: 20, spores: 5 }, { pool: 90, sugar: 220 });
  const water = resourceTip(s, 'water');
  assert.equal(water.main, 'Влага · 90 из 90');
  assert.equal(water.sub, 'кладовая полна');
  assert.equal(water.warn, true);
  assert.match(water.body.join(' '), /нити перестают добывать/);
  assert.match(water.body.join(' '), /Длиннее сеть — больше кладовая/);
  const minerals = resourceTip(s, 'minerals');
  assert.equal(minerals.main, 'Минералы · 20 из 90');
  assert.equal(minerals.warn, false);
  assert.match(minerals.sub, /заполнена на 22 %/);
  assert.equal(resourceTip(s, 'spores').main, 'Споры · 5');
  assert.equal(resourceTip(s, 'spores').body.length, 2, 'no limit line for spores');
  assert.equal(resourceTip(s, 'gold'), null);
});

test('resources: every stock has a what / use text; capped ones a limit and a full-stock line', () => {
  for (const [k, info] of Object.entries(RESOURCE_INFO)) {
    assert.ok(info.name && info.what && info.use, k);
    if (RESOURCES.find((r) => r.k === k).cap) assert.ok(info.limit && info.full, `${k} limit`);
    else assert.equal(info.limit, null);
  }
  assert.equal(fillWords(1), 'кладовая полна');
  assert.equal(fillWords(0), 'кладовая пуста');
  assert.equal(fillWords(0.5), 'кладовая заполнена на 50 %');
});

test('help: no «Запас сети» block any more; it explains «71 / 90» and the red bar', () => {
  const html = buildHelp(createState(7));
  assert.doesNotMatch(html, /запас(е|а|у)? сети/i);
  assert.match(html, /71 \/ 90/);
  assert.match(html, /краснеет/);
});

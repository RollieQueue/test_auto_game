// The HUD side of the soil threats: pure helpers in src/ui/threats.js and the worm arrow of the guide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { B } from '../src/sim/balance.js';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { pickHint } from '../src/ui/guide-logic.js';
import {
  FIRST_WORM_NOTE,
  THREAT_BOTH,
  THREAT_LOCAL,
  chapterOf,
  chapterTotal,
  describeTrapPick,
  objectivesTitle,
  pickWorm,
  ruPlural,
  summaryTexts,
  threatLabel,
  threatNote,
  trapCost,
  wormHint,
} from '../src/ui/threats.js';

const on = (s) => {
  s.flags.threats = true;
  return s;
};

test('ruPlural follows the Russian rules', () => {
  const nodes = (n) => `${n} ${ruPlural(n, 'узел', 'узла', 'узлов')}`;
  assert.equal(nodes(1), '1 узел');
  assert.equal(nodes(2), '2 узла');
  assert.equal(nodes(5), '5 узлов');
  assert.equal(nodes(11), '11 узлов');
  assert.equal(nodes(21), '21 узел');
  assert.equal(nodes(24), '24 узла');
  assert.equal(nodes(112), '112 узлов');
});

test('trapCost reads the balance and falls back to 30', () => {
  assert.equal(trapCost({}), 30);
  assert.equal(trapCost(undefined), Math.round(B.trapCost ?? 30), 'no argument: the live balance');
  assert.equal(trapCost({ trapCost: 'many' }), 30);
  assert.equal(trapCost({ trapCost: 42.4 }), 42);
});

test('the trap tooltip says the price, or why the ring cannot go here', () => {
  const ok = describeTrapPick({ ok: true }, 30, 80);
  assert.match(ok.main, /Ловчее кольцо · цена 30 сахара/);
  assert.ok(!ok.warn);
  const poor = describeTrapPick({ ok: true }, 30, 12.9);
  assert.match(poor.main, /Не хватает сахара/);
  assert.match(poor.sub, /нужно 30, есть 12/);
  assert.ok(poor.warn);
  const reasons = { sugar: /сахара/, crowded: /Рядом уже есть кольцо/, dead: /отмерла/, off: /на нить/ };
  for (const [reason, re] of Object.entries(reasons)) {
    const t = describeTrapPick({ ok: false, reason }, 30, 80);
    assert.match(t.main, re, reason);
    assert.ok(t.warn, reason);
  }
  assert.ok(describeTrapPick({ ok: false, reason: 'mystery' }, 30, 80).warn);
  const idle = describeTrapPick(null, 30, 80);
  assert.match(idle.sub, /30 сахара/);
  assert.ok(!idle.warn);
});

test('chapters: card title, defaults and the summary page', () => {
  const s = createState(7);
  assert.equal(chapterOf(s), 1);
  assert.equal(objectivesTitle(s), 'Наблюдения'); // threats off: today's card
  assert.equal(summaryTexts(s).title, 'Поляна изучена');
  on(s);
  assert.equal(objectivesTitle(s), 'Глава 1');
  s.chapter = 2;
  assert.equal(objectivesTitle(s), 'Глава 2');
  assert.equal(chapterTotal(s), 3);
  const mid = summaryTexts(s, 2);
  assert.equal(mid.title, 'Страница наблюдений заполнена');
  assert.equal(mid.button, 'Перевернуть страницу');
  assert.match(mid.overline, /глава 2/);
  assert.match(mid.sub, /2 из 3/);
  assert.ok(mid.hasNext);
  const last = summaryTexts(s, 3);
  assert.equal(last.button, 'Продолжить наблюдения');
  assert.ok(!last.hasNext);
  s.chapterCount = 5;
  assert.ok(summaryTexts(s, 3).hasNext);
});

test('labels and notes for the threat events', () => {
  assert.deepEqual([...THREAT_BOTH].filter((t) => !THREAT_LOCAL.has(t)), [], 'every two-way event is local too');
  const cut = threatLabel({ type: 'severed', x: 1, y: 1, nodes: 7, lost: 3 });
  assert.equal(cut.text, 'перекушено: −7');
  assert.equal(cut.tone, 'warn');
  assert.equal(threatLabel({ type: 'severed', x: 1, y: 1 }).text, 'перекушено');
  assert.equal(threatNote({ type: 'severed', nodes: 1 }).text, 'Нить перекушена: отмерло 1 узел');
  assert.equal(threatNote({ type: 'severed', nodes: 4 }).text, 'Нить перекушена: отмерло 4 узла');
  assert.equal(threatNote({ type: 'severed', nodes: 12 }).text, 'Нить перекушена: отмерло 12 узлов');
  assert.equal(threatNote({ type: 'severed', lost: 5 }).text, 'Нить перекушена: отмерло 5 узлов');
  assert.match(threatNote({ type: 'severed' }).text, /перекушена/); // fields missing: still a sentence
  assert.equal(threatNote({ type: 'worm-caught', minerals: 14.4 }).text, 'Кольцо поймало нематоду: +14 минералов');
  assert.equal(threatNote({ type: 'worm-caught', minerals: 2 }).text, 'Кольцо поймало нематоду: +2 минерала');
  assert.equal(threatNote({ type: 'worm-caught' }).text, 'Кольцо поймало нематоду');
  assert.equal(threatNote({ type: 'trap-spent' }).text, 'Кольцо истощилось');
  assert.equal(threatNote({ type: 'mushroom-wilted' }).text, 'Гриб завял');
  assert.match(threatNote({ type: 'chapter', chapter: 2 }).text, /Глава 2/);
  assert.equal(threatLabel({ type: 'trap-denied', reason: 'crowded' }).text, 'рядом уже есть кольцо');
  assert.equal(threatLabel({ type: 'trap-denied', reason: 'sugar' }).icon, 'sugar');
  assert.equal(threatLabel({ type: 'bite' }).tone, 'bite');
  assert.equal(threatLabel({ type: 'link' }), null);
  assert.equal(threatNote({ type: 'link' }), null);
  assert.match(FIRST_WORM_NOTE, /клавиша 3/);
  for (const type of THREAT_LOCAL) assert.ok(threatLabel({ type, reason: 'off' }), `a label for ${type}`);
});

test('the guide points at the first worm and ignores leaving ones', () => {
  const s = on(createState(7));
  s.phase = 'playing';
  const o = s.net.nodes[s.net.originId];
  assert.ok(sim.commandGrow(s, o.id, [{ x: o.x + 12, y: o.y + 6 }, { x: o.x + 24, y: o.y + 12 }]));
  for (let i = 0; i < 60; i++) {
    sim.updateSim(s, 1 / 60);
    s.time += 1 / 60;
  }
  assert.equal(pickWorm(s), null);
  assert.equal(wormHint(s), null);
  s.fauna = [
    { id: 1, x: 900, y: 500, mode: 'leave', fade: 0.6, age: 30 },
    { id: 2, x: 905, y: 505, mode: 'wander', fade: 0.1, age: 1 }, // still fading in
    { id: 3, x: 910, y: 510, mode: 'wander', fade: 1, age: 4 },
  ];
  assert.equal(pickWorm(s).id, 3);
  const h = wormHint(s);
  assert.equal(h.id, 'worm');
  assert.match(h.text, /\{3\}/);
  assert.ok(h.ring.rx > 20);
  // the normal steps go on unless the one-time arrow is asked for
  assert.notEqual(pickHint(s).id, 'worm');
  assert.equal(pickHint(s, null, 'grow', { wormHint: true }).id, 'worm');
  s.flags.threats = false;
  assert.notEqual(pickHint(s, null, 'grow', { wormHint: true }).id, 'worm');
});

test('the key of the worm arrow changes only when the worm moved far', () => {
  const s = on(createState(7));
  s.fauna = [{ id: 1, x: 900, y: 500, mode: 'wander', fade: 1, age: 2 }];
  const a = wormHint(s).key;
  s.fauna[0].x = 912;
  assert.equal(wormHint(s).key, a);
  s.fauna[0].x = 1100;
  assert.notEqual(wormHint(s).key, a);
});

test('the HUD shows the real mushroom price (threats raise it, every standing mushroom too)', async () => {
  const { fruitCostOf } = await import('../src/ui/threats.js');
  const s = createState(42);
  assert.equal(fruitCostOf(s), Math.round(sim.mushroomCost(s)));
  s.flags.threats = true;
  const base = fruitCostOf(s);
  assert.equal(base, Math.round(sim.mushroomCost(s)));
  assert.ok(base > Math.round(B.mushroomCost), 'threats make mushrooms dearer');
  s.mushrooms.push({ id: 90, nodeId: 0, x: 0, baseY: 0, species: 'common', variant: 0, age: 0, growth: 0, mature: false, spores: 0 });
  assert.ok(fruitCostOf(s) > base, 'each standing mushroom raises the price');
  assert.equal(fruitCostOf(null), Math.round(B.mushroomCost ?? 24));
});

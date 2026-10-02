import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { FUNGUS_IDS } from '../src/sim/species.js';
import { BIOME_IDS } from '../src/world/biomes.js';
import { KINDS } from '../src/ui/atlas-logic.js';
import { buildAtlas, createAtlas } from '../src/ui/atlas.js';
import { buildMarksPage, createMarks, tabsHtml } from '../src/ui/marks.js';
import { MARKS, MARK_IDS, checkMarks, dateText, emptyMemory, lifetimeProgress, marksModel, newTracker, noteText } from '../src/ui/marks-logic.js';
import { MARKS_KEY, createMarksStore, emptyStore, gladeOf, loadStore, mergeEarned, mergeGame, sanitize, saveStore } from '../src/ui/marks-store.js';

const game = (seed = 2) => {
  const s = createState(seed);
  s.phase = 'playing';
  return s;
};
const memoryWith = (extra = {}) => ({ ...emptyMemory(), ...extra });
const run = (state, events, tracker = newTracker(), memory = emptyMemory(), kinds = {}) => checkMarks(state, events, tracker, memory, kinds);
const linkTrees = (state, n) => state.world.trees.forEach((t, i) => (t.linked = i < n));

test('marks: a dozen or so, unique ids, every one has a title, a line, a condition and an icon', () => {
  assert.ok(MARKS.length >= 12 && MARKS.length <= 16);
  assert.equal(new Set(MARK_IDS).size, MARKS.length);
  for (const m of MARKS) {
    assert.ok(m.title && m.line && m.cond && m.icon, m.id);
    assert.ok(m.kind === 'game' || m.kind === 'life');
  }
});

test('marks: a fresh game earns nothing', () => {
  assert.deepEqual(run(game(), []), []);
  assert.deepEqual(run(null, []), []);
});

test('mark first_fruit: a mushroom matured (event) or stands mature (state)', () => {
  assert.deepEqual(run(game(), [{ type: 'mushroom-mature', id: 1 }]), ['first_fruit']);
  const s = game();
  s.mushrooms.push({ id: 1, mature: false });
  assert.deepEqual(run(s, []), []);
  s.mushrooms[0].mature = true;
  assert.deepEqual(run(s, []), ['first_fruit']);
});

test('mark union3 / union_all: three linked trees, then every tree; a lost tree does not count', () => {
  const s = game();
  const n = s.world.trees.length;
  assert.ok(n >= 4);
  linkTrees(s, 2);
  assert.deepEqual(run(s, []), []);
  linkTrees(s, 3);
  assert.deepEqual(run(s, []), ['union3']);
  linkTrees(s, n);
  assert.deepEqual(run(s, []), ['union3', 'union_all']);
  s.world.trees[0].lost = true;
  assert.deepEqual(run(s, []), ['union3'], 'a lost tree breaks the whole glade');
  linkTrees(s, 3);
  s.world.trees[0].lost = true;
  assert.deepEqual(run(s, []), [], 'two living linked trees are not a union');
});

test('mark year2: the first year-end', () => {
  assert.deepEqual(run(game(), [{ type: 'season', season: 'spring' }]), []);
  assert.deepEqual(run(game(), [{ type: 'year-end', year: 0 }]), ['year2']);
});

test('mark trap: a worm caught in a ring', () => {
  assert.deepEqual(run(game(), [{ type: 'worm-caught', wormId: 1 }]), ['trap']);
});

test('mark freed: a tree let go of the honey fungus', () => {
  assert.deepEqual(run(game(), [{ type: 'tree-freed', treeId: 2 }]), ['freed']);
});

test('mark fungal_year: six mushrooms in one year, counted per year', () => {
  const s = game();
  const done = memoryWith({ earned: { first_fruit: { at: 1 }, year2: { at: 1 } } });
  const fruit = (n) => Array.from({ length: n }, (_, i) => ({ type: 'mushroom-mature', id: i }));
  const t = newTracker();
  run(s, fruit(5), t, done);
  assert.deepEqual(run(s, [{ type: 'year-end', year: 0 }], t, done), [], 'five is not enough');
  run(s, fruit(3), t, done);
  assert.deepEqual(run(s, [{ type: 'year-end', year: 1 }], t, done), [], 'the count restarts every year');
  const t2 = newTracker();
  run(s, fruit(6), t2, done);
  assert.deepEqual(run(s, [{ type: 'year-end', year: 0 }], t2, done), ['fungal_year']);
});

test('mark winter: a winter with no severed branch and no lost tree, with a tree linked', () => {
  const done = memoryWith({ earned: { year2: { at: 1 } } });
  const winter = (extra) => {
    const s = game();
    linkTrees(s, 1);
    const t = newTracker();
    run(s, [{ type: 'season', season: 'winter' }], t, done);
    if (extra) run(s, [extra], t, done);
    return run(s, [{ type: 'year-end', year: 0 }, { type: 'season', season: 'spring' }], t, done);
  };
  assert.deepEqual(winter(null), ['winter']);
  assert.deepEqual(winter({ type: 'severed', cause: 'worm', nodes: 3 }), []);
  assert.deepEqual(winter({ type: 'severed', cause: 'starved', nodes: 3 }), []);
  assert.deepEqual(winter({ type: 'tree-lost', treeId: 1 }), []);
  // a winter nobody watched from its start earns nothing; neither does a glade without a linked tree
  assert.ok(!run(game(), [{ type: 'season', season: 'spring' }]).includes('winter'));
  const s = game();
  const t = newTracker();
  run(s, [{ type: 'season', season: 'winter' }], t);
  assert.ok(!run(s, [{ type: 'season', season: 'spring' }], t).includes('winter'));
  // losses in autumn do not count against the winter
  const s2 = game();
  linkTrees(s2, 1);
  const t2 = newTracker();
  run(s2, [{ type: 'severed', cause: 'worm' }, { type: 'season', season: 'winter' }], t2);
  assert.ok(run(s2, [{ type: 'season', season: 'spring' }], t2).includes('winter'));
});

test('mark chapter: a page finished with worms about and no branch cut; threats must be on', () => {
  const s = game();
  s.flags.threats = true;
  const page = (events) => {
    const t = newTracker();
    run(s, events, t);
    return run(s, [{ type: 'all-objectives', chapter: 1 }], t);
  };
  assert.deepEqual(page([{ type: 'worm-spawn', id: 1 }, { type: 'bite-abort' }]), ['chapter']);
  assert.deepEqual(page([]), [], 'no worm came: nothing to be proud of');
  assert.deepEqual(page([{ type: 'worm-spawn', id: 1 }, { type: 'severed', cause: 'worm', nodes: 2 }]), []);
  const t = newTracker();
  run(s, [{ type: 'worm-spawn', id: 1 }, { type: 'severed', cause: 'worm' }, { type: 'all-objectives', chapter: 1 }], t);
  assert.deepEqual(run(s, [{ type: 'worm-spawn', id: 2 }, { type: 'all-objectives', chapter: 2 }], t), ['chapter'], 'each page counts on its own');
  s.flags.threats = false;
  assert.deepEqual(page([{ type: 'worm-spawn', id: 1 }]), []);
});

test('mark honey_year: a whole year with the honey fungus awake, one grip, no tree lost', () => {
  const s = game();
  s.flags.rival = true;
  s.rival = { awake: true };
  const done = memoryWith({ earned: { year2: { at: 1 } } });
  const year = (events, awakeAtStart = true) => {
    const t = newTracker();
    t.yearRival = awakeAtStart;
    run(s, events, t, done);
    return run(s, [{ type: 'year-end', year: 1 }], t, done);
  };
  assert.deepEqual(year([{ type: 'rival-grip', treeId: 1 }]), ['honey_year']);
  assert.deepEqual(year([{ type: 'rival-grip', treeId: 1 }, { type: 'tree-lost', treeId: 1 }]), []);
  assert.deepEqual(year([]), [], 'it never gripped');
  assert.deepEqual(year([{ type: 'rival-grip', treeId: 1 }], false), [], 'it woke in the middle of the year');
  s.rival.awake = false;
  assert.deepEqual(year([{ type: 'rival-grip', treeId: 1 }]), []);
  s.rival.awake = true;
  s.flags.rival = false;
  assert.deepEqual(year([{ type: 'rival-grip', treeId: 1 }]), []);
});

test('marks: lifetime progress and the four lifetime marks', () => {
  assert.deepEqual(lifetimeProgress('four', memoryWith({ species: ['porcini'] })), { n: 1, of: 4 });
  assert.deepEqual(lifetimeProgress('forests3', memoryWith({ biomes: ['oak', 'pine'] })), { n: 2, of: 3 });
  assert.deepEqual(lifetimeProgress('forests3', memoryWith({ biomes: BIOME_IDS })), { n: 3, of: 3 });
  assert.deepEqual(lifetimeProgress('ten_finds', memoryWith(), { pebble: 4, leaf: 4 }), { n: 8, of: 10 });
  assert.deepEqual(lifetimeProgress('ten_finds', memoryWith(), { pebble: 40 }), { n: 10, of: 10 });
  assert.deepEqual(lifetimeProgress('atlas_full', memoryWith(), { pebble: 4 }), { n: 1, of: KINDS.length });
  assert.equal(lifetimeProgress('union3', memoryWith()), null);

  const s = game();
  assert.deepEqual(run(s, [], newTracker(), memoryWith({ species: FUNGUS_IDS.slice(0, 3) })), []);
  assert.deepEqual(run(s, [], newTracker(), memoryWith({ species: FUNGUS_IDS })), ['four']);
  assert.deepEqual(run(s, [], newTracker(), memoryWith({ biomes: BIOME_IDS.slice(0, 2) })), []);
  assert.deepEqual(run(s, [], newTracker(), memoryWith({ biomes: BIOME_IDS.slice(0, 3) })), ['forests3']);
  assert.deepEqual(run(s, [], newTracker(), memoryWith(), { pebble: 5, leaf: 4 }), []);
  assert.deepEqual(run(s, [], newTracker(), memoryWith(), { pebble: 5, leaf: 5 }), ['ten_finds']);
  const all = Object.fromEntries(KINDS.map((k) => [k, 1]));
  assert.deepEqual(run(s, [], newTracker(), memoryWith(), all), ['ten_finds', 'atlas_full'], 'eleven kinds are eleven finds');
  assert.deepEqual(run(s, [], newTracker(), memoryWith({ earned: { ten_finds: { at: 1 } } }), all), ['atlas_full']);
});

test('marks: an earned mark is never returned again; results follow the order of MARKS', () => {
  const s = game();
  linkTrees(s, 3);
  const ev = [{ type: 'worm-caught' }, { type: 'tree-freed', treeId: 1 }];
  assert.deepEqual(run(s, ev), ['union3', 'trap', 'freed']);
  assert.deepEqual(run(s, ev, newTracker(), memoryWith({ earned: { trap: { at: 1 } } })), ['union3', 'freed']);
});

test('marks: dates and the note text', () => {
  assert.equal(dateText(new Date(2026, 9, 2, 12).getTime()), '02.10.2026');
  assert.equal(dateText(NaN), '');
  assert.equal(noteText(MARKS.find((m) => m.id === 'union3')), 'Пометка на полях: «Союз трёх деревьев»');
});

test('marks model: earned ones carry date and glade, the rest their condition and progress', () => {
  const at = new Date(2026, 9, 2, 12).getTime();
  const m = marksModel(memoryWith({ earned: { union3: { at, glade: 'Берёзовая роща №7' } }, species: ['porcini', 'chanterelle'] }));
  assert.equal(m.total, MARKS.length);
  assert.equal(m.earned, 1);
  assert.equal(m.progress, `отмечено 1 из ${MARKS.length}`);
  const e = m.entries.find((x) => x.id === 'union3');
  assert.deepEqual([e.date, e.glade], ['02.10.2026', 'Берёзовая роща №7']);
  assert.equal(m.entries.find((x) => x.id === 'four').progressText, '2 из 4');
  assert.equal(m.entries.find((x) => x.id === 'trap').progressText, '');
});

// ---- the store ----------------------------------------------------------------------------------------------------

const memStorage = (initial) => {
  const data = new Map(initial === undefined ? [] : [[MARKS_KEY, initial]]);
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => void data.set(k, String(v)), data };
};

test('marks store: sanitize drops unknown marks, species, biomes and bad values', () => {
  assert.deepEqual(sanitize(null), emptyStore());
  assert.deepEqual(sanitize({ v: 2, earned: { trap: { at: 5 } } }), emptyStore());
  const s = sanitize({
    v: 1,
    earned: { trap: { at: 1700000000000, glade: 'Луг' }, unicorn: { at: 5 }, freed: 'x', year2: { at: 'now', glade: 5 } },
    species: ['porcini', 'dragon', 'porcini'],
    biomes: ['oak', 7],
  });
  assert.deepEqual(Object.keys(s.earned), ['year2', 'trap']);
  assert.deepEqual(s.earned.trap, { at: 1700000000000, glade: 'Луг' });
  assert.deepEqual(s.earned.year2, { at: 0, glade: '' });
  assert.deepEqual(s.species, ['porcini']);
  assert.deepEqual(s.biomes, ['oak']);
});

test('marks store: tolerates missing, throwing and corrupt storage', () => {
  assert.deepEqual(loadStore(null), emptyStore());
  assert.deepEqual(loadStore(memStorage('{not json')), emptyStore());
  assert.deepEqual(loadStore(memStorage('[1,2]')), emptyStore());
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('full');
    },
  };
  assert.deepEqual(loadStore(throwing), emptyStore());
  assert.equal(saveStore(emptyStore(), throwing), false);
  assert.equal(saveStore(emptyStore(), null), false);
  // a blocked storage still works for the session
  const st = createMarksStore(throwing, () => 1700000000000);
  const s = game();
  assert.deepEqual(st.award(['trap'], s), ['trap']);
  assert.deepEqual(Object.keys(st.memory().earned), ['trap']);
  const none = createMarksStore(null, () => 1);
  assert.deepEqual(none.award(['freed'], s), ['freed']);
});

test('marks store: glade name, species and biome of a game, earned marks with date and glade', () => {
  const s = game(7);
  s.world.name = 'Дубовая поляна';
  assert.equal(gladeOf(s), 'Дубовая поляна');
  delete s.world.name;
  assert.equal(gladeOf(s), 'Поляна №7');
  s.flags.species = 'porcini';
  const g = mergeGame(emptyStore(), s);
  assert.equal(g.changed, true);
  assert.deepEqual(g.store.species, ['porcini']);
  assert.deepEqual(g.store.biomes, [s.world.biome]);
  assert.equal(mergeGame(g.store, s).changed, false);
  const noSpecies = game(7);
  assert.deepEqual(mergeGame(emptyStore(), noSpecies).store.species, [], 'the generalist is none of the four');
  const e = mergeEarned(emptyStore(), ['trap', 'trap', 'nope'], 1700000000000, 'Луг');
  assert.deepEqual(e.added, ['trap']);
  assert.deepEqual(e.store.earned.trap, { at: 1700000000000, glade: 'Луг' });
  assert.deepEqual(mergeEarned(e.store, ['trap'], 5, 'Другая').added, []);
});

test('marks store: persists across handles, never overwrites a first date', () => {
  const storage = memStorage();
  const a = createMarksStore(storage, () => 1700000000000);
  const s = game(7);
  s.flags.species = FUNGUS_IDS[1];
  assert.equal(a.noteGame(s), true);
  assert.equal(a.noteGame(s), false);
  assert.deepEqual(a.award(['union3'], s), ['union3']);
  const b = createMarksStore(storage, () => 1800000000000);
  assert.deepEqual(b.award(['union3', 'trap'], s), ['trap']);
  const mem = createMarksStore(storage).memory();
  assert.equal(mem.earned.union3.at, 1700000000000);
  assert.equal(mem.earned.trap.at, 1800000000000);
  assert.deepEqual(mem.species, [FUNGUS_IDS[1]]);
  assert.equal(JSON.parse(storage.data.get(MARKS_KEY)).v, 1);
});

// ---- the watcher and the page ---------------------------------------------------------------------------------------

test('marks watcher: says a note per mark, one at a time, and remembers it', () => {
  const said = [];
  const storage = memStorage();
  const marks = createMarks({ notes: { say: (d) => said.push(d) }, storage, now: () => 1700000000000 });
  const s = game(2);
  s.flags.species = 'porcini';
  marks.update({ ...s, phase: 'title' }, 1);
  assert.equal(said.length, 0, 'nothing on the title page');
  linkTrees(s, 3);
  s.events.push({ type: 'worm-caught' });
  marks.update(s, 0.016);
  assert.equal(said.length, 1);
  assert.equal(said[0].text, 'Пометка на полях: «Союз трёх деревьев»');
  assert.equal(said[0].tone, 'good');
  assert.ok(said[0].icon && said[0].key === 'mark:union3');
  s.events.length = 0;
  marks.update(s, 0.016);
  assert.equal(said.length, 1, 'the second note waits');
  marks.update(s, 4);
  assert.equal(said.length, 2);
  assert.equal(said[1].key, 'mark:trap');
  marks.update(s, 10);
  assert.equal(said.length, 2, 'earned marks are not said again');
  assert.deepEqual(Object.keys(marks.store.memory().earned).sort(), ['trap', 'union3']);
  assert.deepEqual(marks.counts(), { earned: 2, total: MARKS.length });
  // a reload keeps them, a new watcher says nothing
  const said2 = [];
  const again = createMarks({ notes: { say: (d) => said2.push(d) }, storage });
  again.update(s, 1);
  assert.equal(said2.length, 0);
  assert.ok(again.pageHtml().includes('Союз трёх деревьев'));
});

test('marks watcher: a new game starts a fresh tracker', () => {
  const marks = createMarks({ notes: { say() {} }, storage: memStorage() });
  const a = game(2);
  a.flags.threats = true;
  a.events.push({ type: 'worm-spawn', id: 1 });
  marks.update(a, 0.1);
  const b = game(8);
  b.flags.threats = true;
  b.events.push({ type: 'all-objectives', chapter: 1 });
  marks.update(b, 0.1);
  assert.ok(!('chapter' in marks.store.memory().earned), 'the worm of the other game does not count');
});

test('marks page: earned marks inked with date and glade, the rest pencilled with their condition', () => {
  const at = new Date(2026, 9, 2, 12).getTime();
  const html = buildMarksPage(memoryWith({ earned: { union3: { at, glade: 'Берёзовая роща' } }, species: ['porcini'] }), {});
  assert.equal((html.match(/class="mk-entry /g) || []).length, MARKS.length);
  assert.equal((html.match(/mk-entry earned/g) || []).length, 1);
  assert.ok(html.includes('02.10.2026') && html.includes('Берёзовая роща'));
  assert.ok(html.includes(MARKS.find((m) => m.id === 'union3').line));
  const trap = MARKS.find((m) => m.id === 'trap');
  assert.ok(html.includes(trap.cond) && !html.includes(trap.line), 'a pencilled mark shows its condition, not its remark');
  assert.ok(html.includes('1 из 4') && html.includes(`отмечено 1 из ${MARKS.length}`));
  assert.ok(html.includes('data-act="atlas-close"'));
  assert.ok(/<svg/.test(html), 'ink icons');
  assert.ok(buildMarksPage(undefined).includes('Пометки на полях'));
});

test('atlas tabs: the finds page gets a tab bar only when marks are wired in', () => {
  const s = createState(7);
  assert.ok(!buildAtlas(s).includes('atl-tabs'));
  const html = buildAtlas(s, {}, null, { earned: 3, total: MARKS.length });
  assert.ok(html.includes('data-tab="marks"') && html.includes(`3/${MARKS.length}`));
  assert.ok(tabsHtml('marks').includes('class="atl-tab on" type="button" role="tab" aria-selected="true" data-act="atlas-tab" data-tab="marks"'));
});

test('atlas with marks: the tab switches by click and by keys; Esc and Enter are left to the hud', () => {
  globalThis.document = { activeElement: null };
  const listeners = {};
  const page = {
    html: '',
    scrollTop: 0,
    classList: { toggle() {}, remove() {}, add() {} },
    addEventListener: (type, fn) => (listeners[type] = fn),
    set innerHTML(v) {
      this.html = v;
    },
    get innerHTML() {
      return this.html;
    },
    querySelector: () => null,
    contains: () => false,
  };
  const marks = createMarks({ notes: { say() {} }, storage: memStorage() });
  const atlas = createAtlas(page, null, marks);
  atlas.open(game(7));
  assert.ok(page.html.includes('atl-grid') && !page.html.includes('mk-grid'));
  const click = (tab) => listeners.click({ target: { closest: (sel) => (sel === 'button' ? { dataset: { act: 'atlas-tab', tab } } : null) } });
  click('marks');
  assert.ok(page.html.includes('mk-grid') && !page.html.includes('atl-grid'));
  click('finds');
  assert.ok(page.html.includes('atl-grid'));
  assert.equal(atlas.key('ArrowRight'), true);
  assert.ok(page.html.includes('mk-grid'));
  assert.equal(atlas.key('Escape'), false, 'Esc on the marks tab closes the atlas (the hud does it)');
  assert.equal(atlas.key('Enter'), false);
  assert.equal(atlas.key('ArrowLeft'), true);
  assert.ok(page.html.includes('atl-grid'));
  assert.equal(atlas.key('KeyM'), true);
  assert.ok(page.html.includes('mk-grid'));
  assert.equal(atlas.back(), false);
  atlas.close();
  atlas.open(game(7));
  assert.ok(page.html.includes('atl-grid'), 'the atlas opens on the finds');
  // without marks there is no second tab
  const plain = createAtlas(page, null);
  plain.open(game(7));
  assert.equal(plain.key('ArrowRight'), false);
  assert.ok(!page.html.includes('atl-tabs'));
  delete globalThis.document;
});

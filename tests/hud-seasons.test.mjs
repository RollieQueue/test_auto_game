// HUD logic for seasons (S2), the lifetime atlas and the compact HUD: pure functions only, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { B } from '../src/sim/balance.js';
import { FINDS } from '../src/content/finds.js';
import { SEASONS, SEASON_RULES, calendarModel, dayWord, seasonNote, weatherNote, yearStats, yearTitle } from '../src/ui/season-logic.js';
import { buildYearPage } from '../src/ui/year.js';
import { buildHelp } from '../src/ui/help.js';
import { buildAtlas } from '../src/ui/atlas.js';
import { atlasModel } from '../src/ui/atlas-logic.js';
import { ATLAS_KEY, createAtlasStore, loadStore, mergeGame, sanitize, saveStore } from '../src/ui/atlas-store.js';
import { clockAt } from '../src/sim/clock.js';

const seasonal = (t, weather = { kind: 'clear', intensity: 0 }) => {
  const state = createState(7);
  state.flags.seasons = true;
  state.clock = clockAt(t, state.flags.firstDusk); // the clock of a new game (long first morning)
  state.weather = weather;
  return state;
};

// ---- calendar ---------------------------------------------------------------------------------------------

test('calendar: nothing without the seasons flag or a clock', () => {
  assert.equal(calendarModel(null), null);
  const state = createState(7);
  state.clock = clockAt(0, state.flags.firstDusk);
  assert.equal(calendarModel(state), null);
  state.flags.seasons = true;
  state.clock = undefined;
  assert.equal(calendarModel(state), null);
});

test('calendar: the pointer goes clockwise, 90 degrees per season, from the top', () => {
  const at = (season, frac) => {
    const state = seasonal(0);
    state.clock = { ...state.clock, seasonIndex: SEASONS.indexOf(season), season, seasonFrac: frac };
    return calendarModel(state).angle;
  };
  assert.equal(at('spring', 0), 0);
  assert.equal(at('summer', 0), 90);
  assert.equal(at('autumn', 0.5), 225);
  assert.equal(at('winter', 0), 270);
  assert.ok(at('winter', 1) <= 360);
  // the real clock: the pointer only ever moves forward within a year and wraps at the new year
  let prev = -1;
  for (let t = 0; t < B.seasonSeconds * 4; t += 7) {
    const a = calendarModel(seasonal(t)).angle;
    assert.ok(a >= prev, `angle at t=${t}`);
    assert.ok(a < 360 || t >= B.seasonSeconds * 4);
    prev = a;
  }
  assert.ok(calendarModel(seasonal(B.seasonSeconds * 4 + 1)).angle < 5);
});

test('calendar: the day is numbered from 1, the glyph follows the daylight, the weather has a word', () => {
  const start = calendarModel(seasonal(0));
  assert.equal(start.day, 1);
  assert.equal(start.name, 'Весна');
  assert.equal(start.glyph, 'sun');
  assert.equal(start.weather, 'clear');
  assert.equal(start.weatherWord, 'ясно');
  const night = B.newGameDusk + 30; // the first dusk, then 30 s: night
  assert.ok(clockAt(night, B.newGameDusk).daylight < 0.1);
  const state = seasonal(night, { kind: 'rain', intensity: 0.8 });
  const m = calendarModel(state);
  assert.equal(m.glyph, 'moon');
  assert.equal(m.word, 'ночь');
  assert.equal(m.weatherWord, 'дождь');
  assert.ok(m.title.startsWith('Весна: '));
  assert.equal(calendarModel(seasonal(B.daySeconds * 3.2)).day, 4);
  assert.equal(calendarModel(seasonal(0, { kind: 'hail', intensity: 3 })).weather, 'clear', 'unknown weather reads as clear');
  assert.equal(calendarModel(seasonal(0, { kind: 'snow', intensity: 3 })).intensity, 1);
});

test('calendar: words for the hours of the day', () => {
  assert.deepEqual([0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.85, 1.05].map(dayWord), ['ночь', 'ночь', 'утро', 'утро', 'день', 'вечер', 'ночь', 'ночь']);
  assert.equal(dayWord(-0.1), 'ночь');
});

// ---- notes: the texts must agree with the rules in balance.js -------------------------------------------------

test('season notes: one per season and accurate to balance.js', () => {
  for (const season of SEASONS) {
    const n = seasonNote(season);
    assert.equal(n.key, `season:${season}`);
    assert.ok(n.text.length <= 60, `short enough for two lines: ${n.text}`);
    assert.ok(SEASON_RULES[season].length > 10);
  }
  assert.equal(seasonNote('monsoon'), null);
  const S = B.seasons;
  assert.equal(S.autumn.spore, 3);
  assert.ok(seasonNote('autumn').text.includes('втрое') && S.autumn.mushGrow > 1);
  assert.equal(S.winter.mushGrow, 0);
  assert.equal(S.winter.spore, 0);
  assert.ok(seasonNote('winter').text.includes('не растут') && seasonNote('winter').text.includes('спор нет'));
  assert.ok(S.summer.drinkW > 1 && S.summer.regen < 1);
  assert.ok(seasonNote('summer').text.includes('воды меньше') && seasonNote('summer').text.includes('пьют больше'));
  assert.ok(S.spring.rain > 0 && S.spring.treeGrow > 1);
  assert.ok(seasonNote('spring').text.includes('дожди пополняют воду') && seasonNote('spring').text.includes('растут быстрее'));
});

test('weather notes: each kind has a note, «clear» names what ended', () => {
  assert.match(weatherNote('rain').text, /дождь/);
  assert.match(weatherNote('drought').text, /Засуха/);
  assert.match(weatherNote('snow').text, /снег/);
  assert.equal(weatherNote('clear', 'rain').text, 'Дождь кончился');
  assert.match(weatherNote('clear', 'drought').text, /Засуха отступила/);
  assert.equal(weatherNote('clear', 'snow').text, 'Снег перестал');
  assert.equal(weatherNote('clear').text, 'Небо прояснилось');
  assert.equal(weatherNote('hail'), null);
  assert.equal(new Set(['rain', 'drought', 'snow', 'clear'].map((k) => weatherNote(k).key)).size, 4);
});

// ---- year-end page ----------------------------------------------------------------------------------------------

test('year page: titles, stats and the two buttons', () => {
  assert.equal(yearTitle(0), 'Первый год позади');
  assert.equal(yearTitle(2), 'Третий год позади');
  assert.equal(yearTitle(7), 'Год 8 позади');
  const state = createState(7);
  state.res.spores = 154.7;
  state.stats.hyphaeLength = 868.6;
  state.finds = { 3: { kind: 'bone', at: 1 }, 5: { kind: 'shell', at: 2 } };
  state.world.trees[0].stage = 2;
  const s = yearStats(state);
  assert.deepEqual([s.spores, s.length, s.finds], [154, 869, 2]);
  assert.equal(s.trees.length, state.world.trees.length);
  assert.equal(s.trees[0].word, 'взрослое');
  const html = buildYearPage(state, 0);
  assert.ok(html.includes('Первый год позади'));
  for (const t of state.world.trees) assert.ok(html.includes(t.name));
  assert.ok(html.includes('data-act="year-continue"') && html.includes('data-act="restart"'));
  assert.ok(html.includes('Продолжить наблюдения') && html.includes('Новая поляна'));
});

test('help page: the seasons section only appears with the flag', () => {
  const off = buildHelp(createState(7));
  assert.ok(!off.includes('Времена года'));
  const state = createState(7);
  state.flags.seasons = true;
  const on = buildHelp(state);
  assert.ok(on.includes('Времена года'));
  for (const season of SEASONS) assert.ok(on.includes(SEASON_RULES[season]));
});

// ---- lifetime atlas -------------------------------------------------------------------------------------------

const fakeStorage = (initial) => {
  const data = new Map(initial === undefined ? [] : [[ATLAS_KEY, initial]]);
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => void data.set(k, String(v)) };
};

test('atlas store: tolerant of anything that may sit in storage', () => {
  const empty = { v: 1, kinds: {}, seen: {} };
  for (const bad of [null, undefined, 5, 'x', [], {}, { v: 2, kinds: { acorn: 1 } }, { v: 1, kinds: 'x', seen: 7 }]) {
    assert.deepEqual(sanitize(bad), empty);
  }
  const s = sanitize({ v: 1, kinds: { acorn: 2, unicorn: 4, leaf: -1, twig: 1.5, bone: '3', shell: 1 }, seen: { g1: [1, 2, 'x', -4, 2.5], g2: 'no' } });
  assert.deepEqual(s.kinds, { acorn: 2, shell: 1 });
  assert.deepEqual(s.seen, { g1: [1, 2] });
  assert.deepEqual(loadStore(fakeStorage('{not json')), empty);
  assert.deepEqual(loadStore(fakeStorage()), empty);
  assert.deepEqual(loadStore(null), empty);
  assert.deepEqual(loadStore({ getItem() { throw new Error('blocked'); } }), empty);
  assert.equal(saveStore(empty, { setItem() { throw new Error('quota'); } }), false);
  assert.equal(saveStore(empty, null), false);
  const ok = fakeStorage();
  assert.equal(saveStore({ v: 1, kinds: { acorn: 1 }, seen: {} }, ok), true);
  assert.deepEqual(loadStore(ok).kinds, { acorn: 1 });
});

test('atlas store: finds of all games add up, and the same glade is never counted twice', () => {
  const g1 = { 3: { kind: 'bone', at: 1 }, 5: { kind: 'acorn', at: 2 } };
  let r = mergeGame(null, 7, g1);
  assert.equal(r.added, 2);
  assert.deepEqual(r.store.kinds, { acorn: 1, bone: 1 });
  r = mergeGame(r.store, 7, g1); // a loaded save, or the atlas opened twice
  assert.equal(r.added, 0);
  assert.deepEqual(r.store.kinds, { acorn: 1, bone: 1 });
  r = mergeGame(r.store, 7, { ...g1, 9: { kind: 'bone', at: 3 } }); // the same glade found one more
  assert.equal(r.added, 1);
  assert.equal(r.store.kinds.bone, 2);
  r = mergeGame(r.store, 8, { 3: { kind: 'bone', at: 1 }, 4: { kind: 'ammonite', at: 1 }, 6: { kind: 'unicorn', at: 1 } }); // another glade
  assert.deepEqual(r.store.kinds, { acorn: 1, bone: 3, ammonite: 1 });
  assert.deepEqual(r.store.seen.g8, [3, 4]);
  assert.equal(mergeGame(r.store, 8, null).added, 0);
});

test('atlas store: only the newest glades are remembered in `seen`, the counts stay', () => {
  let store = null;
  for (let seed = 1; seed <= 70; seed++) store = mergeGame(store, seed, { 1: { kind: 'leaf', at: 0 } }).store;
  assert.equal(store.kinds.leaf, 70);
  const glades = Object.keys(store.seen);
  assert.equal(glades.length, 60);
  assert.equal(glades.at(-1), 'g70');
  assert.ok(!glades.includes('g1') && glades.includes('g11'));
  // a glade seen again keeps its place in the newest end
  store = mergeGame(store, 11, { 1: { kind: 'leaf', at: 0 }, 2: { kind: 'twig', at: 0 } }).store;
  assert.equal(Object.keys(store.seen).at(-1), 'g11');
  assert.equal(store.kinds.twig, 1);
});

test('atlas store: the HUD handle persists, picks up other tabs, and survives a blocked storage', () => {
  const storage = fakeStorage(JSON.stringify({ v: 1, kinds: { acorn: 2 }, seen: { g99: [1, 2] } }));
  const handle = createAtlasStore(storage);
  assert.deepEqual(handle.kinds(), { acorn: 2 });
  const state = createState(7);
  const bone = state.world.decor.find((d) => d.type === 'bone');
  state.finds = { [bone.id]: { kind: 'bone', at: 1 } };
  assert.equal(handle.sync(state), 1);
  assert.equal(handle.sync(state), 0);
  assert.deepEqual(JSON.parse(storage.data.get(ATLAS_KEY)).kinds, { acorn: 2, bone: 1 });
  storage.data.set(ATLAS_KEY, JSON.stringify({ v: 1, kinds: { acorn: 5, leaf: 1 }, seen: {} }));
  assert.deepEqual(handle.kinds(), { acorn: 5, leaf: 1 }, 'a second tab wrote to the storage');
  // storage that refuses everything: the session still remembers
  const blocked = createAtlasStore({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.equal(blocked.sync(state), 1);
  assert.deepEqual(blocked.kinds(), { bone: 1 });
  assert.equal(createAtlasStore(null).sync(state), 1, 'no storage at all');
});

test('atlas model: kinds found in other games count, the current glade is marked', () => {
  const state = createState(42);
  const pebble = state.world.decor.find((d) => d.type === 'pebble');
  state.finds = { [pebble.id]: { kind: 'pebble', at: 1 } };
  const now = atlasModel(state);
  assert.equal(now.kinds, 1);
  const life = atlasModel(state, {}, { acorn: 2, pebble: 1, ammonite: 1 });
  assert.equal(life.kinds, 3);
  assert.equal(life.hereKinds, 1);
  assert.equal(life.progress, 'найдено 3 из 11 видов');
  const by = (kind) => life.entries.find((e) => e.kind === kind);
  assert.deepEqual([by('acorn').discovered, by('acorn').here, by('acorn').ever], [true, false, 2]);
  assert.deepEqual([by('pebble').discovered, by('pebble').here, by('pebble').ever], [true, true, 1]);
  assert.deepEqual([by('leaf').discovered, by('leaf').ever], [false, 0]);
  // the lifetime count is never below what this game found
  assert.equal(atlasModel(state, {}, { pebble: 0 }).entries.find((e) => e.kind === 'pebble').ever, 1);
  assert.equal(life.gladeKinds, new Set(state.world.decor.map((d) => d.type)).size);
});

test('atlas page: lifetime counts and a mark for this glade; the old two-argument call is unchanged', () => {
  const state = createState(42);
  const shell = state.world.decor.find((d) => d.type === 'shell');
  state.finds = { [shell.id]: { kind: 'shell', at: 1 } };
  const plain = buildAtlas(state, {});
  assert.ok(plain.includes('найдено 1 из 11 видов') && !plain.includes('в тетради'));
  const html = buildAtlas(state, {}, { shell: 3, ammonite: 1, acorn: 2 });
  assert.ok(html.includes('найдено 3 из 11 видов'));
  assert.ok(html.includes(FINDS.ammonite.name) && html.includes(FINDS.ammonite.note), 'a kind from another game is shown in full');
  assert.equal((html.match(/class="atl-here-mark"/g) || []).length, 1, 'only the shell is marked as found here');
  assert.ok(html.includes('в тетради: 3') && html.includes('в тетради: 1') && html.includes('в тетради: 2'));
  assert.ok(html.includes('на этой поляне найдено 1 из'));
  assert.equal((html.match(/class="atl-entry /g) || []).length, 11);
});

// World generator versions and saves. A save made before the generator got a version (no `gen` field) is a generator-1 save: it
// rebuilds its glade with exactly the v1 rules and loads unchanged; a generator-2 save keeps its glade the same way. A new game is generator 3 and says so in its save.
//
// The fixtures in tests/fixtures/ were written by the code of commit b9fe632, i.e. BEFORE the generator version existed
// (playBot + encodeState, see gen1-index.json for what each one is): their payloads have no `gen`, and the index pins what that
// code generated for each seed (a hash of the whole world, the trees, stumps, pockets, the spore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import * as persist from '../src/persist.js';
import { GEN, GENERATIONS, generateWorld } from '../src/world/generate.js';
import { SAVE_VERSION, decodeState, encodeState, validatePayload, worldFingerprint } from '../src/persist-codec.js';
import { DT, playBot } from './bot.mjs';

const dir = new URL('./fixtures/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('gen1-index.json', dir), 'utf8'));
const load = (file) => JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
const sha = (obj) => createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
const round1 = (v) => +v.toFixed(1);

/** What the generator makes and nothing the game changes later: the geometry of a glade. */
function geometry(w) {
  return {
    seed: w.seed, biome: w.biome, name: w.name, terrain: w.terrain, ground: w.ground, origin: w.origin, rocks: w.rocks, decor: w.decor,
    horizons: w.horizons, stumps: w.stumps,
    water: w.water.map(({ amount, ...d }) => d),
    minerals: w.minerals.map(({ amount, ...d }) => d),
    trees: w.trees.map(({ stage, growth, health, linked, infection, mantle, lost, ...t }) => t),
  };
}

test('the fixtures are what they claim: made by the code before the generator version, one per biome', () => {
  assert.equal(index.saves.length, 4);
  assert.deepEqual(index.saves.map((s) => s.biome).sort(), ['birch', 'mixed', 'oak', 'pine']);
  for (const s of index.saves) {
    const p = load(s.file);
    assert.equal('gen' in p, false, `${s.file} has no generator version: it was written before there was one`);
    assert.equal(p.v, 1);
    assert.equal(p.seed, s.seed);
    assert.equal(p.wf, s.wf);
  }
  assert.ok(index.saves.some((s) => s.rival), 'one has the honey fungus under way');
});

for (const fx of index.saves) {
  test(`a generator-1 save (${fx.biome}, seed ${fx.seed}, made at ${fx.savedAt} s) loads unchanged: same fingerprint, trees, stumps and pockets`, () => {
    const p = load(fx.file);
    assert.doesNotThrow(() => validatePayload(p));
    const state = decodeState(p);
    // the world is the v1 world of that seed, the very one the old code generated
    assert.equal(state.world.gen, 1);
    assert.equal(worldFingerprint(state.world), fx.wf, 'same fingerprint as in the save');
    const fresh = generateWorld(fx.seed, 1);
    const { gen, ...rest } = fresh;
    assert.equal(sha(rest), fx.world, 'generator 1 still builds exactly what the code of b9fe632 built (hash of the whole world)');
    assert.deepEqual(geometry(state.world), geometry(fresh), 'the loaded glade is the v1 glade');
    assert.deepEqual(fresh.trees.map((t) => [t.species, round1(t.x), t.stage]), fx.trees, 'trees');
    assert.deepEqual(fresh.stumps.map((s) => [round1(s.x), round1(s.r)]), fx.stumps, 'stumps');
    assert.deepEqual(fresh.water.map((w) => [round1(w.x), round1(w.y), w.max]), fx.water, 'water pockets');
    assert.deepEqual([round1(fresh.origin.x), round1(fresh.origin.y)], fx.origin, 'the spore');
    // and what was saved is what comes back
    assert.equal(state.seed, p.seed);
    assert.equal(state.time, p.time);
    assert.equal(state.net.nodes.length, p.net.x.length);
    assert.equal(state.net.links.length, p.net.links.length);
    assert.equal(state.mushrooms.length, p.mushrooms.length);
    assert.equal(Boolean(state.rival), Boolean(fx.rival));
    state.world.trees.forEach((t, i) => assert.deepEqual([t.stage, t.growth, t.health], p.trees[i].slice(0, 3)));
  });

  test(`... and goes on playing: the ${fx.biome} save runs a minute and saves again as a generator-1 save, bit for bit`, () => {
    const state = decodeState(load(fx.file));
    state.phase = 'playing';
    const again = decodeState(JSON.parse(JSON.stringify(encodeState(state))));
    assert.deepEqual(encodeState(again), encodeState(state), 'saving a loaded v1 game and loading it again changes nothing');
    assert.equal(encodeState(state).gen, 1, 'a v1 glade is saved as generator 1');
    for (let i = 0; i < 60 / DT; i++) {
      sim.updateSim(state, DT);
      state.time += DT;
      state.events.length = 0;
    }
    assert.ok(state.time > fx.savedAt + 59);
    const later = encodeState(state);
    assert.equal(later.gen, 1);
    assert.equal(later.wf, fx.wf, 'the fingerprint of the glade does not move');
    assert.doesNotThrow(() => decodeState(JSON.parse(JSON.stringify(later))));
  });
}

test('a generator-1 save in storage is offered by the title page and continues (persist.js, the way the game loads it)', () => {
  const data = new Map();
  const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => void data.set(k, String(v)), removeItem: (k) => void data.delete(k) };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    persist.clearSave();
    for (const fx of index.saves) {
      data.set(persist.SAVE_KEY, readFileSync(new URL(fx.file, dir), 'utf8'));
      assert.equal(persist.hasSave(), true, fx.file);
      const state = persist.loadSave();
      assert.ok(state, `${fx.file} loads`);
      assert.equal(state.world.gen, 1);
      assert.equal(state.seed, fx.seed);
    }
  } finally {
    delete globalThis.localStorage;
  }
});

test('a new game is generator 3 and its save says so; it comes back as the same glade', () => {
  assert.equal(GEN, 3);
  assert.deepEqual(GENERATIONS, [1, 2, 3]);
  const { state } = playBot(42, { maxSeconds: 60, threats: true, seasons: true });
  assert.equal(state.world.gen, 3);
  const p = JSON.parse(JSON.stringify(encodeState(state)));
  assert.equal(p.gen, 3);
  assert.equal(p.v, SAVE_VERSION);
  const back = decodeState(p);
  assert.equal(back.world.gen, 3);
  assert.equal(back.world.opening, state.world.opening, 'the opening kind is rebuilt from the seed');
  assert.deepEqual(geometry(back.world), geometry(generateWorld(42, 3)));
  assert.equal(worldFingerprint(back.world), p.wf);
  assert.deepEqual(encodeState(back), encodeState(state));
  // a fresh random seed gives another glade, again generator 3 («Новая поляна» takes createState(seed) with the default generator)
  for (const seed of [123456789, 987654321, 31337]) assert.equal(createState(seed).world.gen, 3);
  assert.notEqual(worldFingerprint(createState(123456789).world), worldFingerprint(createState(987654321).world));
  // the glade of the same seed differs between the generators, so the fingerprint does tell them apart
  for (const seed of [7, 13, 23, 42]) assert.notEqual(worldFingerprint(generateWorld(seed, 1)), worldFingerprint(generateWorld(seed, 2)), `seed ${seed}`);
  for (const seed of [7, 13, 23, 42]) assert.notEqual(worldFingerprint(generateWorld(seed, 2)), worldFingerprint(generateWorld(seed, 3)), `seed ${seed}`);
});

test('the version of the save format stays 1: the new field is optional, and a glade of another generator is refused by its fingerprint', () => {
  assert.equal(SAVE_VERSION, 1);
  const { state } = playBot(7, { maxSeconds: 40, threats: true });
  const v2 = JSON.parse(JSON.stringify(encodeState(state)));
  // an older build ignores `gen`, rebuilds the v1 glade of the seed and finds another fingerprint: it refuses the save instead of playing a wrong glade
  const stripped = { ...v2 };
  delete stripped.gen;
  assert.doesNotThrow(() => validatePayload(stripped), 'valid on its face');
  assert.throws(() => decodeState(stripped), /world differs/);
  // and a v1 save that claims generator 2 is just as wrong
  const v1 = load(index.saves[0].file);
  assert.throws(() => decodeState({ ...v1, gen: 2 }), /world differs/);
  // a generator this build does not know, or a garbled one
  for (const gen of [0, 4, 1.5, '2', null, true, [2]]) assert.throws(() => validatePayload({ ...v2, gen }), /save: world generator/, `gen ${JSON.stringify(gen)}`);
  assert.throws(() => decodeState({ ...v2, gen: 4 }), /save: world generator/);
  // a glade is only rebuilt by the generator it was made with: the same save claiming another one is refused
  assert.throws(() => decodeState({ ...v2, gen: 2 }), /world differs/);
  // gen 1 stated outright is the same as no gen at all
  assert.deepEqual(geometry(decodeState({ ...v1, gen: 1 }).world), geometry(decodeState(v1).world));
});

// ---- generator 2: the glades made before generator 3 keep their generator --------------------------------------------------

const gen2 = JSON.parse(readFileSync(new URL('gen2-index.json', dir), 'utf8'));

for (const fx of gen2.saves) {
  test(`a generator-2 save (seed ${fx.seed}, made at ${fx.savedAt} s) keeps its glade: gen 2 stays gen 2, the same fingerprint, and it plays on`, () => {
    const p = load(fx.file);
    assert.equal(p.gen, 2);
    assert.doesNotThrow(() => validatePayload(p));
    const state = decodeState(p);
    assert.equal(state.world.gen, 2, 'the save keeps the generator it was made with');
    assert.equal(state.world.opening, undefined, 'a v2 glade has no kind of opening');
    assert.equal(worldFingerprint(state.world), fx.wf);
    assert.deepEqual(geometry(state.world), geometry(generateWorld(fx.seed, 2)));
    // it is not the glade generator 3 builds for the seed, and a save that claims generator 3 is refused
    assert.notEqual(worldFingerprint(generateWorld(fx.seed, 3)), fx.wf);
    assert.throws(() => decodeState({ ...p, gen: 3 }), /world differs/);
    // the save saves again as generator 2 and the game goes on
    assert.equal(encodeState(state).gen, 2);
    for (let i = 0; i < 600; i++) sim.updateSim(state, DT);
    assert.equal(state.world.gen, 2);
    assert.equal(encodeState(state).gen, 2);
  });
}

test('the worlds of generators 1 and 2 never change: hashes written by the code before generator 3 (27 seeds each)', () => {
  const entries = Object.entries(gen2.hashes);
  assert.equal(entries.length, 54);
  for (const [key, hash] of entries) {
    const [gen, seed] = key.split(':').map(Number);
    assert.equal(sha(generateWorld(seed, gen)), hash, `generator ${gen}, seed ${seed}`);
  }
});

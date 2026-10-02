// Per-biome soil look: the look data, and the pure layout of the soil's small features (render/soil-look.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HORIZONS, generateWorld } from '../src/world/generate.js';
import { BIOMES, BIOME_IDS } from '../src/world/biomes.js';
import { hash32 } from '../src/core/rng.js';
import { sampleProfile } from '../src/world/query.js';
import { FEATURE_KINDS, soilFeatures, soilLookOf } from '../src/render/soil-look.js';

const HORIZON_IDS = HORIZONS.map((h) => h.id);
const HEX = /^#[0-9a-f]{6}$/i;
const EXT = { x0: 0, x1: 1920 };

/** First few seeds of each biome. */
const seedsOf = (biome, n = 4) => {
  const out = [];
  for (let s = 1; out.length < n && s < 400; s++) if (generateWorld(s).biome === biome) out.push(s);
  return out;
};
const SEEDS = Object.fromEntries(BIOME_IDS.map((id) => [id, seedsOf(id)]));
const kindsOf = (id) => new Set(BIOMES[id].look.features.map((f) => f.kind));
const digest = (w) => hash32(JSON.stringify(w));

test('every biome has look data, and its colours, fractions and features are well formed', () => {
  for (const id of BIOME_IDS) {
    const look = BIOMES[id].look;
    assert.ok(look, `${id}: look`);
    for (const [hid, layer] of Object.entries(look.layers)) {
      assert.ok(HORIZON_IDS.includes(hid), `${id}: layer ${hid} is a horizon`);
      assert.match(layer.color, HEX, `${id}.${hid} colour`);
      for (const a of layer.accents || []) assert.match(a, HEX, `${id}.${hid} accent`);
      for (const t of layer.tones || []) {
        assert.match(t.color, HEX);
        assert.ok(t.from >= 0 && t.to <= 1 && t.from < t.to, `${id}.${hid} tone fractions ${t.from}..${t.to}`);
        assert.ok(t.alpha > 0 && t.alpha <= 1);
      }
    }
    for (const k of ['sand', 'specks', 'hatch', 'pebbles', 'strata', 'cracks', 'fibres', 'humusFibres']) {
      assert.ok(look.grain[k] >= 0 && look.grain[k] <= 4, `${id}: grain.${k}`);
    }
    for (const c of look.stones) assert.match(c, HEX);
    for (const f of look.features) {
      assert.ok(FEATURE_KINDS.includes(f.kind), `${id}: kind ${f.kind}`);
      assert.ok(HORIZON_IDS.includes(f.in), `${id}: feature in ${f.in}`);
      assert.ok((f.density > 0) !== !!f.count, `${id}.${f.kind}: exactly one of density and count`);
      if (f.count) assert.ok(f.count[0] >= 0 && f.count[0] <= f.count[1]);
      if (f.y) assert.ok(f.y[0] >= 0 && f.y[1] <= 1 && f.y[0] < f.y[1], `${id}.${f.kind}: y fractions`);
      for (const c of f.tones || []) assert.match(c, HEX);
    }
  }
});

test('each biome looks different: its own colours and its own signature features', () => {
  const sig = JSON.stringify;
  for (let i = 0; i < BIOME_IDS.length; i++) {
    for (let j = i + 1; j < BIOME_IDS.length; j++) {
      const a = BIOMES[BIOME_IDS[i]].look;
      const b = BIOMES[BIOME_IDS[j]].look;
      assert.notEqual(sig(a), sig(b), `${BIOME_IDS[i]} vs ${BIOME_IDS[j]}`);
      // not only a tweak: at least three of the four soil horizons are painted in other colours
      const differs = ['humus', 'loam', 'clay', 'litter'].filter((h) => a.layers[h].color !== b.layers[h].color).length;
      assert.ok(differs >= 3, `${BIOME_IDS[i]} vs ${BIOME_IDS[j]}: ${differs} horizons differ in colour`);
      // and the set of features differs
      assert.notDeepEqual([...kindsOf(BIOME_IDS[i])].sort(), [...kindsOf(BIOME_IDS[j])].sort());
    }
  }
  // the pedology each glade is named for
  assert.ok(kindsOf('pine').has('needle') && kindsOf('pine').has('tongue') && kindsOf('pine').has('stone'));
  assert.ok(kindsOf('oak').has('krot') && kindsOf('oak').has('nodule') && kindsOf('oak').has('cast') && kindsOf('oak').has('channel'));
  assert.ok(kindsOf('birch').has('gley') && kindsOf('birch').has('rust') && kindsOf('birch').has('damp'));
  assert.ok(kindsOf('mixed').has('lens') && kindsOf('mixed').has('stone'));
  for (const k of ['krot', 'nodule']) assert.ok(!kindsOf('pine').has(k) && !kindsOf('birch').has(k) && !kindsOf('mixed').has(k), k);
  assert.ok(!kindsOf('oak').has('gley') && !kindsOf('pine').has('gley') && !kindsOf('mixed').has('gley'));
  assert.ok(!kindsOf('pine').has('lens') && !kindsOf('oak').has('lens') && !kindsOf('birch').has('lens'));
  // podzol: an ash-grey E under the litter (red low, little saturation) over a rusty B (red clearly above blue)
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [er, eg, eb] = rgb(BIOMES.pine.look.layers.humus.color);
  assert.ok(Math.max(er, eg, eb) - Math.min(er, eg, eb) < 40, 'the E horizon is grey');
  const [br, , bb] = rgb(BIOMES.pine.look.layers.loam.color);
  assert.ok(br - bb > 60, 'the B horizon is rusty');
  // oak: the darkest humus of the four
  const lum = (c) => rgb(c).reduce((s, v) => s + v, 0);
  for (const id of ['birch', 'pine', 'mixed']) assert.ok(lum(BIOMES.oak.look.layers.humus.color) < lum(BIOMES[id].look.layers.humus.color), `oak humus darker than ${id}`);
});

test('soilLookOf follows the world biome, and falls back to the mixed look', () => {
  for (const id of BIOME_IDS) assert.equal(soilLookOf({ biome: id }), BIOMES[id].look);
  assert.equal(soilLookOf({ biome: 'nowhere' }), BIOMES.mixed.look);
  assert.equal(soilLookOf(null), BIOMES.mixed.look);
});

test('the soil features are deterministic per seed and differ between seeds', () => {
  for (const id of BIOME_IDS) {
    const [s1, s2] = SEEDS[id];
    const a = soilFeatures(generateWorld(s1), EXT);
    const b = soilFeatures(generateWorld(s1), EXT);
    assert.ok(a.length > 50, `${id}: ${a.length} features`);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, soilFeatures(generateWorld(s2), EXT));
    // a wider view only adds features; the span of the world keeps its own
    assert.deepEqual(soilFeatures(generateWorld(s1)), soilFeatures(generateWorld(s1), { x0: 0, x1: generateWorld(s1).width }));
  }
});

test('laying out the soil does not touch the world or its generation stream', () => {
  for (const id of BIOME_IDS) {
    for (const seed of SEEDS[id].slice(0, 2)) {
      const w = generateWorld(seed);
      const before = digest(w);
      const sample = digest(generateWorld(seed));
      assert.equal(before, sample);
      soilFeatures(w, EXT);
      soilFeatures(w, { x0: -200, x1: 2100 });
      assert.equal(digest(w), before, `seed ${seed}: the world is not changed by the soil layout`);
      assert.equal(digest(generateWorld(seed)), before, `seed ${seed}: generating after the layout gives the same world`);
    }
  }
});

test('the soil features are inside their horizon, in range, and the signature kinds appear', () => {
  for (const id of BIOME_IDS) {
    for (const seed of SEEDS[id]) {
      const w = generateWorld(seed);
      const feats = soilFeatures(w, EXT);
      const kinds = new Set(feats.map((f) => f.kind));
      for (const k of kindsOf(id)) assert.ok(kinds.has(k), `seed ${seed} (${id}): has ${k}`);
      for (const k of kinds) assert.ok(kindsOf(id).has(k), `seed ${seed} (${id}): ${k} is not in the look`);
      for (const f of feats) {
        const at = `seed ${seed} ${id}.${f.kind}`;
        assert.ok(FEATURE_KINDS.includes(f.kind));
        for (const v of [f.x, f.y]) assert.ok(Number.isFinite(v), at);
        assert.ok(f.x >= EXT.x0 && f.x <= EXT.x1, `${at}: x ${f.x}`);
        const top = sampleProfile(w.horizons[f.band].top, w.step, f.x);
        const bot = f.band + 1 < w.horizons.length ? sampleProfile(w.horizons[f.band + 1].top, w.step, f.x) : w.height;
        assert.ok(f.y >= top - 1e-6 && f.y <= bot + 1e-6, `${at}: y ${f.y} in ${top}..${bot}`);
        for (const key of ['rx', 'ry', 'r', 'w', 'h', 'len']) if (key in f) assert.ok(f[key] > 0 && f[key] < 400, `${at}: ${key} ${f[key]}`);
        if ('alpha' in f) assert.ok(f.alpha > 0 && f.alpha <= 1, `${at}: alpha`);
        if (f.kind === 'krot') assert.ok(f.fill === 'light' || f.fill === 'dark');
        if (f.kind === 'stone') assert.match(f.tone, HEX);
        if (f.pts) {
          assert.ok(f.pts.length >= 2);
          for (const p of f.pts) assert.ok(Number.isFinite(p.x) && p.y >= top - 1e-6 && p.y <= bot + 1e-6, `${at}: path point`);
        }
      }
    }
  }
});

test('the krotovinas of an oak glade are some round or oval cross-sections, lighter in the humus and darker in the loam', () => {
  for (const seed of SEEDS.oak) {
    const w = generateWorld(seed);
    const krots = soilFeatures(w, EXT).filter((f) => f.kind === 'krot');
    assert.ok(krots.length >= 5, `seed ${seed}: ${krots.length} krotovinas`);
    for (const k of krots) {
      assert.ok(k.rx / k.ry < 3 && k.ry / k.rx < 3, 'round or oval, not a streak');
      assert.equal(k.fill, w.horizons[k.band].id === 'humus' ? 'light' : 'dark');
    }
  }
});

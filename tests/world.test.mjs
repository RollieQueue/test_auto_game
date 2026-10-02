import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CROWN_HALF, GEN, HORIZONS, MIN_TRUNK_GAP, TREE_X, buildWorld, generateWorld, trunkRange } from '../src/world/generate.js';
import { BIOMES, BIOME_IDS, TERRAIN_FEATURES } from '../src/world/biomes.js';
import { FAIR, FAIR_V2, checkFairness } from '../src/world/fairness.js';
import { costAt, groundYAt, horizonIndexAt, rockAt } from '../src/world/query.js';
import { distToPolyline, pointInPolygon } from '../src/core/geom.js';

// Both world generators are tested: 1 is what saves made before «старт с задачкой» rebuild with, 2 is what a new game gets
// (tests/world-gen2.test.mjs has the checks that belong to 2 alone).
const GENS = [1, 2];
const SEEDS = Array.from({ length: 220 }, (_, i) => i + 1).concat([1234, 4242, 99991, 2024, 31337, 7777777]);
const worlds = new Map();
const worldOf = (seed, gen = GEN) => {
  const key = `${gen}:${seed}`;
  if (!worlds.has(key)) worlds.set(key, generateWorld(seed, gen));
  return worlds.get(key);
};
const outlineDist = (x, y, poly) => (pointInPolygon(x, y, poly) ? 0 : distToPolyline(x, y, [...poly, poly[0]]));
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const humusSpan = (w) => w.horizons[2].depth - w.horizons[1].depth;

for (const gen of GENS) {
test(`world generation v${gen} is deterministic for a seed`, () => {
  assert.deepEqual(generateWorld(42, gen), generateWorld(42, gen));
  assert.deepEqual(generateWorld(1234, gen), generateWorld(1234, gen));
  assert.notDeepEqual(generateWorld(42, gen).rocks, generateWorld(43, gen).rocks);
  assert.equal(generateWorld(42, gen).gen, gen, 'the world says which generator made it');
});

test(`world invariants (generator v${gen}) over ${SEEDS.length} seeds`, () => {
  const F = gen === 1 ? FAIR : FAIR_V2;
  for (const seed of SEEDS) {
    const w = worldOf(seed, gen);
    const at = `v${gen} seed ${seed} (${w.biome}, ${w.terrain})`;
    const biome = BIOMES[w.biome];
    assert.ok(biome, `${at}: known biome`);
    assert.ok(w.terrain in TERRAIN_FEATURES, `${at}: known terrain`);
    assert.ok(/^[А-ЯЁ][а-яё]+(?: [а-яё]+)+$/.test(w.name) || /^[А-ЯЁ][а-яё]+ [А-ЯЁа-яё ]+$/.test(w.name), `${at}: name «${w.name}»`);
    assert.ok(biome.bases.some((b) => w.name.startsWith(b)), `${at}: name «${w.name}» starts with a base of the biome`);
    assert.ok(TERRAIN_FEATURES[w.terrain].some((f) => w.name.endsWith(f)), `${at}: name «${w.name}» ends with a feature of the terrain`);

    // trees: 2-5, spread, spaced, young, at most one full-grown
    assert.ok(w.trees.length >= 2 && w.trees.length <= 5, `${at}: ${w.trees.length} trees`);
    assert.ok(w.trees.length >= biome.trees.counts[0][0] - 1 && w.trees.length <= biome.trees.counts.at(-1)[0], `${at}: tree count fits the biome`);
    w.trees.forEach((t, i) => {
      assert.equal(t.id, i);
      assert.ok(t.x >= TREE_X[0] - 0.01 && t.x <= TREE_X[1] + 0.01, `${at}: trunk x ${t.x}`);
      assert.ok(t.x >= trunkRange(t.species)[0] - 0.01 && t.x <= trunkRange(t.species)[1] + 0.01, `${at}: ${t.species} crown clear of the HUD cards`);
      assert.ok(Math.abs(t.baseY - groundYAt(w, t.x)) < 1e-6);
      assert.ok(t.stage >= 0 && t.stage <= 3);
      assert.ok(t.roots.some((r) => r.minStage <= t.stage), `${at}: every tree has visible roots`);
      assert.ok(t.tips.some((p) => p.minStage <= t.stage), `${at}: every tree has active root tips`);
      if (i > 0) {
        const p = w.trees[i - 1];
        const gap = t.x - p.x;
        assert.ok(gap >= Math.max(MIN_TRUNK_GAP, 0.6 * (CROWN_HALF[p.species] + CROWN_HALF[t.species])) - 0.01, `${at}: trunks ${i - 1} and ${i} are ${gap} apart`);
      }
    });
    assert.ok(w.trees.filter((t) => t.stage === 3).length <= 1, `${at}: at most one full-grown tree`);
    assert.ok(w.trees.some((t) => t.stage <= 2));
    const species = new Set(w.trees.map((t) => t.species));
    if (biome.trees.dominant) {
      const share = w.trees.filter((t) => t.species === biome.trees.dominant).length / w.trees.length;
      assert.ok(share >= 0.6 - 1e-9, `${at}: ${biome.trees.dominant} share ${share}`);
    } else assert.ok(species.size >= 2, `${at}: a mixed forest has several species`);
    if (w.trees.length >= 3) assert.ok(w.trees.at(-1).x - w.trees[0].x >= 400, `${at}: trees are spread`);

    // soil
    assert.deepEqual(w.horizons.map((h) => h.id), HORIZONS.map((h) => h.id));
    for (let i = 1; i < w.horizons.length; i++) {
      assert.ok(w.horizons[i].depth >= w.horizons[i - 1].depth + 14, `${at}: nominal depths grow`);
      w.horizons[i].top.forEach((y, k) => assert.ok(y >= w.horizons[i - 1].top[k] + 10 - 1e-9, `${at}: horizons are ordered with a gap`));
    }
    w.horizons[0].top.forEach((y, k) => assert.equal(y, w.ground[k]));
    assert.ok(Math.min(...w.ground) >= 262 && Math.max(...w.ground) <= 362, `${at}: ground inside the playable band`);
    assert.equal(horizonIndexAt(w, 500, groundYAt(w, 500) - 5), -1);

    // rocks, deposits, curiosities
    assert.ok(w.rocks.filter((r) => !r.boulder).length <= biome.rocks.count[1]); // v2 may add one boulder on top
    assert.ok(w.water.length === biome.water.plan.length, `${at}: ${w.water.length} water pockets`);
    assert.ok(w.minerals.length === biome.minerals.length, `${at}: ${w.minerals.length} mineral deposits`);
    assert.ok(w.water.length >= 4 && w.minerals.length >= 4, 'enough to play with');
    for (const d of [...w.water, ...w.minerals]) {
      assert.equal(rockAt(w, d.x, d.y), null, `${at}: deposits are not inside rocks`);
      assert.ok(d.y > groundYAt(w, d.x), `${at}: deposits are underground`);
      assert.ok(d.y < w.height && d.x > 0 && d.x < w.width);
    }
    assert.equal(w.minerals[0].kind, 'nitrogen');
    assert.ok(w.decor.length >= 8 && w.decor.length <= 18, `${at}: ${w.decor.length} curiosities`);
    for (const c of w.decor) {
      assert.equal(rockAt(w, c.x, c.y), null);
      assert.ok(c.y > groundYAt(w, c.x));
    }

    // the spore: between the trunks, off the edges, in free soil
    const o = w.origin;
    assert.ok(o.x >= F.edge && o.x <= w.width - F.edge, `${at}: origin x ${o.x}`);
    assert.ok(Math.min(...w.trees.map((t) => Math.abs(t.x - o.x))) >= F.trunkGap, `${at}: the spore is not under a trunk`);
    assert.ok(Number.isFinite(costAt(w, o.x, o.y)), `${at}: origin is passable`);
    assert.ok(o.y - groundYAt(w, o.x) > 40);
    // v1 keeps its rocks a rock's radius + 100 from the spore; v2 may lay a boulder nearer (62 u of soil around the spore's ring), so it is judged by the outline
    for (const r of w.rocks) {
      if (gen === 1) assert.ok(Math.hypot(r.x - o.x, r.y - o.y) > r.r + 100, `${at}: rocks keep clear of the spore`);
      else assert.ok(outlineDist(o.x, o.y, r.poly) >= 60, `${at}: rock ${r.id} keeps clear of the spore`);
    }

    // fairness: the opening is winnable
    const fair = checkFairness(w);
    assert.ok(fair.ok, `${at}: ${fair.problems.join('; ')}`);
    assert.equal(w.fallback, undefined, `${at}: no fallback`);
    if (gen === 1) assert.ok(fair.water <= FAIR.waterCost && fair.tip <= FAIR.tipCost && fair.nitrogen <= FAIR.nitrogenCost);
  }
});

test(`the generator v${gen} rarely needs a rebuild to be fair`, () => {
  let first = 0;
  for (const seed of SEEDS.slice(0, 120)) if (checkFairness(buildWorld(seed, 0, gen)).ok) first++;
  // v2 asks more of a glade (a first tree a walk away, a stump in sight, a wide clearing): about a third of the first builds are fair, and 80 attempts are made
  const least = gen === 1 ? 0.5 : 0.2;
  assert.ok(first >= 120 * least, `only ${first} of 120 first builds were fair`);
});

test(`glades differ (generator v${gen}): biomes, trees, positions, spore and names vary across 60 seeds`, () => {
  const ws = Array.from({ length: 60 }, (_, i) => worldOf(i + 1, gen));
  const biomes = {};
  for (const w of ws) biomes[w.biome] = (biomes[w.biome] || 0) + 1;
  assert.deepEqual(Object.keys(biomes).sort(), [...BIOME_IDS].sort(), 'all biomes appear');
  for (const id of BIOME_IDS) assert.ok(biomes[id] >= 6, `${id} appears ${biomes[id]} times`);
  const counts = new Set(ws.map((w) => w.trees.length));
  assert.ok(counts.size >= 3, `tree counts: ${[...counts]}`);
  assert.ok(ws.some((w) => w.trees.length === 2) && ws.some((w) => w.trees.length >= 4));
  const compositions = new Set(ws.map((w) => w.trees.map((t) => t.species[0]).join('')));
  assert.ok(compositions.size >= 25, `${compositions.size} species compositions`);
  const layouts = new Set(ws.map((w) => w.trees.map((t) => Math.round(t.x / 40)).join(',')));
  // v2 lays out a wide clearing for the spore, which leaves the trunks less room to move: fewer distinct layouts at this rounding
  assert.ok(layouts.size >= (gen === 1 ? 50 : 30), `${layouts.size} trunk layouts`);
  assert.ok(new Set(ws.flatMap((w) => w.trees.map((t) => t.species))).size === 3);
  assert.ok(new Set(ws.flatMap((w) => w.trees.map((t) => t.stage))).size >= 3, 'stages vary');
  const xs = ws.map((w) => w.origin.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) >= 600, `origin x spread ${Math.min(...xs)}..${Math.max(...xs)}`);
  const firstTreeX = ws.map((w) => w.trees[0].x);
  assert.ok(Math.max(...firstTreeX) - Math.min(...firstTreeX) >= 300, 'the first trunk moves around');
  assert.ok(new Set(ws.map((w) => w.name)).size >= 40, `${new Set(ws.map((w) => w.name)).size} names`);
  assert.ok(new Set(ws.map((w) => w.terrain)).size >= 5, 'ground shapes vary');
  const relief = ws.map((w) => Math.max(...w.ground) - Math.min(...w.ground));
  assert.ok(Math.max(...relief) - Math.min(...relief) >= 30, 'some ground is flat, some is not');
  assert.ok(new Set(ws.map((w) => w.horizons[2].depth)).size >= 40, 'soil depths vary');
});

test(`biomes have their own character (generator v${gen})`, () => {
  const by = (id) => SEEDS.filter((s) => worldOf(s, gen).biome === id).map((s) => worldOf(s, gen));
  const birch = by('birch');
  const oak = by('oak');
  const pine = by('pine');
  assert.ok(birch.length > 20 && oak.length > 20 && pine.length > 20);
  // trees follow the biome
  const share = (ws, sp) => mean(ws.map((w) => w.trees.filter((t) => t.species === sp).length / w.trees.length));
  assert.ok(share(birch, 'birch') > 0.6 && share(oak, 'oak') > 0.6 && share(pine, 'pine') > 0.6);
  // thick humus in the oak wood and the birch glade, thin and sandy under pines
  assert.ok(mean(oak.map(humusSpan)) > 150 && mean(birch.map(humusSpan)) > 140, 'deep humus');
  assert.ok(mean(pine.map(humusSpan)) < 100, 'thin humus under pines');
  assert.ok(mean(birch.map((w) => w.horizons[1].depth)) > mean(pine.map((w) => w.horizons[1].depth)) + 8, 'thick litter in the birch glade');
  assert.ok(mean(pine.map((w) => w.horizons[4].depth)) < mean(oak.map((w) => w.horizons[4].depth)) - 40, 'gravel lies shallower under pines');
  assert.ok(mean(oak.map((w) => w.horizons[4].depth - w.horizons[3].depth)) > mean(pine.map((w) => w.horizons[4].depth - w.horizons[3].depth)) + 50, 'oak soil is clayey');
  // rocks and water
  assert.ok(mean(pine.map((w) => w.rocks.length)) > mean(oak.map((w) => w.rocks.length)) + 3, 'pine soil is stony');
  assert.ok(mean(birch.map((w) => w.water.length)) > mean(pine.map((w) => w.water.length)) + 1.5, 'birch glade has more pockets');
  const depthOf = (w) => mean(w.water.map((p) => p.y - groundYAt(w, p.x)));
  assert.ok(mean(pine.map(depthOf)) > mean(birch.map(depthOf)) + 60, 'pine water lies deeper');
  const shallowWater = (w) => w.water.filter((p) => p.y - groundYAt(w, p.x) < 210).length;
  assert.ok(mean(birch.map(shallowWater)) > mean(pine.map(shallowWater)) + 1, 'birch glade has many shallow pockets');
  // minerals
  const kinds = (ws, kind) => mean(ws.map((w) => w.minerals.filter((m) => m.kind === kind).length));
  assert.ok(kinds(oak, 'nitrogen') > kinds(pine, 'nitrogen') + 1, 'the oak wood is rich in nitrogen');
  assert.ok(kinds(pine, 'phosphorus') > kinds(oak, 'phosphorus') + 1, 'pines stand on phosphorus crystals');
});
}

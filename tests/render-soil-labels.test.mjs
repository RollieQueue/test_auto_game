// Horizon labels per biome (world/biomes.js look.labels, render/soil-labels.js) and mushrooms drawn in clumps, not a fence
// (render/mushroom-cluster.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HORIZONS, generateWorld } from '../src/world/generate.js';
import { BIOMES, BIOME_IDS, horizonLabel } from '../src/world/biomes.js';
import { hash32 } from '../src/core/rng.js';
import { sampleProfile } from '../src/world/query.js';
import { LABEL_FONT, LABEL_INSET, cardZone, freeLabelY, labelLayout, obstacleBoxes } from '../src/render/soil-labels.js';
import { MAX_COMPANIONS, clusterOf, companionGrowth, lookOf, trunkNear } from '../src/render/mushroom-cluster.js';

const seedOf = (biome) => {
  for (let s = 1; s < 400; s++) if (generateWorld(s).biome === biome) return s;
  throw new Error(`no seed for ${biome}`);
};
const layoutOf = (world, ext, unit) => {
  const hs = world.horizons;
  const topY = (i, x) => sampleProfile(hs[i].top, world.step, x);
  const botY = (i, x) => (i + 1 < hs.length ? topY(i + 1, x) : ext.y1 + 90);
  return { labels: labelLayout(world, ext, { topY, botY, unit }), topY, botY };
};

test('every biome names every horizon it draws, in its own words', () => {
  const names = new Set();
  for (const id of BIOME_IDS) {
    const labels = BIOMES[id].look.labels;
    assert.ok(labels, `${id}: labels`);
    assert.deepEqual(Object.keys(labels).sort(), HORIZONS.map((h) => h.id).sort(), `${id}: one label per horizon`);
    for (const [hid, text] of Object.entries(labels)) {
      assert.ok(typeof text === 'string' && text.length >= 4 && text.length <= 26, `${id}.${hid}: «${text}» is short enough for the margin`);
      assert.match(text, /^[А-ЯЁ]/, `${id}.${hid}: starts with a capital`);
    }
    names.add(JSON.stringify(labels));
  }
  assert.equal(names.size, BIOME_IDS.length, 'no two biomes share one set of labels');
  // the podzol and the chernozem keep to their pedology
  assert.match(BIOMES.pine.look.labels.loam, /Иллювий/);
  assert.match(BIOMES.oak.look.labels.humus, /Чернозём/);
});

test('the world keeps its generic layer names (and generation never reads the labels)', () => {
  for (const id of BIOME_IDS) {
    const w = generateWorld(seedOf(id));
    assert.deepEqual(w.horizons.map((h) => h.name), HORIZONS.map((h) => h.name), `${id}: layer names are the world's`);
    const before = hash32(JSON.stringify(w));
    labelLayout(w, { x0: 0, y0: 0, x1: 1920, y1: 1080 }, { topY: () => 300, botY: () => 400, unit: 1 });
    assert.equal(hash32(JSON.stringify(w)), before, `${id}: the layout does not touch the world`);
    assert.equal(horizonLabel(w, w.horizons[1]), BIOMES[id].look.labels.humus);
  }
  assert.equal(horizonLabel({ biome: 'pine' }, { id: 'sky', name: 'Небо' }), 'Небо', 'an unnamed horizon keeps the layer name');
  assert.equal(horizonLabel({}, null), '');
});

test('one label per drawn horizon, inside the page, clear of the cards, at both window sizes', () => {
  for (const [w, h] of [[1280, 720], [1600, 900], [1920, 1080]]) {
    const scale = Math.min(w / 1920, h / 1080);
    const unit = 1 / scale;
    const ext = { x0: 0, y0: 0, x1: w / scale, y1: h / scale };
    const zone = cardZone(unit);
    for (const id of BIOME_IDS) {
      const world = generateWorld(seedOf(id));
      const { labels, topY, botY } = layoutOf(world, ext, unit);
      assert.equal(labels.length, world.horizons.length, `${id} ${w}x${h}: one label per horizon`);
      const font = LABEL_FONT * unit;
      labels.forEach((l, i) => {
        assert.equal(l.text, BIOMES[id].look.labels[world.horizons[i].id], `${id}: ${l.id} is named by the biome`);
        // the text (about 0.5 em per letter, italic serif) lies on the page
        const width = l.text.length * font * 0.55;
        const x0 = l.align === 'right' ? l.x - width : l.x;
        const x1 = l.align === 'right' ? l.x : l.x + width;
        assert.ok(x0 >= ext.x0 && x1 <= ext.x1, `${id} ${w}x${h} ${l.id}: «${l.text}» fits the width (${Math.round(x0)}..${Math.round(x1)})`);
        // vertically inside its own band (the litter may straddle its thin band by a line)
        const slack = i === 0 ? font : 4;
        assert.ok(l.y >= topY(i, l.x) - slack && l.y <= Math.max(botY(i, l.x), topY(i, l.x) + font) + slack, `${id} ${w}x${h} ${l.id}: y ${Math.round(l.y)} in its horizon`);
        // never under the resource card: a left-margin label starts past the ruler, below the card's bottom edge
        if (l.align === 'left') {
          assert.ok(Math.abs(l.x - (ext.x0 + LABEL_INSET * unit)) < 1e-6, `${id} ${l.id}: left column`);
          assert.ok(l.y - 12 * unit >= ext.y0 + zone.b, `${id} ${w}x${h} ${l.id}: below the resource card`);
        }
      });
      assert.ok(labels.filter((l) => l.align === 'left').length >= world.horizons.length - 1, `${id}: all but the litter in the left margin`);
    }
  }
});

test('a label slides to the next free line past a pool, a pocket and a rock', () => {
  const hs = [{ id: 'litter', name: 'Подстилка' }, { id: 'humus', name: 'Гумус' }, { id: 'loam', name: 'Суглинок' }];
  const base = { biome: 'pine', horizons: hs, water: [], minerals: [], rocks: [] };
  const ext = { x0: 0, y0: 0, x1: 1920, y1: 1080 };
  const topY = (i) => [100, 400, 800][i];
  const botY = (i) => [400, 800, 1100][i];
  const free = labelLayout(base, ext, { topY, botY, unit: 1 });
  const at = free[1];
  // a pool right under the label's first line (the playtest's «Дёрн» under a water pocket)
  const pool = { id: 0, x: at.x + 20, y: at.y, rx: 60, ry: 25 };
  const w = labelLayout({ ...base, water: [pool] }, ext, { topY, botY, unit: 1 });
  assert.ok(w[1].y > pool.y + pool.ry, `slid below the pool (${at.y} -> ${w[1].y})`);
  assert.ok(w[1].y <= botY(1) - 12, 'and stays in its band');
  assert.equal(w[1].x, at.x, 'the column does not move');
  assert.deepEqual([w[0], w[2]], [free[0], free[2]], 'the other labels stay');
  // a pocket and a rock in a row push it on past both
  const rock = { minX: at.x, maxX: at.x + 80, minY: pool.y + pool.ry + 4, maxY: pool.y + pool.ry + 40 };
  const w2 = labelLayout({ ...base, water: [pool], rocks: [rock] }, ext, { topY, botY, unit: 1 });
  assert.ok(w2[1].y > rock.maxY, `past the rock too (${w2[1].y})`);
  // no room below (a thin band): it goes above instead; no room at all: it stays where it was
  const boxes = obstacleBoxes({ water: [{ x: 100, y: 500, rx: 50, ry: 20 }] });
  assert.ok(freeLabelY(500, 60, 140, 9, boxes, 440, 520) < 500 - 20, 'up when the band ends below');
  assert.equal(freeLabelY(500, 60, 140, 9, boxes, 490, 520), 500, 'nothing fits: unchanged');
  assert.equal(freeLabelY(500, 200, 260, 9, boxes, 440, 600), 500, 'an object beside the text does not move it');
});

test('on every glade the labels clear the pools, pockets and rocks wherever the band has room', () => {
  const unit = 1.2;
  const ext = { x0: 0, y0: 0, x1: 1600 * unit, y1: 900 * unit };
  let checked = 0;
  let stuck = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const world = generateWorld(seed);
    const { labels } = layoutOf(world, ext, unit);
    const boxes = obstacleBoxes(world);
    for (const l of labels) {
      const wd = l.text.length * LABEL_FONT * 0.55 * unit;
      const x0 = l.align === 'right' ? l.x - wd : l.x;
      const hits = boxes.filter((b) => b.x0 < x0 + wd && b.x1 > x0 && b.y0 < l.y + 6 * unit && b.y1 > l.y - 6 * unit);
      checked++;
      if (hits.length) stuck++;
    }
  }
  assert.ok(checked > 200);
  assert.ok(stuck / checked < 0.02, `${stuck} of ${checked} labels still lie on an object`);
});

test('the cards of the real game stay clear of the label column (measured: 1280x720 card 372x337, 1600x900 332x302)', () => {
  assert.ok(cardZone(1.5).r >= 372 && cardZone(1.5).b >= 337);
  assert.ok(cardZone(1.2).r >= 332 && cardZone(1.2).b >= 302);
});

test('a clump is deterministic: the same seed and mushroom always give the same caps', () => {
  for (const seed of [1, 7, 13, 23, 42]) {
    for (let id = 0; id < 30; id++) {
      const a = clusterOf(seed, id);
      assert.deepEqual(clusterOf(seed, id), a, `seed ${seed} mushroom ${id}`);
    }
  }
  const sig = (seed) => JSON.stringify(Array.from({ length: 12 }, (_, id) => clusterOf(seed, id)));
  assert.notEqual(sig(1), sig(2), 'another world, another clumps');
  assert.notEqual(JSON.stringify(clusterOf(7, 0)), JSON.stringify(clusterOf(7, 1)), 'another mushroom, another clump');
});

test('a clump has none to three caps (four beside a trunk), smaller and slanting away, and the main cap is not part of it', () => {
  const counts = [0, 0, 0, 0];
  const xs = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    for (let id = 0; id < 40; id++) {
      const cl = clusterOf(seed, id);
      assert.ok(cl.length <= MAX_COMPANIONS);
      counts[cl.length]++;
      cl.forEach((c, k) => {
        assert.ok(Math.abs(c.dx) >= 15 && Math.abs(c.dx) <= 46, `dx ${c.dx}`);
        assert.ok(c.dy >= -1 && c.dy <= 2.5, `dy ${c.dy}`);
        assert.ok(c.scale >= 0.4 && c.scale <= 0.92, `scale ${c.scale}`);
        assert.ok(c.tall >= 0.86 && c.tall <= 1.2, `tall ${c.tall}`);
        assert.ok(Math.abs(c.lean) <= 0.2 && Math.sign(c.lean) === Math.sign(c.dx), `lean ${c.lean} away from the main cap (dx ${c.dx})`);
        assert.ok(c.start >= 0.12 && c.start <= 0.7, `start ${c.start}`);
        assert.equal(typeof c.mirror, 'boolean');
        assert.ok(Number.isInteger(c.salt));
        xs.add(c.dx);
        const before = cl.slice(0, k).filter((q) => Math.sign(q.dx) === Math.sign(c.dx));
        assert.ok(before.length <= 1, 'at most two caps on one side');
        for (const q of before) assert.ok(Math.abs(c.dx) > Math.abs(q.dx), 'a second cap on the same side stands further out');
      });
    }
  }
  // every size of clump occurs, none dominates (a fence is every mushroom alike)
  for (const n of counts.slice(0, 3)) assert.ok(n / 800 > 0.1, `clump sizes ${counts}`);
  assert.ok(counts[3] / 800 > 0.02 && counts[3] / 800 < 0.15, `a few threes: ${counts}`);
  assert.ok(xs.size > 200, 'offsets vary');
});

test('the clump grows in after the main cap and catches up with it', () => {
  const c = { start: 0.3 };
  assert.equal(companionGrowth(0, c), 0);
  assert.equal(companionGrowth(0.3, c), 0);
  assert.ok(companionGrowth(0.65, c) > 0 && companionGrowth(0.65, c) < 1);
  assert.equal(companionGrowth(1, c), 1);
});

test('the soil tooltip names the horizon as the margin does', async () => {
  const { describeTarget } = await import('../src/ui/tooltip.js');
  for (const id of BIOME_IDS) {
    const world = generateWorld(seedOf(id));
    for (const h of world.horizons) {
      const d = describeTarget({ world, mushrooms: [] }, { kind: 'horizon', id: h.id });
      assert.equal(d.main, BIOMES[id].look.labels[h.id], `${id}.${h.id}`);
      assert.match(d.sub, /рост нити/);
    }
  }
});

test('beside a trunk the clumps are bigger: up to four small caps, more of them than in the open', () => {
  const mean = (near) => {
    let sum = 0;
    let max = 0;
    for (let seed = 1; seed <= 10; seed++) {
      for (let id = 0; id < 40; id++) {
        const n = clusterOf(seed, id, near).length;
        sum += n;
        max = Math.max(max, n);
        assert.ok(n <= MAX_COMPANIONS);
      }
    }
    return { mean: sum / 400, max };
  };
  const open = mean(0);
  const trunk = mean(1);
  assert.ok(open.max <= 3, 'in the open at most three');
  assert.equal(trunk.max, 4, 'beside a trunk up to four');
  assert.ok(trunk.mean > open.mean + 0.8, `${trunk.mean} vs ${open.mean}`);
  assert.deepEqual(clusterOf(7, 3, 0), clusterOf(7, 3), 'no proximity argument = in the open');
  assert.deepEqual(clusterOf(7, 3, NaN), clusterOf(7, 3), 'a bad proximity counts as none');
});

test('trunkNear: 1 at a trunk or a stump, falling to 0 beyond 130 units, 0 for a world without either', () => {
  const w = { trees: [{ x: 500 }], stumps: [{ x: 900 }] };
  assert.equal(trunkNear(w, 500), 1);
  assert.equal(trunkNear(w, 540), 1);
  assert.ok(trunkNear(w, 585) > 0.4 && trunkNear(w, 585) < 0.6);
  assert.equal(trunkNear(w, 700), 0);
  assert.equal(trunkNear(w, 880), 1, 'a stump gathers them too');
  assert.equal(trunkNear({}, 500), 0);
  assert.equal(trunkNear(null, 500), 0);
});

test('a mushroom look is deterministic and varied: size, height and slant, in range', () => {
  const sizes = [];
  let bent = 0;
  for (const seed of [1, 7, 13, 23, 42]) {
    for (let id = 0; id < 60; id++) {
      const a = lookOf(seed, id);
      assert.deepEqual(lookOf(seed, id), a);
      assert.ok(a.size >= 0.62 && a.size <= 1.42, `size ${a.size}`);
      assert.ok(a.tall >= 0.86 && a.tall <= 1.18, `tall ${a.tall}`);
      assert.ok(Math.abs(a.lean) <= 0.16, `lean ${a.lean}`);
      assert.ok(a.phase >= 0 && a.phase <= 40);
      assert.equal(typeof a.mirror, 'boolean');
      sizes.push(a.size);
      if (Math.abs(a.lean) >= 0.09) bent++;
    }
  }
  assert.notDeepEqual(lookOf(7, 1), lookOf(8, 1), 'another world, another look');
  assert.notDeepEqual(lookOf(7, 1), lookOf(7, 2), 'another mushroom, another look');
  assert.ok(sizes.filter((v) => v < 0.85).length / sizes.length > 0.1, 'some small caps');
  assert.ok(sizes.filter((v) => v > 1.15).length / sizes.length > 0.1, 'some big caps');
  assert.ok(Math.max(...sizes) - Math.min(...sizes) > 0.7, 'the spread is wide, not 0.92..1.08');
  assert.ok(bent / sizes.length > 0.15 && bent / sizes.length < 0.35, `about one in four leans hard: ${bent}`);
});

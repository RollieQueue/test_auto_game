import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest, getSprite, spriteTypes, mushroomLook, mushroomSprite, wiltTarget, growScale, _setSpritesForTest, spritesReady, TREE_MUSHROOM } from '../src/render/sprites.js';

const row = (group, type, n, extra = {}) => ({ id: `${group}.${type}.${n}`, group, type, file: `assets/art/${group}/${type}.${n}.webp`, w: 100, h: 200, anchor: { x: 50, y: 199 }, worldSize: 48, ...extra });

test('parseManifest keeps well-formed rows of the scene groups and survives garbage', () => {
  const rows = parseManifest({
    assets: [row('mushroom', 'common', 1), row('plate', 'frontispiece', 1), row('decor', 'acorn', 1), { group: 'decor' }, null, row('decor', 'bad', 1, { w: 0 }), row('decor', 'noanchor', 1, { anchor: undefined })],
  });
  assert.deepEqual(rows.map((r) => r.id), ['mushroom.common.1', 'decor.acorn.1', 'decor.noanchor.1']);
  assert.deepEqual(rows[2].anchor, { x: 50, y: 200 });
  assert.deepEqual(parseManifest(null), []);
  assert.deepEqual(parseManifest({ assets: 'nope' }), []);
});

test('getSprite picks a variant deterministically and is null for unknown types', () => {
  _setSpritesForTest([1, 2, 3].map((n) => ({ ...row('mushroom', 'common', n), img: {} })).concat([{ ...row('decor', 'acorn', 1), img: {} }]));
  assert.ok(spritesReady());
  assert.equal(getSprite('mushroom', 'common', 0).id, 'mushroom.common.1');
  assert.equal(getSprite('mushroom', 'common', 4).id, 'mushroom.common.2');
  assert.equal(getSprite('mushroom', 'common', -2).id, 'mushroom.common.3');
  assert.equal(getSprite('mushroom', 'porcini', 1), null);
  assert.deepEqual(spriteTypes('mushroom'), ['common']);
  assert.deepEqual(spriteTypes('decor'), ['acorn']);
});

test('mushroomLook follows the nearest tree, stays stable, and falls back to open-ground kinds', () => {
  const trees = [{ species: 'birch', x: 400 }, { species: 'oak', x: 900 }, { species: 'pine', x: 1400 }];
  const seen = { birch: 0, oak: 0, pine: 0 };
  let total = 0;
  for (let id = 0; id < 300; id++) {
    const at = (x) => ({ id, x, variant: id * 7919, species: 'common' });
    const a = mushroomLook(at(430), trees);
    assert.equal(a, mushroomLook(at(430), trees), 'stable per mushroom');
    if (a === TREE_MUSHROOM.birch) seen.birch++;
    else assert.ok(a === 'common' || a === 'chanterelle', a);
    total++;
    const b = mushroomLook(at(880), trees);
    if (b === TREE_MUSHROOM.oak) seen.oak++;
    const c = mushroomLook(at(1420), trees);
    if (c === TREE_MUSHROOM.pine) seen.pine++;
  }
  for (const k of Object.keys(seen)) assert.ok(seen[k] > total * 0.6 && seen[k] < total * 0.9, `${k}: ${seen[k]}/${total}`);
  // far from every trunk, or no trees at all: only the open-ground kinds
  for (let id = 0; id < 50; id++) {
    assert.ok(['common', 'chanterelle'].includes(mushroomLook({ id, x: 1800, variant: id }, [{ species: 'birch', x: 400 }])));
    assert.ok(['common', 'chanterelle'].includes(mushroomLook({ id, x: 10, variant: id }, null)));
  }
  assert.equal(mushroomLook({ id: 1, x: 10, species: 'porcini' }, trees), 'porcini', 'a species set by the sim wins');
});

test('mushroomSprite falls back to the common species when the look has no image', () => {
  _setSpritesForTest([{ ...row('mushroom', 'common', 1), img: {} }]);
  const s = mushroomSprite({ id: 3, x: 430, variant: 11, species: 'porcini' }, []);
  assert.equal(s.type, 'common');
  _setSpritesForTest([]);
  assert.equal(mushroomSprite({ id: 3, x: 430, variant: 11 }, []), null);
});

test('wiltTarget: only with seasons, builds up in winter, eases off in spring', () => {
  const on = { seasons: true };
  assert.equal(wiltTarget({}, { season: 'winter', seasonFrac: 0.9 }), 0);
  assert.equal(wiltTarget(on, null), 0);
  assert.equal(wiltTarget(on, { season: 'summer', seasonFrac: 0.5, year: 0 }), 0);
  assert.equal(wiltTarget(on, { season: 'winter', seasonFrac: 0, year: 0 }), 0);
  assert.equal(wiltTarget(on, { season: 'winter', seasonFrac: 0.5, year: 0 }), 1);
  const mid = wiltTarget(on, { season: 'winter', seasonFrac: 0.075, year: 0 });
  assert.ok(mid > 0.3 && mid < 0.7);
  assert.equal(wiltTarget(on, { season: 'spring', seasonFrac: 0, year: 1 }), 1);
  assert.equal(wiltTarget(on, { season: 'spring', seasonFrac: 0.5, year: 1 }), 0);
  assert.equal(wiltTarget(on, { season: 'spring', seasonFrac: 0, year: 0 }), 0);
});

test('growScale grows monotonically from a small nub to full size', () => {
  assert.ok(growScale(0) > 0 && growScale(0) < 0.2);
  assert.equal(growScale(1), 1);
  let prev = -1;
  for (let g = 0; g <= 1.0001; g += 0.05) {
    const v = growScale(g);
    assert.ok(v >= prev);
    prev = v;
  }
  assert.equal(growScale(5), 1);
  assert.equal(growScale(-1), growScale(0));
});

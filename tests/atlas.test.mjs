import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { addNode } from '../src/sim/network.js';
import { FINDS } from '../src/content/finds.js';
import { KINDS, artByKind, atlasModel, findNames, progressText } from '../src/ui/atlas-logic.js';
import { buildAtlas } from '../src/ui/atlas.js';
import { buildHelp } from '../src/ui/help.js';

const touch = (state, d) => addNode(state, d.x + 1, d.y, state.net.originId);

test('atlas: eleven kinds, nothing found in a fresh game', () => {
  assert.equal(KINDS.length, 11);
  const m = atlasModel(createState(7));
  assert.equal(m.entries.length, 11);
  assert.equal(m.kinds, 0);
  assert.equal(m.items, 0);
  assert.equal(m.progress, 'найдено 0 из 11 видов');
  assert.ok(m.entries.every((e) => !e.discovered && e.found === 0));
});

test('atlas: counts per kind, totals on the glade, progress text', () => {
  // any glade that hides at least two pebbles and an ammonite
  const seed = [42, 7, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12].find((n) => {
    const decor = createState(n).world.decor;
    return decor.filter((d) => d.type === 'pebble').length >= 2 && decor.some((d) => d.type === 'ammonite');
  });
  const state = createState(seed);
  const pebbles = state.world.decor.filter((d) => d.type === 'pebble');
  assert.ok(pebbles.length >= 2);
  touch(state, pebbles[0]);
  touch(state, pebbles[1]);
  touch(state, state.world.decor.find((d) => d.type === 'ammonite'));
  const m = atlasModel(state);
  const pebble = m.entries.find((e) => e.kind === 'pebble');
  assert.deepEqual([pebble.discovered, pebble.found, pebble.total], [true, 2, pebbles.length]);
  assert.equal(m.entries.find((e) => e.kind === 'ammonite').found, 1);
  assert.equal(m.kinds, 2);
  assert.equal(m.items, 3);
  assert.equal(m.progress, 'найдено 2 из 11 видов');
  assert.equal(pebble.initial, 'О');
});

test('atlas: progress wording, art manifest tolerance', () => {
  assert.equal(progressText(1, 11), 'найдено 1 из 11 видов');
  assert.deepEqual(artByKind(null), {});
  assert.deepEqual(artByKind({}), {});
  assert.deepEqual(artByKind({ assets: 5 }), {});
  const art = artByKind({
    assets: [
      { group: 'mushroom', type: 'acorn', file: 'a.png' },
      { group: 'decor', type: 'acorn', file: 'acorn1.webp' },
      { group: 'decor', type: 'acorn', file: 'acorn2.webp' },
      { group: 'decor', type: 'leaf' },
      null,
    ],
  });
  assert.deepEqual(art, { acorn: 'acorn1.webp' });
  const m = atlasModel(createState(7), art);
  assert.equal(m.entries.find((e) => e.kind === 'acorn').art, 'acorn1.webp');
  assert.equal(m.entries.find((e) => e.kind === 'leaf').art, null);
});

test('atlas: page shows names of found kinds, only the zone of unknown ones, works with and without art', () => {
  const state = createState(42);
  touch(state, state.world.decor.find((d) => d.type === 'shell'));
  for (const art of [{}, { shell: 'assets/art/shell.webp', ammonite: 'assets/art/ammonite.webp' }]) {
    const html = buildAtlas(state, art);
    assert.ok(html.includes(FINDS.shell.name) && html.includes(FINDS.shell.note) && html.includes(FINDS.shell.latin));
    assert.ok(html.includes('найдено 1 из 11 видов'));
    assert.ok(!html.includes(FINDS.ammonite.name) && !html.includes(FINDS.ammonite.note), 'unknown kinds stay hidden');
    assert.ok(html.includes(FINDS.ammonite.zone));
    assert.equal(html.includes('assets/art/shell.webp'), 'shell' in art);
    assert.equal((html.match(/class="atl-entry /g) || []).length, 11);
  }
});

test('atlas: labels use names, the help page mentions the atlas and the A key', () => {
  assert.equal(findNames('ammonite').lower, 'аммонит');
  assert.equal(findNames('ammonite').rarity, 4);
  assert.equal(findNames('unicorn'), null);
  const help = buildHelp(createState(7));
  assert.ok(help.includes('атлас находок') && help.includes('<kbd>A</kbd>'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { addNode } from '../src/sim/network.js';
import { FINDS } from '../src/content/finds.js';
import { KINDS, plateByKind, specimenModel, stepKind, openableKinds, atlasModel, clockText } from '../src/ui/atlas-logic.js';
import { buildSpecimen, hereWords } from '../src/ui/specimen.js';
import { buildAtlas } from '../src/ui/atlas.js';
import { gladeLabel } from '../src/ui/glade.js';
import { horizonLabel } from '../src/world/biomes.js';
import { buildYearPage } from '../src/ui/year.js';

const touch = (state, d, at = 12) => {
  state.time = at;
  return addNode(state, d.x + 1, d.y, state.net.originId);
};

test('finds content: every kind has a longer «Пометки натуралиста» paragraph of 3–5 sentences', () => {
  for (const kind of KINDS) {
    const more = FINDS[kind].more;
    assert.ok(typeof more === 'string' && more.length > 200, `${kind}: more`);
    const sentences = more.split(/(?<=[.!?])\s+/).length;
    assert.ok(sentences >= 3 && sentences <= 5, `${kind}: ${sentences} sentences`);
    assert.doesNotMatch(more, /\s{2,}|\.\./, kind);
  }
});

test('specimen: where and when a find lay on this glade (horizon, depth in cm, game time)', () => {
  const state = createState(42);
  const d = state.world.decor.find((x) => x.type === 'pebble');
  touch(state, d, 125);
  const m = specimenModel(state, 'pebble');
  assert.equal(m.discovered, true);
  assert.equal(m.spots.length, 1);
  const spot = m.spots[0];
  assert.equal(spot.id, d.id);
  assert.ok(state.world.horizons.some((h) => horizonLabel(state.world, h) === spot.horizon), spot.horizon);
  assert.ok(Number.isInteger(spot.depthCm) && spot.depthCm >= 0);
  assert.equal(spot.atText, '2:05');
  assert.equal(spot.season, '', 'no season word while seasons are off');
  assert.equal(m.more, FINDS.pebble.more);
});

test('specimen: seasons on add the season of the find; a kind found only elsewhere has no spot here', () => {
  const state = createState(42);
  state.flags.seasons = true;
  touch(state, state.world.decor.find((x) => x.type === 'pebble'), 5);
  assert.equal(specimenModel(state, 'pebble').spots[0].season, 'весной');
  const m = specimenModel(state, 'ammonite', { ammonite: 2 });
  assert.equal(m.discovered, true);
  assert.equal(m.spots.length, 0);
  assert.equal(m.ever, 2);
  const html = buildSpecimen(state, 'ammonite', {}, { ammonite: 2 });
  assert.match(html, /не находили/);
  assert.match(html, /2 находок за все поляны/);
});

test('specimen: unknown and unfound kinds give no page; found ones carry the picture, texts and arrows', () => {
  const state = createState(7);
  assert.equal(specimenModel(state, 'dragon'), null);
  assert.equal(buildSpecimen(state, 'dragon'), '');
  assert.equal(buildSpecimen(state, 'acorn'), '', 'an unfound card stays closed');
  const d = state.world.decor[0];
  touch(state, d);
  const html = buildSpecimen(state, d.type, {});
  assert.match(html, /class="spec-canvas"/, 'procedural canvas without art');
  assert.match(html, new RegExp(FINDS[d.type].latin));
  assert.match(html, /Пометки натуралиста/);
  assert.match(html, /data-act="spec-back"/);
  assert.match(html, /data-act="spec-prev"[^>]*disabled/, 'one kind: nothing to move to');
  const withArt = buildSpecimen(state, d.type, { [d.type]: 'assets/art/x.webp' });
  assert.match(withArt, /<img class="spec-img" src="assets\/art\/x.webp"/);
  assert.doesNotMatch(withArt, /<canvas/);
});

test('specimen: arrows wrap around the kinds that can be opened', () => {
  const state = createState(42);
  for (const type of ['twig', 'pebble', 'shell']) {
    const d = state.world.decor.find((x) => x.type === type);
    if (d) touch(state, d);
  }
  const kinds = openableKinds(atlasModel(state));
  assert.ok(kinds.length >= 2);
  assert.deepEqual(kinds, KINDS.filter((k) => kinds.includes(k)), 'atlas order');
  assert.equal(stepKind(kinds, kinds[0], 1), kinds[1]);
  assert.equal(stepKind(kinds, kinds[0], -1), kinds[kinds.length - 1]);
  assert.equal(stepKind(kinds, kinds[kinds.length - 1], 1), kinds[0]);
  assert.equal(stepKind([], 'x', 1), null);
  assert.equal(specimenModel(state, kinds[1]).index, 1);
});

test('atlas grid: found cards are openable, unfound ones are not', () => {
  const state = createState(42);
  touch(state, state.world.decor.find((x) => x.type === 'pebble'));
  const html = buildAtlas(state);
  assert.equal((html.match(/data-open="/g) || []).length, 1);
  assert.match(html, /data-open="pebble"/);
});

test('art: a plate picture of the kind is found in the manifest; the frontispiece is not a kind', () => {
  const m = {
    assets: [
      { id: 'plate.frontispiece', group: 'plate', type: 'frontispiece', file: 'assets/art/f.webp' },
      { id: 'plate.acorn.1', group: 'plate', type: 'acorn', file: 'assets/art/a.webp' },
      { id: 'decor.pebble.1', group: 'decor', type: 'pebble', file: 'assets/art/p.webp' },
    ],
  };
  assert.deepEqual(plateByKind(m), { acorn: 'assets/art/a.webp' });
  assert.deepEqual(plateByKind(null), {});
  assert.equal(clockText(3725), '62:05');
});

test('specimen: «здесь» words', () => {
  assert.match(hereWords({ found: 2, total: 3 }), /2 из 3/);
  assert.match(hereWords({ found: 3, total: 3 }), /все 3/);
  assert.match(hereWords({ found: 0, total: 0 }), /не лежит/);
});

test('glade label: «Поляна: <name> · №<seed>», with a fallback when the world has no name', () => {
  const state = createState(7);
  assert.ok(state.world.name, 'generated glades carry a name');
  assert.equal(gladeLabel(state), `Поляна: ${state.world.name} · №7`);
  delete state.world.name;
  assert.equal(gladeLabel(state), 'Поляна №7');
  state.world.name = 'Сосновый бор на холме';
  assert.equal(gladeLabel(state), 'Поляна: Сосновый бор на холме · №7');
  assert.equal(gladeLabel(state, 'Новая поляна'), 'Новая поляна: Сосновый бор на холме · №7');
  state.world.name = '   ';
  assert.equal(gladeLabel(state), 'Поляна №7');
  assert.equal(gladeLabel(null), 'Поляна');
  state.world.name = 'Берёзовая роща <у ручья>';
  assert.match(buildYearPage(state, 0), /Поляна: Берёзовая роща &lt;у ручья&gt; · №7/);
});

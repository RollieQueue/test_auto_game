// The folded objectives card: «ближе всего: галечник 255/597», chosen as the open line that is furthest along.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { B } from '../src/sim/balance.js';
import { createObjectives } from '../src/sim/objectives.js';
import { SHORT_NAMES, foldedLine, nearestObjective } from '../src/ui/obj-fold.js';

function page(chapter, seed = 7, flags = { threats: true, rival: true }) {
  const s = createState(seed);
  s.phase = 'playing';
  Object.assign(s.flags, flags);
  s.chapter = chapter;
  s.objectives = createObjectives(chapter, Boolean(s.flags.seasons), s.world.biome, Boolean(s.flags.rival));
  return s;
}

const growGoal = Math.round(B.treeGrowGoal * 100);

test('with nothing counted yet the first open line is the nearest; then the growth line', () => {
  const s = page(1);
  assert.equal(nearestObjective(s).o.id, 'water');
  assert.equal(foldedLine(s), 'ближе всего: вода');
  s.objectives[0].done = s.objectives[1].done = s.objectives[2].done = true;
  assert.equal(foldedLine(s), `ближе всего: рост 0/${growGoal} %`);
});

test('the open line with the highest done fraction wins, ticked lines never do', () => {
  const s = page(1);
  s.objectives.slice(0, 3).forEach((o) => (o.done = true));
  s.sim.treeGrowTotal = 0.1; // 10/25 = 0.4
  s.res.spores = 30; // 30/40 = 0.75
  assert.equal(foldedLine(s), `ближе всего: споры 30/${B.sporesGoal}`);
  s.objectives.find((o) => o.id === 'spores').done = true;
  assert.equal(foldedLine(s), `ближе всего: рост 10/${growGoal} %`);
  s.objectives.find((o) => o.id === 'treeGrow').done = true;
  assert.equal(foldedLine(s), 'всё отмечено');
});

test('page 2: depth without its unit, and «Опёнок» shows whichever of its two ways is further along', () => {
  const s = page(2);
  s.world.trees.forEach((t, i) => (s.sim.contacts[t.id] = i === 0 ? [{ tip: 0 }] : []));
  const need = Math.ceil(s.world.horizons[s.world.horizons.length - 1].depth);
  s.stats.maxDepth = need - 1;
  assert.equal(foldedLine(s), `ближе всего: галечник ${need - 1}/${need}`);
  s.stats.maxDepth = 0;
  s.world.trees.forEach((t) => (s.sim.contacts[t.id] = []));
  s.rival = { stats: { freedTrees: 0, cut: 12 } };
  s.sim.pageBase = { chapter: 2, freed: 0, cut: 0, caught: 0 };
  assert.equal(foldedLine(s), `ближе всего: опёнок 12/${B.rivalCutGoal}`);
  s.rival.stats.freedTrees = 1; // 1/2 = 0.5 is behind 12/15 = 0.8
  assert.equal(foldedLine(s), `ближе всего: опёнок 12/${B.rivalCutGoal}`);
  s.rival.stats.cut = 2; // now the trees are the way that is further along
  assert.equal(foldedLine(s), `ближе всего: опёнок 1/${B.rivalCutFreed}`);
});

test('every line of every page has a short name; a line without one falls back to its text; no lines, no text', () => {
  for (const chapter of [1, 2, 3, 4]) {
    for (const seed of [13, 42, 23, 7]) {
      const s = page(chapter, seed, { threats: true, rival: true, seasons: true });
      for (const o of s.objectives) {
        assert.ok(SHORT_NAMES[o.id], `${o.id} has a short name`);
        assert.ok(SHORT_NAMES[o.id].length <= 14, `${o.id}: «${SHORT_NAMES[o.id]}» is short`);
      }
      assert.ok(foldedLine(s).length <= 34, foldedLine(s));
    }
  }
  const s = page(1);
  s.objectives = [{ id: 'mystery', text: 'Что-то новое', done: false }];
  assert.equal(foldedLine(s), 'ближе всего: Что-то новое');
  assert.equal(foldedLine(s, []), '');
  assert.equal(foldedLine({}, null), '');
  assert.equal(nearestObjective(s, [{ id: 'x', text: 'y', done: true }]), null);
});

test('a partial state does not throw', () => {
  assert.equal(typeof foldedLine({ objectives: [{ id: 'allies', text: 'a', done: false }] }), 'string');
  assert.equal(foldedLine({ objectives: [{ id: 'rivalCut', text: 'a', done: false }] }), 'ближе всего: опёнок 0/2');
});

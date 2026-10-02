// A mushroom claims ground by its cap's size: a big cap keeps a wide berth, a small one lets a neighbour stand close,
// so the mushrooms of a glade come in groups and loners, not at one fixed step (sim/mushrooms.js fruitClaim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { addNode } from '../src/sim/network.js';
import { B } from '../src/sim/balance.js';
import { fruitClaim, fruitDenial, crowdingMushroom } from '../src/sim/mushrooms.js';
import { groundYAt } from '../src/world/query.js';
import { lookOf } from '../src/world/clump.js';

function fresh(seed = 7) {
  const state = createState(seed);
  state.phase = 'playing';
  state.res.sugar = 500;
  return state;
}

/** A mushroom of this id standing at x (written straight into the state: the rule under test is the claim, not the planting). */
function standing(state, id, x) {
  const m = { id, nodeId: 0, x, baseY: groundYAt(state.world, x), species: 'common', variant: 0, age: 0, growth: 1, mature: true, spores: 0, burst: 0, burstT: 0 };
  state.mushrooms.push(m);
  return m;
}

/** The first id whose cap is at most / at least this size in the world. */
const idWithSize = (seed, test) => {
  for (let id = 0; id < 500; id++) if (test(lookOf(seed, id).size)) return id;
  throw new Error('no such mushroom');
};

test('a claim follows the cap size, stays inside the limits and averages about the old fixed spacing', () => {
  const s = fresh();
  let sum = 0;
  let n = 0;
  let lo = Infinity;
  let hi = 0;
  for (const seed of [1, 7, 13, 42]) {
    const st = fresh(seed);
    for (let id = 0; id < 200; id++) {
      const c = fruitClaim(st, { id });
      assert.ok(c >= B.fruitSpacingMin && c <= B.fruitSpacingMax, `claim ${c}`);
      assert.equal(fruitClaim(st, { id }), c, 'stable');
      sum += c;
      n++;
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
    }
  }
  const mean = sum / n;
  assert.ok(mean > 55 && mean < 66, `mean claim ${mean} (the old rule: 60)`);
  assert.ok(lo <= 40 && hi >= 85, `the claims spread: ${lo}..${hi}`);
  const small = idWithSize(7, (v) => v < 0.8);
  const big = idWithSize(7, (v) => v > 1.3);
  assert.ok(fruitClaim(s, { id: big }) > fruitClaim(s, { id: small }) * 2, 'a big cap claims far more than a small one');
});

test('a small mushroom lets another stand close; a big one keeps it away', () => {
  const s = fresh();
  const small = idWithSize(7, (v) => v < 0.8);
  const big = idWithSize(7, (v) => v > 1.3);
  const x = 900;
  const here = standing(s, small, x);
  const claim = fruitClaim(s, here);
  const node = (dx) => addNode(s, x + dx, groundYAt(s.world, x + dx) + 15, s.net.originId);
  const inside = node(claim - 6);
  const outside = node(claim + 6);
  assert.equal(fruitDenial(s, inside.id), 'crowded');
  assert.equal(crowdingMushroom(s, inside.id), here);
  assert.equal(fruitDenial(s, outside.id), null);
  assert.ok(claim < B.fruitSpacing, 'a small cap leaves room for a neighbour closer than the old step');
  // the same spot beside a big mushroom is still crowded
  const s2 = fresh();
  const there = standing(s2, big, x);
  const near = addNode(s2, x + claim + 6, groundYAt(s2.world, x + claim + 6) + 15, s2.net.originId);
  assert.equal(fruitDenial(s2, near.id), 'crowded');
  assert.ok(fruitClaim(s2, there) > B.fruitSpacing, 'a big cap claims more than the old step');
  assert.equal(crowdingMushroom(s2, near.id), there);
});

test('the claim is the ground a mushroom keeps clear on both sides; planting keeps the rest of the rules', () => {
  const s = fresh();
  const here = standing(s, idWithSize(7, (v) => v > 0.9 && v < 1.1), 900);
  const claim = fruitClaim(s, here);
  const left = addNode(s, 900 - claim + 4, groundYAt(s.world, 900 - claim + 4) + 15, s.net.originId);
  assert.equal(fruitDenial(s, left.id), 'crowded');
  const far = addNode(s, 900 + claim + 20, groundYAt(s.world, 900 + claim + 20) + 15, s.net.originId);
  s.res.sugar = 0;
  assert.equal(fruitDenial(s, far.id), 'sugar', 'out of the claim the sugar rule still answers');
  s.res.sugar = 500;
  assert.equal(sim.canFruit(s, far.id), true);
  assert.ok(sim.commandFruit(s, far.id));
  assert.equal(s.mushrooms.length, 2);
});

test('no mushroom ever stands inside another one\'s claim, whatever order the player plants in', () => {
  const s = fresh(13);
  const ids = [];
  for (let x = 300; x < 1500; x += 9) ids.push(addNode(s, x, groundYAt(s.world, x) + 15, s.net.originId).id);
  for (let round = 0; round < 3; round++) {
    for (const id of ids) {
      s.res.sugar = 500;
      if (sim.canFruit(s, id)) assert.ok(sim.commandFruit(s, id));
    }
  }
  assert.ok(s.mushrooms.length >= 8, `${s.mushrooms.length} mushrooms stand`);
  for (const a of s.mushrooms) {
    for (const b of s.mushrooms) {
      if (a !== b) assert.ok(Math.abs(a.x - b.x) >= fruitClaim(s, a) - 1e-9 || Math.abs(a.x - b.x) >= fruitClaim(s, b) - 1e-9, `mushrooms ${a.id} and ${b.id} keep clear of at least one claim`);
    }
  }
  // not an even step: groups and gaps
  const xs = s.mushrooms.map((m) => m.x).sort((p, q) => p - q);
  const gaps = xs.slice(1).map((v, i) => v - xs[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 25, `gaps vary: ${gaps.map(Math.round)}`);
});

// The objectives card must not sit on the rival's stump: the pure part that finds a stump under the card as it would be open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { openCardRect, stumpRect, stumpsUnder } from '../src/ui/cards-logic.js';

const VIEW = { scale: 1600 / 1920, ox: 0, oy: 0, cssW: 1600, cssH: 900 };
const FOLDED = { l: 1224, t: 8, r: 1585, b: 42 }; // the card as a one-line header at 1600x900 (measured)
const withStump = (x, rival = true) => {
  const s = createState(23);
  s.world.stumps = [{ id: 0, x, y: 276, r: 30 }];
  if (rival) s.rival = { awake: false, nodes: [], edges: [], tips: [], grip: [], clusters: [] };
  return s;
};

test('openCardRect: the open card hangs from the folded one\'s top right corner, a small window is a little smaller', () => {
  const big = openCardRect(FOLDED, 16, false);
  assert.equal(big.r, 1585);
  assert.equal(big.t, 8);
  assert.ok(big.l > 1250 && big.l < 1290, `${big.l}`); // measured open: 1271..1586 x 14..269
  assert.ok(big.b > 240 && big.b < 290, `${big.b}`);
  const small = openCardRect({ l: 943, t: 7, r: 1267, b: 37 }, 16, true);
  assert.ok(small.l > 960 && small.l < 1000 && small.b > 210 && small.b < 250, JSON.stringify(small));
});

test('a stump in the right edge band is under the open card, one in the clear band or without a rival is not', () => {
  const open = openCardRect(FOLDED, 16, false);
  assert.equal(stumpsUnder(withStump(1700), VIEW, open), 1, 'fallback band at the right edge: hidden');
  assert.equal(stumpsUnder(withStump(1540), VIEW, open), 1);
  assert.equal(stumpsUnder(withStump(1300), VIEW, open), 0, 'the seen band 1220..1450 is clear');
  assert.equal(stumpsUnder(withStump(1450), VIEW, open), 0);
  assert.equal(stumpsUnder(withStump(500), VIEW, open), 0, 'left band');
  assert.equal(stumpsUnder(withStump(1700, false), VIEW, open), 0, 'no rival: no stump is drawn, so none is hidden');
  // the folded header is one line high: a stump on the ground (y ~ 276 world = 230 px) is not under it
  assert.equal(stumpsUnder(withStump(1700), VIEW, FOLDED), 0);
  // garbage in, nothing out
  const bad = withStump(1700);
  bad.world.stumps.push(null, { x: NaN, y: 1 });
  assert.equal(stumpsUnder(bad, VIEW, open), 1);
  assert.equal(stumpsUnder(bad, null, open), 0);
  assert.equal(stumpsUnder(bad, VIEW, null), 0);
  const r = stumpRect({ x: 1000, y: 300, r: 30 }, VIEW);
  assert.ok(r.l < r.r && r.t < r.b && r.b > 300 * VIEW.scale);
});

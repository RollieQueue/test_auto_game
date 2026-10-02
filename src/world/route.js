// The cheapest hypha route between two places of a glade, around rocks and out of the open air. Pure functions over a World.
// The same idea as the scripted player in tests/bot.mjs (a Dijkstra over a coarse cost grid), but over one box of the glade
// whose cells are priced the first time a search reaches them, so the generator can ask it about every candidate world.
import { costAt } from './query.js';

export const ROUTE_CELL = 8; // the game resamples a drag every 8 u too (B.pathStep)
const MARGIN = 5; // a cell is open only when the points this far around its centre are passable (a straight hop between centres stays clear)
const SIDES = [[MARGIN, 0], [-MARGIN, 0], [0, MARGIN], [0, -MARGIN]];
const DIAGONAL = Math.SQRT2;

class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, value) {
    const { k, v } = this;
    let i = k.length;
    k.push(key);
    v.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = value;
  }
  pop() {
    const { k, v } = this;
    const key = k[0];
    const value = v[0];
    const lastK = k.pop();
    const lastV = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= k.length) break;
        const m = l + 1 < k.length && k[l + 1] < k[l] ? l + 1 : l;
        if (k[m] >= lastK) break;
        k[i] = k[m];
        v[i] = v[m];
        i = m;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return [key, value];
  }
}

/**
 * A router over the box [x0, y0, x1, y1] of `world`. `router.cheapest(ax, ay, isTarget)` is the cheapest way for a hypha
 * from (ax, ay) to the first cell centre where `isTarget(x, y)` holds, in sugar at the glade's own horizon prices (before
 * any growth-cost multiplier): { cost, length, points } (cell centres, the target cell last) or null when rock or the
 * open air shuts every way inside the box.
 */
export function createRouter(world, [bx0, by0, bx1, by1]) {
  const cell = ROUTE_CELL;
  const x0 = Math.max(0, Math.floor(bx0 / cell));
  const y0 = Math.max(0, Math.floor(by0 / cell));
  const cols = Math.min(Math.ceil(world.width / cell) - 1, Math.ceil(bx1 / cell)) - x0 + 1;
  const rows = Math.min(Math.ceil(world.height / cell) - 1, Math.ceil(by1 / cell)) - y0 + 1;
  const price = new Float32Array(cols * rows).fill(-1); // -1: not priced yet, Infinity: shut
  const centreX = (i) => (x0 + (i % cols)) * cell + cell / 2;
  const centreY = (i) => (y0 + ((i / cols) | 0)) * cell + cell / 2;
  const priceOf = (i) => {
    if (price[i] !== -1) return price[i];
    const px = centreX(i);
    const py = centreY(i);
    let c = costAt(world, px, py);
    if (Number.isFinite(c)) for (const [dx, dy] of SIDES) if (!Number.isFinite(costAt(world, px + dx, py + dy))) c = Infinity;
    price[i] = c;
    return c;
  };

  function cheapest(ax, ay, isTarget) {
    const sx = Math.floor(ax / cell) - x0;
    const sy = Math.floor(ay / cell) - y0;
    if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) return null;
    const start = sy * cols + sx;
    const dist = new Float64Array(cols * rows).fill(Infinity);
    const prev = new Int32Array(cols * rows).fill(-1);
    const heap = new MinHeap();
    dist[start] = 0;
    heap.push(0, start);
    while (heap.size) {
      const [d, i] = heap.pop();
      if (d > dist[i]) continue;
      const cx = i % cols;
      const cy = (i / cols) | 0;
      if (i !== start && isTarget(centreX(i), centreY(i))) {
        const points = [];
        let length = 0;
        for (let j = i; prev[j] !== -1; j = prev[j]) {
          points.push({ x: centreX(j), y: centreY(j) });
          length += j % cols !== prev[j] % cols && ((j / cols) | 0) !== ((prev[j] / cols) | 0) ? cell * DIAGONAL : cell;
        }
        return { cost: d, length, points: points.reverse() };
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          const c = priceOf(j);
          if (!Number.isFinite(c)) continue;
          const nd = d + (dx && dy ? cell * DIAGONAL : cell) * c;
          if (nd < dist[j]) {
            dist[j] = nd;
            prev[j] = i;
            heap.push(nd, j);
          }
        }
      }
    }
    return null;
  }

  return { cheapest };
}

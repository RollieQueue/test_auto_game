import test from 'node:test';
import assert from 'node:assert/strict';
import { premultiply, unpremultiply, resize, sharpen, mipChain } from '../src/render/resample.js';

// a canvas stand-in: sprites.js builds its copies on OffscreenCanvas when there is no document
const made = [];
class FakeCanvas {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    made.push(this);
  }
  getContext() {
    return {
      drawImage() {},
      fillRect() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      putImageData: (img) => (this.put = img),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(200) }),
    };
  }
}
globalThis.OffscreenCanvas = FakeCanvas;
globalThis.ImageData = class {
  constructor(data, width, height) {
    Object.assign(this, { data, width, height });
  }
};
const { levelHeight, levelFor, levelNear, washedNear, beginFrame } = await import('../src/render/sprites.js');

const entryOf = (h = 320, w = 300) => ({ id: 'mushroom.test.1', group: 'mushroom', type: 'test', w, h, anchor: { x: w / 2, y: h }, worldSize: 50, img: { width: w, height: h } });
const wait = (ms = 20) => new Promise((ok) => setTimeout(ok, ms));

test('levelHeight is the first rung of the 1.1 ladder not below the target, never above the full size', () => {
  for (const px of [9, 20, 33, 45, 59, 90, 180, 280]) {
    const h = levelHeight(320, px);
    assert.ok(h >= px && h <= px * 1.1 + 1, `${px} -> ${h}`);
  }
  assert.equal(levelHeight(320, 300), 320, 'near the full size: the image itself');
  assert.equal(levelHeight(320, 900), 320, 'never magnified past the full size');
  assert.equal(levelHeight(320, 1), levelHeight(320, 8), 'a floor');
  assert.equal(levelHeight(320, NaN), 320);
  assert.equal(levelHeight(320, 50), levelHeight(320, 49.2), 'neighbouring targets share a rung');
});

test('levelFor gives every size its own fit, however the sizes were asked for', () => {
  const e = entryOf();
  const small = levelFor(e, 18);
  const big = levelFor(e, 70);
  assert.ok(small.h >= 18 && small.h < 21, `small ${small.h}`);
  assert.ok(big.h >= 70 && big.h < 78, `big ${big.h} (a small request earlier must not cap a bigger one)`);
  assert.equal(levelFor(e, 70), big, 'cached');
  assert.equal(levelFor(e, 70.5), big, 'a hair more still the same rung');
  assert.equal(levelFor(e, 1000).src, e.img, 'the full size is the image itself');
  assert.equal(big.w, Math.round((e.w * big.h) / e.h));
});

test('levelNear builds one copy per frame, queues the rest and stands in with a taller copy', async () => {
  const e = entryOf();
  levelFor(e, 120); // a taller copy exists
  beginFrame();
  const a = levelNear(e, 40); // the frame's one build
  assert.ok(!a.stand && a.h >= 40 && a.h < 45);
  const b = levelNear(e, 60); // over budget
  assert.equal(b.stand, true);
  assert.ok(b.h >= 120, 'the closest taller copy stands in');
  assert.equal(levelNear(e, 60).stand, true, 'still waiting within the same frame');
  await wait();
  beginFrame();
  const c = levelNear(e, 60);
  assert.ok(!c.stand && c.h >= 60 && c.h < 67, 'the idle tick built it');
  const lone = entryOf();
  beginFrame();
  levelNear(lone, 30);
  const d = levelNear(lone, 50);
  assert.equal(d.src, lone.img, 'nothing built: the image itself stands in');
});

test('washedNear builds one wash per frame and answers null for the others until an idle tick', async () => {
  const mk = () => ({ width: 40, height: 40 });
  const [a, b] = [mk(), mk()];
  beginFrame();
  assert.ok(washedNear(a, 40, 40));
  assert.equal(washedNear(b, 40, 40), null);
  await wait();
  beginFrame();
  assert.ok(washedNear(b, 40, 40));
});

test('resize averages the covered area and keeps alpha-weighted colour', () => {
  // a 4x2 image: left half opaque red, right half fully transparent; to 2x1
  const px = [];
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) px.push(...(x < 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
  const out = resize(premultiply(Uint8ClampedArray.from(px)), 4, 2, 2, 1);
  assert.deepEqual([...out], [255, 0, 0, 255, 0, 0, 0, 0]);
  // half-covered pixel: half alpha, the colour stays red once un-premultiplied (no dark halo)
  const half = resize(premultiply(Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 0, 0])), 2, 1, 1, 1);
  assert.equal(half[3], 128);
  assert.deepEqual([...unpremultiply(half)].slice(0, 3), [255, 0, 0]);
  // an odd ratio: the weights still sum to one (a flat grey stays flat)
  const flat = resize(premultiply(Uint8ClampedArray.from({ length: 7 * 5 * 4 }, (_, i) => (i % 4 === 3 ? 255 : 180))), 7, 5, 3, 2);
  assert.ok(flat.every((v, i) => v === (i % 4 === 3 ? 255 : 180)));
});

test('sharpen raises contrast on edges, keeps alpha and never lets the colour pass its alpha', () => {
  const w = 6;
  const px = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < w; x++) px.push(...(x < 3 ? [60, 60, 60, 255] : [200, 200, 200, 255]));
  const pm = premultiply(Uint8ClampedArray.from(px));
  const out = sharpen(pm, w, 3, 0.6);
  const at = (x) => out[(1 * w + x) * 4];
  assert.ok(at(2) < 60 && at(3) > 200 - 1, 'the step is steeper');
  assert.ok(out.every((v, i) => i % 4 !== 3 || v === 255), 'alpha untouched');
  const faint = premultiply(Uint8ClampedArray.from([255, 255, 255, 40, 0, 0, 0, 255, 255, 255, 255, 40, 255, 255, 255, 40]));
  const f = sharpen(faint, 4, 1, 3);
  for (let i = 0; i < 16; i += 4) assert.ok(f[i] <= f[i + 3] && f[i + 1] <= f[i + 3] && f[i + 2] <= f[i + 3]);
});

test('mipChain halves down to the floor', () => {
  const chain = mipChain(new Uint8ClampedArray(320 * 300 * 4), 320, 300, 8);
  assert.deepEqual(chain.map((m) => m.h), [300, 150, 75, 38, 19, 10]);
  assert.deepEqual(chain.map((m) => m.w), [320, 160, 80, 40, 20, 10]);
  assert.equal(chain[2].pm.length, 80 * 75 * 4);
});

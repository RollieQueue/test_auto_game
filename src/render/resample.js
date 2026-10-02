// Pure pixel code for the illustrations' pre-filtered copies (see levelFor in sprites.js): premultiplied RGBA bytes in,
// premultiplied RGBA bytes out, no canvas and no DOM, so it runs on the main thread, in the world-layer worker and in tests.
// A copy is made once per sprite and size; the frame loop only ever draws the finished canvas at about 1:1.
//   premultiply(rgba) -> Uint8ClampedArray     straight RGBA (ImageData) -> premultiplied
//   unpremultiply(pm) -> Uint8ClampedArray     premultiplied -> straight RGBA (for putImageData)
//   resize(pm, w, h, w2, h2) -> Uint8ClampedArray   exact area average (every source pixel counts by the area it covers)
//   sharpen(pm, w, h, amount) -> Uint8ClampedArray  unsharp mask on the colour, alpha untouched; the colour stays <= alpha
//   mipChain(pm, w, h, minH) -> [{ pm, w, h }]      the image, then halves of it while they stay >= minH tall

export function premultiply(rgba) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    out[i] = (rgba[i] * a) / 255;
    out[i + 1] = (rgba[i + 1] * a) / 255;
    out[i + 2] = (rgba[i + 2] * a) / 255;
    out[i + 3] = a;
  }
  return out;
}

export function unpremultiply(pm) {
  const out = new Uint8ClampedArray(pm.length);
  for (let i = 0; i < pm.length; i += 4) {
    const a = pm[i + 3];
    if (a === 0) continue;
    const k = 255 / a;
    out[i] = pm[i] * k;
    out[i + 1] = pm[i + 1] * k;
    out[i + 2] = pm[i + 2] * k;
    out[i + 3] = a;
  }
  return out;
}

/** For n source cells squeezed into n2: per output cell its first source index, tap count and the weights (they sum to 1). */
function areaWeights(n, n2) {
  const scale = n / n2;
  const taps = Math.ceil(scale) + 1;
  const first = new Int32Array(n2);
  const count = new Int32Array(n2);
  const weight = new Float32Array(n2 * taps);
  for (let o = 0; o < n2; o++) {
    const a = o * scale;
    const b = (o + 1) * scale;
    const f = Math.floor(a);
    const last = Math.min(n - 1, Math.ceil(b) - 1);
    let sum = 0;
    for (let s = f; s <= last; s++) {
      const cover = Math.min(b, s + 1) - Math.max(a, s);
      weight[o * taps + (s - f)] = cover;
      sum += cover;
    }
    for (let k = 0; k <= last - f; k++) weight[o * taps + k] /= sum;
    first[o] = f;
    count[o] = last - f + 1;
  }
  return { first, count, weight, taps };
}

export function resize(pm, w, h, w2, h2) {
  const X = areaWeights(w, w2);
  const Y = areaWeights(h, h2);
  const mid = new Float32Array(w2 * h * 4); // horizontal pass: w2 x h
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w2; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let i = row + X.first[x] * 4;
      const wi = x * X.taps;
      for (let k = 0, n = X.count[x]; k < n; k++, i += 4) {
        const f = X.weight[wi + k];
        r += pm[i] * f;
        g += pm[i + 1] * f;
        b += pm[i + 2] * f;
        a += pm[i + 3] * f;
      }
      const o = (y * w2 + x) * 4;
      mid[o] = r;
      mid[o + 1] = g;
      mid[o + 2] = b;
      mid[o + 3] = a;
    }
  }
  const out = new Uint8ClampedArray(w2 * h2 * 4);
  const stride = w2 * 4;
  for (let y = 0; y < h2; y++) {
    const wi = y * Y.taps;
    const n = Y.count[y];
    for (let x = 0; x < stride; x++) {
      let v = 0;
      let i = Y.first[y] * stride + x;
      for (let k = 0; k < n; k++, i += stride) v += mid[i] * Y.weight[wi + k];
      out[y * stride + x] = v;
    }
  }
  return out;
}

export function sharpen(pm, w, h, amount) {
  const stride = w * 4;
  const out = new Uint8ClampedArray(pm.length);
  const hz = new Uint16Array(pm.length); // 4 x the horizontal [1 2 1] blur of the colour
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++) {
      const l = row + Math.max(0, x - 1) * 4;
      const m = row + x * 4;
      const r = row + Math.min(w - 1, x + 1) * 4;
      hz[m] = pm[l] + 2 * pm[m] + pm[r];
      hz[m + 1] = pm[l + 1] + 2 * pm[m + 1] + pm[r + 1];
      hz[m + 2] = pm[l + 2] + 2 * pm[m + 2] + pm[r + 2];
    }
  }
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * stride;
    const mid = y * stride;
    const dn = Math.min(h - 1, y + 1) * stride;
    for (let x = 0; x < stride; x += 4) {
      const a = pm[mid + x + 3];
      out[mid + x + 3] = a;
      if (a === 0) continue;
      for (let c = 0; c < 3; c++) {
        const i = x + c;
        const blur = (hz[up + i] + 2 * hz[mid + i] + hz[dn + i]) / 16;
        const v = pm[mid + i] + amount * (pm[mid + i] - blur); // the colour is premultiplied, so it never goes past alpha
        out[mid + i] = v < 0 ? 0 : v > a ? a : v; // the clamped array rounds
      }
    }
  }
  return out;
}

export function mipChain(pm, w, h, minH = 8) {
  const chain = [{ pm, w, h }];
  for (;;) {
    const top = chain[chain.length - 1];
    const w2 = Math.max(1, Math.round(top.w / 2));
    const h2 = Math.max(1, Math.round(top.h / 2));
    if (h2 < minH || chain.length >= 8) break;
    chain.push({ pm: resize(top.pm, top.w, top.h, w2, h2), w: w2, h: h2 });
  }
  return chain;
}

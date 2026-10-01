// Deterministic randomness: seeded PRNG and smooth value noise. No DOM, safe for Node tests.

/** FNV-1a style hash of any values into an unsigned 32-bit integer (for deriving sub-seeds). */
export function hash32(...values) {
  let h = 0x811c9dc5;
  for (const v of values) {
    const s = String(v);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
  }
  return h >>> 0;
}

/** mulberry32: fast 32-bit PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** The generator's whole state (one uint32), for saving; setState(getState()) continues the same sequence. */
  next.getState = () => a;
  next.setState = (value) => {
    a = value >>> 0;
  };
  return next;
}

/** Convenience wrapper around a seeded PRNG. */
export function createRng(seed) {
  const next = mulberry32(seed);
  return {
    seed: seed >>> 0,
    next,
    getState: next.getState,
    setState: next.setState,
    /** Float in [min, max). */
    range: (min, max) => min + (max - min) * next(),
    /** Integer in [min, max], both inclusive. */
    int: (min, max) => min + Math.floor((max - min + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    /** Standard normal sample (Box–Muller). */
    gauss: () => {
      let u = 0;
      while (u === 0) u = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    /** Independent generator derived from this seed and a label. */
    fork: (label) => createRng(hash32(seed, label)),
  };
}

const smooth = (t) => t * t * (3 - 2 * t);

/** 1D value noise in [-1, 1]; the lattice repeats every 256 units. */
export function makeNoise1D(seed) {
  const r = mulberry32(seed);
  const v = new Float32Array(256);
  for (let i = 0; i < 256; i++) v[i] = r() * 2 - 1;
  return (x) => {
    const xi = Math.floor(x);
    const t = smooth(x - xi);
    const a = v[xi & 255];
    const b = v[(xi + 1) & 255];
    return a + (b - a) * t;
  };
}

/** 2D value noise in [-1, 1]; the lattice repeats every 256 units on both axes. */
export function makeNoise2D(seed) {
  const r = mulberry32(seed);
  const v = new Float32Array(256 * 256);
  for (let i = 0; i < v.length; i++) v[i] = r() * 2 - 1;
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const x0 = xi & 255;
    const x1 = (xi + 1) & 255;
    const y0 = (yi & 255) << 8;
    const y1 = ((yi + 1) & 255) << 8;
    const top = v[y0 + x0] + (v[y0 + x1] - v[y0 + x0]) * tx;
    const bottom = v[y1 + x0] + (v[y1 + x1] - v[y1 + x0]) * tx;
    return top + (bottom - top) * ty;
  };
}

/** Fractal sum of 1D noise, normalised to roughly [-1, 1]. */
export function fbm1(noise, x, octaves = 4) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq + o * 31.7);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Fractal sum of 2D noise, normalised to roughly [-1, 1]. */
export function fbm2(noise, x, y, octaves = 4) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq + o * 31.7, y * freq - o * 17.3);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

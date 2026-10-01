// Illustrated sprites from assets/art/manifest.json (mushrooms, curiosities): loaded asynchronously, looked up by
// (group, type, variant). A missing or broken manifest or image just means "no sprite": callers fall back to the
// procedural drawing, nothing here ever throws or makes a frame wait. Works on the main thread and in the world-layer
// worker (fetch + createImageBitmap; the single-file build serves fetch from memory, see tools/build/bootstrap.js).
//   loadSprites() -> Promise<number>   idempotent; resolves with the number of images ready (0 = none), never rejects
//   getSprite(group, type, variant) -> { id, img, anchor:{x,y}, w, h, worldSize } | null
//   spriteTypes(group) -> string[]     types that have at least one ready image
//   onSpritesReady(cb)                 cb() fires once the first load finished with at least one image

const ROOT = new URL('../../', import.meta.url); // the project root (the bundle maps it to rnt://app/)
const MANIFEST = 'assets/art/manifest.json';
const TIMEOUT = 8000; // ms: a silent network is given up on

let started = null;
let readyCount = 0;
const byKey = new Map(); // `${group}.${type}` -> [entry] sorted by id
const waiting = [];

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function within(promise, ms) {
  return Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
}

async function decode(res) {
  const blob = await res.blob();
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  // no createImageBitmap (very old engines): an <img> from a blob URL
  return new Promise((ok, no) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      ok(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      no(new Error('decode'));
    };
    img.src = url;
  });
}

/** Keep only well-formed manifest rows of the groups the scene uses. */
export function parseManifest(json, groups = ['mushroom', 'decor']) {
  const out = [];
  const rows = json && Array.isArray(json.assets) ? json.assets : [];
  for (const a of rows) {
    if (!a || typeof a !== 'object' || !groups.includes(a.group) || typeof a.type !== 'string' || typeof a.file !== 'string') continue;
    const w = num(a.w);
    const h = num(a.h);
    if (w <= 0 || h <= 0) continue;
    const anchor = a.anchor && typeof a.anchor === 'object' ? { x: num(a.anchor.x, w / 2), y: num(a.anchor.y, h) } : { x: w / 2, y: h };
    out.push({ id: String(a.id || `${a.group}.${a.type}`), group: a.group, type: a.type, file: a.file, w, h, anchor, worldSize: num(a.worldSize, h) });
  }
  return out;
}

async function loadOne(row) {
  try {
    const url = new URL(row.file, ROOT);
    const res = await within(fetch(url), TIMEOUT);
    if (!res.ok) return null;
    const img = await within(decode(res), TIMEOUT);
    return { ...row, img };
  } catch {
    return null; // a missing image is not an error
  }
}

function register(entry) {
  const key = `${entry.group}.${entry.type}`;
  let list = byKey.get(key);
  if (!list) byKey.set(key, (list = []));
  list.push(entry);
  list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  readyCount++;
}

export function loadSprites() {
  if (started) return started;
  started = (async () => {
    try {
      if (typeof fetch !== 'function') return 0;
      const res = await within(fetch(new URL(MANIFEST, ROOT)), TIMEOUT);
      if (!res.ok) return 0;
      const rows = parseManifest(await res.json());
      const loaded = await Promise.all(rows.map(loadOne));
      for (const e of loaded) if (e) register(e);
    } catch {
      /* no manifest, no sprites */
    }
    if (readyCount > 0) for (const cb of waiting.splice(0)) safe(cb);
    return readyCount;
  })();
  return started;
}

function safe(cb) {
  try {
    cb();
  } catch (err) {
    console.error('[sprites]', err);
  }
}

/** cb() once the sprites are ready (right away if they already are). Never fires when nothing could be loaded. */
export function onSpritesReady(cb) {
  if (readyCount > 0) safe(cb);
  else waiting.push(cb);
}

export function spritesReady() {
  return readyCount > 0;
}

/** variant: any integer (or undefined); picks one of the type's images deterministically. */
export function getSprite(group, type, variant = 0) {
  const list = byKey.get(`${group}.${type}`);
  if (!list || list.length === 0) return null;
  const v = Math.floor(Math.abs(num(variant)));
  return list[v % list.length];
}

export function spriteTypes(group) {
  const out = [];
  for (const [key, list] of byKey) if (list.length && key.startsWith(`${group}.`)) out.push(key.slice(group.length + 1));
  return out;
}

/** Test hook: install sprites without any network. */
export function _setSpritesForTest(entries) {
  byKey.clear();
  readyCount = 0;
  started = Promise.resolve(entries.length);
  for (const e of entries) register(e);
}

/* ------------------------------------------------------------------ pre-filtered levels and washes */

function scratch(w, h) {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (typeof document === 'undefined') return new OffscreenCanvas(cw, ch);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  return c;
}

/**
 * A copy of `entry.img` that is at least `pxH` device pixels tall, and no more than twice that: halved step by step so
 * the later drawImage downscale stays under 2:1 (a 320 px painting squeezed to 60 px in one go aliases).
 * Returns { src, h } where h is the level's pixel height; draw it into the rectangle of the entry's full size.
 */
export function levelFor(entry, pxH) {
  const levels = entry.levels || (entry.levels = [{ src: entry.img, w: entry.w, h: entry.h }]);
  let last = levels[levels.length - 1];
  while (last.h / 2 >= Math.max(8, pxH) && levels.length < 8) {
    const w = Math.max(1, Math.round(last.w / 2));
    const h = Math.max(1, Math.round(last.h / 2));
    const c = scratch(w, h);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(last.src, 0, 0, w, h);
    last = { src: c, w, h };
    levels.push(last);
  }
  return last;
}

const WASH_COLD = 'rgba(88,82,92,0.5)';

/**
 * A winter «wilted» copy of an image or canvas: the same silhouette, greyed and darkened, with a cap of snow along
 * the top. Cached on the source. `src` is anything drawImage takes with a known size (sw, sh).
 */
const washes = new WeakMap();
export function washed(src, sw, sh) {
  let c = washes.get(src);
  if (c) return c;
  c = scratch(sw, sh);
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = WASH_COLD;
  g.fillRect(0, 0, c.width, c.height);
  const snow = g.createLinearGradient(0, 0, 0, c.height * 0.42);
  snow.addColorStop(0, 'rgba(240,245,251,0.96)');
  snow.addColorStop(0.55, 'rgba(232,240,248,0.7)');
  snow.addColorStop(1, 'rgba(232,240,248,0)');
  g.fillStyle = snow;
  g.fillRect(0, 0, c.width, c.height * 0.42);
  washes.set(src, c);
  return c;
}

/* ------------------------------------------------------------------ which look a mushroom gets */

export const TREE_MUSHROOM = { birch: 'fly_agaric', oak: 'porcini', pine: 'saffron_milk_cap' };
// mushroom images that belong to the honey-fungus rival (mushroom.honey.N): the player's fruit bodies never wear them
export const RIVAL_MUSHROOM_TYPES = new Set(['honey']);
const OWN_SPECIES = new Set(['fly_agaric', 'porcini', 'chanterelle', 'saffron_milk_cap']);
const TREE_REACH = 300; // world units: a mushroom farther from every trunk keeps to the open-ground kinds
const hashInt = (...v) => {
  let h = 0x811c9dc5;
  for (const x of v) {
    const s = String(x);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
};

/**
 * The species whose illustration a fruit body wears, stable per mushroom: its own species when the sim sets a
 * specific one; otherwise by the nearest tree (birch fly agaric, oak porcini, pine saffron milk cap, about three of
 * four beside a tree), else common / chanterelle by its variant.
 */
export function mushroomLook(m, trees) {
  if (m && OWN_SPECIES.has(m.species) && !RIVAL_MUSHROOM_TYPES.has(m.species)) return m.species;
  const id = m && m.id !== undefined ? m.id : 0;
  const variant = m && m.variant !== undefined ? m.variant : 0;
  const roll = hashInt('mushroom-look', id, variant) % 100;
  let near = null;
  let best = TREE_REACH;
  for (const t of Array.isArray(trees) ? trees : []) {
    const d = Math.abs(num(t && t.x) - num(m && m.x));
    if (d < best && TREE_MUSHROOM[t.species]) {
      best = d;
      near = t;
    }
  }
  if (near && roll < 75) return TREE_MUSHROOM[near.species];
  return roll % 2 === 0 ? 'common' : 'chanterelle';
}

/** The sprite entry for a mushroom (falls back to the common species when its own has no image), or null. */
export function mushroomSprite(m, trees) {
  let type = mushroomLook(m, trees);
  if (RIVAL_MUSHROOM_TYPES.has(type)) type = 'common';
  const pick = hashInt('mushroom-sprite', m && m.id !== undefined ? m.id : 0, m && m.variant !== undefined ? m.variant : 0);
  return getSprite('mushroom', type, pick) || getSprite('mushroom', 'common', pick);
}

/** The rival's old cut stump illustration (decor.stump.N) for a stump id, or null (the renderer then paints it in ink). */
export function stumpSprite(id = 0) {
  return getSprite('decor', 'stump', hashInt('stump-sprite', id));
}

/** A honey-mushroom (mushroom.honey.N) illustration for a cluster id, or null (procedural caps then). */
export function honeySprite(id = 0) {
  return getSprite('mushroom', 'honey', hashInt('honey-sprite', id));
}

/* ------------------------------------------------------------------ small pure helpers of the scene */

const smooth = (u) => {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  return x * x * (3 - 2 * x);
};

/** How wilted the fruit bodies are, 0..1: they droop and grey as winter sets in and recover in early spring. */
export function wiltTarget(flags, clock) {
  if (!flags || !flags.seasons || !clock) return 0;
  const f = num(clock.seasonFrac);
  if (clock.season === 'winter') return smooth(f / 0.15);
  if (clock.season === 'spring' && num(clock.year) > 0) return 1 - smooth(f / 0.2);
  return 0;
}

/** Size of a growing fruit body relative to its full size: a nub at first, then quickly a recognisable mushroom. */
export function growScale(g) {
  const x = g < 0 ? 0 : g > 1 ? 1 : num(g);
  return 0.1 + 0.9 * Math.pow(x, 0.75);
}

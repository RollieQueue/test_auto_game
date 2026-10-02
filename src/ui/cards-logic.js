// The HUD cards (resources top-left, objectives top-right) must not hide what the player is looking at:
// this is the pure part that says what lies under a card (screen rect). No DOM.
import { CROWN_HALF } from '../world/generate.js';
import { hash32 } from '../core/rng.js';
import { mushroomSprite, growScale } from '../render/sprites.js';

const STAGE_H = [70, 140, 205, 255]; // as in render/trees-model.js (full height of a tree per stage)
const CROWN_SHARE = [0.3, 0.55, 0.85, 1]; // how much of the full crown width is grown at each stage
// A mushroom without a loaded illustration (the procedural body is shown meanwhile) is about this big, world units.
const MUSHROOM_HALF = 28;
const MUSHROOM_UP = 58;
const MUSHROOM_DOWN = 4;
const PAD = 6; // CSS px: a thing this close to the card edge counts as under it

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * World box {l, r, t, b} of what a mushroom draws. With its illustration loaded (render/mushrooms.js: the picture is
 * worldSize tall times the per-mushroom size 0.92..1.08 and the growth scale, its anchor at the stalk base, mirrored
 * for half of them) this is the picture's own rectangle; without one, a plain box of the same order.
 */
export function mushroomBox(m, trees) {
  const x = num(m.x);
  const y = num(m.baseY);
  const il = mushroomSprite(m, trees);
  if (!il) return { l: x - MUSHROOM_HALF, r: x + MUSHROOM_HALF, t: y - MUSHROOM_UP, b: y + MUSHROOM_DOWN };
  const h = hash32('mushroom', m.id === undefined ? 0 : m.id);
  const size = 0.92 + 0.16 * ((h & 1023) / 1023);
  const mirror = ((h >>> 10) & 1023) / 1023 < 0.5;
  const g = Math.max(0, Math.min(1, num(m.growth)));
  const k = (il.worldSize * size * growScale(g)) / il.h; // world units per image pixel
  const left = (mirror ? il.w - il.anchor.x : il.anchor.x) * k;
  const right = (mirror ? il.anchor.x : il.w - il.anchor.x) * k;
  const sink = 0.05 * il.worldSize * size; // the stalk base sits a hair below the ground line
  return { l: x - left, r: x + right, t: y + sink - il.anchor.y * k, b: y + sink + (il.h - il.anchor.y) * k };
}

/** World -> screen rect {l, t, r, b} of a mushroom as drawn (`trees`: state.world.trees, for the species look). */
export function mushroomRect(m, view, trees) {
  const box = mushroomBox(m, trees);
  const s = view.scale;
  return { l: box.l * s + view.ox, r: box.r * s + view.ox, t: box.t * s + view.oy, b: box.b * s + view.oy };
}

/** World -> screen rect of the leafy part of a tree crown (the upper part of the tree, as wide as it has grown). */
export function crownRect(tree, view) {
  const stage = Math.max(0, Math.min(3, Math.floor(num(tree.stage))));
  const half = (CROWN_HALF[tree.species] || 130) * CROWN_SHARE[stage];
  const h = STAGE_H[stage];
  const s = view.scale;
  const y = num(tree.baseY);
  return {
    l: (num(tree.x) - half) * s + view.ox,
    r: (num(tree.x) + half) * s + view.ox,
    t: (y - h) * s + view.oy,
    b: (y - h * 0.4) * s + view.oy,
  };
}

const overlaps = (a, b) => a.l < b.r + PAD && a.r > b.l - PAD && a.t < b.b + PAD && a.b > b.t - PAD;

/**
 * What lies under the card `rect` (screen px): { mushrooms, crowns } counts. `view` = { scale, ox, oy }.
 * A card with something under it turns see-through (see hud.css .behind).
 */
export function coverage(state, view, rect) {
  const out = { mushrooms: 0, crowns: 0 };
  if (!state || !view || !(view.scale > 0) || !rect || rect.r - rect.l < 2) return out;
  const trees = (state.world && state.world.trees) || [];
  for (const m of state.mushrooms || []) if (overlaps(rect, mushroomRect(m, view, trees))) out.mushrooms += 1;
  for (const t of trees) if (overlaps(rect, crownRect(t, view))) out.crowns += 1;
  return out;
}

/** True when the pointer (screen px, or null) lies inside the rect. */
export function pointerIn(p, rect, pad = 6) {
  return Boolean(p && rect && p.sx >= rect.l - pad && p.sx <= rect.r + pad && p.sy >= rect.t - pad && p.sy <= rect.b + pad);
}

/**
 * The look of a card from what is under it and the pointer: 'solid' (nothing there), 'pointer' (only the pointer is
 * on it: a little see-through, the world below stays workable), 'behind' (a mushroom or crown is under it: very
 * see-through), 'pointed' (both: see-through, but readable enough for a tooltip).
 */
export function cardMode(cover, pointerOnCard) {
  const under = Boolean(cover) && cover.mushrooms + cover.crowns > 0;
  if (under) return pointerOnCard ? 'pointed' : 'behind';
  return pointerOnCard ? 'pointer' : 'solid';
}

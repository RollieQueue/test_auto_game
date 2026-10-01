// The HUD cards (resources top-left, objectives top-right) must not hide what the player is looking at:
// this is the pure part that says what lies under a card (screen rect). No DOM.
import { CROWN_HALF } from '../world/generate.js';

const STAGE_H = [70, 140, 205, 255]; // as in render/trees-model.js (full height of a tree per stage)
const CROWN_SHARE = [0.3, 0.55, 0.85, 1]; // how much of the full crown width is grown at each stage
const MUSHROOM_HALF = 38; // world units: a cap with its spore haze, wider than it looks
const MUSHROOM_UP = 100;
const MUSHROOM_DOWN = 8;
const PAD = 6; // CSS px: a thing this close to the card edge counts as under it

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** World -> screen rect {l, t, r, b} of a mushroom (a generous box round the cap and stalk). */
export function mushroomRect(m, view) {
  const x = num(m.x);
  const y = num(m.baseY);
  const s = view.scale;
  return {
    l: (x - MUSHROOM_HALF) * s + view.ox,
    r: (x + MUSHROOM_HALF) * s + view.ox,
    t: (y - MUSHROOM_UP) * s + view.oy,
    b: (y + MUSHROOM_DOWN) * s + view.oy,
  };
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
  for (const m of state.mushrooms || []) if (overlaps(rect, mushroomRect(m, view))) out.mushrooms += 1;
  for (const t of (state.world && state.world.trees) || []) if (overlaps(rect, crownRect(t, view))) out.crowns += 1;
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

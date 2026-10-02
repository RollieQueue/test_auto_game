// The HUD cards (resources top-left, objectives top-right) must not hide what the player is looking at:
// this is the pure part that says what lies under a card (screen rect). No DOM.
import { CROWN_HALF } from '../world/generate.js';
import { hash32 } from '../core/rng.js';
import { clumpCaps } from '../world/clump.js';
import { groundYAt } from '../world/query.js';
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
export function mushroomBox(m, trees, world) {
  const x = num(m.x);
  const y = num(m.baseY);
  const il = mushroomSprite(m, trees);
  const main = il ? spriteBox(m, il, x, y) : { l: x - MUSHROOM_HALF, r: x + MUSHROOM_HALF, t: y - MUSHROOM_UP, b: y + MUSHROOM_DOWN };
  // the small caps of the clump (seeded, see world/clump.js) widen the box to the whole clump
  for (const c of clumpCaps(world, m, groundYAt).slice(1)) {
    main.l = Math.min(main.l, c.x - MUSHROOM_HALF * c.scale);
    main.r = Math.max(main.r, c.x + MUSHROOM_HALF * c.scale);
    main.t = Math.min(main.t, c.y - MUSHROOM_UP * c.scale);
    main.b = Math.max(main.b, c.y + MUSHROOM_DOWN * c.scale);
  }
  return main;
}

function spriteBox(m, il, x, y) {
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
export function mushroomRect(m, view, trees, world) {
  const box = mushroomBox(m, trees, world);
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
  for (const m of state.mushrooms || []) if (overlaps(rect, mushroomRect(m, view, trees, state.world))) out.mushrooms += 1;
  for (const t of trees) if (overlaps(rect, crownRect(t, view))) out.crowns += 1;
  return out;
}

/** True when the pointer (screen px, or null) lies inside the rect. */
export function pointerIn(p, rect, pad = 6) {
  return Boolean(p && rect && p.sx >= rect.l - pad && p.sx <= rect.r + pad && p.sy >= rect.t - pad && p.sy <= rect.b + pad);
}

/**
 * The look of a card from what is under it and the pointer: 'solid' (nothing there), 'pointer' (only the pointer is
 * on it: a hair see-through, the world below stays workable), 'behind' (a mushroom or crown is under it), 'pointed'
 * (both: readable enough for a tooltip). A card never goes below MIN_CARD_OPACITY: what it hides is handled by
 * folding it (wantFold, foldStep), not by making the numbers hard to read.
 */
export function cardMode(cover, pointerOnCard) {
  const under = Boolean(cover) && cover.mushrooms + cover.crowns > 0;
  if (under) return pointerOnCard ? 'pointed' : 'behind';
  return pointerOnCard ? 'pointer' : 'solid';
}

export const MIN_CARD_OPACITY = 0.85; // a card is never more see-through than this (playtest 3: 0.36 was unreadable)
/** Opacity of a card per cardMode; hud.css (.m-pointer, .m-behind, .m-pointed) carries the same numbers. */
export const CARD_OPACITY = { solid: 1, pointer: 0.94, behind: 0.9, pointed: 0.87 };

const total = (c) => (c ? c.mushrooms + c.crowns : 0);

/** True when folding the resources card to its header and sugar row would free something it hides (`full`, `folded`: coverage of each rect). */
export const wantFold = (full, folded) => total(full) > 0 && total(folded) < total(full);

export const FOLD_AFTER = 1.2; // s something has to lie under the card before it folds (a passing crown does not flicker it)
export const UNFOLD_AFTER = 0.6; // s it must be clear before it opens again

/**
 * One step of the fold: `f` = { folded, t } (t: s the wish differs from the state). The pointer on the card opens it at
 * once (the numbers are for reading); otherwise the wish must hold for FOLD_AFTER / UNFOLD_AFTER seconds.
 */
export function foldStep(f, want, pointerOn, dt) {
  if (pointerOn) return { folded: false, t: 0 };
  if (want === f.folded) return { folded: f.folded, t: 0 };
  const t = f.t + dt;
  if (t >= (want ? FOLD_AFTER : UNFOLD_AFTER)) return { folded: want, t: 0 };
  return { folded: f.folded, t };
}

/** World -> screen rect of an old stump as drawn (the cut trunk, its roots and the honey tufts round its foot). */
export function stumpRect(stump, view) {
  const r = Math.max(14, Math.min(60, num(stump.r) || 28));
  const s = view.scale;
  return {
    l: (num(stump.x) - 2.2 * r) * s + view.ox,
    r: (num(stump.x) + 2.2 * r) * s + view.ox,
    t: (num(stump.y) - 3 * r) * s + view.oy,
    b: (num(stump.y) + 0.6 * r) * s + view.oy,
  };
}

/** How many of the rival's stumps lie under the screen rect `rect` (none when the game has no rival: they are not drawn then). */
export function stumpsUnder(state, view, rect) {
  const list = state && state.rival && typeof state.rival === 'object' && state.world && state.world.stumps;
  if (!Array.isArray(list) || !view || !(view.scale > 0) || !rect) return 0;
  let n = 0;
  for (const st of list) if (st && Number.isFinite(st.x) && Number.isFinite(st.y) && overlaps(rect, stumpRect(st, view))) n += 1;
  return n;
}

// The objectives card measured open: 19.7 em x 15.9 em (17.6 x 14.1 in a small window), from its top right corner.
const OBJ_OPEN = { w: 19.7, h: 15.9, smallW: 17.6, smallH: 14.1 };

/** The screen rect the objectives card would fill if it were open, from the rect it has now (`b`) and the font size in px. */
export function openCardRect(b, fs, small = false) {
  const w = (small ? OBJ_OPEN.smallW : OBJ_OPEN.w) * fs;
  const h = (small ? OBJ_OPEN.smallH : OBJ_OPEN.h) * fs;
  return { l: b.r - w, r: b.r, t: b.t, b: b.t + h };
}

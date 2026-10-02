// The first-encounter cards, the pure part: when a card is due and what it says. No DOM (ui/callout.js draws it).
// A card pauses the game, dims the scene round a spotlight and waits for «Понятно». There are two, each once per player:
//   worm  -> the first nematode that is really on screen (it also reveals the ring tool, src/sim/tools.js);
//   rival -> the honey fungus wakes (the barrier tool is revealed by the state itself).
import { toolRevealed } from '../sim/tools.js';
import { threatsOn } from './threats.js';

export const CARD_BUTTON = 'Понятно';

export const CARDS = {
  worm: {
    title: 'Нематода',
    text: 'Тонкая нить, которую она перекусит, рвётся, и всё за укусом отмирает. Нажми {3} и поставь ловчее кольцо на нить у неё на пути: червь застрянет в нём.',
  },
  rival: {
    title: 'Проснулся опёнок',
    text: 'От старого пня потянутся чёрные шнуры к корням деревьев. Нажми {4} и поставь барьер на нить рядом с захватом: шнуры вокруг растворятся.',
  },
};

const EDGE = 56; // px: a worm nearer the window's edge than this is not "on screen" for the card
const CARD_GAP = 14; // px: the margin kept round a HUD card
const FADED_IN = 0.9; // a worm that has not fully surfaced is no use to point at
const SPOT_R = 60; // world units: the radius of the spotlight round a worm

/** World -> CSS px. */
export const toScreen = (view, x, y) => ({ x: x * view.scale + view.ox, y: y * view.scale + view.oy });

/** The point (CSS px) lies inside the window, clear of its edge, and not under any of the HUD rectangles { l, t, r, b }. */
export function pointClear(view, rects, p, edge = EDGE, gap = CARD_GAP) {
  if (p.x < edge || p.y < edge || p.x > view.cssW - edge || p.y > view.cssH - edge) return false;
  return !rects.some((r) => p.x > r.l - gap && p.x < r.r + gap && p.y > r.t - gap && p.y < r.b + gap);
}

/** The oldest worm that is fully surfaced, not leaving, and on screen clear of the HUD cards; null when none is. */
export function visibleWorm(state, view, rects) {
  let best = null;
  for (const w of state.fauna || []) {
    if (!w || w.mode === 'leave' || !(w.fade >= FADED_IN)) continue;
    if (!pointClear(view, rects, toScreen(view, w.x, w.y))) continue;
    if (!best || w.age > best.age) best = w;
  }
  return best;
}

/**
 * The first worm the player can see, while the ring is still hidden: { x, y } of the worm in world units, or null.
 * `open` is true while a page (title, pause, help, atlas, summary, year) or another card is up: nothing is due then.
 */
export function wormDue(state, view, rects, open) {
  if (open || !view || !(view.scale > 0) || !threatsOn(state) || state.phase !== 'playing') return null;
  if (toolRevealed(state, 'trap') || state.ui.drag || state.ui.card) return null;
  const w = visibleWorm(state, view, rects);
  return w ? { x: w.x, y: w.y } : null;
}

/** The card the waking of the honey fungus opens: { x, y } of the old stump (world units; `spot` says whether it is on screen), or null. */
export function rivalDue(state, view, rects, ev, open) {
  if (open || !view || !(view.scale > 0) || !threatsOn(state) || state.phase !== 'playing' || state.ui.card) return null;
  if (!ev || ev.type !== 'rival-wake' || state.time < 5) return null; // ?rival=1 wakes it at the first second: no card for a glade that has just begun
  const spot = Number.isFinite(ev.x) && Number.isFinite(ev.y) && pointClear(view, rects, toScreen(view, ev.x, ev.y), 24);
  return { x: ev.x, y: ev.y, spot };
}

/** Spotlight radius in CSS px. */
export const spotRadius = (view) => SPOT_R * view.scale;

// Where a floating label goes: at its event, inside the window, apart from the labels already floating and clear
// of the rectangles it must not cross (the column of margin notes). Pure, no DOM.
// A label is anchored by its bottom centre, then floats up by RISE of its own height while it lives (hud.css lab-float).

export const LABEL_LIFE = 2.7; // s, as in labels.js
export const RISE = 1.1; // heights climbed over the life of a label
const GAP = 3; // px between stacked labels
const AIR = 4; // px of air round an avoided rectangle
const STEPS = 8; // how many label-heights away from the event a label may be moved

const hits = (a, b) => a.l < b.r + AIR && a.r > b.l - AIR && a.t < b.b + AIR && a.b > b.t - AIR;

/** Screen rect a label sweeps over its whole life (spawn spot to the top of its float). */
export function sweptRect(x, y, w, h) {
  return { l: x - w / 2, r: x + w / 2, t: y - h * (1 + RISE), b: y };
}

/**
 * @param {{x:number, y:number, w:number, h:number}} lab  wanted bottom-centre (x already inside the window), size
 * @param {{x:number, y:number, w:number, h:number, age:number}[]} others  floating labels (y = their spawn bottom, age in s)
 * @param {{l,t,r,b}[]} avoid  rectangles to stay out of (checked over the whole float)
 * @param {{w:number, h:number}} win  window size
 * @returns {number} the bottom y to use
 */
export function placeLabelY(lab, others, avoid, win) {
  const { x, w, h } = lab;
  const step = h + GAP;
  const inside = (y) => y - h >= 4 && y <= win.h - 4;
  const apart = (y) =>
    !others.some((l) => Math.abs(l.x - x) < (l.w + w) / 2 + 4 && Math.abs(l.y - (l.age / LABEL_LIFE) * RISE * l.h - y) < h + 2);
  const clear = (y) => !avoid.some((a) => hits(sweptRect(x, y, w, h), a));
  let fallback = null; // first spot apart from the other labels (if the notes cannot be avoided)
  for (let k = 0; k <= STEPS * 2; k++) {
    // 0, up one, down one, up two, ...
    const n = Math.ceil(k / 2);
    const y = lab.y + (k % 2 === 1 ? -n : n) * step;
    if (!inside(y) || !apart(y)) continue;
    if (clear(y)) return y;
    if (fallback === null) fallback = y;
  }
  return fallback === null ? Math.max(h + 4, lab.y) : fallback;
}

export const MERGE_RADIUS = 70; // CSS px: a repeat this close restarts the label instead of adding another
export const DENIAL_WINDOW = 1.6; // s: a refusal of the same kind within this time belongs to the same action, wherever it is drawn

const SUGAR_KEY = /^(insufficient|denied:sugar|barrier:denied:sugar|trap:denied:sugar)/;

/**
 * Which refusal a label key is: 'sugar' for any lack of sugar (the plain «не хватает сахара», a mushroom, a ring or a
 * barrier), the key itself for the other refusals (crowded, deep, ...), null for labels that are no refusal.
 */
export function denialFamily(key) {
  if (typeof key !== 'string') return null;
  if (SUGAR_KEY.test(key)) return 'sugar';
  return /denied/.test(key) ? key : null;
}

/** The family of what a cursor tooltip says (hud tooltip «Не хватает сахара (нужно 20)»), null when it is no refusal. */
export const tooltipDenialFamily = (main) => (typeof main === 'string' && /^не хватает сахара/i.test(main.trim()) ? 'sugar' : null);

/**
 * The floating label a new one at screen (sx, sy) with `key` folds into, or null. `labels`: { key, sx, sy, age } of those
 * floating. A repeat of the same label near the same place counts up; so does a refusal of the same family while the
 * first one is young: one action shows one refusal, whichever layer of the game reported it.
 */
export function findRepeat(labels, key, sx, sy) {
  const family = denialFamily(key);
  for (const l of labels) {
    if (l.key === key && Math.hypot(l.sx - sx, l.sy - sy) < MERGE_RADIUS) return l;
    if (family && denialFamily(l.key) === family && l.age < DENIAL_WINDOW) return l;
  }
  return null;
}

const SUGAR_DENIALS = new Set(['fruit-denied', 'trap-denied', 'barrier-denied']);
const SAME_SPOT = 60; // world units: an «insufficient» this close to a refusal belongs to the same click

/** Where this frame's events refused something for lack of sugar (a mushroom, a ring or a barrier on a node). */
export function sugarDenialSpots(events) {
  const spots = [];
  for (const ev of events || []) {
    if (SUGAR_DENIALS.has(ev.type) && ev.reason === 'sugar' && typeof ev.x === 'number' && typeof ev.y === 'number') spots.push({ x: ev.x, y: ev.y });
  }
  return spots;
}

/** True when `ev` lies within SAME_SPOT of one of the spots. */
export const nearAny = (spots, ev) => spots.some((p) => Math.hypot(p.x - ev.x, p.y - ev.y) < SAME_SPOT);

const SHIFT_STEP = 16; // px between the spots tried for the note stack

/**
 * How far (px, + is right) to slide the stack of margin notes from its centred spot so that it covers fewer tree crowns
 * and mushrooms. `box`: { cx, w, t, h } the centred stack (centre x, width, top, height); `span`: { l, r } where it may
 * lie (between the cards); `things`: screen rects { l, t, r, b, w } with the weight of each (what it hides if covered).
 * Ties keep the smaller move, so a free stack stays centred.
 */
export function notesShift(box, span, things) {
  const room = span.r - span.l - box.w;
  if (!(room > 0)) return 0;
  const lo = Math.min(0, Math.ceil((span.l + box.w / 2 - box.cx) / SHIFT_STEP) * SHIFT_STEP);
  const hi = Math.max(0, Math.floor((span.r - box.w / 2 - box.cx) / SHIFT_STEP) * SHIFT_STEP);
  let best = 0;
  let bestScore = Infinity;
  for (let dx = lo; dx <= hi; dx += SHIFT_STEP) {
    const l = box.cx + dx - box.w / 2;
    let score = 0;
    for (const r of things) if (l < r.r && l + box.w > r.l && box.t < r.b && box.t + box.h > r.t) score += r.w ?? 1;
    score += Math.abs(dx) / 1e4; // a tie keeps the smaller move
    if (score < bestScore) {
      bestScore = score;
      best = dx;
    }
  }
  return best;
}

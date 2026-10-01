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

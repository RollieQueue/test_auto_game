// Where the pointer tooltip goes: beside the pointer (or its anchor), inside the window, and clear of the
// rectangles it must not cover (the guide's note). Pure, no DOM.

const EDGE = 6; // px kept free at the window edge
const GAP = 4; // px of air around an avoided rectangle

const hits = (a, b) => a.l < b.r + GAP && a.r > b.l - GAP && a.t < b.b + GAP && a.b > b.t - GAP;

/**
 * @param {{x:number, y:number}} pt   the pointer, or the anchor of a tooltip that sits beside a HUD row
 * @param {{w:number, h:number}} size  size of the tooltip
 * @param {{vw:number, vh:number}} win  window size
 * @param {{l:number,t:number,r:number,b:number}[]} avoid  rectangles the tooltip should not cover
 * @param {boolean} anchored  true for a tooltip with an anchor (it sits to the right of it, not under the pointer)
 * @returns {{x:number, y:number, rect:{l,t,r,b}, covers:boolean}} `covers`: no free spot was found, `rect` overlaps an avoided one
 */
export function placeTip(pt, size, win, avoid = [], anchored = false) {
  const { w, h } = size;
  const { vw, vh } = win;
  const dx = anchored ? 0 : 16;
  const dy = anchored ? 0 : 20;
  const side = (right) => (right ? pt.x + dx : pt.x - w - 12);
  const rise = (below) => (below ? pt.y + dy : pt.y - h - 14);
  const fits = (x, y) => x + w <= vw - EDGE && x >= 4 && y + h <= vh - EDGE && y >= 4;
  // the usual spot first (right and below, flipping at the window edge), then the other corners of the pointer
  const order = [
    [true, true],
    [false, true],
    [true, false],
    [false, false],
  ];
  let usual = null;
  let free = null;
  for (const [right, below] of order) {
    const x = Math.max(4, side(right));
    const y = Math.max(4, rise(below));
    const rect = { l: x, t: y, r: x + w, b: y + h };
    const cand = { x, y, rect, covers: avoid.some((a) => hits(rect, a)) };
    if (!usual && fits(x, y)) usual = cand;
    if (!free && fits(x, y) && !cand.covers) free = cand;
  }
  if (free) return free;
  if (usual) return usual;
  // nothing fits whole (a tiny window): clamp the usual spot
  const x = Math.max(4, Math.min(vw - w - EDGE, side(true)));
  const y = Math.max(4, Math.min(vh - h - EDGE, rise(true)));
  const rect = { l: x, t: y, r: x + w, b: y + h };
  return { x, y, rect, covers: avoid.some((a) => hits(rect, a)) };
}

/** True when the two rectangles overlap (with a little air). */
export const rectsTouch = hits;

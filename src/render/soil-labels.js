// Where the names of the soil horizons are lettered in the margin. Pure and DOM-free (unit-tested); terrain.js paints them.
// The names come from the biome (world/biomes.js look.labels), so a podzol reads «Подзол», «Иллювий» and a chernozem
// «Чернозёмный гумус». They stand in the LEFT margin, past the ruler: the HUD cards never hide it below the resource
// card, while the objectives card (top right, open at the start of a page) hides most of the right margin. The one row
// that lies beside the resource card (the litter, at some window sizes) is lettered at the right edge instead. A label
// that would stand on a water pool, a mineral pocket or a rock slides to the next free line of its band.
import { horizonLabel } from '../world/biomes.js';

/**
 * The resource card, in world units from the viewport's left edge and top, for a window where one css pixel is
 * `u` world units (measured at u = 1, 1.2 and 1.5: the card is about as wide in css pixels as the window allows, so it
 * grows in world units as the window shrinks); a little generous. Floating labels avoid it the same way (hud.js).
 */
export const cardZone = (u) => ({ r: 160 + 150 * u, b: 150 + 127 * u });

/** Margin of the label column from the left edge of the page, in css pixels (the depth ruler and its numerals end before). */
export const LABEL_INSET = 54;
export const LABEL_FONT = 15;
/** Wider than the italic serif really runs (about 0.5 em a letter), so a label never kisses an object it was slid past. */
const GLYPH_W = 0.6;
/** The air kept between a label and a pool, a pocket or a rock, in css pixels (they are painted with a dark halo). */
const OBJ_PAD = 8;

/** The boxes (world units) that a label must not lie on: water pools, mineral pockets, rocks. */
export function obstacleBoxes(world, pad = 0) {
  const boxes = [];
  for (const w of world.water || []) boxes.push({ x0: w.x - w.rx - pad, x1: w.x + w.rx + pad, y0: w.y - w.ry - pad, y1: w.y + w.ry + pad });
  for (const m of world.minerals || []) boxes.push({ x0: m.x - m.r - pad, x1: m.x + m.r + pad, y0: m.y - m.r - pad, y1: m.y + m.r + pad });
  for (const r of world.rocks || []) boxes.push({ x0: r.minX - pad, x1: r.maxX + pad, y0: r.minY - pad, y1: r.maxY + pad });
  return boxes;
}

/**
 * Slides a label's line to the next free y: past the objects it lies on, down first (the natural way to read on), up when
 * the band ends below. `lo`..`hi` is the band the line may stand in. Returns the line's y, or `y` when nothing fits.
 */
export function freeLabelY(y, x0, x1, half, boxes, lo, hi) {
  const hit = (yy) => boxes.filter((b) => b.x0 < x1 && b.x1 > x0 && b.y0 < yy + half && b.y1 > yy - half);
  if (!hit(y).length) return y;
  for (const dir of [1, -1]) {
    let yy = y;
    for (let n = 0; n < 8; n++) {
      const bs = hit(yy);
      if (!bs.length) break;
      yy = dir > 0 ? Math.max(...bs.map((b) => b.y1)) + half : Math.min(...bs.map((b) => b.y0)) - half;
      if (yy < lo || yy > hi) break;
    }
    if (yy >= lo && yy <= hi && !hit(yy).length) return yy;
  }
  return y;
}

/**
 * One label per horizon: [{ id, text, x, y, align: 'left' }]. ext: the visible span of the page
 * ({ x0, y0, y1 }); topY(i, x) / botY(i, x): the horizon's boundaries; u: world units per css pixel.
 */
export function labelLayout(world, ext, { topY, botY, unit = 1 }) {
  const u = unit;
  const zone = cardZone(u);
  const colX = ext.x0 + LABEL_INSET * u;
  const boxes = obstacleBoxes(world, OBJ_PAD * u);
  return world.horizons.map((h, i) => {
    const text = horizonLabel(world, h);
    const band = (x) => ({ ty: topY(i, x), by: Math.min(botY(i, x), ext.y1) });
    const rowY = (x) => {
      const { ty, by } = band(x);
      const y = ty + Math.max(LABEL_FONT * u, (by - ty) * 0.25);
      return Math.max(ty + 9 * u, Math.min(y, by - 12 * u));
    };
    const clear = (ext.y0 || 0) + zone.b + 12 * u; // the lowest the resource card reaches, and the text's half height
    let x = colX;
    let y = rowY(x);
    let align = 'left';
    if (y < clear) {
      // lower in its own band if it fits there (a thick band), else at the right edge
      const { by } = band(x);
      if (clear <= by - 12 * u) y = clear;
      else {
        x = ext.x1 - 16 * u;
        y = rowY(x);
        align = 'right';
      }
    }
    // slid past a pool, a pocket or a rock that lies where the text would stand (within its own band, below the card)
    const w = text.length * LABEL_FONT * GLYPH_W * u;
    const { ty, by } = band(x);
    const lo = Math.max(ty + 9 * u, align === 'left' ? clear : -Infinity);
    y = freeLabelY(y, align === 'right' ? x - w : x, align === 'right' ? x : x + w, (LABEL_FONT / 2 + 1) * u, boxes, lo, by - 12 * u);
    return { id: h.id, text, x, y, align };
  });
}

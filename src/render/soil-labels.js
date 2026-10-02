// Where the names of the soil horizons are lettered in the margin. Pure and DOM-free (unit-tested); terrain.js paints them.
// The names come from the biome (world/biomes.js look.labels), so a podzol reads «Подзол», «Иллювий» and a chernozem
// «Чернозёмный гумус». They stand in the LEFT margin, past the ruler: the HUD cards never hide it below the resource
// card, while the objectives card (top right, open at the start of a page) hides most of the right margin. The one row
// that lies beside the resource card (the litter, at some window sizes) is lettered at the right edge instead.
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

/**
 * One label per horizon: [{ id, text, x, y, align: 'left' }]. ext: the visible span of the page
 * ({ x0, y0, y1 }); topY(i, x) / botY(i, x): the horizon's boundaries; u: world units per css pixel.
 */
export function labelLayout(world, ext, { topY, botY, unit = 1 }) {
  const u = unit;
  const zone = cardZone(u);
  const colX = ext.x0 + LABEL_INSET * u;
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
    return { id: h.id, text, x, y, align };
  });
}

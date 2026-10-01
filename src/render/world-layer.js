// The static world layer: paper, sky, soil horizons, rocks, ground vegetation, curiosities and the page finish,
// painted once per world and view into a canvas of device resolution. Shared by the world-layer worker (the usual
// path, so the page never freezes while it paints) and the main thread (fallback when workers are unavailable).
// Worker-safe: no DOM access here or in the modules it uses.
import { paintPaper, paintFinish } from './paper.js';
import { paintTerrain } from './terrain.js';
import { drawDecor } from './decor.js';

/**
 * Paint the layer into `g` (a 2D context of a w × h canvas). view = { scale, ox, oy, cssW, cssH, dpr }.
 * season: optional 'spring' | 'summer' | 'autumn' | 'winter' recolours the vegetation (same picture, other pigments);
 * undefined or '' gives the unseasonal look, which is the summer one.
 */
export function paintWorldLayer(g, w, h, world, view, season) {
  const s = view.scale * view.dpr;
  paintPaper(g, w, h, world.seed, view.dpr);
  g.setTransform(s, 0, 0, s, view.ox * view.dpr, view.oy * view.dpr);
  const ext = {
    x0: -view.ox / view.scale,
    y0: -view.oy / view.scale,
    x1: (view.cssW - view.ox) / view.scale,
    y1: (view.cssH - view.oy) / view.scale,
  };
  const avoidList = [
    ...world.water.map((d) => ({ x: d.x, y: d.y, r: Math.max(d.rx, d.ry) + 8 })),
    ...world.minerals.map((d) => ({ x: d.x, y: d.y, r: d.r + 8 })),
    ...world.decor.map((d) => ({ x: d.x, y: d.y, r: 24 })),
    ...world.rocks.map((d) => ({ x: d.x, y: d.y, r: d.r * 1.5 })),
  ];
  const avoid = (x, y, m) => avoidList.some((a) => Math.hypot(x - a.x, y - a.y) < a.r + m * 0.4);
  paintTerrain(g, world, ext, { avoid, cssUnit: 1 / view.scale, season });
  for (const d of world.decor) {
    try {
      drawDecor(g, d, { seed: world.seed });
    } catch (err) {
      console.error('[render:decor]', err);
      fallbackDecor(g, d);
    }
  }
  paintFinish(g, w, h, view.dpr);
}

function fallbackDecor(g, d) {
  g.save();
  g.translate(d.x, d.y);
  g.rotate(d.rot);
  g.fillStyle = '#b9aa8c';
  g.strokeStyle = '#2a1d14';
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(0, 0, 10 * d.scale, 6 * d.scale, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.restore();
}

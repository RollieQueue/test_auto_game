// The static world layer: paper, sky, soil horizons, rocks, ground vegetation, curiosities and the page finish,
// painted once per world and view into a canvas of device resolution. Shared by the world-layer worker (the usual
// path, so the page never freezes while it paints) and the main thread (fallback when workers are unavailable).
// Worker-safe: no DOM access here or in the modules it uses.
import { paintPaperSteps, paintFinishSteps } from './paper.js';
import { paintTerrainSteps } from './terrain.js';
import { drawDecor } from './decor.js';

/**
 * Paint the layer into `g` (a 2D context of a w × h canvas). view = { scale, ox, oy, cssW, cssH, dpr }.
 * season: optional 'spring' | 'summer' | 'autumn' | 'winter' recolours the vegetation (same picture, other pigments);
 * undefined or '' gives the unseasonal look, which is the summer one.
 */
export function paintWorldLayer(g, w, h, world, view, season) {
  for (const _ of paintSteps(g, w, h, world, view, season));
}

/**
 * The same painting in slices, for the main thread (the worker paints in one go): step(budgetMs) works until the budget
 * is spent and returns true once the plate is finished. `g` must belong to the painter until then: units of work share
 * its state (transform, clips). The result is exactly paintWorldLayer's.
 * `flush` (optional) is called after every unit so that a canvas which rasterises lazily has paid for the unit by the time
 * the clock is read, e.g. () => g.getImageData(0, 0, 1, 1) on a software canvas; without it the budget only covers the
 * recording of the drawing commands.
 *   painter.done, painter.units (units run), painter.maxUnitMs (the longest one: what a frame can be stretched by)
 */
export function createWorldPainter(g, w, h, world, view, season, flush = null) {
  const run = paintSteps(g, w, h, world, view, season);
  const painter = {
    done: false,
    units: 0,
    maxUnitMs: 0,
    step(budgetMs = 6) {
      if (painter.done) return true;
      const t0 = performance.now();
      let t = t0;
      do {
        if (run.next().done) {
          painter.done = true;
          return true;
        }
        flush?.();
        painter.units++;
        const now = performance.now();
        if (now - t > painter.maxUnitMs) painter.maxUnitMs = now - t;
        t = now;
      } while (t - t0 < budgetMs);
      return false;
    },
  };
  return painter;
}

function* paintSteps(g, w, h, world, view, season) {
  const s = view.scale * view.dpr;
  yield* paintPaperSteps(g, w, h, world.seed, view.dpr);
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
  yield* paintTerrainSteps(g, world, ext, { avoid, cssUnit: 1 / view.scale, season });
  for (const d of world.decor) {
    try {
      drawDecor(g, d, { seed: world.seed, px: s });
    } catch (err) {
      console.error('[render:decor]', err);
      fallbackDecor(g, d);
    }
    yield;
  }
  yield* paintFinishSteps(g, w, h, view.dpr);
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

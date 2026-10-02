// Module worker that paints the static world layer off the main thread (software raster, so it does not compete with
// the page for the GPU either) and hands it back as horizontal bands of ImageBitmaps (see plate-bands.js: the page uploads
// them a couple per frame instead of 33 MB in one). The single-file build folds this module and what it imports into one
// classic worker script (tools/build/worker-bundle.mjs).
//   in:  { id, w, h, world, view, season? }      out: { id, bands: [{ y, bitmap }], ms, sprites } | { id, error }
import { paintWorldLayer } from './world-layer.js';
import { loadSprites, spritesReady } from './sprites.js';
import { cutBands } from './plate-bands.js';

let fonts = null;
/** The plate lettering uses the notebook's italic; load it here too (workers do not see the page's @font-face). */
function loadFonts() {
  if (!fonts) {
    fonts = (async () => {
      try {
        if (typeof FontFace === 'undefined' || !self.fonts) return;
        // through fetch(), not a url() source: the single-file build serves fetch from memory (tools/build/bootstrap.js)
        const url = new URL('../../assets/fonts/OldStandard-Italic.woff2', import.meta.url);
        const timeout = new Promise((_, no) => setTimeout(() => no(new Error('font timeout')), 2500));
        const res = await Promise.race([fetch(url), timeout]);
        if (!res.ok) throw new Error(`font ${res.status}`);
        const face = new FontFace('Old Standard TT', await Promise.race([res.arrayBuffer(), timeout]), { style: 'italic', weight: '400' });
        await Promise.race([face.load(), timeout]);
        self.fonts.add(face);
      } catch {
        /* the fallback serif will do */
      }
    })();
  }
  return fonts;
}

let latest = 0;
self.onmessage = async (e) => {
  const job = e.data;
  latest = job.id;
  await loadFonts();
  await Promise.race([loadSprites(), new Promise((ok) => setTimeout(ok, 4000))]); // illustrations for the curiosities (none = hand-drawn)
  if (job.id !== latest) return; // a newer request arrived meanwhile
  try {
    const t0 = performance.now();
    const canvas = new OffscreenCanvas(job.w, job.h);
    const g = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    paintWorldLayer(g, job.w, job.h, job.world, job.view, job.season);
    const bands = await cutBands(canvas, job.w, job.h); // the snapshot also finishes any lazily rasterised drawing
    const ms = performance.now() - t0;
    if (job.id !== latest) {
      for (const b of bands) b.bitmap.close?.();
      return;
    }
    self.postMessage({ id: job.id, bands, ms, sprites: spritesReady() }, bands.map((b) => b.bitmap));
  } catch (err) {
    self.postMessage({ id: job.id, error: String((err && err.stack) || err) });
  }
};

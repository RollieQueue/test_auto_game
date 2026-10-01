// Module worker that paints the static world layer off the main thread (software raster, so it does not compete with
// the page for the GPU either) and hands it back as an ImageBitmap.
//   in:  { id, w, h, world, view, season? }      out: { id, bitmap, ms } | { id, error }
import { paintWorldLayer } from './world-layer.js';
import { loadSprites, spritesReady } from './sprites.js';

let fonts = null;
/** The plate lettering uses the notebook's italic; load it here too (workers do not see the page's @font-face). */
function loadFonts() {
  if (!fonts) {
    fonts = (async () => {
      try {
        if (typeof FontFace === 'undefined' || !self.fonts) return;
        const url = new URL('../../assets/fonts/OldStandard-Italic.woff2', import.meta.url);
        const face = new FontFace('Old Standard TT', `url(${url.href})`, { style: 'italic', weight: '400' });
        await Promise.race([face.load(), new Promise((_, no) => setTimeout(() => no(new Error('font timeout')), 2500))]);
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
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ id: job.id, bitmap, ms: performance.now() - t0, sprites: spritesReady() }, [bitmap]);
  } catch (err) {
    self.postMessage({ id: job.id, error: String((err && err.stack) || err) });
  }
};

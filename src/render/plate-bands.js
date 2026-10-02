// A finished plate is a few dozen megabytes of pixels (33 MB at DPR 2). Uploading it to the page's canvas in one go is a
// frame-long stall, so it is cut into horizontal bands (here, off the main thread when the worker does it) and the page
// copies a couple of bands per frame. Worker-safe: no DOM access.

export const BAND_COUNT = 8;

/** [[y, rows], …]: the horizontal bands of an h-row plate. */
export function bandRanges(h, count = BAND_COUNT) {
  const rows = Math.max(1, Math.ceil(h / count));
  const out = [];
  for (let y = 0; y < h; y += rows) out.push([y, Math.min(rows, h - y)]);
  return out;
}

/** An ImageBitmap of every band of `source` (a canvas or an ImageBitmap, w × h): Promise<[{ y, bitmap }]>. */
export function cutBands(source, w, h) {
  return Promise.all(bandRanges(h).map(async ([y, rows]) => ({ y, bitmap: await createImageBitmap(source, 0, y, w, rows) })));
}

export function closeBands(bands) {
  for (const b of bands || []) b.bitmap?.close?.();
}

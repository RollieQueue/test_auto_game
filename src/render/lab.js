// Scratch page for the ink primitives (not part of the game). Open /src/render/lab.html
import * as ink from './ink.js';

const c = document.getElementById('c');
const ctx = c.getContext('2d');
ctx.fillStyle = ink.PAL.paper;
ctx.fillRect(0, 0, c.width, c.height);

// Strokes
for (let i = 0; i < 6; i++) {
  ink.inkStroke(ctx, [{ x: 40, y: 50 + i * 28 }, { x: 160, y: 40 + i * 28 }, { x: 300, y: 60 + i * 28 }], { w: 1 + i * 0.8, seed: i });
}
ink.inkDashed(ctx, [{ x: 340, y: 60 }, { x: 460, y: 80 }, { x: 560, y: 50 }], { w: 2, seed: 3 });

// Wash on dark band
ctx.fillStyle = ink.PAL.paper;
const poly = ink.blobPoly(200, 330, 140, 70, 5, { n: 12, jitter: 0.25 });
ink.wash(ctx, poly, { color: '#5a4030', alpha: 0.8, layers: 3, ragged: 3, comp: 'multiply', seed: 4 });
ink.hatch(ctx, poly, { angle: 0.9, gap: 5, w: 0.8, alpha: 0.5 });
ink.stipple(ctx, poly, { count: 120, color: ink.PAL.cream, alpha: 0.5 });
ink.inkOutline(ctx, poly, { w: 2.2, seed: 2 });

const poly2 = ink.blobPoly(520, 330, 90, 90, 9, { n: 12, jitter: 0.2 });
ink.wash(ctx, poly2, { color: '#4f9fc4', alpha: 0.7, layers: 3, ragged: 2, comp: 'multiply', seed: 9 });
ink.inkOutline(ctx, poly2, { w: 1.6, seed: 5 });
ink.inkBlot(ctx, 700, 330, 12, { color: ink.PAL.wax, seed: 3 });
ctx.fillStyle = '#000';
ctx.font = '12px sans-serif';
ctx.fillText('ink lab', 10, 890);
window.ink = ink;

// Paper: the sheet everything is painted on, plus the page finish (grain, foxing, vignette) painted over the top.
import { PAL, granulate, inkStroke, mulberry, rgba, noise1, seedOf, subSeed } from './ink.js';

/** Warm paper with tonal clouds, fibres and foxing, in device pixels of a w x h canvas. */
export function paintPaper(ctx, w, h, seed, dpr = 1) {
  const rng = mulberry(subSeed(seed, 'paper'));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAL.paper;
  ctx.fillRect(0, 0, w, h);

  // Big soft tonal clouds: slightly yellower / greyer areas, like uneven paper stock.
  const so = seedOf(seed);
  for (let i = 0; i < 46; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = (120 + rng() * 360) * dpr;
    const warm = noise1(i * 1.9 + so) > 0;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = warm ? '214,176,104' : '170,170,150';
    g.addColorStop(0, `rgba(${c},${0.03 + rng() * 0.04})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Fibres: short curved hairs, dark and pale.
  const n = Math.round((w * h) / (9000 * dpr * dpr));
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const a = rng() * Math.PI * 2;
    const len = (5 + rng() * 22) * dpr;
    const bend = (rng() - 0.5) * len * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.lineWidth = (0.4 + rng() * 0.5) * dpr;
    ctx.strokeStyle = rng() < 0.62 ? `rgba(110,82,50,${0.05 + rng() * 0.08})` : `rgba(255,252,238,${0.2 + rng() * 0.25})`;
    ctx.stroke();
  }

  // Foxing: brownish age spots with a darker speck at the heart.
  for (let i = 0; i < 16; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = (4 + rng() * rng() * 34) * dpr;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(150,100,48,${0.1 + rng() * 0.12})`);
    g.addColorStop(0.55, `rgba(170,120,60,${0.05 + rng() * 0.05})`);
    g.addColorStop(1, 'rgba(170,120,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    if (rng() < 0.5) {
      ctx.fillStyle = rgba('#5a3a1c', 0.25 + rng() * 0.2);
      ctx.beginPath();
      ctx.arc(x, y, (0.5 + rng() * 1.1) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  granulate(ctx, w, h, 0.07, 0.9);
}

/** Final pass over everything painted: grain, vignette, yellowed page edge, a hair-line frame. */
export function paintFinish(ctx, w, h, dpr = 1) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  granulate(ctx, w, h, 0.075, 0.6);

  // Vignette: warm sepia darkening toward the corners.
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.hypot(cx, cy);
  const g = ctx.createRadialGradient(cx, cy, R * 0.62, cx, cy, R * 1.02);
  g.addColorStop(0, 'rgba(70,44,20,0)');
  g.addColorStop(1, 'rgba(70,44,20,0.24)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Yellowed page edge.
  const band = 46 * dpr;
  const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const lg = ctx.createLinearGradient(x0, y0, x1, y1);
    lg.addColorStop(0, 'rgba(110,70,26,0.26)');
    lg.addColorStop(1, 'rgba(110,70,26,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(rx, ry, rw, rh);
  };
  edge(0, 0, band, 0, 0, 0, band, h);
  edge(w, 0, w - band, 0, w - band, 0, band, h);
  edge(0, 0, 0, band, 0, 0, w, band);
  edge(0, h, 0, h - band, 0, h - band, w, band);

  // A faint pencil frame inside the page edge, drawn by a shaky hand.
  const m = 16 * dpr;
  const pts = [
    [m, m, w - m, m],
    [w - m, m, w - m, h - m],
    [w - m, h - m, m, h - m],
    [m, h - m, m, m],
  ];
  pts.forEach(([x0, y0, x1, y1], i) => {
    inkStroke(
      ctx,
      [
        { x: x0, y: y0 },
        { x: (x0 + x1) / 2 + (i % 2 ? 2 : 0), y: (y0 + y1) / 2 + (i % 2 ? 0 : 2) },
        { x: x1, y: y1 },
      ],
      { w: 1.1 * dpr, color: '#3a2a1e', alpha: 0.22, taperStart: 0.06, taperEnd: 0.06, step: 14 * dpr, tremor: 0.5 * dpr, seed: 70 + i },
    );
  });
  ctx.restore();
}

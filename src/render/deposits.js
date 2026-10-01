// Deposits: water pockets, phosphorus crystals, nitrogen humus. Each is a small ink + watercolor sprite that is
// repainted only when its amount crosses a step, so depletion is visible but costs nothing per frame.
import {
  PAL,
  blobPoly,
  catmull,
  clipTo,
  darken,
  glowSprite,
  hatch,
  inkDashed,
  inkOutline,
  inkStroke,
  lighten,
  makeSprite,
  mix,
  mulberry,
  rgba,
  seedOf,
  noise1,
  stipple,
  subSeed,
  tracePath,
  wash,
  blit,
  granulate,
} from './ink.js';

const STEPS = 24;

export function createDeposits() {
  let px = 1;
  const cache = new Map(); // key -> { step, sprite }

  function sprite(key, step, make) {
    let e = cache.get(key);
    if (!e || e.step !== step) {
      e = { step, sprite: make() };
      cache.set(key, e);
    }
    return e.sprite;
  }

  return {
    setScale(p) {
      if (Math.abs(p / px - 1) > 0.02) {
        px = p;
        cache.clear();
      }
    },
    reset() {
      cache.clear();
    },
    draw(ctx, state, t) {
      const world = state.world;
      for (const d of world.water) {
        const f = clamp01(d.amount / d.max);
        const step = Math.round(f * STEPS);
        const sp = sprite(`w${d.id}`, step, () => renderWater(d, step / STEPS, px, world.seed));
        blit(ctx, sp, d.x, d.y);
        if (f > 0.04) glints(ctx, d, f, t);
      }
      for (const d of world.minerals) {
        const f = clamp01(d.amount / d.max);
        const step = Math.round(f * STEPS);
        const sp = sprite(`m${d.id}`, step, () => (d.kind === 'phosphorus' ? renderPhosphorus(d, step / STEPS, px, world.seed) : renderNitrogen(d, step / STEPS, px, world.seed)));
        blit(ctx, sp, d.x, d.y);
        if (f > 0.04) twinkle(ctx, d, f, t);
      }
    },
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ------------------------------------------------------------------- live glints */

function glints(ctx, d, f, t) {
  const g = glowSprite('#bfeaff', 32);
  const ys = d.y + d.ry * (1 - 2 * f * 0.96);
  const half = d.rx * Math.sqrt(Math.max(0, 1 - Math.pow((ys - d.y) / d.ry, 2)));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2; i++) {
    const ph = d.id * 1.7 + i * 2.9;
    const a = 0.5 + 0.5 * Math.sin(t * 1.3 + ph);
    const x = d.x + Math.sin(t * 0.21 + ph) * half * 0.6;
    ctx.globalAlpha = 0.16 + 0.34 * a * f;
    const r = 5 + 4 * a;
    ctx.drawImage(g, x - r, ys - r * 0.6, r * 2, r * 1.2);
  }
  ctx.restore();
}

function twinkle(ctx, d, f, t) {
  const phosphor = d.kind === 'phosphorus';
  const g = glowSprite(phosphor ? '#d9c2ff' : '#d8e68a', 32);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2; i++) {
    const ph = d.id * 2.3 + i * 3.7;
    const a = Math.max(0, Math.sin(t * (0.9 + i * 0.4) + ph));
    if (a < 0.05) continue;
    ctx.globalAlpha = 0.5 * a * f;
    const ang = ph * 5;
    const x = d.x + Math.cos(ang) * d.r * 0.5;
    const y = d.y + Math.sin(ang) * d.r * 0.35 - (phosphor ? d.r * 0.3 : 0);
    const r = 4 + 4 * a;
    ctx.drawImage(g, x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

/* ----------------------------------------------------------------------- water */

function renderWater(d, f, px, wseed) {
  const pad = 22;
  const w = d.rx * 2 + pad * 2;
  const h = d.ry * 2 + pad * 2;
  const sp = makeSprite(w, h, px, w / 2, h / 2);
  const g = sp.ctx;
  const seed = subSeed(wseed, 'water', d.id);
  const rr = mulberry(seed);
  const { rx, ry } = d;

  // damp halo around the pocket
  wash(g, blobPoly(0, 0, rx + 13, ry + 10, seed, { n: 14, jitter: 0.12 }), { color: '#1e3a4c', alpha: 0.26 + 0.16 * f, layers: 3, ragged: 3.5, edge: 0, seed });
  const cavity = blobPoly(0, 0, rx, ry, seed + 1, { n: 16, jitter: 0.07 });
  const cav = (c) => tracePath(c, cavity, true, true);

  // dry cavity
  g.save();
  g.beginPath();
  cav(g);
  const gd = g.createLinearGradient(0, -ry, 0, ry);
  gd.addColorStop(0, '#0e1b24');
  gd.addColorStop(1, '#173041');
  g.fillStyle = gd;
  g.fill();
  g.clip();
  stipple(g, cavity, { count: 22, rMin: 0.3, rMax: 0.8, color: '#7fb4cc', alpha: 0.35, seed: seed + 2 });

  const ys = ry - 2 * ry * f * 0.98; // waterline (y grows down)
  if (f > 0.01) {
    // water body
    const wg = g.createLinearGradient(0, ys, 0, ry);
    wg.addColorStop(0, '#9ad8e2');
    wg.addColorStop(0.35, '#58a8c6');
    wg.addColorStop(1, '#2f6c98');
    g.fillStyle = wg;
    g.fillRect(-rx - 2, ys, rx * 2 + 4, ry * 2);
    // layered washes inside for the watercolor feel
    for (let k = 0; k < 5; k++) {
      const bx = (rr() - 0.5) * rx * 1.4;
      const by = ys + (ry - ys) * (0.2 + rr() * 0.7);
      wash(g, blobPoly(bx, by, rx * (0.25 + rr() * 0.3), Math.max(2, (ry - ys) * 0.2), seed + 10 + k, { n: 9, jitter: 0.3 }), { color: rr() < 0.5 ? '#2d78b0' : '#7cc8e0', alpha: 0.28, layers: 2, ragged: 1.6, edge: 0.4, seed: seed + k });
    }
    // ripples
    for (let k = 0; k < 3; k++) {
      const yy = ys + (ry - ys) * (0.28 + k * 0.24);
      const hw = rx * Math.sqrt(Math.max(0, 1 - (yy / ry) ** 2)) * 0.55;
      inkDashed(g, [{ x: -hw, y: yy }, { x: 0, y: yy + 1.2 }, { x: hw, y: yy }], { w: 0.8, color: '#d8f2ff', alpha: 0.45, dash: 6, gap: 6, seed: seed + 20 + k, taperStart: 0.4, taperEnd: 0.4 });
    }
    // reflection arc, upper left
    inkStroke(g, [{ x: -rx * 0.62, y: ys + (ry - ys) * 0.38 }, { x: -rx * 0.5, y: ys + (ry - ys) * 0.12 }, { x: -rx * 0.22, y: ys + 1.5 }], { w: 1.8, color: '#ffffff', alpha: 0.7, taperStart: 0.3, taperEnd: 0.6, seed });
    // waterline highlight
    const hw = rx * Math.sqrt(Math.max(0, 1 - (ys / ry) ** 2));
    inkStroke(g, [{ x: -hw, y: ys + 0.6 }, { x: -hw * 0.3, y: ys - 0.6 }, { x: hw * 0.4, y: ys + 0.4 }, { x: hw, y: ys }], { w: 1.5, color: '#eaf9ff', alpha: 0.85, taperStart: 0.15, taperEnd: 0.15, seed: seed + 3, step: 3 });
    // meniscus darker line just below
    inkStroke(g, [{ x: -hw * 0.9, y: ys + 2.6 }, { x: 0, y: ys + 3.4 }, { x: hw * 0.9, y: ys + 2.6 }], { w: 0.9, color: '#1f5c8c', alpha: 0.5, taperStart: 0.3, taperEnd: 0.3, seed: seed + 4 });
  } else {
    // dried hollow: cracks
    for (let k = 0; k < 4; k++) {
      const a = rr() * 6.28;
      inkStroke(g, [{ x: 0, y: ry * 0.4 }, { x: Math.cos(a) * rx * 0.4, y: ry * 0.4 + Math.sin(a) * ry * 0.3 }, { x: Math.cos(a) * rx * 0.7, y: ry * 0.4 + Math.sin(a) * ry * 0.5 }], { w: 0.9, color: '#6f8795', alpha: 0.5, seed: seed + k, taperEnd: 0.8 });
    }
  }
  // inner shading at the rim: darker toward the edge
  g.lineWidth = 7;
  g.strokeStyle = rgba('#06121c', 0.5);
  g.beginPath();
  cav(g);
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = rgba('#06121c', 0.35);
  g.stroke();
  g.restore();

  // rim: pale outer light, dark ink line
  g.save();
  g.beginPath();
  cav(g);
  g.lineWidth = 5;
  g.strokeStyle = rgba('#a9dff0', 0.22);
  g.stroke();
  g.restore();
  inkOutline(g, cavity, { w: 2.1, color: '#08131c', seed: seed + 5, press: 0.45, tremor: 0.4, step: 3 });
  granulate(g, sp.cw, sp.ch, 0.07, 0.4);
  inkDashed(g, cavity.map((p) => ({ x: p.x * 1.12, y: p.y * 1.16 })).concat([{ x: cavity[0].x * 1.12, y: cavity[0].y * 1.16 }]), { w: 0.8, color: '#9fd0e4', alpha: 0.38, dash: 5, gap: 9, seed: seed + 6, taperStart: 0.5, taperEnd: 0.5 });
  return sp;
}

/* ------------------------------------------------------------------ phosphorus */

function crystal(g, x, y, ang, len, wid, seed, light, mid, dark, ink) {
  const rr = mulberry(seed);
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  // outline polygon along -y: base at y=0, tip at -len
  const shoulder = -len * (0.72 + rr() * 0.08);
  const lean = (rr() - 0.5) * wid * 0.5;
  const base = [{ x: -wid / 2, y: 0 }, { x: wid / 2, y: 0 }, { x: wid / 2 + lean * 0.2, y: shoulder }, { x: lean, y: -len }, { x: -wid / 2 + lean * 0.2, y: shoulder }];
  // left facet (light), right facet (dark)
  g.beginPath();
  g.moveTo(-wid / 2, 0);
  g.lineTo(lean * 0.3, 0);
  g.lineTo(lean * 0.3, shoulder * 1.02);
  g.lineTo(lean, -len);
  g.lineTo(-wid / 2 + lean * 0.2, shoulder);
  g.closePath();
  g.fillStyle = light;
  g.fill();
  g.beginPath();
  g.moveTo(lean * 0.3, 0);
  g.lineTo(wid / 2, 0);
  g.lineTo(wid / 2 + lean * 0.2, shoulder);
  g.lineTo(lean, -len);
  g.lineTo(lean * 0.3, shoulder * 1.02);
  g.closePath();
  g.fillStyle = dark;
  g.fill();
  // mid-tone wash and glow near the tip
  g.beginPath();
  g.moveTo(lean, -len);
  g.lineTo(-wid / 2 + lean * 0.2, shoulder);
  g.lineTo(lean * 0.3, shoulder * 1.02);
  g.closePath();
  g.fillStyle = rgba(mid, 0.55);
  g.fill();
  // facet hatching on the dark side
  g.save();
  g.beginPath();
  g.moveTo(lean * 0.3, 0);
  g.lineTo(wid / 2, 0);
  g.lineTo(wid / 2 + lean * 0.2, shoulder);
  g.lineTo(lean, -len);
  g.lineTo(lean * 0.3, shoulder * 1.02);
  g.closePath();
  g.clip();
  for (let i = 0; i < 6; i++) {
    const yy = -len * (0.1 + i * 0.15);
    inkStroke(g, [{ x: lean * 0.3 + 0.5, y: yy }, { x: wid / 2, y: yy - wid * 0.25 }], { w: 0.6, color: ink, alpha: 0.5, taperStart: 0.1, taperEnd: 0.7, seed: seed + i, tremor: 0.1, smooth: false, step: 2 });
  }
  g.restore();
  // highlight along the ridge and left edge
  inkStroke(g, [{ x: -wid * 0.22, y: -len * 0.08 }, { x: -wid * 0.2, y: shoulder * 0.9 }], { w: 0.9, color: '#ffffff', alpha: 0.75, taperStart: 0.1, taperEnd: 0.6, seed: seed + 5, tremor: 0.1 });
  // ink outline and ridge
  inkOutline(g, base, { w: 1.2, color: ink, seed: seed + 9, press: 0.35, tremor: 0.2, step: 2 });
  inkStroke(g, [{ x: lean * 0.3, y: 0 }, { x: lean * 0.3, y: shoulder }, { x: lean, y: -len }], { w: 0.8, color: ink, alpha: 0.7, seed: seed + 11, taperStart: 0.1, taperEnd: 0.2, tremor: 0.1, step: 2, smooth: false });
  g.restore();
}

function renderPhosphorus(d, f, px, wseed) {
  const R = d.r;
  const size = R * 4.6;
  const sp = makeSprite(size, size, px, size / 2, size * 0.62);
  const g = sp.ctx;
  const seed = subSeed(wseed, 'phos', d.id);
  const rr = mulberry(seed);
  const sc = 0.55 + 0.45 * f;
  // violet glow
  const glow = g.createRadialGradient(0, -R * 0.4, 0, 0, -R * 0.4, R * 2.1);
  glow.addColorStop(0, `rgba(190,150,255,${0.32 * (0.4 + f * 0.6)})`);
  glow.addColorStop(1, 'rgba(190,150,255,0)');
  g.fillStyle = glow;
  g.fillRect(-size / 2, -size * 0.62, size, size);
  // matrix rock
  const mat = blobPoly(0, R * 0.12, R * 1.0 * sc + 3, R * 0.5 * sc + 2, seed, { n: 10, jitter: 0.2 });
  wash(g, mat, { color: '#4a4262', alpha: 0.95, layers: 2, ragged: 1.4, edge: 0.7, seed });
  hatch(g, mat, { angle: 0.9, gap: 3, w: 0.7, color: '#0e0a18', alpha: 0.5, seed, lenVar: 0.2 });
  inkOutline(g, mat, { w: 1.5, color: '#120b1e', seed: seed + 3, tremor: 0.3 });
  // crystals
  const N = 7;
  const show = Math.max(1, Math.ceil(f * N));
  const ink = '#1a1030';
  const order = [3, 1, 5, 0, 6, 2, 4];
  for (let k = 0; k < show; k++) {
    const idx = order[k];
    const t = (idx - 3) / 3;
    const ang = t * 0.62 + (rr() - 0.5) * 0.25;
    const len = R * (1.35 - Math.abs(t) * 0.45 + rr() * 0.3) * sc;
    const wid = R * (0.46 + rr() * 0.12) * (0.75 + 0.25 * sc);
    const bx = t * R * 0.78 * sc;
    const by = R * 0.1 + Math.abs(t) * R * 0.1;
    crystal(g, bx, by, ang, len, wid, seed + idx * 13, '#c7a6f0', '#9367cc', '#5d3a96', ink);
  }
  // sparkle crosses
  for (let k = 0; k < Math.min(3, show); k++) {
    const sx = (rr() - 0.5) * R * 1.4;
    const sy = -R * (0.5 + rr() * 0.8) * sc;
    inkStroke(g, [{ x: sx - 2.6, y: sy }, { x: sx + 2.6, y: sy }], { w: 0.7, color: '#ffffff', alpha: 0.9, taperStart: 0.3, taperEnd: 0.3, smooth: false });
    inkStroke(g, [{ x: sx, y: sy - 2.6 }, { x: sx, y: sy + 2.6 }], { w: 0.7, color: '#ffffff', alpha: 0.9, taperStart: 0.3, taperEnd: 0.3, smooth: false });
  }
  granulate(g, sp.cw, sp.ch, 0.05, 0.3);
  return sp;
}

/* -------------------------------------------------------------------- nitrogen */

function renderNitrogen(d, f, px, wseed) {
  const R = d.r;
  const size = R * 4.2;
  const sp = makeSprite(size, size, px, size / 2, size / 2);
  const g = sp.ctx;
  const seed = subSeed(wseed, 'nit', d.id);
  const rr = mulberry(seed);
  const sc = 0.5 + 0.5 * f;
  // faint olive glow
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, R * 2);
  glow.addColorStop(0, `rgba(190,205,100,${0.22 * (0.4 + f * 0.6)})`);
  glow.addColorStop(1, 'rgba(190,205,100,0)');
  g.fillStyle = glow;
  g.fillRect(-size / 2, -size / 2, size, size);
  const N = 6;
  const show = Math.max(2, Math.ceil(f * N));
  for (let k = 0; k < show; k++) {
    const a = (k / N) * Math.PI * 2 + rr() * 0.6;
    const dd = k === 0 ? 0 : R * (0.45 + rr() * 0.35) * sc;
    const cx = Math.cos(a) * dd;
    const cy = Math.sin(a) * dd * 0.62;
    const r = R * (k === 0 ? 0.62 : 0.34 + rr() * 0.16) * (0.7 + 0.3 * sc);
    const blob = blobPoly(cx, cy, r * 1.25, r * 0.95, seed + k, { n: 9, jitter: 0.28, rot: rr() * 3 });
    wash(g, blob, { color: k % 2 ? '#5d5a26' : '#6a6a2e', alpha: 0.96, layers: 3, ragged: 1.2, edge: 0.8, seed: seed + k });
    // lit top, shade bottom
    g.save();
    g.beginPath();
    tracePath(g, blob, true, true);
    g.clip();
    g.fillStyle = rgba('#b4c256', 0.55);
    g.beginPath();
    g.ellipse(cx - r * 0.3, cy - r * 0.35, r * 0.7, r * 0.42, -0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rgba('#1c1a0a', 0.45);
    g.beginPath();
    g.ellipse(cx + r * 0.35, cy + r * 0.55, r * 0.9, r * 0.5, 0.2, 0, Math.PI * 2);
    g.fill();
    g.restore();
    hatch(g, blob, { angle: 0.8, gap: 2.8, w: 0.6, color: '#14130a', alpha: 0.42, seed: seed + k * 3, lenVar: 0.3, density: (x, y) => (x - cx) / r * 0.5 + (y - cy) / r * 0.7 > 0.1 ? 0.9 : 0 });
    stipple(g, blob, { count: Math.round(r * 1.5), rMin: 0.3, rMax: 0.8, color: '#e2ee96', alpha: 0.55, seed: seed + k * 5 });
    inkOutline(g, blob, { w: 1.2, color: '#141208', seed: seed + k * 7, tremor: 0.25, step: 2 });
  }
  // fibres and tiny rootlets
  for (let k = 0; k < 9; k++) {
    const a = rr() * 6.28;
    const r0 = R * (0.4 + rr() * 0.5) * sc;
    const x = Math.cos(a) * r0;
    const y = Math.sin(a) * r0 * 0.62;
    inkStroke(g, [{ x, y }, { x: x + Math.cos(a + 0.4) * 5, y: y + Math.sin(a + 0.4) * 4 }, { x: x + Math.cos(a - 0.2) * 10, y: y + Math.sin(a - 0.2) * 7 }], { w: 0.8, color: '#c4cf7a', alpha: 0.7, seed: seed + k, taperStart: 0.1, taperEnd: 0.8, tremor: 0.3 });
  }
  // nitrate crystals: bright specks
  for (let k = 0; k < Math.ceil(5 * f) + 1; k++) {
    const a = rr() * 6.28;
    const r0 = R * rr() * sc;
    g.fillStyle = rgba('#f4ffb0', 0.9);
    g.beginPath();
    g.ellipse(Math.cos(a) * r0, Math.sin(a) * r0 * 0.6, 1.1, 0.8, rr() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return sp;
}

// Ambient life: watercolor clouds drifting across the sky and leaves falling from healthy crowns.
// Cheap by design: a handful of prerendered sprites, a capped particle pool, no per-frame path building.
import { granulate, hatch, inkStroke, makeSprite, mulberry, rgba, subSeed, noise1 } from './ink.js';

const CLOUDS = 4;
const MAX_LEAVES = 28;
const STAGE_H = [70, 140, 205, 255];

export function createAmbient() {
  let px = 1;
  let view = null;
  let clouds = null;
  let leafSprites = null;
  let seed = 1;
  const leaves = [];
  const acc = new Map(); // tree id -> spawn accumulator
  let ext = { x0: 0, x1: 1920, y0: 0 };
  let groundMin = 270;

  function build(world) {
    const rr = mulberry(subSeed(seed, 'clouds'));
    clouds = [];
    for (let i = 0; i < CLOUDS; i++) {
      const w = 150 + rr() * 190;
      const h = 30 + rr() * 26;
      const pad = 16;
      const sp = makeSprite(w + pad * 2, h * 1.6 + pad * 2, px, w / 2 + pad, h * 1.25 + pad);
      paintCloud(sp, w, h, rr, subSeed(seed, 'cloud', i));
      clouds.push({ sp, w, h, x: ext.x0 + ((i + 0.2 + rr() * 0.6) / CLOUDS) * (ext.x1 - ext.x0), y: ext.y0 + h * 1.25 + 26 + rr() * Math.max(10, groundMin - ext.y0 - h * 1.25 - 170), v: 2 + rr() * 3.5, alpha: 0.62 + rr() * 0.22 });
    }
    // leaf sprites per species colour
    const defs = {
      oak: ['#6f8a3a', '#a9873a', '#8a6a2e'],
      birch: ['#b9c85a', '#d7cf5a', '#9fb84a'],
      pine: ['#8b6a3a', '#a07a44', '#6f5a34'],
    };
    leafSprites = {};
    for (const sp of Object.keys(defs)) {
      leafSprites[sp] = defs[sp].map((col, k) => {
        const s = makeSprite(14, 10, px * 1.2, 7, 5);
        const g = s.ctx;
        g.beginPath();
        if (sp === 'pine') {
          g.moveTo(-5, 0);
          g.lineTo(5, 0.4);
          g.lineWidth = 0.9;
          g.strokeStyle = rgba(col, 0.9);
          g.stroke();
          g.beginPath();
          g.moveTo(-4, -1.2);
          g.lineTo(4, 1.2);
          g.stroke();
        } else {
          g.moveTo(-5, 0);
          g.quadraticCurveTo(-1, -3.6, 5, 0);
          g.quadraticCurveTo(-1, 3.2, -5, 0);
          g.fillStyle = rgba(col, 0.92);
          g.fill();
          g.lineWidth = 0.55;
          g.strokeStyle = rgba('#2a1d14', 0.75);
          g.stroke();
          g.beginPath();
          g.moveTo(-5, 0);
          g.lineTo(4, 0);
          g.strokeStyle = rgba('#2a1d14', 0.55);
          g.stroke();
        }
        void k;
        return s;
      });
    }
  }

  return {
    setScale(p, v) {
      px = p;
      view = v;
      if (v) {
        ext = { x0: -v.ox / v.scale, x1: (v.cssW - v.ox) / v.scale, y0: -v.oy / v.scale };
      }
      clouds = null;
    },
    reset(world) {
      seed = world.seed;
      groundMin = Math.min(...world.ground);
      leaves.length = 0;
      acc.clear();
      clouds = null;
    },
    drawSky(ctx, state, t, dt) {
      if (!view) return;
      if (!clouds) build(state.world);
      ctx.save();
      for (const c of clouds) {
        c.x += c.v * dt;
        if (c.x - c.w / 2 > ext.x1 + 20) c.x = ext.x0 - c.w / 2 - 20;
        ctx.globalAlpha = c.alpha;
        ctx.drawImage(c.sp.canvas, c.x - c.sp.ax, c.y - c.sp.ay, c.sp.w, c.sp.h);
      }
      ctx.restore();
    },
    draw(ctx, state, t, dt, frame) {
      if (!leafSprites) return;
      const world = state.world;
      const trees = frame?.refs?.trees;
      // spawn from healthy crowns
      for (const tr of world.trees || []) {
        const rate = 0.11 * (tr.stage + 1) * Math.max(0, tr.health - 0.25) * (tr.species === 'pine' ? 0.35 : 1);
        if (rate <= 0) continue;
        const a = (acc.get(tr.id) || 0) + rate * Math.min(dt, 0.1);
        if (a >= 1 && leaves.length < MAX_LEAVES) {
          const b = trees?.bounds?.(tr);
          const h = STAGE_H[Math.max(0, Math.min(3, tr.stage | 0))];
          const x0 = b ? b.x0 : tr.x - 30 - tr.stage * 18;
          const x1 = b ? b.x1 : tr.x + 30 + tr.stage * 18;
          const y0 = b ? b.y0 + (b.y1 - b.y0) * 0.1 : tr.baseY - h;
          const y1 = b ? b.y0 + (b.y1 - b.y0) * 0.5 : tr.baseY - h * 0.45;
          const r = Math.random;
          leaves.push({
            sp: leafSprites[tr.species] || leafSprites.oak,
            x: x0 + (x1 - x0) * (0.2 + 0.6 * r()),
            y: y0 + (y1 - y0) * r(),
            ph: r() * 6.28,
            sw: 6 + r() * 10,
            vy: 11 + r() * 9,
            rot: r() * 6.28,
            spin: (r() - 0.5) * 1.6,
            k: Math.floor(r() * 3),
            age: 0,
            ground: -1,
          });
          acc.set(tr.id, a - 1);
        } else acc.set(tr.id, a >= 1 ? 0.99 : a);
      }
      if (!leaves.length) return;
      const wind = 7 + 5 * Math.sin(t * 0.23) + 3 * noise1(t * 0.4);
      ctx.save();
      for (let i = leaves.length - 1; i >= 0; i--) {
        const l = leaves[i];
        l.age += dt;
        l.y += l.vy * dt;
        l.x += (wind + Math.cos(t * 1.7 + l.ph) * l.sw * 0.6) * dt;
        l.rot += l.spin * dt;
        const gy = world.ground ? groundAt(world, l.x) : 300;
        let a = Math.min(1, l.age * 1.5);
        if (l.y >= gy - 2) {
          if (l.ground < 0) l.ground = t;
          l.y = gy - 2;
          l.vy = 0;
          l.spin = 0;
          a *= Math.max(0, 1 - (t - l.ground) / 2.2);
          if (a <= 0) {
            leaves.splice(i, 1);
            continue;
          }
        }
        ctx.globalAlpha = a;
        ctx.save();
        ctx.translate(l.x, l.y);
        ctx.rotate(l.rot);
        ctx.scale(l.ground < 0 ? Math.cos(t * 2.3 + l.ph) * 0.8 + 0.2 : 1, 1);
        const s = l.sp[l.k];
        ctx.drawImage(s.canvas, -s.ax * 0.83, -s.ay * 0.83, s.w * 0.83, s.h * 0.83);
        ctx.restore();
      }
      ctx.restore();
    },
  };
}

function groundAt(world, x) {
  const f = x / world.step;
  const i = Math.floor(f);
  if (i <= 0) return world.ground[0];
  if (i >= world.ground.length - 1) return world.ground[world.ground.length - 1];
  return world.ground[i] + (world.ground[i + 1] - world.ground[i]) * (f - i);
}

/**
 * A cumulus in the manner of a field sketch on toned paper: puffs over a flattish base heightened with a soft
 * body-white (as the old naturalists did on tinted sheets), a grey-blue wash pooled in the shaded underside and a few
 * broken pen arcs along the lit tops. Painted once into a sprite (the blur filter is a one-off build cost, never per
 * frame).
 */
function paintCloud(sp, w, h, rr, sd) {
  const g = sp.ctx;
  const TAU = Math.PI * 2;
  const n = 5 + Math.floor(rr() * 3);
  const puffs = [];
  for (let p = 0; p < n; p++) {
    const t = p / (n - 1);
    const bell = Math.sin(Math.PI * (0.1 + 0.8 * t));
    const r = h * (0.26 + 0.44 * bell * (0.72 + 0.5 * rr()));
    puffs.push({ x: (t - 0.5) * w * 0.8 + (rr() - 0.5) * w * 0.05, y: -r * (0.62 + 0.2 * rr()), r });
  }
  if (w > 220) {
    const m = 2 + Math.floor(rr() * 2);
    for (let p = 0; p < m; p++) {
      const t = (p + 0.5) / m;
      const r = h * (0.24 + 0.16 * rr());
      puffs.push({ x: (t - 0.5) * w * 0.42 + (rr() - 0.5) * 14, y: -h * (0.66 + 0.18 * rr()), r });
    }
  }
  const base = h * 0.12;
  const body = () => {
    g.beginPath();
    for (const q of puffs) {
      g.moveTo(q.x + q.r, q.y);
      g.arc(q.x, q.y, q.r, 0, TAU);
    }
    g.ellipse(0, base - h * 0.16, w * 0.4, h * 0.18, 0, 0, TAU); // the flat floor
  };
  const soft = (k) => {
    if (typeof g.filter === 'string') g.filter = `blur(${(k * sp.px).toFixed(1)}px)`;
  };
  g.save();
  // 1. body-white heightening with a soft wet edge
  soft(1.6);
  body();
  g.fillStyle = rgba('#fbf7ec', 0.62);
  g.fill('nonzero');
  // 2. the shaded underside, only where the body is
  g.globalCompositeOperation = 'source-atop';
  soft(3);
  const grd = g.createLinearGradient(0, -h * 0.75, 0, base + 2);
  grd.addColorStop(0, rgba('#8d9cad', 0));
  grd.addColorStop(0.5, rgba('#8d9cad', 0.32));
  grd.addColorStop(1, rgba('#76869a', 0.62));
  g.fillStyle = grd;
  g.fillRect(-w, -h * 2, w * 2, h * 2 + base + 8);
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    g.ellipse((rr() - 0.5) * w * 0.6, base - h * 0.12, w * (0.1 + 0.1 * rr()), h * (0.1 + 0.08 * rr()), 0, 0, TAU);
    g.fillStyle = rgba('#6a7a8e', 0.3);
    g.fill();
  }
  g.filter = 'none';
  hatch(g, { cx: 0, cy: base - h * 0.16, rx: w * 0.32, ry: h * 0.14 }, { angle: 2.3, gap: 4.4, w: 0.5, color: '#4a5a6a', alpha: 0.2, seed: sd, lenVar: 0.5 });
  g.restore();
  // 3. pen: broken arcs on the outer tops of the puffs, never inside a neighbour
  const outside = (x, y, self) => puffs.every((q) => q === self || Math.hypot(x - q.x, y - q.y) > q.r * 0.97);
  puffs.forEach((q, qi) => {
    if (rr() < 0.35) return;
    const a0 = Math.PI * (1.08 + 0.15 * rr());
    const a1 = Math.PI * (1.82 + 0.1 * rr());
    let run = [];
    const flush = () => {
      if (run.length > 3) inkStroke(g, run, { w: 0.6, color: '#5a5550', alpha: 0.34, taperStart: 0.35, taperEnd: 0.45, tremor: 0.2, seed: sd + qi * 7 + run.length, step: 1.5 });
      run = [];
    };
    for (let k = 0; k <= 14; k++) {
      const a = a0 + ((a1 - a0) * k) / 14;
      const x = q.x + Math.cos(a) * q.r;
      const y = q.y + Math.sin(a) * q.r;
      if (outside(x, y, q)) run.push({ x, y });
      else flush();
    }
    flush();
  });
  granulate(g, sp.cw, sp.ch, 0.1, 0.4);
}

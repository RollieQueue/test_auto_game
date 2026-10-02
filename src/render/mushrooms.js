// Fruit bodies above ground (ink + watercolour sprites, cached per look and growth step) and the spore effect.
// API: createMushrooms() -> { setScale, reset, event, draw, bounds }. See docs/ARCHITECTURE.md (Mushroom, events).
// Drawing code for the bodies lives in mushrooms-paint.js; this file owns caches, idle motion and particles.
import { hash32 } from '../core/rng.js';
import { makeSprite, makeCanvas, glowSprite, granulate, smooth01 } from './ink.js';
import { STEPS, extentOf, paintMushroom } from './mushrooms-paint.js';
import { reducedMotion } from './motion.js';
import { levelFor, levelNear, washed, washedNear, drained, beginFrame, getSprite as artSprite, mushroomLook, mushroomSprite, spritesReady, wiltTarget, growScale, RIVAL_MUSHROOM_TYPES } from './sprites.js';
import { lookOf, clumpLayout, companionGrowth } from './mushroom-cluster.js';
import { groundYAt } from '../world/query.js';

const MAX_P = 500;
const MAX_RINGS = 12;
const RENDER_BUDGET = 2; // new sprites per frame (more only if a mushroom would otherwise have nothing to show)
const RENDER_HARD = 6;
const WILT_LIFE = 4.2; // seconds a wilted mushroom lingers (fauna.js draws the main cap, this file the small ones)

let warned = false;
const warn = (e) => {
  if (warned) return;
  warned = true;
  console.warn('[mushrooms]', e);
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const seedOf = (state) => (state && state.world && Number.isFinite(state.world.seed) ? state.world.seed : 0);

// spore kinds: 0 ochre, 1 cream, 2 gold, 3 soil speck
const DOT_STYLE = [
  { core: '#c98f2c', halo: '#e6b552', ring: null },
  { core: '#fff1cc', halo: '#f0d089', ring: '#b8923c' },
  { core: '#e9b03c', halo: '#f6d27a', ring: null },
  { core: '#4e3626', halo: '#4e3626', ring: null },
];
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const NB = 4; // alpha levels per spore kind (particles of one level are drawn in a single path)
const TAU = Math.PI * 2;
const STYLES = [];
for (let kind = 0; kind < 4; kind++) {
  const st = DOT_STYLE[kind];
  for (let b = 0; b < NB; b++) {
    const lvl = (b + 0.5) / NB;
    STYLES.push({
      h2: hexA(st.halo, 0.17 * lvl),
      core: hexA(st.core, (kind === 3 ? 0.9 : 0.95) * lvl),
      ring: st.ring ? hexA(st.ring, 0.75 * lvl) : null,
    });
  }
}

export function createMushrooms() {
  let px = 1;
  let sprites = new Map();
  let stale = new Map();
  let renders = 0;
  const rt = new Map(); // per mushroom runtime: shown growth, per-id variation, wisp timer
  let lastT = 0;
  let curSeed = 0; // the world's seed (the looks and the clumps are keyed by it)
  let wilt = 0; // 0..1: winter droop of the fruit bodies, follows the season smoothly
  let lastPrune = 0;
  const curS = []; // per frame: the illustration of mushroom i (null = painted procedurally)
  const order = [];
  const cur = [];
  const curR = [];
  const bIdx = new Int16Array(4 * NB * MAX_P);
  const bCount = new Uint16Array(4 * NB);
  const extFull = [null, null, null, null];

  // particle pool (struct of arrays, no allocation in the frame loop)
  const pX = new Float32Array(MAX_P);
  const pY = new Float32Array(MAX_P);
  const pVX = new Float32Array(MAX_P);
  const pVY = new Float32Array(MAX_P);
  const pAge = new Float32Array(MAX_P);
  const pLife = new Float32Array(MAX_P); // 0 = free
  const pSize = new Float32Array(MAX_P);
  const pPh = new Float32Array(MAX_P);
  const pKind = new Uint8Array(MAX_P);
  let pNext = 0;
  // light blooms
  const rX = new Float32Array(MAX_RINGS);
  const rY = new Float32Array(MAX_RINGS);
  const rAge = new Float32Array(MAX_RINGS);
  const rLife = new Float32Array(MAX_RINGS);
  let rNext = 0;

  /* -------------------------------------------------------------- helpers */

  function info(m) {
    const id = m.id;
    let r = rt.get(id);
    if (!r || r.seed !== curSeed) {
      const L = lookOf(curSeed, id); // world/clump.js: size 0.62..1.42, height, slant, side, phase: stable per world and mushroom
      const g = clamp(num(m.growth), 0, 1);
      r = { v: NaN, kind: 0, sub: 0, sg: g, seed: curSeed, size: L.size, tall: L.tall, mirror: L.mirror, lean: L.lean, phase: L.phase, nextWisp: 0, seen: 0, cx: 0, cy: 0, spr: null, sprReady: false, cl: [], clSeed: NaN, clReady: null, lx: 0, ly: 0 };
      r.nextWisp = lastT + 1 + 4 * ((L.phase * 7) % 1);
      rt.set(id, r);
    }
    if (r.v !== m.variant) {
      r.v = m.variant;
      const v = Math.floor(Math.abs(num(m.variant)));
      r.kind = v % 4;
      r.sub = (v >> 2) & 1;
    }
    return r;
  }

  function getSprite(kind, sub, step) {
    const key = (kind * 2 + sub) * 64 + step;
    let sp = sprites.get(key);
    if (sp) return sp;
    // fall back to the old-resolution sprite or a neighbouring step while over budget
    const canRender = renders < RENDER_BUDGET;
    if (!canRender) {
      const old = stale.get(key);
      if (old) return old;
      for (let d = 1; d <= 3; d++) {
        const a = sprites.get(key - d) || sprites.get(key + d);
        if (a) return a;
      }
      if (renders >= RENDER_HARD) return null;
    }
    renders++;
    const g = step / STEPS;
    const ext = extentOf(kind, g);
    sp = makeSprite(ext.w * 2, ext.up + ext.down, px, ext.w, ext.up);
    try {
      paintMushroom(sp.ctx, kind, sub, g);
      granulate(sp.ctx, sp.cw, sp.ch, 0.24, 0.55);
    } catch (e) {
      warn(e); // a broken sprite is better than a broken frame
    }
    sprites.set(key, sp);
    return sp;
  }

  const extentFull = (kind) => extFull[kind] || (extFull[kind] = extentOf(kind, 1));
  const byBase = (a, b) => a.baseY - b.baseY;
  let ringGlow = null;
  // halo sprites are rendered once per kind at device resolution, so drawing them needs no resampling
  let halos = [null, null, null, null];
  const haloOf = (kind) => {
    let h = halos[kind];
    if (h) return h;
    const hr = Math.max(17, extentFull(kind).w * 0.6);
    const c = makeCanvas(2 * hr * px, 2 * hr * px);
    const g = c.getContext('2d');
    const R = c.width / 2;
    const grad = g.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, hexA('#fff4d0', 1));
    grad.addColorStop(0.1, hexA('#ffd98a', 0.95));
    grad.addColorStop(0.45, hexA('#ffd98a', 0.32));
    grad.addColorStop(1, hexA('#ffd98a', 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    h = halos[kind] = { canvas: c, w: c.width / px, h: c.height / px, hr };
    return h;
  };

  function emit(x, y, vx, vy, size, life, kind) {
    const i = pNext;
    pNext = (pNext + 1) % MAX_P;
    pX[i] = x;
    pY[i] = y;
    pVX[i] = vx;
    pVY[i] = vy;
    pAge[i] = 0;
    pLife[i] = life;
    pSize[i] = size;
    pPh[i] = Math.random();
    pKind[i] = kind;
  }

  function addRing(x, y) {
    const i = rNext;
    rNext = (rNext + 1) % MAX_RINGS;
    rX[i] = x;
    rY[i] = y;
    rAge[i] = 0;
    rLife[i] = 1.5;
  }

  const wind = (t) => 2.5 + 9 * Math.sin(t * 0.31) + 5 * Math.sin(t * 0.83 + 1.7);

  function capPoint(m) {
    const r = info(m);
    if (r.spr) return { x: num(m.x), y: num(m.baseY) - r.spr.worldSize * r.size * r.tall * growScale(r.sg) * 0.85 };
    const ext = extentOf(r.kind, clamp(num(m.growth), 0, 1));
    return { x: num(m.x), y: num(m.baseY) - (ext.up - 8) * r.size * r.tall * 0.85 };
  }

  function sporeBurst(x, y, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const v = speed * (0.35 + 0.65 * Math.random());
      const k = Math.random();
      emit(
        x + (Math.random() - 0.5) * 8,
        y + (Math.random() - 0.5) * 3,
        Math.cos(a) * v * 0.8,
        Math.sin(a) * v,
        0.6 + 1.0 * Math.random() * Math.random() + 0.2 * Math.random(),
        3 + 3 * Math.random(),
        k < 0.5 ? 0 : k < 0.8 ? 1 : 2,
      );
    }
  }

  /* -------------------------------------------------------------- API */

  function setScale(p) {
    const v = num(p, 1);
    if (v <= 0) return;
    if (Math.abs(v / px - 1) > 0.02) {
      stale = sprites;
      sprites = new Map();
      halos = [null, null, null, null];
      px = v;
    }
  }

  function reset() {
    sprites = new Map();
    stale = new Map();
    rt.clear();
    pLife.fill(0);
    rLife.fill(0);
  }

  function event(ev, state) {
    if (!ev || typeof ev !== 'object') return;
    try {
      curSeed = seedOf(state);
      if (ev.type === 'spores') {
        const m = state && Array.isArray(state.mushrooms) ? state.mushrooms.find((q) => q && q.id === ev.id) : null;
        const p = m ? capPoint(m) : { x: num(ev.x), y: num(ev.y) - 40 };
        const n = clamp(Math.round(num(ev.amount, 10) * 0.6), 6, 40);
        sporeBurst(p.x, p.y, n, 62);
      } else if (ev.type === 'mushroom-planted') {
        const x = num(ev.x);
        const y = num(ev.y);
        for (let i = 0; i < 14; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
          const v = 22 + 40 * Math.random();
          emit(x + (Math.random() - 0.5) * 6, y - 1, Math.cos(a) * v, Math.sin(a) * v, 0.7 + 1.1 * Math.random(), 0.6 + 0.6 * Math.random(), 3);
        }
      } else if (ev.type === 'mushroom-mature') {
        const m = state && Array.isArray(state.mushrooms) ? state.mushrooms.find((q) => q && q.id === ev.id) : null;
        const p = m ? capPoint(m) : { x: num(ev.x), y: num(ev.y) - 40 };
        addRing(p.x, p.y);
        sporeBurst(p.x, p.y, 8, 30);
      }
    } catch (e) {
      warn(e); // never throw into the render loop
    }
  }

  function bounds(m) {
    const mm = m || {};
    const r = mm.id !== undefined && rt.get(mm.id);
    const g = r ? r.sg : clamp(num(mm.growth), 0, 1);
    const size = r ? r.size : 1;
    if (r && r.spr) {
      const hh = r.spr.worldSize * size * r.tall * growScale(g);
      const hw = (r.spr.w / r.spr.h) * hh;
      return { x0: num(mm.x) - hw, y0: num(mm.baseY) - hh, x1: num(mm.x) + hw, y1: num(mm.baseY) + 4 };
    }
    const ext = extentOf(Math.floor(Math.abs(num(mm.variant))) % 4, g);
    const x = num(mm.x);
    const y = num(mm.baseY);
    return { x0: x - ext.w * size, y0: y - ext.up * size * (r ? r.tall : 1), x1: x + ext.w * size, y1: y + ext.down };
  }

  function draw(ctx, state, t, dt) {
    if (!ctx) return;
    const dtc = clamp(num(dt), 0, 0.1);
    const now = num(t, lastT + dtc);
    lastT = now;
    curSeed = seedOf(state);
    renders = 0;
    beginFrame();
    const list = state && Array.isArray(state.mushrooms) ? state.mushrooms : [];
    ctx.save();
    try {
      drawMushrooms(ctx, list, now, dtc, state);
      drawParticles(ctx, now, dtc);
    } catch (e) {
      warn(e); // keep the frame alive
    } finally {
      ctx.restore();
    }
  }

  /** The illustration of a companion cap: its mushroom's species, another picture of it than the main cap's where there is one. */
  function companionSprite(m, trees, c) {
    let type = mushroomLook(m, trees);
    if (RIVAL_MUSHROOM_TYPES.has(type)) type = 'common';
    const pick = hash32('mushroom-cluster-sprite', m.id === undefined ? 0 : m.id, c.salt);
    return artSprite('mushroom', type, pick) || artSprite('mushroom', 'common', pick);
  }

  /**
   * One fruit body standing at (x, baseY), sway = its slant, g = its growth, size = its size factor. il: an illustration
   * (anchored at the stalk base, a hair below the ground so the stalk comes out of the soil); else sp: a procedural sprite.
   * ghost: -1 for a living body (winter wilt applies); >= 0 for the clump of a wilted mushroom: the colour left, 0..1.
   */
  function paintBody(ctx, T, il, sp, x, baseY, size, mirror, sway, g, pulse, squash, ghost) {
    if (!il && !sp) return;
    const live = ghost < 0;
    if (il) {
      const k = (il.worldSize * size * growScale(g)) / il.h; // world units per image pixel
      const sx = mirror ? -1 : 1;
      const sy = pulse * squash;
      const c = -sway;
      const sink = 0.05 * il.worldSize * size;
      ctx.setTransform(T.a * sx, T.b * sx, T.a * c + T.c * sy, T.b * c + T.d * sy, T.a * x + T.c * (baseY + sink) + T.e, T.b * x + T.d * (baseY + sink) + T.f);
      const lv = live ? levelNear(il, il.h * k * px) : levelFor(il, il.h * k * px); // a ghost shows only briefly: its copy is never a stand-in
      const dx = -il.anchor.x * k;
      const dy = -il.anchor.y * k;
      const dw = il.w * k;
      const dh = il.h * k;
      const a0 = ctx.globalAlpha;
      ctx.globalAlpha = a0 * 0.22;
      ctx.fillStyle = '#2a1b13';
      ctx.beginPath();
      ctx.ellipse(0, -0.3, Math.max(2, dw * 0.17), Math.max(0.8, dh * 0.045), 0, 0, TAU); // seat in the soil
      ctx.fill();
      ctx.globalAlpha = a0;
      if (!live) {
        ctx.drawImage(drained(lv.src, lv.w, lv.h), dx, dy, dw, dh);
        if (ghost > 0.01) {
          ctx.globalAlpha = a0 * ghost;
          ctx.drawImage(lv.src, dx, dy, dw, dh);
          ctx.globalAlpha = a0;
        }
        return;
      }
      ctx.drawImage(lv.src, dx, dy, dw, dh);
      const wash = wilt > 0.01 && !lv.stand ? washedNear(lv.src, lv.w, lv.h) : null; // null: not built yet, a frame or two later it is there
      if (wash) {
        ctx.globalAlpha = a0 * wilt;
        ctx.drawImage(wash, dx, dy, dw, dh);
        ctx.globalAlpha = a0;
      }
      return;
    }
    const sx = size * (mirror ? -1 : 1);
    const sy = size * pulse * squash;
    const c = -sway * size;
    ctx.setTransform(T.a * sx, T.b * sx, T.a * c + T.c * sy, T.b * c + T.d * sy, T.a * x + T.c * baseY + T.e, T.b * x + T.d * baseY + T.f);
    const a0 = ctx.globalAlpha;
    if (!live) {
      ctx.drawImage(washed(sp.canvas, sp.canvas.width, sp.canvas.height), -sp.ax, -sp.ay, sp.w, sp.h);
      return;
    }
    ctx.drawImage(sp.canvas, -sp.ax, -sp.ay, sp.w, sp.h);
    if (wilt > 0.01) {
      ctx.globalAlpha = a0 * wilt;
      ctx.drawImage(washed(sp.canvas, sp.canvas.width, sp.canvas.height), -sp.ax, -sp.ay, sp.w, sp.h);
      ctx.globalAlpha = a0;
    }
  }

  function drawMushrooms(ctx, list, now, dt, state) {
    order.length = 0;
    const world = state && state.world ? state.world : null;
    const trees = world ? world.trees : null;
    const seed = world && Number.isFinite(world.seed) ? world.seed : 0;
    const ready = spritesReady();
    wilt += (wiltTarget(state && state.flags, state && state.clock) - wilt) * (1 - Math.exp(-dt * 1.2));
    if (Math.abs(wilt) < 0.003) wilt = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m && Number.isFinite(m.x) && Number.isFinite(m.baseY)) order.push(m);
    }
    const n = order.length;
    if (n > 1) order.sort(byBase);
    const ease = 1 - Math.exp(-dt * 5);
    const calm = reducedMotion(); // «меньше движения»: no sway, no idle breathing, no wisps of spores drifting off by themselves
    for (let i = 0; i < n; i++) {
      const m = order[i];
      const r = info(m);
      curR[i] = r;
      r.seen = now;
      const g = clamp(num(m.growth), 0, 1);
      r.sg += (g - r.sg) * ease;
      if (Math.abs(g - r.sg) < 0.002) r.sg = g;
      if (r.sprReady !== ready) {
        r.sprReady = ready;
        r.spr = ready ? mushroomSprite(m, trees) : null; // illustrated look, chosen once per mushroom (stable)
      }
      curS[i] = r.spr;
      r.lx = m.x;
      r.ly = m.baseY;
      if (r.clSeed !== seed) {
        r.cl = (world ? clumpLayout(world, m).cl : []).map((c) => ({ ...c, spr: null })); // more small caps beside a trunk
        r.clSeed = seed;
        r.clReady = null;
      }
      if (r.clReady !== ready) {
        r.clReady = ready;
        for (const c of r.cl) c.spr = ready ? companionSprite(m, trees, c) : null;
      }
      const step = Math.round(clamp(r.sg, 0, 1) * STEPS);
      cur[i] = r.spr ? null : getSprite(r.kind, r.sub, step);
      if (m.mature && r.sg > 0.9 && now >= r.nextWisp && !calm) {
        r.nextWisp = now + 3 + Math.random() * 6;
        const cy = m.baseY - (extentFull(r.kind).up - 8) * 0.85 * r.size * r.tall;
        const k = 3 + ((Math.random() * 3) | 0);
        for (let j = 0; j < k; j++) {
          emit(m.x + (Math.random() - 0.5) * 14, cy + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6, -(5 + Math.random() * 9), 0.6 + 0.8 * Math.random(), 4 + 2.5 * Math.random(), Math.random() < 0.7 ? 0 : 1);
        }
      }
    }
    // pass 1: soft halos of productive bodies (one composite switch for all of them)
    let lit = false;
    const prevA = ctx.globalAlpha;
    for (let i = 0; i < n; i++) {
      const m = order[i];
      const r = curR[i];
      if (!(m.mature && r.sg > 0.9) || !(cur[i] || curS[i]) || wilt > 0.9) continue;
      if (!lit) {
        ctx.globalCompositeOperation = 'lighter';
        lit = true;
      }
      const ext = extentFull(r.kind);
      const h = haloOf(r.kind);
      const up = r.spr ? r.spr.worldSize * 0.8 : ext.up * 0.78;
      ctx.globalAlpha = prevA * (0.17 + 0.06 * Math.sin(now * 1.6 + r.phase)) * (1 - wilt);
      ctx.drawImage(h.canvas, m.x - h.hr, m.baseY - up * r.size * r.tall - h.hr, h.w, h.h);
    }
    if (lit) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = prevA;
    }
    // pass 2: the painted bodies, swaying about their base (the base matrix is composed by hand: no save/restore per body)
    const T = ctx.getTransform();
    for (let i = 0; i < n; i++) {
      const sp = cur[i];
      const il = curS[i];
      cur[i] = null;
      curS[i] = null;
      if (!sp && !il) continue;
      const m = order[i];
      const r = curR[i];
      curR[i] = null;
      const ph = r.phase;
      const pulse = calm ? 1 : 1 + 0.009 * Math.sin(now * 1.35 + ph * 1.7);
      const squash = 1 - 0.14 * wilt;
      // the clump: smaller caps beside the main one, behind it (see mushroom-cluster.js; the main cap stays at the sim position)
      for (let k = 0; k < r.cl.length; k++) {
        const c = r.cl[k];
        const gk = companionGrowth(r.sg, c);
        if (gk < 0.03) continue;
        const cx = m.x + c.dx * r.size;
        const cy = (world ? groundYAt(world, cx) : m.baseY) + c.dy;
        const sway = c.lean + 0.2 * wilt * (c.lean < 0 ? -1 : 1) + (calm ? 0 : 0.011 * Math.sin(now * 0.8 + ph + k * 2.1 + 1));
        paintBody(ctx, T, c.spr, c.spr ? null : getSprite(r.kind, (r.sub + k + 1) & 1, Math.round(gk * STEPS)), cx, cy, r.size * c.scale, c.mirror, sway, gk, pulse, squash * c.tall, -1);
      }
      const droop = 0.2 * wilt * (r.lean < 0 ? -1 : 1); // winter: the stalk bows over, the cap hangs
      const sway = r.lean + droop + (calm ? 0 : 0.011 * Math.sin(now * 0.8 + ph) + 0.004 * Math.sin(now * 1.9 + ph * 2.3));
      paintBody(ctx, T, il, sp, m.x, m.baseY, r.size, r.mirror, sway, r.sg, pulse, squash * r.tall, -1);
    }
    // the clumps of mushrooms that just wilted away: the small caps bow over and fade as the main one does (fauna.js 'wilt')
    for (const r of rt.values()) {
      const age = now - r.seen;
      if (age <= 0 || age >= WILT_LIFE || !r.cl.length) continue;
      const u = age / WILT_LIFE;
      const bowT = smooth01(u / 0.8);
      const alpha = 1 - smooth01((u - 0.3) / 0.7);
      if (alpha <= 0.01) continue;
      const colA = 1 - smooth01(u / 0.22);
      const sy = 1 - 0.34 * smooth01(u / 0.9);
      for (let k = 0; k < r.cl.length; k++) {
        const c = r.cl[k];
        const gk = companionGrowth(r.sg, c);
        if (gk < 0.03) continue;
        const cx = r.lx + c.dx * r.size;
        const cy = (world ? groundYAt(world, cx) : r.ly) + c.dy;
        const bow = c.lean + (c.lean < 0 ? -1 : 1) * 0.62 * bowT * bowT;
        const a0 = ctx.globalAlpha;
        ctx.globalAlpha = a0 * alpha;
        paintBody(ctx, T, c.spr, c.spr ? null : getSprite(r.kind, (r.sub + k + 1) & 1, Math.round(gk * STEPS)), cx, cy, r.size * c.scale, c.mirror, bow, gk, 1, sy * c.tall, colA);
        ctx.globalAlpha = a0;
      }
    }
    ctx.setTransform(T);
    order.length = 0;
    if (now - lastPrune > 2) {
      lastPrune = now;
      for (const [id, r] of rt) if (now - r.seen > 5) rt.delete(id);
    }
  }

  /** One path with a dot per particle of a group: tiny on screen -> squares (much cheaper), else circles. */
  function speckPath(ctx, base, cnt, k, small) {
    ctx.beginPath();
    for (let j = 0; j < cnt; j++) {
      const i = bIdx[base + j];
      const rr = pSize[i] * k;
      if (small) ctx.rect(pX[i] - rr, pY[i] - rr, rr * 2, rr * 2);
      else {
        ctx.moveTo(pX[i] + rr, pY[i]);
        ctx.arc(pX[i], pY[i], rr, 0, TAU);
      }
    }
  }

  function drawParticles(ctx, now, dt) {
    const small = px < 2.2;
    const w = wind(now);
    const kDrag = 1 - Math.exp(-dt * 1.3);
    const kWind = 1 - Math.exp(-dt * 0.9);
    const baseA = ctx.globalAlpha;
    bCount.fill(0);
    for (let i = 0; i < MAX_P; i++) {
      const life = pLife[i];
      if (life <= 0) continue;
      const age = pAge[i] + dt;
      if (age >= life) {
        pLife[i] = 0;
        continue;
      }
      pAge[i] = age;
      const kind = pKind[i];
      if (kind === 3) {
        pVY[i] += 150 * dt;
        pVX[i] *= 1 - dt * 1.5;
      } else {
        const ph = pPh[i];
        pVX[i] += (w * (0.6 + 0.8 * ph) - pVX[i]) * kWind + Math.sin(age * 2.3 + ph * 6.28) * 5 * dt;
        pVY[i] += (3 + 5 * ph - pVY[i]) * kDrag + Math.cos(age * 1.7 + ph * 5) * 3 * dt;
      }
      pX[i] += pVX[i] * dt;
      pY[i] += pVY[i] * dt;
      const u = age / life;
      let a = Math.min(1, age / 0.12) * (1 - smooth01((u - 0.5) / 0.5));
      if (kind === 3) a = 1 - smooth01((u - 0.3) / 0.7);
      if (a <= 0.02) continue;
      const grp = kind * NB + Math.min(NB - 1, (a * NB) | 0);
      bIdx[grp * MAX_P + bCount[grp]++] = i;
    }
    // one path per (kind, alpha level): halo discs, then cores, then the thin ring of cream spores
    for (let grp = 0; grp < 4 * NB; grp++) {
      const cnt = bCount[grp];
      if (!cnt) continue;
      const kind = (grp / NB) | 0;
      const sty = STYLES[grp];
      const base = grp * MAX_P;
      if (kind < 3) {
        // faint glow, only for the bigger specks (keeps the path short)
        ctx.fillStyle = sty.h2;
        ctx.beginPath();
        for (let k = 0; k < cnt; k++) {
          const i = bIdx[base + k];
          if (pSize[i] < 0.85) continue;
          const rr = pSize[i] * 2.5;
          ctx.moveTo(pX[i] + rr, pY[i]);
          ctx.arc(pX[i], pY[i], rr, 0, TAU);
        }
        ctx.fill();
      }
      if (sty.ring) {
        // cream speck: an ochre rim under a cream core (a ring without a stroke)
        ctx.fillStyle = sty.ring;
        speckPath(ctx, base, cnt, 1.35, small);
        ctx.fill();
      }
      ctx.fillStyle = sty.core;
      speckPath(ctx, base, cnt, sty.ring ? 0.85 : 1, small);
      ctx.fill();
    }
    // light blooms of freshly matured bodies
    const prevOp = ctx.globalCompositeOperation;
    for (let i = 0; i < MAX_RINGS; i++) {
      if (rLife[i] <= 0) continue;
      const age = rAge[i] + dt;
      if (age >= rLife[i]) {
        rLife[i] = 0;
        continue;
      }
      rAge[i] = age;
      const u = age / rLife[i];
      const e = 1 - (1 - u) * (1 - u);
      const r = 6 + 34 * e;
      const fade = 1 - u;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = baseA * 0.55 * fade;
      ctx.drawImage(ringGlow || (ringGlow = glowSprite('#ffe2a0', 64, 0.1)), rX[i] - r * 1.5, rY[i] - r * 1.5, r * 3, r * 3);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = baseA * 0.5 * fade * fade;
      ctx.strokeStyle = '#c99430';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(rX[i], rY[i], r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = prevOp;
    ctx.globalAlpha = baseA;
  }

  return { setScale, reset, event, draw, bounds };
}

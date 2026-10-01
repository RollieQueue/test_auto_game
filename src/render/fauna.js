// Fauna: the nematodes that wander the soil and bite thin hyphae, the dying of a cut-off network, and the trap rings
// of the nematophagous fungus. Everything here is read from state (state.fauna, state.traps, state.ui.trapPick) and
// from events (worm-spawn, bite-abort, severed, worm-caught, trap-placed, trap-ready, trap-spent, trap-denied,
// mushroom-wilted); nothing is mutated. With state.fauna / state.traps missing or empty the module draws nothing.
// Worms: a per-worm trail cache (keyed by worm.id) makes the body follow the path the head took, so turns bend it like
// a snake; a travelling sine wriggle rides on top (phase comes from the sim and grows with distance travelled).
// Ghosts (cut hyphae, wilting mushroom, withering ring) are short-lived effects kept in one capped list.
import { glowSprite, granulate, makeSprite, mix, mulberry, noise1, rgba, smooth01, tracePath } from './ink.js';
import { hash32 } from '../core/rng.js';
import { STEPS, extentOf, paintMushroom } from './mushrooms-paint.js';

const TRAP_RADIUS = 60; // world units: the lure radius of a trap (balance.trapRadius); the placement preview circle
const WAX = '#c9443b'; // sealing wax, bright enough to read on dark soil (same as feedback.js)
const CREAM = '#fff6dc';
const INK = '#3a2a1e';
const NITRO = '#b7c85a'; // nitrogen sparkles
const TAU = Math.PI * 2;
const MAX_FX = 520;
const SEG = 16; // spine samples per worm
const RING_R = [18.6, 13.7, 9]; // radii of the three concentric hyphal loops (world units; drawn ~20% larger than the lure suggests so they read)
const WORM_LEN = 1.12; // drawn worm length / thickness relative to the sim body (readability)
const WORM_THICK = 1.25;
const RING_N = 20; // points per loop
const CUT_SPEED = 320; // u/s: how fast the dying wave runs away from the cut
const CUT_FADE = 2.1; // s one hypha takes to go from cream to grey and vanish
const WILT_LIFE = 4.2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => smooth01(k);

/* "The worm has caught a scent": a wax-red «!» over the worm and a dashed ink line to the hypha it is heading for. */
export const SENSE_LIFE = 4.6; // s a marker stays up when nothing ends it earlier
const SENSE_IN = 0.22; // s to fade in
const SENSE_OUT = 1.3; // s of the gentle fade at the end of the natural life
const SENSE_CUT = 0.55; // s of the fade after an early end (bite, catch, the worm leaving)
const SENSE_ENDS = new Set(['bite', 'worm-gone']);

/** Opacity 0..1 of a marker `age` seconds after it was raised; `endAge` is seconds since it was ended early (null while up). */
export function senseAlpha(age, endAge = null, life = SENSE_LIFE) {
  if (!(age >= 0)) return 0;
  let a = ease(Math.min(1, age / SENSE_IN));
  const left = life - age;
  if (left < SENSE_OUT) a = Math.min(a, ease(Math.max(0, left) / SENSE_OUT));
  if (endAge !== null && endAge >= 0) a = Math.min(a, 1 - ease(Math.min(1, endAge / SENSE_CUT)));
  return a;
}

/** The worm id whose marker an event ends early (a bite, a catch in a ring, the worm leaving), or null. */
export function senseEndsOn(ev) {
  if (!ev || typeof ev !== 'object') return null;
  if (SENSE_ENDS.has(ev.type)) return ev.id ?? null;
  if (ev.type === 'worm-caught') return ev.wormId ?? null;
  return null;
}

export function createFauna() {
  let px = 1;
  let refs = null;
  const worms = new Map(); // worm id -> { pts, bk, snaredAt, nextChip, X, Y, W, seen, hx, hy }
  const traps = new Map(); // trap id -> { caughtAt, coolMax, seen }
  const list = []; // timed effects: { k, born (-1 until first draw), life, delay, ... }
  const holds = new Set(); // trap ids that currently have a snared worm
  const senses = new Map(); // worm id -> { born (-1 until first draw), endedAt (-1 while up), x, y, tx, ty }
  const wilts = new Map(); // mushroom sprite cache: key -> { col, grey }
  let seq = 1;
  let lastT = 0;
  let lastPrune = 0;

  const push = (e) => {
    if (list.length >= MAX_FX) list.shift();
    e.born = -1;
    e.id = seq++;
    list.push(e);
    return e;
  };

  /* ------------------------------------------------------------------ events */

  function sparks(x, y, n, o) {
    const rr = mulberry(seq * 31 + (x | 0));
    for (let i = 0; i < n; i++) {
      const a = o.up ? -Math.PI / 2 + (rr() - 0.5) * (o.spread ?? 1.6) : rr() * TAU;
      const v = (o.v0 ?? 10) + rr() * (o.v1 ?? 30);
      push({
        k: 'spark',
        x: x + (rr() - 0.5) * (o.jit ?? 4),
        y: y + (rr() - 0.5) * (o.jit ?? 4),
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        g: o.g ?? 0,
        life: (o.life ?? 0.8) * (0.7 + rr() * 0.6),
        color: o.colors ? o.colors[(rr() * o.colors.length) | 0] : o.color || CREAM,
        size: (o.size ?? 2) * (0.7 + rr() * 0.6),
        delay: rr() * (o.delay ?? 0),
        tw: rr() * 6,
        glow: o.glow ?? 0,
      });
    }
  }

  function startSevered(ev, state) {
    const net = state && state.net;
    const x = num(ev.x);
    const y = num(ev.y);
    push({ k: 'snap', x, y, life: 1.15 });
    sparks(x, y, 12, { v0: 22, v1: 55, life: 0.7, size: 1.8, colors: ['#fff6dc', '#ffe6a0', '#ffffff'], glow: 1 });
    if (!net || !Array.isArray(ev.edges)) return;
    const mycelium = refs && refs.mycelium;
    const edges = [];
    let maxDelay = 0;
    for (let i = 0; i < ev.edges.length && edges.length < 700; i++) {
      const e = net.edges[ev.edges[i]];
      if (!e) continue;
      const A = net.nodes[e.a];
      const B = net.nodes[e.b];
      if (!A || !B) continue;
      let pts = null;
      try {
        pts = mycelium && mycelium.edgePoints ? mycelium.edgePoints(state, e.id) : null;
      } catch {
        pts = null;
      }
      if (!pts || pts.length < 4) pts = [A.x, A.y, B.x, B.y];
      const d = Math.hypot((A.x + B.x) / 2 - x, (A.y + B.y) / 2 - y);
      const delay = Math.min(1.7, 0.1 + d / CUT_SPEED);
      if (delay > maxDelay) maxDelay = delay;
      edges.push({ pts, w: num(e.w, 1), delay, path: null, fired: false, mx: (A.x + B.x) / 2, my: (A.y + B.y) / 2 });
    }
    if (edges.length) push({ k: 'ghost', edges, life: maxDelay + CUT_FADE + 0.2, x, y });
  }

  function startWilt(ev) {
    const v = Math.floor(Math.abs(num(ev.variant)));
    const g = clamp(num(ev.growth, 1), 0.08, 1);
    const h = hash32('mushroom', ev.id === undefined ? 0 : ev.id);
    const a = (h & 1023) / 1023;
    const b = ((h >>> 10) & 1023) / 1023;
    const c = ((h >>> 20) & 1023) / 1023;
    push({
      k: 'wilt',
      x: num(ev.x),
      y: num(ev.y),
      kind: v % 4,
      sub: (v >> 2) & 1,
      step: Math.round(g * STEPS),
      size: 0.92 + 0.16 * a,
      mirror: b < 0.5,
      lean0: (c - 0.5) * 0.07,
      dir: b < 0.5 ? -1 : 1,
      life: WILT_LIFE,
    });
  }

  function event(ev, state) {
    if (!ev || typeof ev !== 'object') return;
    const x = num(ev.x);
    const y = num(ev.y);
    const endId = senseEndsOn(ev);
    if (endId !== null) {
      const s = senses.get(endId);
      if (s && s.endedAt < 0) s.endedAt = lastT; // faded out on the next frames
    }
    switch (ev.type) {
      case 'worm-sense':
        if (ev.id !== undefined && ev.id !== null && Number.isFinite(ev.tx) && Number.isFinite(ev.ty)) {
          senses.set(ev.id, { born: -1, endedAt: -1, x, y, tx: ev.tx, ty: ev.ty });
        }
        break;
      case 'worm-spawn':
        sparks(x, y, 7, { v0: 4, v1: 14, life: 0.9, size: 1.5, color: '#a98a68', jit: 6, g: 18 });
        push({ k: 'ripple', x, y, r0: 3, r1: 15, life: 0.9, color: '#d9b3a8', lw: 1.1 });
        break;
      case 'bite-abort':
        sparks(x, y, 6, { v0: 8, v1: 22, life: 0.6, size: 1.5, color: CREAM });
        push({ k: 'ripple', x, y, r0: 8, r1: 15, life: 0.5, color: '#d9b3a8', lw: 1 });
        break;
      case 'severed':
        startSevered(ev, state);
        break;
      case 'worm-caught': {
        const tr = traps.get(ev.trapId) || { caughtAt: -9, coolMax: 1, seen: lastT };
        tr.caughtAt = -1; // set on the first frame that sees it
        tr.pending = true;
        traps.set(ev.trapId, tr);
        push({ k: 'ripple', x, y, r0: 6, r1: 56, life: 1.3, color: '#ffd27a', lw: 1.8 });
        push({ k: 'ripple', x, y, r0: 5, r1: 36, life: 0.95, color: CREAM, lw: 1.2, delay: 0.1 });
        const n = clamp(5 + Math.round(num(ev.minerals, 0) * 0.5), 6, 16);
        sparks(x, y, n, { up: true, spread: 1.7, v0: 8, v1: 24, g: -4, life: 1.9, size: 2.1, colors: [NITRO, '#d4e27a', '#a6b546'], jit: 14, delay: 0.5, glow: 1 });
        const w = worms.get(ev.wormId);
        if (w && w.X) push({ k: 'swallow', X: Array.from(w.X), Y: Array.from(w.Y), W: w.W, cx: x, cy: y, life: 0.7 });
        break;
      }
      case 'trap-placed':
        push({ k: 'ripple', x, y, r0: 4, r1: 30, life: 1.0, color: CREAM, lw: 1.3 });
        sparks(x, y, 7, { v0: 6, v1: 20, life: 0.9, size: 1.5, colors: ['#e6d79c', '#fff6dc'], jit: 8 });
        break;
      case 'trap-ready':
        push({ k: 'ripple', x, y, r0: 8, r1: 34, life: 1.1, color: '#ffe9a8', lw: 1.4 });
        sparks(x, y, 4, { up: true, v0: 6, v1: 14, life: 1.1, size: 1.5, colors: ['#ffe9a8'], jit: 10, glow: 1 });
        break;
      case 'trap-spent':
        push({ k: 'wither', x, y, seed: num(ev.id, 1), life: 3.2 });
        break;
      case 'trap-denied':
        push({ k: 'cross', x, y, life: 1.5, size: 9 });
        push({ k: 'dashring', x, y, r: TRAP_RADIUS, life: 0.8, color: WAX });
        break;
      case 'mushroom-wilted':
        startWilt(ev);
        break;
      default:
    }
  }

  /* ------------------------------------------------------------------ worms */

  function wormRt(w, t) {
    let r = worms.get(w.id);
    if (!r) {
      const dx = Math.cos(num(w.a));
      const dy = Math.sin(num(w.a));
      const len = clamp(num(w.len, 40), 20, 80);
      const pts = [{ x: num(w.x), y: num(w.y) }];
      for (let k = 3; k <= len * WORM_LEN + 16; k += 3) pts.push({ x: num(w.x) - dx * k, y: num(w.y) - dy * k });
      r = { pts, bk: 0, snaredAt: -1, nextChip: 0, X: new Float32Array(SEG), Y: new Float32Array(SEG), W: 6, seen: t };
      worms.set(w.id, r);
    }
    r.seen = t;
    return r;
  }

  /** Walk the trail from the head: SEG samples spread evenly over `total` units of arc length. */
  function sampleTrail(pts, total, X, Y) {
    let seg = 0;
    let acc = 0;
    let segLen = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    for (let j = 0; j < SEG; j++) {
      const s = (j / (SEG - 1)) * total;
      while (seg < pts.length - 2 && acc + segLen < s) {
        acc += segLen;
        seg++;
        segLen = Math.hypot(pts[seg + 1].x - pts[seg].x, pts[seg + 1].y - pts[seg].y);
      }
      const f = segLen > 1e-6 ? clamp((s - acc) / segLen, 0, 1) : 0;
      X[j] = pts[seg].x + (pts[seg + 1].x - pts[seg].x) * f;
      Y[j] = pts[seg].y + (pts[seg + 1].y - pts[seg].y) * f;
    }
  }

  function updateWorm(r, w, state, t, dt) {
    const mode = w.mode;
    const bite = mode === 'bite' && w.bite && Number.isFinite(w.bite.x) ? w.bite : null;
    r.bk += ((bite ? 1 : 0) - r.bk) * (1 - Math.exp(-dt * 10));
    if (!bite && r.bk < 0.002) r.bk = 0;
    // while chewing the head's tip rests on the bite point: the head sits one head-length back along the heading
    if (bite) {
      r.biteX = w.bite.x - Math.cos(num(w.a)) * r.W * 0.45;
      r.biteY = w.bite.y - Math.sin(num(w.a)) * r.W * 0.45;
    }
    const hx = lerp(num(w.x), num(r.biteX, w.x), r.bk);
    const hy = lerp(num(w.y), num(r.biteY, w.y), r.bk);
    const pts = r.pts;
    if (Math.hypot(hx - pts[1].x, hy - pts[1].y) > 60) {
      // teleported (a reset, a loaded game): lay the body straight back along the heading
      const dx = Math.cos(num(w.a));
      const dy = Math.sin(num(w.a));
      pts.length = 1;
      for (let k = 3; k <= num(w.len, 40) * WORM_LEN + 16; k += 3) pts.push({ x: hx - dx * k, y: hy - dy * k });
    }
    pts[0].x = hx;
    pts[0].y = hy;
    if (Math.hypot(hx - pts[1].x, hy - pts[1].y) > 2.4) pts.splice(1, 0, { x: hx, y: hy });
    // keep just a little more than the body length
    const len0 = clamp(num(w.len, 40), 20, 80);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (acc > len0 * WORM_LEN + 14 && i + 1 < pts.length) {
        pts.length = i + 1;
        break;
      }
    }
    // snared: the body contracts and thickens as the ring pulls it in
    let k = 0;
    if (mode === 'snared') {
      if (r.snaredAt < 0) r.snaredAt = t;
      k = ease((t - r.snaredAt) / 0.9);
    } else r.snaredAt = -1;
    r.k = k;
    const len = len0 * WORM_LEN * (1 - 0.24 * k);
    sampleTrail(pts, len, r.X, r.Y);
    r.W = clamp(len0 * 0.175, 6, 9.2) * WORM_THICK * (1 + 0.22 * k);
    // wriggle: a sine wave riding along the body, running backwards from the head as the worm advances
    const speed = num(w.speed);
    const moving = clamp(speed / 16, 0, 1);
    const amp = (1.0 + 1.5 * moving) * (mode === 'snared' ? 0.35 : 1) * (1 - 0.7 * r.bk);
    const phase = num(w.phase) + (speed < 0.5 ? t * (mode === 'bite' ? 0 : 1.8) : 0);
    const X = r.X;
    const Y = r.Y;
    const ox = new Float32Array(SEG);
    const oy = new Float32Array(SEG);
    for (let j = 0; j < SEG; j++) {
      const a = Math.max(0, j - 1);
      const b = Math.min(SEG - 1, j + 1);
      let tx = X[a] - X[b];
      let ty = Y[a] - Y[b];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const u = j / (SEG - 1);
      const s = u * len;
      let off = amp * (0.3 + 0.7 * u) * Math.sin(phase - s * 0.34);
      if (mode === 'snared') off += 0.9 * k * Math.sin(t * 38 + j * 1.3) * (0.3 + u);
      ox[j] = -ty * off;
      oy[j] = tx * off;
    }
    for (let j = 0; j < SEG; j++) {
      X[j] += ox[j];
      Y[j] += oy[j];
    }
  }

  /** Body outline of a worm as one smooth closed polygon, left side head -> tail then right side back. */
  const profile = (u) => (0.55 + 0.45 * ease(u / 0.12)) * (u < 0.55 ? 1 : 0.07 + 0.93 * Math.pow(1 - ease((u - 0.55) / 0.45), 0.75));

  function bodyPoly(X, Y, W) {
    const L = [];
    const R = [];
    for (let j = 0; j < SEG; j++) {
      const a = Math.max(0, j - 1);
      const b = Math.min(SEG - 1, j + 1);
      let tx = X[a] - X[b];
      let ty = Y[a] - Y[b];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const hw = 0.5 * W * profile(j / (SEG - 1));
      L.push({ x: X[j] - ty * hw, y: Y[j] + tx * hw });
      R.push({ x: X[j] + ty * hw, y: Y[j] - tx * hw });
    }
    return L.concat(R.reverse());
  }

  /** Paint one worm body from its sampled spine. Returns the head's forward unit vector. */
  function paintBody(ctx, X, Y, W, flush) {
    const poly = bodyPoly(X, Y, W);
    const base = mix('#dcb6aa', '#cf8f88', flush);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // pale halo: separates the body from the dark soil
    ctx.beginPath();
    tracePath(ctx, poly, true, true);
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = 'rgba(255,214,196,0.2)';
    ctx.stroke();
    ctx.fillStyle = base;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const spine = new Path2D();
    spine.moveTo(X[0], Y[0]);
    for (let j = 1; j < SEG; j++) spine.lineTo(X[j], Y[j]);
    // belly light along the spine
    ctx.lineWidth = W * 0.3;
    ctx.strokeStyle = 'rgba(255,238,228,0.5)';
    ctx.stroke(spine);
    // roundness: a darker band along the lower flank
    const flank = new Path2D();
    for (let j = 0; j < SEG; j++) {
      const a = Math.max(0, j - 1);
      const b = Math.min(SEG - 1, j + 1);
      let tx = X[a] - X[b];
      let ty = Y[a] - Y[b];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const hw = 0.5 * W * profile(j / (SEG - 1)) * 0.72;
      const fx = X[j] + ty * hw;
      const fy = Y[j] - tx * hw;
      if (j) flank.lineTo(fx, fy);
      else flank.moveTo(fx, fy);
    }
    ctx.lineWidth = W * 0.34;
    ctx.strokeStyle = 'rgba(110,62,58,0.34)';
    ctx.stroke(flank);
    // the saddle (clitellum): a pinker band a quarter of the way down the body
    ctx.lineCap = 'butt';
    ctx.lineWidth = W * 1.4;
    ctx.strokeStyle = 'rgba(184,102,100,0.55)';
    ctx.beginPath();
    ctx.moveTo((X[3] + X[4]) / 2, (Y[3] + Y[4]) / 2);
    ctx.lineTo(X[5], Y[5]);
    ctx.stroke();
    ctx.lineCap = 'round';
    // segment ticks across the body
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = 'rgba(82,46,40,0.55)';
    ctx.beginPath();
    for (let k = 1; k <= 9; k++) {
      const f = (k / 10) * (SEG - 1);
      const j = Math.min(SEG - 2, Math.floor(f));
      const q = f - j;
      const cx = lerp(X[j], X[j + 1], q);
      const cy = lerp(Y[j], Y[j + 1], q);
      let tx = X[j] - X[j + 1];
      let ty = Y[j] - Y[j + 1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const hw = W * 0.62;
      ctx.moveTo(cx - ty * hw, cy + tx * hw);
      ctx.quadraticCurveTo(cx - tx * 0.9, cy - ty * 0.9, cx + ty * hw, cy - tx * hw); // each ring bows a little towards the head
    }
    ctx.stroke();
    ctx.restore();
    // ink rim
    ctx.beginPath();
    tracePath(ctx, poly, true, true);
    ctx.lineWidth = 1.15;
    ctx.strokeStyle = 'rgba(58,42,30,0.92)';
    ctx.stroke();
    // darker head
    let hx = X[0] - X[1];
    let hy = Y[0] - Y[1];
    const hl = Math.hypot(hx, hy) || 1;
    hx /= hl;
    hy /= hl;
    const hr = W * 0.5;
    const cx = X[0] - hx * hr * 0.15;
    const cy = Y[0] - hy * hr * 0.15;
    ctx.beginPath();
    ctx.ellipse(cx, cy, hr * 0.98, hr * 0.8, Math.atan2(hy, hx), 0, TAU);
    ctx.fillStyle = '#8a665a';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(46,30,22,0.95)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + hx * hr * 0.15 - hy * hr * 0.25, cy + hy * hr * 0.15 + hx * hr * 0.25, hr * 0.18, 0, TAU);
    ctx.fillStyle = 'rgba(230,200,188,0.7)';
    ctx.fill();
    return { hx, hy, tipX: X[0] + hx * hr * 0.8, tipY: Y[0] + hy * hr * 0.8 };
  }

  function drawWorm(ctx, r, w, state, t, dt) {
    const fade = clamp(num(w.fade, 1), 0, 1);
    if (fade <= 0.01) return;
    const prevA = ctx.globalAlpha;
    ctx.globalAlpha = prevA * fade;
    // snared: pale tendrils of the trap reach for the body
    if (w.mode === 'snared' && r.k > 0.02) {
      const tr = (state.traps || []).find((q) => q.id === w.trapId);
      if (tr) drawTendrils(ctx, tr, r, t);
    }
    const bite = w.mode === 'bite' && w.bite && r.bk > 0.35 ? w.bite : null;
    if (bite) drawBite(ctx, w, state, r, t, fade); // under the head: ring, nick and tooth marks stay readable
    const head = paintBody(ctx, r.X, r.Y, r.W, r.k * 0.9);
    if (bite) {
      // jaws: two tiny hooks that open and close
      const open = 0.5 + 0.5 * Math.sin(t * 34 + w.id * 2.1);
      const a0 = Math.atan2(head.hy, head.hx);
      ctx.strokeStyle = 'rgba(30,16,10,0.95)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (const s of [-1, 1]) {
        const a = a0 + s * (0.2 + 0.5 * open);
        ctx.moveTo(head.tipX, head.tipY);
        ctx.lineTo(head.tipX + Math.cos(a) * 3.2, head.tipY + Math.sin(a) * 3.2);
        ctx.lineTo(head.tipX + Math.cos(a - s * 0.7) * 4.2, head.tipY + Math.sin(a - s * 0.7) * 4.2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = prevA;
  }

  function drawTendrils(ctx, tr, r, t) {
    const k = r.k;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.9;
    for (let i = 0; i < 4; i++) {
      const j = 2 + i * 3;
      const bx = r.X[Math.min(SEG - 1, j)];
      const by = r.Y[Math.min(SEG - 1, j)];
      const wob = 7 * Math.sin(t * 3 + i * 1.7);
      const dx = bx - tr.x;
      const dy = by - tr.y;
      const mx = tr.x + dx * 0.5 - dy * 0.22 + wob * 0.3;
      const my = tr.y + dy * 0.5 + dx * 0.22 + wob * 0.2;
      ctx.strokeStyle = `rgba(255,240,190,${(0.75 * k).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(tr.x, tr.y);
      ctx.quadraticCurveTo(mx, my, lerp(tr.x, bx, k), lerp(tr.y, by, k));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The chewed spot of a hypha: a nick that deepens, a progress ring that turns red, trembling, flying crumbs. */
  function drawBite(ctx, w, state, r, t, fade) {
    const b = w.bite;
    const p = clamp(num(b.t) / Math.max(0.05, num(b.dur, 1)), 0, 1);
    const net = state.net;
    let dx = Math.cos(num(w.a));
    let dy = Math.sin(num(w.a));
    const e = net && net.edges[b.edge];
    if (e && net.nodes[e.a] && net.nodes[e.b]) {
      dx = net.nodes[e.b].x - net.nodes[e.a].x;
      dy = net.nodes[e.b].y - net.nodes[e.a].y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
    }
    const nx = -dy;
    const ny = dx;
    const shake = 0.25 + 1.1 * p * p;
    const jx = shake * Math.sin(t * 61 + 1.3);
    const jy = shake * Math.cos(t * 53);
    const x = b.x + jx * 0.4;
    const y = b.y + jy * 0.4;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.lineCap = 'round';
    // the hypha trembles: a short bright jittering stretch laid over the thread
    if (p > 0.15) {
      ctx.strokeStyle = `rgba(255,246,220,${(0.5 + 0.4 * p).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = -3; i <= 3; i++) {
        const s = i * 3.2;
        const off = shake * 1.3 * Math.sin(t * 47 + i * 1.9) * (1 - Math.abs(i) / 4);
        const qx = b.x + dx * s + nx * off;
        const qy = b.y + dy * s + ny * off;
        if (i === -3) ctx.moveTo(qx, qy);
        else ctx.lineTo(qx, qy);
      }
      ctx.stroke();
    }
    // warning glow, redder as the cut nears
    const g = glowSprite('#ff7a62', 48);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = fade * (0.12 + 0.55 * p * p);
    ctx.drawImage(g, x - 15, y - 15, 30, 30);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = fade;
    // the nick: a dark bite eating into the thread, deeper every moment
    const nick = 1.6 + 3.4 * p;
    ctx.strokeStyle = 'rgba(14,6,3,0.95)';
    ctx.lineWidth = 0.9 + 2.6 * p;
    ctx.beginPath();
    ctx.moveTo(x - nx * nick, y - ny * nick);
    ctx.lineTo(x + nx * nick, y + ny * nick);
    ctx.stroke();
    // tooth marks: little ticks either side of the nick, more of them as the chewing goes on
    const teeth = 1 + Math.floor(p * 4);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = 'rgba(30,14,8,0.8)';
    ctx.beginPath();
    for (let i = 1; i <= teeth; i++) {
      const s = 2.2 + i * 1.7;
      for (const sd of [-1, 1]) {
        const cx = x + dx * s * sd;
        const cy = y + dy * s * sd;
        ctx.moveTo(cx - nx * 2.2, cy - ny * 2.2);
        ctx.lineTo(cx + nx * 2.2, cy + ny * 2.2);
      }
    }
    ctx.stroke();
    // progress ring
    const R = 11;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,246,220,0.22)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.arc(b.x, b.y, R, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    if (p > 0.01) {
      ctx.strokeStyle = 'rgba(14,6,3,0.55)';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.arc(b.x, b.y, R, -Math.PI / 2, -Math.PI / 2 + TAU * p);
      ctx.stroke();
      ctx.strokeStyle = mix('#ffe9b0', '#ff5a44', p * p);
      ctx.lineWidth = 1.7;
      ctx.stroke();
    }
    ctx.restore();
    // crumbs flying off the chewed spot
    if (t >= r.nextChip) {
      r.nextChip = t + 0.07 + 0.12 * (1 - p);
      const a = Math.random() * TAU;
      push({ k: 'spark', x: b.x, y: b.y, vx: Math.cos(a) * (12 + Math.random() * 22), vy: Math.sin(a) * (12 + Math.random() * 22) - 6, g: 30, life: 0.35 + Math.random() * 0.3, color: Math.random() < 0.6 ? CREAM : '#ffd9a0', size: 1.1 + Math.random() * 1.1, delay: 0, tw: 0, glow: 0 });
    }
  }

  /* ------------------------------------------------------------------ scent markers */

  /** A hand-drawn «!» in sealing wax, cream-rimmed so it reads on dark soil too. */
  function paintBang(ctx, x, y, id, a, pulse) {
    const j = (k) => (((hash32('sense', id * 8 + k) & 1023) / 1023) - 0.5) * 0.8; // fixed wobble per worm
    const sc = 1.3 * (1 + 0.07 * pulse);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    ctx.globalAlpha *= a;
    ctx.fillStyle = 'rgba(20,10,4,0.4)'; // a soft dark seat
    ctx.beginPath();
    ctx.arc(0, -1.5, 11.5, 0, TAU);
    ctx.fill();
    const bar = new Path2D();
    bar.moveTo(-3.2 + j(0), -11 + j(1));
    bar.quadraticCurveTo(0, -12.4 + j(2), 3.2 + j(3), -11 + j(4));
    bar.lineTo(1.3 + j(5), 1.8);
    bar.lineTo(-1.3 + j(6), 1.8);
    bar.closePath();
    const dot = new Path2D();
    dot.ellipse(j(7) * 0.5, 6.1, 2.2, 2.1, 0, 0, TAU);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = CREAM;
    ctx.stroke(bar);
    ctx.stroke(dot);
    ctx.fillStyle = '#b3342a';
    ctx.fill(bar);
    ctx.fill(dot);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = INK;
    ctx.stroke(bar);
    ctx.stroke(dot);
    ctx.restore();
  }

  /** A dashed, slightly wobbling line from the worm to the thread it has smelled, and a dashed ring on that spot. */
  function paintScentLine(ctx, x0, y0, x1, y1, id, a, t) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 14) return;
    const ux = dx / d;
    const uy = dy / d;
    const sag = d * 0.07 * Math.sin(id * 1.9) + 1.6 * Math.sin(t * 2.1 + id);
    const sx = x0 + ux * 8;
    const sy = y0 + uy * 8;
    const ex = x1 - ux * 6;
    const ey = y1 - uy * 6;
    const cx = (sx + ex) / 2 - uy * sag;
    const cy = (sy + ey) / 2 + ux * sag;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha *= a;
    ctx.setLineDash([5.5, 4.5]);
    ctx.lineDashOffset = -t * 9;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.lineWidth = 4.2;
    ctx.strokeStyle = 'rgba(14,8,4,0.4)';
    ctx.stroke();
    ctx.lineWidth = 2.3;
    ctx.strokeStyle = '#d4493e';
    ctx.stroke();
    ctx.setLineDash([2.5, 3]);
    ctx.lineDashOffset = t * 6;
    ctx.beginPath();
    ctx.arc(x1, y1, 7 + 0.8 * Math.sin(t * 3 + id), 0, TAU);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawSenses(ctx, fauna, t) {
    for (const [id, s] of senses) {
      if (s.born < 0) s.born = t;
      let w = null;
      for (let i = 0; i < fauna.length; i++) {
        if (fauna[i] && fauna[i].id === id) {
          w = fauna[i];
          break;
        }
      }
      // the worm began to chew, was snared, or is no longer there: the warning has done its job
      if ((!w || w.mode === 'bite' || w.mode === 'snared') && s.endedAt < 0) s.endedAt = t;
      const age = t - s.born;
      const endAge = s.endedAt >= 0 ? t - s.endedAt : null;
      const a = senseAlpha(age, endAge);
      if (a <= 0.003 && (age > SENSE_LIFE || endAge !== null)) {
        senses.delete(id);
        continue;
      }
      if (w && Number.isFinite(w.x) && Number.isFinite(w.y)) {
        s.x = w.x;
        s.y = w.y;
      }
      const fade = w ? clamp(num(w.fade, 1), 0, 1) : 1;
      paintScentLine(ctx, s.x, s.y, s.tx, s.ty, id, a * fade, t);
      paintBang(ctx, s.x, s.y - 25 - 1.6 * Math.sin(t * 5 + id), id, a * fade, 0.5 + 0.5 * Math.sin(t * 7));
    }
  }

  /* ------------------------------------------------------------------ trap rings */

  function loopPts(seed, k, rad, t, n) {
    const pts = [];
    const so = seed * 1.7 + k * 9.3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + k * 0.9;
      const r = rad * (1 + 0.09 * noise1(so + i * 0.95)) + 0.35 * Math.sin(t * 1.3 + i * 0.7 + k);
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return pts;
  }

  /**
   * The ring sketch at (x, y): three rough concentric hyphal loops, each a thin cream thread over a dark under-line,
   * with three little beads (the cells of a constricting ring) when it is closed. grow 0..1 draws the loops in.
   */
  function paintRing(ctx, x, y, o) {
    const { seed = 1, grow = 1, scale = 1, color = '#f4e6b0', alpha = 1, t = 0, dash = null } = o;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let k = 0; k < 3; k++) {
      const f = clamp((grow - k * 0.22) / 0.56, 0, 1);
      if (f <= 0.01) continue;
      const rad = RING_R[k] * scale * (0.55 + 0.45 * ease(f));
      const pts = loopPts(seed, k, rad, t, RING_N);
      const m = f >= 0.999 ? RING_N : Math.max(3, Math.ceil(f * RING_N) + 1);
      const closed = f >= 0.999;
      const part = closed ? pts : pts.slice(0, m);
      ctx.beginPath();
      tracePath(ctx, part, closed, true);
      if (dash) ctx.setLineDash(dash);
      ctx.lineWidth = 3.4 - k * 0.5;
      ctx.strokeStyle = `rgba(12,6,2,${(0.55 * alpha).toFixed(3)})`;
      ctx.stroke();
      ctx.lineWidth = 1.5 - k * 0.15;
      ctx.strokeStyle = rgba(color, 0.95 * alpha);
      ctx.stroke();
      if (dash) ctx.setLineDash([]);
      if (closed) {
        ctx.fillStyle = rgba(color, alpha);
        ctx.strokeStyle = `rgba(30,16,8,${(0.8 * alpha).toFixed(3)})`;
        ctx.lineWidth = 0.7;
        for (let j = 0; j < 3; j++) {
          const a = k * 0.9 + (j / 3) * TAU + 0.5;
          const r = rad * (1 + 0.09 * noise1(seed * 1.7 + k * 9.3 + ((a / TAU) * RING_N) * 0.95));
          ctx.beginPath();
          ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 1.9 - k * 0.25, 0, TAU);
          ctx.fill();
          ctx.stroke();
        }
      } else if (f > 0.02) {
        // the growing tip of the ring
        const tip = part[part.length - 1];
        ctx.globalCompositeOperation = 'lighter';
        const g = glowSprite('#fff2c4', 48);
        ctx.globalAlpha *= 0.9;
        ctx.drawImage(g, tip.x - 6, tip.y - 6, 12, 12);
        ctx.globalAlpha /= 0.9;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.restore();
  }

  function trapRt(tr, t) {
    let r = traps.get(tr.id);
    if (!r) {
      r = { caughtAt: -9, coolMax: 1, seen: t };
      traps.set(tr.id, r);
    }
    r.seen = t;
    if (r.pending) {
      r.pending = false;
      r.caughtAt = t;
    }
    r.coolMax = Math.max(r.coolMax, num(tr.cool));
    return r;
  }

  function drawTrap(ctx, tr, t) {
    const x = num(tr.x);
    const y = num(tr.y);
    const r = trapRt(tr, t);
    const grow = clamp(num(tr.grow, 1), 0, 1);
    const cool = num(tr.cool);
    const digesting = cool > 0.01;
    const glow = clamp(num(tr.glow), 0, 1);
    const ready = grow >= 0.999 && !digesting && num(tr.charges, 1) > 0;
    const held = holds.has(tr.id);
    // the catch makes the ring snap tight, then relax
    const ck = (t - r.caughtAt) / 0.9;
    let scale = 1;
    if (ck >= 0 && ck < 1) scale = 1 - 0.34 * Math.sin(Math.PI * Math.pow(ck, 0.55)) + 0.05 * Math.sin(ck * 14) * (1 - ck);
    if (held) scale = 0.8 + 0.03 * Math.sin(t * 30);
    // lure: soft aura and waves running out towards the lure radius
    if (ready) {
      const reach = num(tr.r, TRAP_RADIUS);
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.9 + tr.id);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.1 + 0.07 * pulse;
      const g = glowSprite('#e8d27a', 48);
      ctx.drawImage(g, x - 34, y - 34, 68, 68);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 1;
      for (let i = 0; i < 2; i++) {
        const u = (t * 0.32 + tr.id * 0.37 + i * 0.5) % 1;
        const rr = 18 + (reach - 18) * u;
        ctx.strokeStyle = `rgba(236,222,150,${(0.2 * Math.pow(1 - u, 1.6)).toFixed(3)})`;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
    // warm halo after a catch
    if (glow > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, glow * 0.85);
      ctx.drawImage(glowSprite('#ffc65a', 48), x - 30, y - 30, 60, 60);
      ctx.globalCompositeOperation = 'source-over';
      const u = 1 - glow;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = `rgba(255,214,120,${(glow * 0.8).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 14 + u * 46, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    let color = '#f4e6b0';
    let alpha = 1;
    if (digesting) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + tr.id);
      color = mix('#bfb985', '#d6d38c', pulse * 0.5);
      alpha = 0.62;
    }
    if (glow > 0.01) color = mix(color, '#ffcb6b', glow);
    paintRing(ctx, x, y, { seed: tr.id, grow, scale, color, alpha, t });
    if (digesting) {
      // the prey, half dissolved: a pale curl in the middle and olive motes rising
      const left = clamp(cool / Math.max(r.coolMax, 0.1), 0, 1);
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = 0.25 + 0.5 * left;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(220,170,160,0.9)';
      ctx.lineWidth = 1.7 * (0.5 + left * 0.5);
      ctx.beginPath();
      ctx.moveTo(-4.4, 1.5);
      ctx.bezierCurveTo(-2.4, -3, 0.4, 3, 2.2, -0.5);
      ctx.bezierCurveTo(3, -1.7, 4, -1.3, 4.6, 0.3);
      ctx.stroke();
      ctx.restore();
      if (Math.random() < 0.035) sparks(x, y, 1, { up: true, v0: 4, v1: 8, life: 1.6, size: 1.3, color: NITRO, jit: 8, glow: 1 });
    }
    // remaining catches: small beads under the ring
    const charges = clamp(Math.round(num(tr.charges, 0)), 0, 5);
    if (grow >= 0.999 && charges > 0) {
      ctx.save();
      ctx.fillStyle = rgba(color, 0.9 * alpha);
      ctx.strokeStyle = 'rgba(20,10,4,0.7)';
      ctx.lineWidth = 0.6;
      for (let i = 0; i < charges; i++) {
        const cx = x + (i - (charges - 1) / 2) * 4.6;
        ctx.beginPath();
        ctx.arc(cx, y + RING_R[0] + 6, 1.5, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawPick(ctx, state, t) {
    const ui = state.ui;
    if (!ui || ui.tool !== 'trap' || state.phase === 'title' || !state.flags || !state.flags.threats) return;
    ctx.save();
    ctx.lineCap = 'round';
    // faint lure circles of the rings already out: where a new one would crowd them
    for (const tr of state.traps || []) {
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(240,226,160,0.2)';
      ctx.beginPath();
      ctx.arc(num(tr.x), num(tr.y), num(tr.r, TRAP_RADIUS), 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const pick = ui.trapPick;
    if (pick && Number.isFinite(pick.x) && Number.isFinite(pick.y)) {
      const ok = !!pick.ok;
      const col = ok ? '#f0dca8' : WAX;
      // dark under-line, then the dashed ink circle of the lure radius
      ctx.beginPath();
      ctx.arc(pick.x, pick.y, TRAP_RADIUS, 0, TAU);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(14,8,4,0.45)';
      ctx.stroke();
      ctx.lineWidth = 1.9;
      ctx.setLineDash([9, 6]);
      ctx.lineDashOffset = -t * 14;
      ctx.strokeStyle = rgba(col, 0.95);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      if (ok) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.08 + 0.04 * Math.sin(t * 3);
        ctx.fillStyle = '#e8d27a';
        ctx.beginPath();
        ctx.arc(pick.x, pick.y, TRAP_RADIUS, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      paintRing(ctx, pick.x, pick.y, { seed: 5, grow: 1, scale: 1, color: ok ? '#f4e6b0' : '#e89a8c', alpha: ok ? 0.6 + 0.15 * Math.sin(t * 4) : 0.5, t, dash: ok ? null : [3, 2.5] });
      if (!ok) {
        ctx.strokeStyle = WAX;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(pick.x - 5.5, pick.y - 5.5);
        ctx.lineTo(pick.x + 5.5, pick.y + 5.5);
        ctx.moveTo(pick.x + 5.5, pick.y - 5.5);
        ctx.lineTo(pick.x - 5.5, pick.y + 5.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ timed effects */

  function wiltSprites(kind, sub, step) {
    const key = (kind * 2 + sub) * 64 + step;
    let s = wilts.get(key);
    if (s) return s;
    const g = step / STEPS;
    const ext = extentOf(kind, g);
    const col = makeSprite(ext.w * 2, ext.up + ext.down, px, ext.w, ext.up);
    paintMushroom(col.ctx, kind, sub, g);
    granulate(col.ctx, col.cw, col.ch, 0.24, 0.55);
    // the same body drained of colour: desaturate in place, keep the original alpha, then dim it a little
    const grey = makeSprite(ext.w * 2, ext.up + ext.down, px, ext.w, ext.up);
    const gc = grey.ctx;
    gc.save();
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.drawImage(col.canvas, 0, 0);
    gc.globalCompositeOperation = 'saturation';
    gc.fillStyle = '#7e7e7e';
    gc.fillRect(0, 0, grey.cw, grey.ch);
    gc.globalCompositeOperation = 'destination-in';
    gc.drawImage(col.canvas, 0, 0);
    gc.globalCompositeOperation = 'source-atop';
    gc.fillStyle = 'rgba(58,48,40,0.3)';
    gc.fillRect(0, 0, grey.cw, grey.ch);
    gc.restore();
    s = { col, grey };
    wilts.set(key, s);
    return s;
  }

  const CREAM_RGB = [255, 246, 220];
  const GREY_RGB = [122, 108, 96];
  const mixRgb = (k, a) => {
    const r = Math.round(lerp(CREAM_RGB[0], GREY_RGB[0], k));
    const g = Math.round(lerp(CREAM_RGB[1], GREY_RGB[1], k));
    const b = Math.round(lerp(CREAM_RGB[2], GREY_RGB[2], k));
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  };

  function drawGhost(ctx, e, age, t) {
    const edges = e.edges;
    // edges the wave has not reached yet are still plain cream: one path for all of them
    const calm = new Path2D();
    let any = false;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < edges.length; i++) {
      const g = edges[i];
      const u = (age - g.delay) / CUT_FADE;
      if (u >= 1) continue;
      if (!g.path) {
        g.path = new Path2D();
        const p = g.pts;
        g.path.moveTo(p[0], p[1]);
        for (let k = 2; k < p.length; k += 2) g.path.lineTo(p[k], p[k + 1]);
      }
      if (u < 0) {
        calm.addPath(g.path);
        any = true;
        continue;
      }
      if (!g.fired) {
        g.fired = true;
        if (Math.random() < 0.55) {
          push({ k: 'spark', x: g.mx, y: g.my, vx: (Math.random() - 0.5) * 7, vy: 3 + Math.random() * 6, g: 4, life: 1.6 + Math.random(), color: '#9c8d7c', size: 1 + Math.random() * 0.9, delay: 0, tw: 0, glow: 0 });
        }
      }
      const cw = 1.75 + 0.7 * Math.min(Math.max(g.w - 1, 0), 3.2);
      const flare = u < 0.14 ? 1 - u / 0.14 : 0;
      const col = ease(u / 0.55);
      const a = 1 - ease((u - 0.2) / 0.8);
      if (u < 0.5) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255,222,150,${(0.2 * (1 - u * 2) + 0.3 * flare).toFixed(3)})`;
        ctx.lineWidth = cw * (4.5 + 2 * flare);
        ctx.stroke(g.path);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.strokeStyle = flare > 0 ? mixRgb(0, 1) : mixRgb(col, a);
      ctx.lineWidth = cw * (1 + 0.5 * flare) * (1 - 0.25 * u);
      ctx.stroke(g.path);
    }
    if (any) {
      ctx.strokeStyle = mixRgb(0, 1);
      ctx.lineWidth = 1.9;
      ctx.stroke(calm);
    }
  }

  function drawOne(ctx, e, age, u, t) {
    switch (e.k) {
      case 'snap': {
        const a = Math.pow(1 - u, 2);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, a * 1.8);
        const r = 12 + 40 * ease(Math.min(1, u * 2.5));
        ctx.drawImage(glowSprite('#fff2c4', 48), e.x - r, e.y - r, r * 2, r * 2);
        ctx.restore();
        // rays and a wax-red wound ring
        ctx.save();
        ctx.lineCap = 'round';
        const rr = mulberry((e.id * 17) | 0);
        const k = ease(Math.min(1, u * 2.2));
        ctx.strokeStyle = `rgba(255,236,190,${(0.9 * Math.pow(1 - Math.min(1, u * 1.6), 1.5)).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 9; i++) {
          const ang = (i / 9) * TAU + rr() * 0.5;
          const r0 = 3 + 8 * k;
          const r1 = 9 + 30 * k * (0.6 + rr() * 0.6);
          ctx.moveTo(e.x + Math.cos(ang) * r0, e.y + Math.sin(ang) * r0);
          ctx.lineTo(e.x + Math.cos(ang) * r1, e.y + Math.sin(ang) * r1);
        }
        ctx.stroke();
        ctx.strokeStyle = `rgba(201,68,59,${(0.8 * Math.pow(1 - u, 1.3)).toFixed(3)})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 6 + 28 * ease(Math.min(1, u * 1.4)), 0, TAU);
        ctx.stroke();
        // ink drops thrown out
        ctx.fillStyle = `rgba(20,8,4,${(0.85 * (1 - u)).toFixed(3)})`;
        for (let i = 0; i < 6; i++) {
          const ang = rr() * TAU;
          const d = (6 + rr() * 16) * ease(Math.min(1, u * 2));
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(ang) * d, e.y + Math.sin(ang) * d + u * 4, 0.9 + rr() * 1.1, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'ghost':
        ctx.save();
        drawGhost(ctx, e, age, t);
        ctx.restore();
        break;
      case 'wilt': {
        const s = wiltSprites(e.kind, e.sub, e.step);
        const m = ease(u / 0.8);
        const lean = e.lean0 + e.dir * 0.62 * m * m;
        const sy = e.size * (1 - 0.34 * ease(u / 0.9));
        const sx = e.size * (e.mirror ? -1 : 1) * (1 + 0.1 * m);
        const alpha = 1 - ease((u - 0.3) / 0.7);
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.transform(sx, 0, -lean * e.size, sy, 0, 0);
        const colA = 1 - ease(u / 0.22);
        if (colA > 0.01) {
          ctx.globalAlpha = colA;
          ctx.drawImage(s.col.canvas, -s.col.ax, -s.col.ay, s.col.w, s.col.h);
        }
        ctx.globalAlpha = alpha * (1 - colA * 0.0);
        ctx.drawImage(s.grey.canvas, -s.grey.ax, -s.grey.ay, s.grey.w, s.grey.h);
        ctx.restore();
        break;
      }
      case 'wither': {
        const a = 1 - ease((u - 0.1) / 0.9);
        ctx.save();
        const dash = [Math.max(0.5, 8 * (1 - u)), 1 + 7 * u];
        paintRing(ctx, e.x, e.y, { seed: e.seed, grow: 1, scale: 1 - 0.18 * u, color: mix('#d9ce9a', '#7f7a70', ease(u / 0.5)), alpha: 0.75 * a, t, dash });
        ctx.restore();
        break;
      }
      case 'swallow': {
        const k = ease(u);
        const X = new Float32Array(SEG);
        const Y = new Float32Array(SEG);
        for (let j = 0; j < SEG; j++) {
          // the tail follows the head into the ring
          const q = clamp(k * 1.35 - (j / SEG) * 0.35, 0, 1);
          X[j] = lerp(e.X[j], e.cx, ease(q));
          Y[j] = lerp(e.Y[j], e.cy, ease(q));
        }
        ctx.save();
        ctx.globalAlpha = 1 - u * u;
        paintBody(ctx, X, Y, e.W * (1 - 0.45 * k), 0.9);
        ctx.restore();
        break;
      }
      case 'ripple': {
        const k = ease(u);
        ctx.save();
        ctx.lineWidth = e.lw * (1 - 0.5 * u);
        ctx.strokeStyle = rgba(e.color, 0.85 * Math.pow(1 - u, 1.4));
        ctx.beginPath();
        ctx.arc(e.x, e.y, lerp(e.r0, e.r1, k), 0, TAU);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'dashring': {
        ctx.save();
        ctx.setLineDash([7, 6]);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = rgba(e.color, 0.8 * (1 - u));
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, TAU);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'cross': {
        const a = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
        const s = e.size * (0.8 + 0.2 * ease(Math.min(1, u * 5)));
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = `rgba(14,6,3,${(0.55 * a).toFixed(3)})`;
        ctx.lineWidth = 4.2;
        ctx.beginPath();
        ctx.moveTo(e.x - s, e.y - s);
        ctx.lineTo(e.x + s, e.y + s);
        ctx.moveTo(e.x + s, e.y - s);
        ctx.lineTo(e.x - s, e.y + s);
        ctx.stroke();
        ctx.strokeStyle = rgba(WAX, a);
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.restore();
        break;
      }
      default:
    }
  }

  function drawSpark(ctx, e, age, u, dt) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.vx *= 1 - Math.min(1, dt * 1.6);
    e.vy = e.vy * (1 - Math.min(1, dt * 1.6)) + e.g * dt;
    const a = u < 0.15 ? u / 0.15 : Math.pow(1 - (u - 0.15) / 0.85, 1.2);
    const tw = e.tw ? 0.75 + 0.25 * Math.sin(age * 14 + e.tw) : 1;
    const s = e.size * (1 - 0.35 * u);
    if (e.glow) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * a * tw;
      ctx.drawImage(glowSprite(e.color, 48), e.x - s * 3.2, e.y - s * 3.2, s * 6.4, s * 6.4);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = a * tw;
    ctx.fillStyle = e.color;
    ctx.fillRect(e.x - s, e.y - s, s * 2, s * 2);
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ draw */

  function draw(ctx, state, t, dt) {
    lastT = t;
    const fauna = Array.isArray(state.fauna) ? state.fauna : [];
    const trapList = Array.isArray(state.traps) ? state.traps : [];
    const preview = state.ui && state.ui.tool === 'trap';
    if (!fauna.length && !trapList.length && !list.length && !preview) {
      senses.clear();
      return;
    }
    dt = clamp(num(dt, 1 / 60), 0, 0.1);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    holds.clear();
    for (const w of fauna) if (w && w.mode === 'snared' && w.trapId != null) holds.add(w.trapId);

    // trap rings sit on the net, under the worms
    for (const tr of trapList) {
      if (tr && Number.isFinite(tr.x) && Number.isFinite(tr.y)) drawTrap(ctx, tr, t);
    }
    if (fauna.length) {
      const order = fauna.filter((w) => w && Number.isFinite(w.x) && Number.isFinite(w.y)).sort((a, b) => a.y - b.y);
      for (const w of order) {
        const r = wormRt(w, t);
        updateWorm(r, w, state, t, dt);
        drawWorm(ctx, r, w, state, t, dt);
      }
    }
    if (senses.size) {
      try {
        drawSenses(ctx, fauna, t);
      } catch {
        senses.clear(); // a marker must never break the frame
      }
    }

    // timed effects (the wilting mushrooms are drawn later, in drawTop, with the living ones)
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.k === 'wilt') continue;
      if (e.born < 0) e.born = t + (e.delay || 0);
      const age = t - e.born;
      if (age < 0) continue;
      const u = age / e.life;
      if (u >= 1) {
        list.splice(i, 1);
        continue;
      }
      ctx.save();
      if (e.k === 'spark') drawSpark(ctx, e, age, u, dt);
      else drawOne(ctx, e, age, u, t);
      ctx.restore();
    }

    drawPick(ctx, state, t);
    ctx.restore();

    if (t - lastPrune > 2) {
      lastPrune = t;
      for (const [id, r] of worms) if (t - r.seen > 4) worms.delete(id);
      for (const [id, r] of traps) if (t - r.seen > 12) traps.delete(id);
    }
  }

  return {
    attach(r) {
      refs = r;
    },
    setScale(p) {
      if (Math.abs(p / px - 1) > 0.02) {
        px = p;
        wilts.clear();
      }
    },
    reset() {
      worms.clear();
      traps.clear();
      list.length = 0;
      holds.clear();
      senses.clear();
    },
    event,
    draw,
    /** Ghosts of wilted mushrooms, after the trees and the living fruit bodies (they stand on the ground in front of the plate). */
    drawTop(ctx, state, t) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e.k !== 'wilt') continue;
        if (e.born < 0) e.born = t;
        const age = t - e.born;
        const u = age / e.life;
        if (u >= 1) {
          list.splice(i, 1);
          continue;
        }
        ctx.save();
        drawOne(ctx, e, age, u, t);
        ctx.restore();
      }
    },
  };
}

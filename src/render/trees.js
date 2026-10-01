// Trees: ink-and-watercolor trunks, branches and crowns above ground, inked watercolor roots below.
// Everything heavy is rendered once into cached sprites (device resolution); a frame only blits and transforms.
// API: createTrees() -> { setScale, reset, event, drawRoots, drawTrees, bounds }
import { makeCanvas, glowSprite, noise1, mulberry, mix, catmull, smooth01 } from './ink.js';
import { resample } from '../core/geom.js';
import { buildModel, STAGE_H } from './trees-model.js';
import { trunkSteps, crownSteps } from './trees-paint.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const GROW_TIME = 2.0; // above-ground stage change, seconds
const ROOT_TIME = 3.0; // roots growing in, seconds
const BUCKETS = 4; // health 0..1 -> 0..4
const SWAY = { oak: 0.7, birch: 1.5, pine: 0.95 };
const MAX_SPRITE = 2300; // device px
const HEALTH_FADE = 0.8; // crown cross-fade after a health change, seconds
const SEASON_FADE = 20; // crown cross-fade after a season change, seconds (globalThis.__seasonFade overrides it: a test knob)
const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];

/** The season to paint ('' = the picture without seasons: flag off or no clock). */
function seasonOf(state) {
  const c = state && state.flags && state.flags.seasons && state.clock;
  return c && SEASON_NAMES.includes(c.season) ? c.season : '';
}

/**
 * Alpha of the fading-out crown. A health fade keeps it opaque under the fading-in one (both crowns are opaque). A season
 * fade also lets it go in the second half, because a bare winter crown is see-through and the old leaves would otherwise
 * stay behind it until the very last frame and then pop away.
 */
const oldCrownAlpha = (look) => (look.fadeSeason ? 1 - smooth01((look.fadeT - 0.45) / 0.55) : 1);

function seasonFadeSeconds() {
  const v = globalThis.__seasonFade;
  return typeof v === 'number' && v > 0 ? v : SEASON_FADE;
}

function stageOf(tree) {
  return clamp(Math.round(num(tree && tree.stage, 0)), 0, 3);
}

/* ------------------------------------------------------------------ sprites */

function spriteBox(model) {
  const pad = 14;
  const bb = model.bbox;
  const x0 = bb.x0 - pad;
  const x1 = bb.x1 + pad;
  const y0 = bb.y0 - pad;
  const y1 = Math.max(bb.y1, 0) + 10;
  return { w: x1 - x0, h: y1 - y0, ax: -x0, ay: -y0 };
}

function fitPx(px, w, h) {
  return Math.min(px, MAX_SPRITE / Math.max(w, h));
}

/** Sprite canvas (same shape as ink.makeSprite) read back cheaply, so painting can be flushed step by step. */
function makeSprite(w, h, px, ax, ay) {
  const canvas = makeCanvas(w * px, h * px);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(px, 0, 0, px, ax * px, ay * px);
  return { canvas, ctx, px, w, h, ax, ay, cw: canvas.width, ch: canvas.height };
}

function drawSprite(ctx, sp, ox, oy, alpha) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(sp.canvas, ox - sp.ax, oy - sp.ay, sp.w, sp.h);
}

/* ------------------------------------------------------------------ roots geometry */

const ROOT_MEANDER = 3.4; // world units

function buildRootGeom(root, roots, seed) {
  const raw = root && root.points;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const clean = raw.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (clean.length < 2) return null;
  const pts = resample(clean.length > 2 ? catmull(clean, 4) : clean, 2.5).map((q) => ({ x: q.x, y: q.y }));
  // let the roots meander: a smooth displacement field of position (not of arc length), so a branch stays attached
  // to its parent and the taproot pieces stay continuous; it fades out near the trunk base
  const base = roots[0]?.points?.[0] || clean[0];
  for (const q of pts) {
    const f = ROOT_MEANDER * smooth01((Math.hypot(q.x - base.x, q.y - base.y) - 4) / 26);
    if (f <= 0) continue;
    q.x += f * (0.65 * noise1(q.y * 0.045 + q.x * 0.012 + 3.1) + 0.35 * noise1((q.x + q.y) * 0.11 + 9.3));
    q.y += f * (0.65 * noise1(q.x * 0.045 - q.y * 0.01 + 7.7) + 0.35 * noise1((q.x - q.y) * 0.105 + 1.9));
  }
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[n - 1] || 1;
  const w0 = Math.max(1.4, num(root.width, 3) * 1.12 + 0.5);
  const last = clean[clean.length - 1];
  const first = clean[0];
  const next = roots.find((o) => o !== root && o.points && o.points[0] && Math.hypot(o.points[0].x - last.x, o.points[0].y - last.y) < 1.5);
  const isCont = roots.some((o) => o !== root && o.points && o.points.length && Math.hypot(o.points[o.points.length - 1].x - first.x, o.points[o.points.length - 1].y - first.y) < 1.5);
  const endW = next ? Math.max(1.4, num(next.width, 2) * 1.12 + 0.5) : Math.max(0.5, w0 * 0.12);
  const so = (seed % 997) * 0.31;
  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const hw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[i > 0 ? i - 1 : 0];
    const b = pts[i < n - 1 ? i + 1 : n - 1];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    px[i] = -dy;
    py[i] = dx;
    cx[i] = pts[i].x;
    cy[i] = pts[i].y;
    const s = cum[i] / total;
    let w = lerp(w0, endW, Math.pow(s, 0.9));
    if (!isCont) w *= 0.45 + 0.55 * smooth01(cum[i] / 9);
    w *= 1 + 0.12 * noise1(cum[i] * 0.13 + so + 3);
    hw[i] = Math.max(0.22, w * 0.5);
  }
  // rootlet hairs: short, leaving the root at a shallow angle and curling down, never straight thorns
  const rng = mulberry(seed * 2654435 + 17);
  const hairs = [];
  const addHair = (i, side, len, spread, s) => {
    const ang = Math.atan2(-px[i], py[i]) + side * spread; // tangent turned towards its side
    const ex = cx[i] + px[i] * hw[i] * side * 0.9;
    const ey = cy[i] + py[i] * hw[i] * side * 0.9;
    const x1 = ex + Math.cos(ang) * len;
    const y1 = ey + Math.sin(ang) * len + len * 0.3;
    const bend = (rng() - 0.5) * len * 0.5;
    hairs.push({ s, x0: ex, y0: ey, mx: (ex + x1) / 2 - Math.sin(ang) * bend, my: (ey + y1) / 2 + Math.cos(ang) * bend, x1, y1 });
  };
  if (w0 > 1.7) {
    let s = rng() * 8 + 7;
    let side = rng() < 0.5 ? -1 : 1;
    while (s < total - 8) {
      const i = Math.min(n - 1, Math.round((s / total) * (n - 1)));
      addHair(i, side, rng() * 3.5 + 2.5 + hw[i] * 0.6, 0.35 + rng() * 0.45, s);
      side = -side;
      s += rng() * 12 + 10;
    }
  }
  if (!next) {
    for (let k = 0; k < 4; k++) {
      const i = Math.max(0, n - 1 - Math.floor(rng() * 4));
      addHair(i, k % 2 ? 1 : -1, 3.5 + rng() * 5, 0.2 + rng() * 0.6, total - 0.5 + k * 0.01);
    }
  }
  // uneven pigment: patches along the root a little darker or lighter than the body wash
  const mottle = [];
  for (let s = rng() * 6; s < total - 3; s += 7 + rng() * 9) {
    const e = Math.min(total, s + 5 + rng() * 9);
    const i0 = Math.round((s / total) * (n - 1));
    const i1 = Math.max(i0 + 1, Math.round((e / total) * (n - 1)));
    mottle.push({ i0, i1, s, dark: rng() < 0.55, k: 0.5 + rng() * 0.5 });
  }
  // engraver's hatching across the shadow side of the thicker roots
  const hatch = [];
  if (w0 > 2.3) {
    for (let s = 2 + rng() * 2; s < total - 2; s += 1.8 + rng() * 1.4) {
      const i = Math.min(n - 1, Math.round((s / total) * (n - 1)));
      if (hw[i] < 0.9) continue;
      hatch.push({ i, s, a: 0.12 + rng() * 0.25, l: 0.75 + rng() * 0.25 });
    }
  }
  // ink pressure along the outline
  const press = new Float32Array(n);
  for (let i = 0; i < n; i++) press[i] = 0.5 + 0.5 * noise1(cum[i] * 0.05 + so + 7);
  const t = clamp((w0 - 2) / 5, 0, 1);
  return { n, cum, total, cx, cy, px, py, hw, hairs, mottle, hatch, press, w0, color: mix('#c9ab7c', '#94704a', t), x0: pts[0].x, y0: pts[0].y, xe: pts[n - 1].x, ye: pts[n - 1].y };
}

const ROOT_SHADOW = 'rgba(14,8,4,0.42)';
const ROOT_INK = 'rgba(30,18,9,0.88)';
const HAIR_COL = 'rgba(208,182,136,0.5)';

/**
 * Draw a root up to a fraction `frac` of its length (frac = 1: the finished root), in the manner of the rest of the
 * plate: a warm watercolor body with uneven pigment, a shaded underside hatched like an engraving, a trembling ink
 * contour heavy on the shadow side and broken on the lit side, a few pale lights and curling root hairs.
 */
function drawRootGeom(ctx, g, frac, sx = 0, sy = 0) {
  const lReveal = g.total * clamp(frac, 0, 1);
  if (lReveal <= 0.5) return null;
  const full = frac >= 0.999;
  const tipLen = full ? 0 : 8 + 14 * (1 - smooth01(frac));
  // number of fully revealed points
  let k = 0;
  while (k < g.n - 1 && g.cum[k + 1] <= lReveal) k++;
  const m = full ? g.n : k + 2 <= g.n ? k + 2 : g.n;
  const hwAt = (i) => {
    if (full) return g.hw[i];
    const d = lReveal - g.cum[i];
    if (d <= 0) return 0.12;
    return g.hw[i] * (tipLen > 0 ? smooth01(Math.min(1, d / tipLen)) * 0.85 + 0.15 * Math.min(1, d / tipLen) : 1);
  };
  const P = new Float32Array(m * 5);
  for (let i = 0; i < m; i++) {
    let x = g.cx[i];
    let y = g.cy[i];
    let h = hwAt(i);
    if (!full && i === m - 1 && i > 0 && g.cum[i] > lReveal) {
      const t = (lReveal - g.cum[i - 1]) / (g.cum[i] - g.cum[i - 1] || 1);
      x = lerp(g.cx[i - 1], g.cx[i], t);
      y = lerp(g.cy[i - 1], g.cy[i], t);
      h = 0.12;
    }
    P[i * 5] = x;
    P[i * 5 + 1] = y;
    P[i * 5 + 2] = g.px[i];
    P[i * 5 + 3] = g.py[i];
    P[i * 5 + 4] = h;
  }
  /** Polygon between lateral offsets off0..off1 (units of half width, + extra world units) over points [i0, i1). */
  const band = (off0, off1, i0 = 0, i1 = m, grow0 = 0, grow1 = 0, dx = 0, dy = 0) => {
    i1 = Math.min(i1, m);
    if (i1 - i0 < 2) return false;
    ctx.beginPath();
    for (let i = i0; i < i1; i++) {
      const o = i * 5;
      const a = P[o + 4] * off0 + grow0;
      if (i === i0) ctx.moveTo(P[o] + P[o + 2] * a + dx, P[o + 1] + P[o + 3] * a + dy);
      else ctx.lineTo(P[o] + P[o + 2] * a + dx, P[o + 1] + P[o + 3] * a + dy);
    }
    for (let i = i1 - 1; i >= i0; i--) {
      const o = i * 5;
      const b = P[o + 4] * off1 + grow1;
      ctx.lineTo(P[o] + P[o + 2] * b + dx, P[o + 1] + P[o + 3] * b + dy);
    }
    ctx.closePath();
    return true;
  };
  const thick = g.w0 > 2.3;
  ctx.save();
  if (sx || sy) ctx.translate(sx, sy);
  // contact shadow on the soil, then the body wash
  if (band(-1, 1, 0, m, -0.5, 0.9, 0.5, 0.9)) {
    ctx.fillStyle = ROOT_SHADOW;
    ctx.fill();
  }
  band(-1, 1);
  ctx.fillStyle = g.color;
  ctx.fill();
  // uneven pigment
  for (const q of g.mottle) {
    if (q.i0 >= m - 1) break;
    if (!band(-1, 1, q.i0, q.i1 + 1)) continue;
    ctx.fillStyle = q.dark ? `rgba(92,60,32,${(0.2 * q.k).toFixed(3)})` : `rgba(240,218,170,${(0.16 * q.k).toFixed(3)})`;
    ctx.fill();
  }
  // shaded underside in two glazes
  if (band(0.05, 1)) {
    ctx.fillStyle = 'rgba(66,40,20,0.3)';
    ctx.fill();
  }
  if (thick && band(0.55, 1)) {
    ctx.fillStyle = 'rgba(46,27,13,0.28)';
    ctx.fill();
  }
  // hatching on the shadow side
  if (g.hatch.length) {
    ctx.beginPath();
    for (const hq of g.hatch) {
      if (hq.i >= m - 1 || (!full && hq.s > lReveal - 2)) continue;
      const o = hq.i * 5;
      const h = P[o + 4];
      const tx = P[o + 3];
      const ty = -P[o + 2];
      const x0 = P[o] + P[o + 2] * h * 0.2;
      const y0 = P[o + 1] + P[o + 3] * h * 0.2;
      const x1 = P[o] + P[o + 2] * h * hq.l + tx * h * hq.a;
      const y1 = P[o + 1] + P[o + 3] * h * hq.l + ty * h * hq.a;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.strokeStyle = 'rgba(34,20,10,0.42)';
    ctx.lineWidth = 0.42;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  // lights along the lit side of thick roots, broken where the pressure is low
  if (thick) {
    ctx.beginPath();
    let on = false;
    for (let i = 0; i < m; i++) {
      const o = i * 5;
      const vis = g.press[i] > 0.42 && P[o + 4] > 0.9;
      const x = P[o] - P[o + 2] * P[o + 4] * 0.55;
      const y = P[o + 1] - P[o + 3] * P[o + 4] * 0.55;
      if (vis && on) ctx.lineTo(x, y);
      else if (vis) ctx.moveTo(x, y);
      on = vis;
    }
    ctx.strokeStyle = 'rgba(250,234,196,0.42)';
    ctx.lineWidth = 0.65;
    ctx.stroke();
  }
  // ink: a pressured contour on the shadow side ...
  ctx.beginPath();
  for (let i = 0; i < m; i++) {
    const o = i * 5;
    const a = P[o + 4];
    ctx[i ? 'lineTo' : 'moveTo'](P[o] + P[o + 2] * a, P[o + 1] + P[o + 3] * a);
  }
  for (let i = m - 1; i >= 0; i--) {
    const o = i * 5;
    const h = P[o + 4];
    const w = (0.22 + 0.55 * g.press[i]) * Math.min(1, 0.35 + h * 0.45);
    ctx.lineTo(P[o] + P[o + 2] * (h + w), P[o + 1] + P[o + 3] * (h + w));
  }
  ctx.closePath();
  ctx.fillStyle = ROOT_INK;
  ctx.fill();
  // ... and a fine, broken one on the lit side
  ctx.beginPath();
  let on = false;
  for (let i = 0; i < m; i++) {
    const o = i * 5;
    const vis = g.press[i] > 0.3;
    const x = P[o] - P[o + 2] * P[o + 4];
    const y = P[o + 1] - P[o + 3] * P[o + 4];
    if (vis && on) ctx.lineTo(x, y);
    else if (vis) ctx.moveTo(x, y);
    on = vis;
  }
  ctx.strokeStyle = 'rgba(30,18,9,0.6)';
  ctx.lineWidth = 0.42;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // root hairs
  ctx.beginPath();
  for (const h of g.hairs) {
    if (!full && h.s > lReveal - 2) continue;
    ctx.moveTo(h.x0, h.y0);
    ctx.quadraticCurveTo(h.mx, h.my, h.x1, h.y1);
  }
  ctx.strokeStyle = HAIR_COL;
  ctx.lineWidth = 0.5;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
  return full ? null : { x: g.cx[Math.min(k, g.n - 1)], y: g.cy[Math.min(k, g.n - 1)] };
}

/* ------------------------------------------------------------------ factory */

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const PUMP_MS = 3; // per frame, spent on background sprite painting

export function createTrees() {
  let px = 1;
  let world = null;
  const models = new Map();
  const ups = new Map(); // above-ground records by tree id
  const rts = new Map(); // roots records by tree id
  const queue = []; // background painting jobs (their steps run a few ms per frame)
  let lastT = null;
  let warned = false;

  const warn = (e) => {
    if (!warned) {
      warned = true;
      console.warn('trees: draw failed', e);
    }
  };
  const guard = (fn) => {
    try {
      fn();
    } catch (e) {
      warn(e);
    }
  };

  let pumpKey = null;
  let pumpSpent = 0;
  /** Run background steps for up to `budget` ms per frame (t identifies the frame; drawRoots and drawTrees share it). */
  function pump(budget, t) {
    if (t !== pumpKey) {
      pumpKey = t;
      pumpSpent = 0;
    }
    while (queue.length && pumpSpent < budget) {
      const job = queue[0];
      if (job.cancelled) {
        queue.shift();
        continue;
      }
      const t0 = nowMs();
      try {
        job.steps[job.i++]();
        // canvas commands are recorded lazily; reading a pixel makes the raster work happen here, inside the budget
        for (const c of job.ctxs) c.getImageData(0, 0, 1, 1);
      } catch (e) {
        warn(e);
        job.i = job.steps.length;
      }
      pumpSpent += nowMs() - t0;
      if (job.i >= job.steps.length) {
        job.done = true;
        queue.shift();
      }
    }
  }
  const runAll = (job) => {
    while (job.i < job.steps.length) job.steps[job.i++]();
    job.done = true;
  };
  const cancel = (job) => {
    if (job) job.cancelled = true;
  };

  const frameDt = (t, dt) => {
    let d = Number.isFinite(dt) ? dt : lastT === null || !Number.isFinite(t) ? 0 : t - lastT;
    if (Number.isFinite(t)) lastT = t;
    d = clamp(d, 0, 0.1);
    return d;
  };

  function modelFor(tree, stage) {
    const species = tree.species === 'oak' || tree.species === 'pine' ? tree.species : 'birch';
    const seed = num(tree.crownSeed, 1) | 0;
    const key = `${tree.id}|${species}|${seed}|${stage}`;
    let m = models.get(key);
    if (!m) {
      m = buildModel(species, stage, seed);
      models.set(key, m);
      if (models.size > 64) models.delete(models.keys().next().value);
    }
    return m;
  }

  function setScale(p) {
    if (!(p > 0) || !Number.isFinite(p)) return;
    const v = clamp(p, 0.2, 6);
    if (Math.abs(v / px - 1) > 0.02) px = v; // sprites are rebuilt in the background when they are drawn next
  }

  function reset(w) {
    world = w || null;
    models.clear();
    ups.clear();
    rts.clear();
    queue.length = 0;
    lastT = null;
  }

  function event(ev) {
    if (!ev || ev.type !== 'tree-stage') return;
    // Stage changes are detected from tree.stage while drawing; the event only notes the hint.
    const r = ups.get(ev.treeId);
    if (r) r.hint = ev.stage;
    const q = rts.get(ev.treeId);
    if (q) q.hint = ev.stage;
  }

  function treesOf(state) {
    const w = state && state.world;
    if (w && w !== world) reset(w);
    const list = w && w.trees;
    return Array.isArray(list) ? list : [];
  }

  /* ------------------------------------------------------------ above ground */

  function bucketFor(rec, health) {
    const h = clamp(num(health, 0.5), 0, 1) * BUCKETS;
    if (rec.bucket === undefined || Math.abs(h - rec.bucket) > 0.62) return Math.round(h);
    return rec.bucket;
  }

  /** A look = trunk sprite + crown sprite for (stage, bucket, px); painted as a job made of small steps. */
  function makeLookJob(tree, stage, bucket, reuseTrunk, season) {
    const model = modelFor(tree, stage);
    const b = spriteBox(model);
    const pf = fitPx(px, b.w, b.h);
    const steps = [];
    let trunk = reuseTrunk;
    if (!trunk) {
      trunk = makeSprite(b.w, b.h, pf, b.ax, b.ay);
      steps.push(...trunkSteps(trunk.ctx, model, trunk.cw, trunk.ch));
    }
    const crown = makeSprite(b.w, b.h, pf, b.ax, b.ay);
    steps.push(...crownSteps(crown.ctx, model, bucket / BUCKETS, crown.cw, crown.ch, season || undefined));
    return { stage, bucket, season, fadeDur: HEALTH_FADE, fadeSeason: false, px, model, trunk, crown, steps, ctxs: reuseTrunk ? [crown.ctx] : [trunk.ctx, crown.ctx], i: 0, done: false, cancelled: false, fadeOld: null, fadeT: 1 };
  }

  function upRecord(tree) {
    const key = `${tree.species}|${num(tree.crownSeed, 1)}`;
    let rec = ups.get(tree.id);
    if (!rec || rec.key !== key) {
      cancel(rec && rec.job);
      rec = { key, look: null, prev: null, grow: 0, job: null, phase: (num(tree.crownSeed, 1) % 1000) * 0.137, bucket: undefined };
      ups.set(tree.id, rec);
    }
    return rec;
  }

  /**
   * The crown exactly as it is on screen now. A look in the middle of a cross-fade shows two sprites; when another change
   * takes over, they are flattened into one so the new fade starts from the same picture (no flash, and at most one
   * fading-out sprite per tree).
   */
  function onScreenCrown(L) {
    if (!L.fadeOld || L.fadeT >= 1) return L.crown;
    const c = L.crown;
    const flat = makeSprite(c.w, c.h, c.px, c.ax, c.ay);
    const g = flat.ctx;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = oldCrownAlpha(L);
    g.drawImage(L.fadeOld.canvas, 0, 0, flat.cw, flat.ch);
    g.globalAlpha = L.fadeT;
    g.drawImage(c.canvas, 0, 0, flat.cw, flat.ch);
    g.restore();
    return flat;
  }

  /** Make sure rec.look is up to date: painted synchronously the first time, later in a background job and swapped in. */
  function updateLook(rec, tree, stage, bucket, season) {
    if (!rec.look) {
      const job = makeLookJob(tree, stage, bucket, null, season);
      runAll(job);
      rec.look = job;
      return;
    }
    const L = rec.look;
    const mismatch = L.stage !== stage || L.px !== px || L.bucket !== bucket || L.season !== season;
    if (!mismatch) {
      if (rec.job) {
        cancel(rec.job);
        rec.job = null;
      }
      return;
    }
    let J = rec.job;
    if (!J || J.stage !== stage || J.px !== px || J.bucket !== bucket || J.season !== season) {
      cancel(J);
      J = makeLookJob(tree, stage, bucket, L.stage === stage && L.px === px ? L.trunk : null, season);
      rec.job = J;
      queue.push(J);
    }
    if (!J.done) return;
    rec.job = null;
    if (L.stage !== J.stage) {
      rec.prev = L;
      rec.grow = 0;
    } else if (L.px === J.px) {
      J.fadeOld = onScreenCrown(L);
      J.fadeT = 0;
      J.fadeSeason = L.season !== J.season;
      J.fadeDur = J.fadeSeason ? seasonFadeSeconds() : HEALTH_FADE;
    }
    rec.look = J;
  }

  function drawLook(ctx, look, x, y, o) {
    const { alpha, scale, k1, k2, rot, fl } = o;
    const m = look.model;
    ctx.save();
    ctx.translate(x, y);
    if (scale !== 1) ctx.scale(scale, scale);
    // trunk: shear about the base
    ctx.save();
    ctx.transform(1, 0, k1, 1, 0, 0);
    drawSprite(ctx, look.trunk, 0, 0, alpha);
    ctx.restore();
    // crown: shear a little more, plus a flutter about its own centre
    ctx.save();
    ctx.transform(1, 0, k2, 1, 0, 0);
    ctx.translate(m.cx, m.cy);
    ctx.rotate(rot);
    ctx.scale(1 + fl * 0.004, 1 - fl * 0.003);
    ctx.translate(-m.cx, -m.cy);
    if (look.fadeOld && look.fadeT < 1) {
      drawSprite(ctx, look.fadeOld, 0, 0, alpha * oldCrownAlpha(look));
      drawSprite(ctx, look.crown, 0, 0, alpha * look.fadeT);
    } else drawSprite(ctx, look.crown, 0, 0, alpha);
    ctx.restore();
    ctx.restore();
  }

  function drawTrees(ctx, state, t, dt) {
    const d = frameDt(t, dt);
    if (!ctx) return;
    const tt = Number.isFinite(t) ? t : lastT || 0;
    const wind = noise1(tt * 0.13 + 7) * 0.6 + noise1(tt * 0.047 + 3) * 0.4;
    const season = seasonOf(state);
    ctx.save();
    for (const tree of treesOf(state)) {
      guard(() => {
        if (!tree || !Number.isFinite(tree.x) || !Number.isFinite(tree.baseY)) return;
        const stage = stageOf(tree);
        const rec = upRecord(tree);
        const bucket = bucketFor(rec, tree.health);
        rec.bucket = bucket;
        updateLook(rec, tree, stage, bucket, season);
        const look = rec.look;
        if (look.fadeOld) {
          look.fadeT += d / look.fadeDur;
          if (look.fadeT >= 1) {
            look.fadeT = 1;
            look.fadeOld = null;
          }
        }
        const sw = SWAY[look.model.species] || 1;
        const own = noise1(tt * 0.31 + rec.phase) * 0.5 + noise1(tt * 0.77 + rec.phase * 1.7) * 0.25;
        const flut = noise1(tt * 1.15 + rec.phase * 2.3) * 0.5 + noise1(tt * 2.3 + rec.phase) * 0.3;
        const k1 = sw * 0.0075 * (0.7 * wind + 0.7 * own);
        const base = { alpha: 1, scale: 1, k1, k2: k1 * 1.5 + flut * 0.003, rot: flut * 0.0055 * sw, fl: flut };
        if (rec.prev) {
          rec.grow += d / GROW_TIME;
          if (rec.grow >= 1) rec.prev = null;
          else {
            const e = smooth01(rec.grow);
            const r = rec.prev.model.H / look.model.H;
            const pop = 1 + 0.03 * Math.sin(e * Math.PI);
            drawLook(ctx, rec.prev, tree.x, tree.baseY, { ...base, scale: lerp(1, 1 / r, e) * pop, alpha: 1 - smooth01((e - 0.3) / 0.7) });
            drawLook(ctx, look, tree.x, tree.baseY, { ...base, scale: lerp(r, 1, e) * pop, alpha: smooth01(e / 0.75) });
            return;
          }
        }
        drawLook(ctx, look, tree.x, tree.baseY, base);
      });
    }
    ctx.restore();
    pump(PUMP_MS, tt);
  }

  function bounds(tree) {
    try {
      if (!tree || !Number.isFinite(tree.x) || !Number.isFinite(tree.baseY)) throw new Error('bad tree');
      const m = modelFor(tree, stageOf(tree));
      const b = m.bbox;
      return { x0: tree.x + b.x0 + 4, y0: tree.baseY + b.y0 + 4, x1: tree.x + b.x1 - 4, y1: tree.baseY + Math.max(b.y1, 0) };
    } catch (e) {
      const x = num(tree && tree.x, 0);
      const y = num(tree && tree.baseY, 0);
      const h = STAGE_H[stageOf(tree)];
      return { x0: x - h * 0.4, y0: y - h, x1: x + h * 0.4, y1: y };
    }
  }

  /* ------------------------------------------------------------ roots */

  function rootRecord(tree) {
    const roots = Array.isArray(tree.roots) ? tree.roots : [];
    const key = `${roots.length}|${roots[0] && roots[0].points && roots[0].points[0] ? roots[0].points[0].x : 0}`;
    let rec = rts.get(tree.id);
    if (!rec || rec.key !== key) {
      cancel(rec && rec.job);
      const geoms = roots.map((r, i) => buildRootGeom(r, roots, num(tree.crownSeed, 1) + i * 131));
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      geoms.forEach((g) => {
        if (!g) return;
        for (let i = 0; i < g.n; i++) {
          const m = g.hw[i] + 14;
          x0 = Math.min(x0, g.cx[i] - m);
          x1 = Math.max(x1, g.cx[i] + m);
          y0 = Math.min(y0, g.cy[i] - m);
          y1 = Math.max(y1, g.cy[i] + m);
        }
        for (const h of g.hairs) {
          x0 = Math.min(x0, h.x1 - 3);
          x1 = Math.max(x1, h.x1 + 3);
          y1 = Math.max(y1, h.y1 + 3);
        }
      });
      rec = {
        key,
        roots,
        geoms,
        box: Number.isFinite(x0) ? { x0, y0, x1, y1 } : null,
        sprite: null, // { sp, stage, px }
        job: null,
        anim: null, // { t, to, items: [{ g, start, dur }] }
        stage: stageOf(tree),
        link: tree.linked ? 1 : 0,
        phase: (num(tree.crownSeed, 1) % 977) * 0.21,
      };
      rts.set(tree.id, rec);
    }
    return rec;
  }

  function makeRootJob(rec, stage) {
    const b = rec.box;
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    const sp = makeSprite(w, h, fitPx(px, w, h), -b.x0, -b.y0);
    const items = [];
    rec.roots.forEach((r, i) => {
      const g = rec.geoms[i];
      if (g && num(r.minStage, 0) <= stage) items.push(g);
    });
    items.sort((a, c) => a.w0 - c.w0);
    const steps = [];
    for (let i = 0; i < items.length; i += 3) {
      const chunk = items.slice(i, i + 3);
      steps.push(() => chunk.forEach((g) => drawRootGeom(sp.ctx, g, 1)));
    }
    if (!steps.length) steps.push(() => {});
    return { sp, stage, px, steps, ctxs: [sp.ctx], i: 0, done: false, cancelled: false };
  }

  const GLOW = { c: null };

  function drawRoots(ctx, state, t, dt) {
    const d = frameDt(t, dt);
    if (!ctx) return;
    const tt = Number.isFinite(t) ? t : lastT || 0;
    ctx.save();
    for (const tree of treesOf(state)) {
      guard(() => {
        if (!tree || !Number.isFinite(tree.x) || !Number.isFinite(tree.baseY)) return;
        const rec = rootRecord(tree);
        if (!rec.box) return;
        const stage = stageOf(tree);

        if (!rec.sprite) {
          const job = makeRootJob(rec, stage);
          runAll(job);
          rec.sprite = { sp: job.sp, stage, px };
          rec.stage = stage;
        }
        // a higher stage: the new roots grow in live while the sprite keeps the old ones
        if (stage > rec.sprite.stage) {
          const anim = rec.anim || { t: 0, to: stage, items: [] };
          const known = new Set(anim.items.map((it) => it.g));
          rec.roots.forEach((r, i) => {
            const g = rec.geoms[i];
            const ms = num(r.minStage, 0);
            if (g && ms > rec.sprite.stage && ms <= stage && !known.has(g)) {
              const dist0 = Math.hypot(g.x0 - tree.x, g.y0 - tree.baseY);
              anim.items.push({ g, start: anim.t + clamp(dist0 / 360, 0, 1) * 0.9, dur: 1.3 + 0.8 * clamp(g.total / 320, 0, 1) });
            }
          });
          anim.to = stage;
          rec.anim = anim;
        } else if (rec.anim && stage <= rec.sprite.stage) rec.anim = null;
        rec.stage = stage;

        let animDone = false;
        if (rec.anim) {
          rec.anim.t += d;
          animDone = rec.anim.items.every((it) => rec.anim.t >= it.start + it.dur);
        }
        // which stage should the cached sprite hold?
        const want = rec.anim ? (animDone ? rec.anim.to : rec.sprite.stage) : stage;
        if (rec.sprite.stage !== want || rec.sprite.px !== px) {
          let J = rec.job;
          if (!J || J.stage !== want || J.px !== px) {
            cancel(J);
            J = makeRootJob(rec, want);
            rec.job = J;
            queue.push(J);
          }
          if (J.done) {
            rec.sprite = { sp: J.sp, stage: want, px };
            rec.job = null;
            if (rec.anim && animDone) rec.anim = null;
          }
        } else if (rec.job) {
          cancel(rec.job);
          rec.job = null;
        }

        ctx.globalAlpha = 1;
        const sp = rec.sprite.sp;
        ctx.drawImage(sp.canvas, rec.box.x0, rec.box.y0, sp.w, sp.h);
        const heads = [];
        if (rec.anim) {
          for (const it of rec.anim.items) {
            const u = clamp((rec.anim.t - it.start) / it.dur, 0, 1);
            const head = drawRootGeom(ctx, it.g, 1 - Math.pow(1 - u, 2.2));
            if (head) heads.push(head);
          }
        }
        // tip glow of a linked tree and the heads of growing roots
        const target = tree.linked ? 1 : 0;
        rec.link += (target - rec.link) * (1 - Math.exp(-d * 2.5));
        if (Math.abs(target - rec.link) < 0.002) rec.link = target;
        if (rec.link > 0.01 || heads.length) {
          const g = GLOW.c || (GLOW.c = glowSprite('#ffe2a0', 64, 0.16));
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          if (rec.link > 0.01) {
            const tips = Array.isArray(tree.tips) ? tree.tips : [];
            for (let i = 0; i < tips.length; i++) {
              const tp = tips[i];
              if (!tp || !Number.isFinite(tp.x) || !Number.isFinite(tp.y)) continue;
              const ms = num(tp.minStage, 0);
              if (ms > stage) continue;
              let wgt = 1;
              if (rec.anim && !animDone && ms > rec.sprite.stage) wgt = smooth01((rec.anim.t - 1.6) / 1.2);
              if (wgt <= 0.01) continue;
              const ph = Math.sin(tt * 2.1 + rec.phase + i * 1.7) * 0.5 + 0.5;
              const sz = 30 + 14 * ph;
              ctx.globalAlpha = rec.link * wgt * (0.42 + 0.4 * ph);
              ctx.drawImage(g, tp.x - sz / 2, tp.y - sz / 2, sz, sz);
            }
          }
          for (const h of heads) {
            ctx.globalAlpha = 0.85;
            ctx.drawImage(g, h.x - 11, h.y - 11, 22, 22);
          }
          ctx.restore();
        }
      });
    }
    ctx.restore();
    pump(PUMP_MS, tt);
  }

  return { setScale, reset, event, drawRoots, drawTrees, bounds };
}

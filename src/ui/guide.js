// First-session guide: one handwritten note at a time with an ink arrow and a circle round the target.
// Which hint to show comes from guide-logic.js; this file is the drawing, placement and timing.
// The overlay never takes pointer events, except for the small "×" that hides the guide for good.
import { pickHint } from './guide-logic.js';
import { guideEnabled, setGuideEnabled, wormHintSeen, markWormHint } from './prefs.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = 12; // keep the note this far from the viewport edge
const ARROW_GAP = 80; // free space between the note and the ring (room for the arrow)
const FIRST_DELAY = 1.2; // s of play before the first hint
const STEP_GAP = 0.55; // s between two hints
const OUT_TIME = 0.35; // fade-out, matches the CSS transition
const RECHECK = 0.25; // s between hint recomputations
const WORM_HINT_TIME = 11; // s the arrow at the first worm stays

// ---- small deterministic helpers (the "hand" must wobble the same way on every redraw) -----------------

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f1 = (v) => v.toFixed(1);

const rectsOverlap = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const inflate = (r, k) => ({ l: r.l - k, t: r.t - k, r: r.r + k, b: r.b + k });

/** A hand-drawn loop around (cx, cy): slightly uneven, a little spiral, overshooting its own start. */
export function ringPath(cx, cy, rx, ry, seed) {
  const rand = rng(seed);
  const p1 = rand() * 6.28;
  const p2 = rand() * 6.28;
  const start = rand() * 6.28;
  const n = 64;
  const turns = 1.1;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + t * turns * Math.PI * 2;
    const k = 1 + 0.04 * Math.sin(a * 2 + p1) + 0.03 * Math.sin(a * 3 + p2) + 0.07 * t;
    d += `${i ? 'L' : 'M'}${f1(cx + Math.cos(a) * rx * k)} ${f1(cy + Math.sin(a) * ry * k)}`;
  }
  return d;
}

/** A wobbly curved shaft from a to b with a two-stroke arrowhead at b. */
export function arrowPath(a, b, seed) {
  const rand = rng(seed);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const bend = Math.min(40, Math.max(10, len * 0.2)) * (rand() < 0.5 ? -1 : 1);
  const ph1 = rand() * 6.28;
  const ph2 = rand() * 6.28;
  const steps = Math.max(8, Math.round(len / 12));
  let d = '';
  let px = b.x;
  let py = b.y;
  let qx = b.x;
  let qy = b.y;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const curve = Math.sin(Math.PI * t) * bend;
    const wob = Math.sin(Math.PI * t) * (1.1 * Math.sin(t * 11 + ph1) + 0.7 * Math.sin(t * 23 + ph2));
    const x = a.x + dx * t + nx * (curve + wob);
    const y = a.y + dy * t + ny * (curve + wob);
    d += `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`;
    qx = px;
    qy = py;
    px = x;
    py = y;
  }
  // arrowhead along the final direction of the shaft
  const tx = b.x - qx;
  const ty = b.y - qy;
  const tl = Math.hypot(tx, ty) || 1;
  const hx = tx / tl;
  const hy = ty / tl;
  const head = 17 + rand() * 3;
  for (const s of [1, -1]) {
    const ang = s * (0.5 + rand() * 0.1);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const wx = -(hx * ca - hy * sa);
    const wy = -(hx * sa + hy * ca);
    d += `M${f1(b.x)} ${f1(b.y)}L${f1(b.x + wx * head)} ${f1(b.y + wy * head)}`;
  }
  return d;
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Fills `el` with text where {key} becomes a <kbd>. */
function setRichText(el, text) {
  el.textContent = '';
  const parts = text.split(/\{([^}]+)\}/);
  parts.forEach((part, i) => {
    if (i % 2) {
      const kbd = document.createElement('kbd');
      kbd.textContent = part;
      el.appendChild(kbd);
    } else if (part) {
      el.appendChild(document.createTextNode(part));
    }
  });
}

/**
 * Where the note goes: the closest free spot around the target (screen px), clear of the HUD panels and
 * the ring, inside the viewport, and preferably not on top of map objects.
 * `nodes`: [{x, y, w, r}] screen points, w = penalty for covering one (within r).
 */
export function placeNote(view, size, tg, nodes, hud) {
  const W = view.cssW;
  const H = view.cssH;
  const w = size.w;
  const h = size.h;
  const fits = (r) => r.l >= MARGIN && r.t >= MARGIN && r.r <= W - MARGIN && r.b <= H - MARGIN;
  const rectAt = (x, y) => ({ l: x - w / 2, t: y - h / 2, r: x + w / 2, b: y + h / 2 });
  const covered = (r) => {
    let sum = 0;
    for (const n of nodes) {
      if (n.x > r.l - n.r && n.x < r.r + n.r && n.y > r.t - n.r && n.y < r.b + n.r) sum += n.w;
    }
    return sum;
  };
  if (!tg) {
    // no target: along the bottom edge between the tool tabs and the stamps, wherever it hides least
    let pick = null;
    for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const r = rectAt(W * fx, H - h / 2 - MARGIN - 28);
      const score = covered(r) + Math.abs(fx - 0.5) * 20 + (hud.some((o) => rectsOverlap(r, inflate(o, 8))) ? 1e6 : 0);
      if (!pick || score < pick.score) pick = { r, score };
    }
    return pick.r;
  }
  const avoid = inflate({ l: tg.cx - tg.rx, t: tg.cy - tg.ry, r: tg.cx + tg.rx, b: tg.cy + tg.ry }, ARROW_GAP);
  const hudPad = hud.map((r) => inflate(r, 10));
  let best = null;
  let fallback = null;
  const reach = Math.max(tg.rx, tg.ry);
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    for (let d = reach + 30; d <= 520; d += 12) {
      const r = rectAt(tg.cx + ux * d, tg.cy + uy * d);
      if (!fits(r) || rectsOverlap(r, avoid)) continue;
      let score = d;
      if (!fallback) fallback = { r, score };
      if (hudPad.some((o) => rectsOverlap(r, o))) continue;
      score += covered(r); // do not sit on top of the network or the map's landmarks
      if (!best || score < best.score) best = { r, score };
      break; // the first free distance on this ray is the closest one
    }
  }
  const pick = best || fallback;
  if (pick) return pick.r;
  // nothing fits (tiny window): clamp near the target
  const x = Math.min(W - MARGIN - w / 2, Math.max(MARGIN + w / 2, tg.cx));
  const y = Math.min(H - MARGIN - h / 2, Math.max(MARGIN + h / 2, tg.cy + reach + ARROW_GAP + h / 2));
  return rectAt(x, y);
}

/**
 * @param {HTMLElement} host    the .guide layer (full-viewport, pointer-events: none)
 * @param {() => Element[]} obstacles  HUD elements the note must not cover
 */
export function createGuide(host, obstacles) {
  host.innerHTML = `
    <svg class="guide-svg" width="100%" height="100%" aria-hidden="true">
      <g class="g-ring"><path class="halo" /><path class="ink" /></g>
      <g class="g-arrow"><path class="halo" /><path class="ink" /></g>
    </svg>
    <div class="guide-note scrap tape" role="note">
      <button class="g-x" type="button" title="Убрать подсказки (вернуть можно на странице паузы)" aria-label="Убрать подсказки">×</button>
      <div class="g-title"></div>
      <p class="g-text"></p>
    </div>`;
  const svg = host.querySelector('.guide-svg');
  const ringG = host.querySelector('.g-ring');
  const arrowG = host.querySelector('.g-arrow');
  const ringPaths = [...ringG.querySelectorAll('path')];
  const arrowPaths = [...arrowG.querySelectorAll('path')];
  const noteEl = host.querySelector('.guide-note');
  const titleEl = host.querySelector('.g-title');
  const textEl = host.querySelector('.g-text');
  for (const p of [...ringPaths, ...arrowPaths]) p.setAttribute('pathLength', '1');

  noteEl.querySelector('.g-x').addEventListener('click', (ev) => {
    ev.stopPropagation();
    setGuideEnabled(false);
  });

  let cur = null; // the state object the guide currently follows
  let view = null;
  let shown = null; // hint on screen
  let mode = 'idle'; // 'idle' | 'in' | 'out'
  let gap = FIRST_DELAY;
  let outT = 0;
  let elapsed = 0;
  let recheck = 0;
  let finished = false;
  let prevKey = null;
  let desired = null;
  let layoutKey = '';
  let layoutDirty = true;
  let noteRect = null;
  let dimmed = false;
  let doneAtStart = false;
  let doneHandled = false;
  let wormLive = false; // the first-worm arrow is on screen (it was marked seen when it appeared)
  let wormT = 0;

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => (layoutDirty = true)) : null;
  ro?.observe(noteEl);

  function hideDom() {
    host.classList.remove('on', 'dim', 'leaving');
    dimmed = false;
    noteEl.classList.remove('in', 'out');
    ringG.classList.remove('draw');
    arrowG.classList.remove('draw');
    layoutKey = '';
  }

  function resetState() {
    shown = null;
    desired = null;
    mode = 'idle';
    gap = FIRST_DELAY;
    elapsed = 0;
    recheck = 0;
    finished = false;
    prevKey = null;
    doneHandled = false;
    wormLive = false;
    wormT = 0;
    doneAtStart = Boolean(cur && cur.flags && cur.flags.allObjectivesDone);
    hideDom();
  }

  // ---- placement -----------------------------------------------------------------------------------

  function hudRects() {
    const out = [];
    for (const el of obstacles()) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    return out;
  }

  /** Screen position and size of the target ring, or null for a hint without a target. */
  function targetScreen(h) {
    if (!h.ring) return null;
    const s = view.scale;
    return { cx: h.ring.x * s + view.ox, cy: h.ring.y * s + view.oy, rx: h.ring.rx * s, ry: h.ring.ry * s };
  }


  function layout() {
    layoutDirty = false;
    if (!shown || !view) return;
    const size = { w: noteEl.offsetWidth, h: noteEl.offsetHeight };
    const tg = targetScreen(shown);
    // things the note should not hide: network nodes (a little) and landmarks of the map (more)
    const nodes = [];
    if (cur) {
      const s = view.scale;
      const at = (o, w, r = 0) => nodes.push({ x: o.x * s + view.ox, y: o.y * s + view.oy, w, r: r * s * 0.6 });
      for (const n of cur.net.nodes) if (n.alive) at(n, 3);
      for (const o of cur.world.water) at(o, 24, (o.rx + o.ry) / 2);
      for (const o of cur.world.minerals) at(o, 24, o.r);
    }
    const r = placeNote(view, size, tg, nodes, hudRects());
    noteRect = r;
    noteEl.style.left = `${Math.round(r.l)}px`;
    noteEl.style.top = `${Math.round(r.t)}px`;

    if (!tg) {
      host.classList.add('no-target');
      return;
    }
    host.classList.remove('no-target');
    const seed = hashSeed(shown.key || shown.id);
    const ncx = (r.l + r.r) / 2;
    const ncy = (r.t + r.b) / 2;
    let dx = tg.cx - ncx;
    let dy = tg.cy - ncy;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    // arrow tail: where the ray from the note centre leaves the note rectangle
    const hw = (r.r - r.l) / 2;
    const hh = (r.b - r.t) / 2;
    const tEdge = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
    const tail = { x: ncx + dx * (tEdge + 6), y: ncy + dy * (tEdge + 6) };
    // arrow tip: just outside the ring along the same ray (ellipse radius in that direction)
    const ex = -dx;
    const ey = -dy;
    const ringR = (tg.rx * tg.ry) / Math.sqrt((tg.ry * ex) ** 2 + (tg.rx * ey) ** 2);
    const tip = { x: tg.cx + ex * (ringR * 1.1 + 8), y: tg.cy + ey * (ringR * 1.1 + 8) };

    const ringD = ringPath(tg.cx, tg.cy, tg.rx * 1.08 + 3, tg.ry * 1.08 + 3, seed);
    const arrowD = arrowPath(tail, tip, seed ^ 0x9e3779b9);
    for (const p of ringPaths) p.setAttribute('d', ringD);
    for (const p of arrowPaths) p.setAttribute('d', arrowD);
    ringG.style.setProperty('--cx', `${f1(tg.cx)}px`);
    ringG.style.setProperty('--cy', `${f1(tg.cy)}px`);
    arrowG.style.setProperty('--bx', `${f1(dx * 5)}px`);
    arrowG.style.setProperty('--by', `${f1(dy * 5)}px`);
  }

  // ---- hint lifecycle ------------------------------------------------------------------------------

  function render() {
    titleEl.textContent = shown.title;
    setRichText(textEl, shown.text);
    layoutDirty = true;
  }

  function show(h) {
    shown = h;
    elapsed = 0;
    prevKey = h.key;
    render();
    layout();
    host.classList.add('on');
    // restart the draw-in animations
    for (const g of [ringG, arrowG]) {
      g.classList.remove('draw');
      void g.getBoundingClientRect();
      g.classList.add('draw');
    }
    noteEl.classList.remove('out');
    void noteEl.offsetWidth; // let the start state paint so the transition runs
    noteEl.classList.add('in');
    mode = 'in';
    if (h.id === 'worm') {
      wormLive = true;
      wormT = 0;
      markWormHint(); // once per player; the arrow stays until the worm leaves or the ring tool is taken
    }
  }

  function startOut() {
    mode = 'out';
    outT = OUT_TIME;
    noteEl.classList.remove('in');
    noteEl.classList.add('out');
    host.classList.add('leaving');
  }

  return {
    reset() {
      cur = null;
    },
    /**
     * @param {object} state  game state
     * @param {number} dt     real seconds
     * @param {{scale:number,ox:number,oy:number,cssW:number,cssH:number}} v  world -> CSS px
     * @param {boolean} active  false while a page (title, pause, help, summary) covers the scene
     */
    update(state, dt, v, active) {
      if (state !== cur) {
        cur = state;
        resetState();
      }
      if (v !== view) {
        view = v;
        layoutDirty = true;
        layoutKey = '';
      }
      const flags = state.flags || {};
      const allDone = Boolean(flags.allObjectivesDone);
      if (allDone && !doneAtStart && !doneHandled) {
        // the objectives were finished during this game: the guide's work is done for good
        doneHandled = true;
        setGuideEnabled(false);
      }
      const want = Boolean(active && view && view.scale > 0 && guideEnabled() && !allDone && !finished);

      if (mode === 'out') {
        outT -= dt;
        if (outT <= 0) {
          host.classList.remove('leaving');
          hideDom();
          shown = null;
          mode = 'idle';
          gap = STEP_GAP;
        }
        return;
      }

      recheck -= dt;
      if (recheck <= 0) {
        recheck = RECHECK;
        const extras = { wormHint: Boolean(state.flags && state.flags.threats) && (wormLive || !wormHintSeen()) };
        desired = want ? pickHint(state, prevKey, state.ui.tool, extras) : null;
      } else if (!want) {
        desired = null;
      }

      if (shown) {
        if (shown.id === 'worm') {
          wormT += dt;
          if (wormT > WORM_HINT_TIME || state.ui.tool === 'trap') desired = null; // done: the player took the ring tool
        }
        if (!desired || desired.id !== shown.id) {
          if (shown.id === 'worm') wormLive = false;
          startOut();
          return;
        }
        if (desired.key !== shown.key || desired.text !== shown.text || desired.title !== shown.title) {
          const keyChanged = desired.key !== shown.key;
          shown = desired;
          prevKey = shown.key;
          render();
          if (keyChanged) layoutKey = '';
        }
        if (shown.duration) {
          elapsed += dt;
          if (elapsed > shown.duration) {
            finished = true;
            startOut();
            return;
          }
        }
        // relayout when the window, the note size or the hint changed
        const key = `${shown.key}|${view.cssW}x${view.cssH}|${view.scale.toFixed(4)}|${view.ox.toFixed(1)}|${view.oy.toFixed(1)}`;
        if (layoutDirty || key !== layoutKey) {
          layoutKey = key;
          layout();
        }
        // step aside when the pointer is over the note
        const p = state.ui.pointer;
        // (the "×" corner stays solid so it can be clicked)
        const over =
          Boolean(p && p.inside !== false && noteRect) &&
          p.sx > noteRect.l - 14 && p.sx < noteRect.r + 14 && p.sy > noteRect.t - 14 && p.sy < noteRect.b + 14 &&
          !(p.sx > noteRect.r - 44 && p.sy < noteRect.t + 44);
        if (over !== dimmed) {
          dimmed = over;
          host.classList.toggle('dim', over);
        }
      } else if (desired && want) {
        gap -= dt;
        if (gap <= 0) show(desired);
      } else if (want) {
        gap = Math.max(gap - dt, 0);
      }
    },
  };
}

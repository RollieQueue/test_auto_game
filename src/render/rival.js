// The honey-fungus rival: an old stump, black-brown rhizomorphs («bootlaces») creeping through the soil with pale growing
// tips, dark rot stains where they grip a root zone, honey-mushroom tufts at infected trunks, chalk barrier rings and
// the short effects of its events. Read-only: everything comes from state (state.rival, state.barriers, world.stumps,
// ui.barrierPick) and from events; nothing is mutated. With none of those fields it draws nothing and throws nothing.
// Contract: docs/ARCHITECTURE.md §«Rival: honey fungus». Trees (infection, snag, mantle) are drawn by trees.js.
//
// Rhizomorph cache: the static edges (alive, grown in, not withering) are painted into one screen-sized canvas that is
// reset when the camera, canvas, world or rival object changes (cameraKey; rivalCacheKey adds rival.ver and is the
// stamp of the whole picture). Edges younger than GROW_TIME, tips and withering edges are drawn live over it; an edge is
// added to the cache when it has grown in and erased from it in place when it starts to wither or dies.
// API: createRival() -> { setScale, reset, event, drawSoil, drawSurface, drawFx, stats }
import { PAL, blobPoly, glowSprite, granulate, inkStroke, makeCanvas, makeSprite, mix, mulberry, noise1, raggedPoly, rgba, smooth01, stipple, tracePath, washEllipse } from './ink.js';
import { hash32 } from '../core/rng.js';
import { honeySprite, levelFor, stumpSprite } from './sprites.js';
import { STAGE_H } from './trees-model.js';
import { GROW_TIME, barrierLook, clamp, clusterLook, growFrac, hasRival, num, cameraKey, rivalParts, stumpsOf, witherAlpha, smoothEdges, curveAt, rootGoal, headingAlpha, tipPulse, tuftLayout, infectionLabel, ringStrength, isLost } from './rival-logic.js';
import { reducedMotion } from './motion.js';

const TAU = Math.PI * 2;
const MAX_FX = 320;
const WAX = '#c9443b'; // sealing wax, the same red as the other tools' «denied» marks
const CHALK = '#f6f0e0';
const LACE_BODY = '#0a0605'; // rhizomorph: near-black, glossy
const LACE_RIM = 'rgba(236,214,170,0.36)'; // a pale outline so the black cord reads on dark soil and in small sheets
const LACE_GLOSS = 'rgba(124,138,160,0.42)'; // the cool sheen of a wet cord
const LACE_SHINE = 'rgba(255,247,226,0.9)'; // the thin highlight along the light side
const BASE_W = 7; // world units: a step thicker than tree roots (1.5 – 4) and the player's hyphae (1.75 – 4.3)

const lerp = (a, b, k) => a + (b - a) * k;
const smoothUp = (u) => smooth01(u);

export function createRival() {
  let px = 1;
  let world = null;
  const shapes = new Map(); // edge id -> smoothEdges() curve + w
  const nodeIndex = { src: null, n: -1, map: new Map() };
  const cache = { canvas: null, key: '', baked: new Set(), world: null, rival: null, stamp: -1 };
  const curves = { rival: null, ver: -2, nodes: -1, edges: -1, stamp: 0 }; // the stamp of the smoothed shapes
  const sprites = new Map(); // key -> sprite (stain, honey tuft, stump, barrier ring)
  const fx = [];
  let seq = 1;
  const stats = { rebuilds: 0, bakes: 0, live: 0, baked: 0, withering: 0 };

  const sprite = (key, make) => {
    let s = sprites.get(key);
    if (!s) {
      s = make();
      sprites.set(key, s);
      if (sprites.size > 120) sprites.delete(sprites.keys().next().value);
    }
    return s;
  };

  /* ------------------------------------------------------------------ geometry of the web */

  function nodeOf(rival, id) {
    if (nodeIndex.src !== rival.nodes || nodeIndex.n !== rival.nodes.length) {
      nodeIndex.src = rival.nodes;
      nodeIndex.n = rival.nodes.length;
      nodeIndex.map.clear();
      for (const n of rival.nodes) if (n && n.id !== undefined) nodeIndex.map.set(n.id, n);
    }
    return nodeIndex.map.get(id) || null;
  }

  /**
   * The curve of one edge. The chains are Chaikin-smoothed (rival-logic smoothEdges: a node with two edges rounds its corner,
   * a fork joins the parent with the straightest child), so every shape depends on its neighbours and the whole set is made
   * again when rival.ver (nodes or edges added, an edge died) or the edge count changes. null for a dead edge or a missing node.
   */
  function shapeOf(rival, e) {
    const ver = Number.isFinite(rival.ver) ? rival.ver : -1;
    if (curves.rival !== rival || curves.ver !== ver || curves.nodes !== rival.nodes.length || curves.edges !== rival.edges.length) {
      shapes.clear();
      for (const [id, s] of smoothEdges(rival.nodes, rival.edges)) shapes.set(id, s);
      for (const q of rival.edges) {
        const s = q && shapes.get(q.id);
        if (s) s.w = clamp(BASE_W + 1.2 * (num(q.w, 1) - 1), BASE_W, 9);
      }
      Object.assign(curves, { rival, ver, nodes: rival.nodes.length, edges: rival.edges.length, stamp: curves.stamp + 1 });
    }
    return shapes.get(e.id) || null;
  }

  const bez = curveAt;

  /** Add the part 0..f of an edge to a Path2D. */
  function addEdge(path, s, f = 1) {
    path.moveTo(s.x0, s.y0);
    if (f >= 0.999) {
      path.quadraticCurveTo(s.c1x, s.c1y, s.mx, s.my);
      path.quadraticCurveTo(s.c2x, s.c2y, s.x1, s.y1);
      return;
    }
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const p = bez(s, (f * i) / steps);
      path.lineTo(p.x, p.y);
    }
  }

  /** The layers of a glossy near-black cord along a path: pale outline, black body, cool sheen, a thin highlight on the light side. */
  function strokeLace(g, path, w, alpha = 1, butt = false) {
    g.save();
    g.lineJoin = 'round';
    g.globalAlpha *= alpha;
    g.lineCap = butt ? 'butt' : 'round';
    g.strokeStyle = LACE_RIM;
    g.lineWidth = w + 2.8;
    g.stroke(path);
    g.lineCap = 'round';
    g.strokeStyle = LACE_BODY;
    g.lineWidth = w;
    g.stroke(path);
    g.strokeStyle = LACE_GLOSS;
    g.lineWidth = w * 0.34;
    g.translate(-w * 0.1, -w * 0.14);
    g.stroke(path);
    g.strokeStyle = LACE_SHINE;
    g.lineWidth = Math.max(0.7, w * 0.12);
    g.translate(-w * 0.12, -w * 0.12);
    g.stroke(path);
    g.restore();
  }

  /** Several width classes of cords, one layer at a time across all of them, so an outline never lies over a neighbour's body. */
  function strokeLaces(g, map, butt = false) {
    if (!map.size) return;
    g.save();
    g.lineJoin = 'round';
    const layer = (style, widthOf, dx, dy, cap) => {
      g.strokeStyle = style;
      g.lineCap = cap;
      for (const [w, p] of map) {
        g.save();
        g.translate(dx * w, dy * w);
        g.lineWidth = widthOf(w);
        g.stroke(p);
        g.restore();
      }
    };
    layer(LACE_RIM, (w) => w + 2.8, 0, 0, butt ? 'butt' : 'round');
    layer(LACE_BODY, (w) => w, 0, 0, 'round');
    layer(LACE_GLOSS, (w) => w * 0.34, -0.1, -0.14, 'round');
    layer(LACE_SHINE, (w) => Math.max(0.7, w * 0.12), -0.22, -0.26, 'round');
    g.restore();
  }

  /* ------------------------------------------------------------------ the web: cache + live parts */

  const bucketPath = (map, s, f = 1) => {
    const k = Math.round(s.w);
    let p = map.get(k);
    if (!p) map.set(k, (p = new Path2D()));
    addEdge(p, s, f);
  };

  /**
   * The mature edges (alive, grown in, not withering) live in a screen-sized canvas. It is cleared and painted again, layer by
   * layer, whenever the camera, the canvas, the world or the rival object changes, an edge matures, starts to wither or dies,
   * or a node is added (the curves are smoothed along chains: rivalCacheKey stamps all that). Between those events a frame
   * costs one blit; growing edges, withering edges, tips and the heading are drawn live over it.
   */
  function drawWeb(ctx, state, rival, t) {
    const parts = rivalParts(state);
    if (!parts.edges.length && !parts.tips.length) return;
    const m = ctx.getTransform();
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const key = cameraKey({ scale: m.a, ox: m.e, oy: m.f }, W, H);
    if (!cache.canvas || cache.canvas.width !== W || cache.canvas.height !== H) {
      cache.canvas = makeCanvas(W, H);
      cache.key = '';
    }
    const g = cache.canvas.getContext('2d');
    const mature = [];
    const live = new Map(); // growing in now
    const wither = [];
    let nLive = 0;
    for (const e of parts.edges) {
      if (!e || !e.alive) continue;
      if (num(e.wither) > 0) {
        wither.push(e);
        continue;
      }
      const sh = shapeOf(rival, e);
      if (!sh) continue;
      const f = growFrac(state.time, e.born);
      if (f >= 1) mature.push([e, sh]);
      else {
        bucketPath(live, sh, smooth01(f));
        nLive++;
      }
    }
    let dirty = false;
    if (cache.key !== key || cache.rival !== rival || cache.world !== state.world) {
      cache.key = key;
      cache.rival = rival;
      cache.world = state.world;
      dirty = true;
    }
    if (cache.stamp !== curves.stamp || cache.baked.size !== mature.length || mature.some(([e]) => !cache.baked.has(e.id))) dirty = true;
    if (dirty) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, W, H);
      g.setTransform(m.a, 0, 0, m.d, m.e, m.f);
      const all = new Map();
      cache.baked.clear();
      for (const [e, sh] of mature) {
        bucketPath(all, sh);
        cache.baked.add(e.id);
      }
      strokeLaces(g, all);
      cache.stamp = curves.stamp;
      stats.rebuilds++;
    }
    stats.baked = cache.baked.size;
    stats.live = nLive;
    stats.withering = wither.length;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cache.canvas, 0, 0);
    ctx.setTransform(m);
    strokeLaces(ctx, live, true);
    if (wither.length) drawWithering(ctx, rival, wither, t);
    drawTips(ctx, state, rival, parts.tips, t);
    ctx.restore();
  }

  /** Withering edges: the black cord turns grey, breaks into dashes and crumbles away as `wither` rises. */
  function drawWithering(ctx, rival, list, t) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const e of list) {
      const s = shapeOf(rival, e);
      if (!s) continue;
      const wv = clamp(num(e.wither), 0, 1);
      const a = witherAlpha(wv);
      if (a <= 0.01) continue;
      const path = new Path2D();
      addEdge(path, s);
      ctx.setLineDash([Math.max(1.2, 5 - 3.5 * wv), 1.5 + 9 * wv]);
      ctx.lineDashOffset = -hash32(e.id, 5) % 20;
      ctx.lineWidth = s.w * (1 - 0.45 * wv);
      ctx.strokeStyle = rgba(mix(LACE_BODY, '#8d7d68', wv), a);
      ctx.stroke(path);
      ctx.setLineDash([]);
      // crumbs falling off
      const rr = mulberry(hash32(e.id, 11));
      const n = 3 + Math.round(s.len / 8);
      for (let i = 0; i < n; i++) {
        const p = bez(s, rr());
        const fall = wv * (4 + 12 * rr()) + Math.sin(t * 2 + i) * 0.3;
        const r = (0.5 + rr() * 1.1) * (1 - 0.4 * wv);
        ctx.fillStyle = rgba(i % 3 ? '#2a1a10' : '#7b6a56', a * (0.5 + 0.4 * rr()));
        ctx.beginPath();
        ctx.arc(p.x + (rr() - 0.5) * 5 * wv, p.y + fall, r, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** The sealing-wax «!» at the end of a heading path (the same hand as the worm's warning in fauna.js, a little smaller). */
  function paintBang(ctx, x, y, pulse) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 + 0.06 * pulse, 1 + 0.06 * pulse);
    ctx.fillStyle = 'rgba(20,10,4,0.4)';
    ctx.beginPath();
    ctx.arc(0, -1.5, 9.5, 0, TAU);
    ctx.fill();
    const bar = new Path2D();
    bar.moveTo(-2.6, -9);
    bar.quadraticCurveTo(0, -10.2, 2.6, -9);
    bar.lineTo(1.1, 1.5);
    bar.lineTo(-1.1, 1.5);
    bar.closePath();
    const dot = new Path2D();
    dot.ellipse(0, 5, 1.8, 1.7, 0, 0, TAU);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = CHALK;
    ctx.stroke(bar);
    ctx.stroke(dot);
    ctx.fillStyle = '#b3342a';
    ctx.fill(bar);
    ctx.fill(dot);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = PAL.sepia;
    ctx.stroke(bar);
    ctx.stroke(dot);
    ctx.restore();
  }

  /**
   * Where a tip is heading, once it is within HEAD_NEAR of the root point it wants: a dashed sealing-wax path with a dashed ring
   * and a «!» on the root, like the worm's warning. The goal comes from rival-logic rootGoal (the sim's own choice).
   */
  function drawHeading(ctx, state, rival, tip, t, startR) {
    const list = state.world && state.world.trees;
    if (!tip.target || !Array.isArray(list)) return;
    const tree = list.find((q) => q && q.id === tip.target.id);
    const goal = rootGoal(tip, tree, { grips: rival.grip, claimed: state.sim && state.sim.tipClaimed });
    if (!goal) return;
    const a = headingAlpha(goal.d);
    if (a <= 0.01 || goal.d < 9) return;
    const ux = (goal.x - tip.x) / goal.d;
    const uy = (goal.y - tip.y) / goal.d;
    const sx = tip.x + ux * (startR + 3);
    const sy = tip.y + uy * (startR + 3);
    const ex = goal.x - ux * 7;
    const ey = goal.y - uy * 7;
    const still = reducedMotion();
    const sag = goal.d * 0.06 * Math.sin(num(tip.id) * 1.9) + (still ? 0 : 1.4 * Math.sin(t * 2.1 + num(tip.id)));
    const cx = (sx + ex) / 2 - uy * sag;
    const cy = (sy + ey) / 2 + ux * sag;
    const pulse = still ? 0 : Math.sin(t * 3 + num(tip.id));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineCap = 'round';
    ctx.setLineDash([5.5, 4.5]);
    ctx.lineDashOffset = -t * 9;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.lineWidth = 4.2;
    ctx.strokeStyle = 'rgba(14,8,4,0.45)';
    ctx.stroke();
    ctx.lineWidth = 2.3;
    ctx.strokeStyle = WAX;
    ctx.stroke();
    ctx.setLineDash([2.5, 3]);
    ctx.lineDashOffset = t * 6;
    ctx.beginPath();
    ctx.arc(goal.x, goal.y, 8 + 0.8 * pulse, 0, TAU);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.setLineDash([]);
    paintBang(ctx, goal.x, goal.y - 17, pulse);
    ctx.restore();
  }

  /**
   * Growing tips: the cord runs from the last node to the head and ends in a dark, glossy bulb that swells and shrinks slowly
   * (still when motion is reduced) with a faint pale ring spreading from it. Nothing glows, so it is never mistaken for the
   * player's threads.
   */
  function drawTips(ctx, state, rival, tips, t) {
    if (!tips.length) return;
    const reduced = reducedMotion();
    ctx.save();
    ctx.lineCap = 'round';
    for (const tip of tips) {
      if (!tip || !Number.isFinite(tip.x) || !Number.isFinite(tip.y)) continue;
      const n = nodeOf(rival, tip.node);
      const hx = tip.x;
      const hy = tip.y;
      if (n && Number.isFinite(n.x + n.y) && Math.hypot(hx - n.x, hy - n.y) > 0.5) {
        const p = new Path2D();
        p.moveTo(n.x, n.y);
        p.lineTo(hx, hy);
        strokeLace(ctx, p, BASE_W, 1, true);
      }
      const pulse = tipPulse(t, tip.id, reduced);
      const r = BASE_W * (0.74 + 0.2 * pulse);
      // a pale ring spreading from the bulb, so the head can be found at a glance in a small picture
      const ph = reduced ? 0.45 : (t * 0.3 + num(tip.id) * 0.37) % 1;
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = rgba('#eed6aa', (reduced ? 0.3 : 0.42) * (1 - ph));
      ctx.beginPath();
      ctx.arc(hx, hy, r + 2 + ph * 9, 0, TAU);
      ctx.stroke();
      // the bulb: outline, ink, sheen, highlight
      ctx.fillStyle = LACE_RIM;
      ctx.beginPath();
      ctx.arc(hx, hy, r + 1.7, 0, TAU);
      ctx.fill();
      ctx.fillStyle = LACE_BODY;
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = LACE_GLOSS;
      ctx.beginPath();
      ctx.ellipse(hx - r * 0.28, hy - r * 0.32, r * 0.42, r * 0.3, -0.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = LACE_SHINE;
      ctx.beginPath();
      ctx.arc(hx - r * 0.38, hy - r * 0.42, Math.max(0.7, r * 0.15), 0, TAU);
      ctx.fill();
      drawHeading(ctx, state, rival, tip, t, r);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ rot stains at grips */

  function stainSprite(variant) {
    return sprite(`stain|${variant}|${px.toFixed(2)}`, () => {
      const R = 34;
      const sp = makeSprite(R * 2 + 12, R * 2 + 12, px, R + 6, R + 6);
      const g = sp.ctx;
      const seed = 400 + variant * 13;
      // umber blotch with a ragged watercolour edge: a pale tide ring, the body, a darker heart
      washEllipse(g, 0, 0, R * 1.0, R * 0.8, { color: '#a07a3e', alpha: 0.3, layers: 2, ragged: 5.5, edge: 0.8, rimColor: '#c9a35e', edgeW: 1.2, seed, rot: variant * 0.6 });
      washEllipse(g, 0, 0, R * 0.78, R * 0.62, { color: '#2e1a0b', alpha: 0.82, layers: 3, ragged: 4.5, edge: 0.9, rimColor: '#0c0603', edgeW: 1.4, seed: seed + 5, rot: variant * 0.6 });
      washEllipse(g, R * 0.05, 0, R * 0.42, R * 0.32, { color: '#0d0704', alpha: 0.8, layers: 2, ragged: 3, edge: 0.5, seed: seed + 9, rot: variant * 0.6 });
      const poly = blobPoly(0, 0, R * 0.8, R * 0.62, seed + 5, { n: 14, jitter: 0.1, rot: variant * 0.6 });
      stipple(g, poly, { count: 70, color: '#080402', alpha: 0.6, seed: seed + 2, rMin: 0.3, rMax: 1 });
      stipple(g, blobPoly(0, 0, R * 1.05, R * 0.85, seed, { n: 12 }), { count: 26, color: '#9b7a45', alpha: 0.35, seed: seed + 3, rMin: 0.3, rMax: 0.8 });
      granulate(g, sp.cw, sp.ch, 0.16, 0.4);
      return sp;
    });
  }

  function drawGrips(ctx, state, t, grips) {
    if (!grips.length) return;
    ctx.save();
    for (const gp of grips) {
      if (!gp || !Number.isFinite(gp.x) || !Number.isFinite(gp.y)) continue;
      const age = Math.max(0, num(state.time) - num(gp.since, num(state.time)));
      const grow = 0.35 + 0.65 * smooth01(age / 8);
      const ph = hash32(num(gp.treeId), 3) % 628 / 100;
      const pulse = 1 + 0.045 * Math.sin(t * 0.8 + ph) + 0.02 * Math.sin(t * 1.9 + ph * 2);
      const sp = stainSprite(hash32(num(gp.treeId), 7) % 3);
      const k = grow * pulse;
      ctx.globalAlpha = (0.78 + 0.18 * Math.sin(t * 0.8 + ph + 1)) * Math.min(1, 0.25 + age / 2);
      ctx.drawImage(sp.canvas, gp.x - sp.ax * k, gp.y - sp.ay * k, sp.w * k, sp.h * k);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ stump */

  /** An old cut stump in ink and wash: weathered bark, mossy foot, ringed top and roots splaying into the soil. */
  function paintStump(g, r, seed) {
    const rng = mulberry(seed);
    const hw = clamp(r, 14, 60) * 1.05;
    const H = hw * 1.25;
    const ry = hw * 0.32;
    // roots splaying out and down into the soil, drawn first so the trunk stands over them
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      const a0 = (0.12 + 0.2 * rng()) * (1 + Math.floor(i / 2) * 0.55);
      const x0 = side * hw * (0.55 + 0.3 * rng());
      const reach = hw * (0.9 + 0.8 * rng());
      const pts = [
        { x: x0, y: -hw * 0.05 },
        { x: x0 + side * reach * 0.35, y: hw * (0.1 + a0 * 0.3) },
        { x: x0 + side * reach * 0.7, y: hw * (0.3 + a0 * 0.8) },
        { x: x0 + side * reach, y: hw * (0.55 + a0 * 1.4) },
      ];
      inkStroke(g, pts, { w: hw * 0.28, color: '#2a1a10', alpha: 0.95, taperStart: 0.02, taperEnd: 0.9, seed: seed + i * 7, tremor: 0.4 });
      inkStroke(g, pts.map((p) => ({ x: p.x - side * 0.5, y: p.y - 0.6 })), { w: hw * 0.1, color: '#9a7b52', alpha: 0.55, taperStart: 0.1, taperEnd: 0.8, seed: seed + i * 7 + 3, tremor: 0.2 });
    }
    // soft shadow on the ground
    washEllipse(g, 0, 1, hw * 1.5, hw * 0.28, { color: '#120a06', alpha: 0.4, layers: 2, ragged: 3, edge: 0, seed: seed + 2 });
    // the trunk: a slightly flared, uneven column
    const body = [
      { x: -hw * 1.14, y: 1 },
      { x: -hw * 1.03, y: -H * 0.35 },
      { x: -hw * 0.99, y: -H * 0.8 },
      { x: -hw, y: -H },
      { x: hw, y: -H * 0.94 },
      { x: hw * 0.99, y: -H * 0.7 },
      { x: hw * 1.05, y: -H * 0.3 },
      { x: hw * 1.14, y: 1 },
      { x: hw * 0.5, y: ry * 0.8 },
      { x: -hw * 0.5, y: ry * 0.8 },
    ];
    const edge = raggedPoly(body, 1.4, seed + 4);
    const grad = g.createLinearGradient(-hw, 0, hw, 0);
    grad.addColorStop(0, '#7a5c3d');
    grad.addColorStop(0.45, '#5b4330');
    grad.addColorStop(1, '#2f2118');
    g.beginPath();
    tracePath(g, edge, true, true);
    g.fillStyle = grad;
    g.fill();
    g.save();
    g.beginPath();
    tracePath(g, edge, true, true);
    g.clip();
    // bark furrows
    for (let i = 0; i < 16; i++) {
      const x = lerp(-hw * 1.05, hw * 1.05, (i + rng() * 0.8) / 16);
      const y0 = -H * (0.15 + 0.8 * rng());
      const pts = [];
      const len = H * (0.25 + 0.45 * rng());
      for (let k = 0; k <= 4; k++) pts.push({ x: x + 1.6 * noise1(i * 3.1 + k * 0.9 + seed), y: y0 + (len * k) / 4 });
      inkStroke(g, pts, { w: 0.6 + rng() * 1.1, color: '#1d130c', alpha: 0.35 + 0.5 * rng(), taperStart: 0.3, taperEnd: 0.45, seed: seed + 50 + i, tremor: 0.25, step: 3 });
    }
    // moss at the foot and up the shaded-from-the-sun left side
    for (let i = 0; i < 7; i++) {
      const x = lerp(-hw * 1.1, hw * 0.9, rng());
      const y = -H * Math.pow(rng(), 1.8) * 0.8;
      washEllipse(g, x, y, hw * (0.2 + 0.25 * rng()), hw * (0.12 + 0.18 * rng()), { color: i % 2 ? '#5f7a30' : '#7a9440', alpha: 0.55, layers: 2, ragged: 2.5, edge: 0.4, seed: seed + 80 + i });
    }
    stipple(g, body, { count: 60, color: '#a9c25e', alpha: 0.55, seed: seed + 9, rMin: 0.3, rMax: 0.9, density: (x, y) => (y > -H * 0.45 || x < -hw * 0.5 ? 1 : 0.15) });
    g.restore();
    g.lineJoin = 'round';
    inkStroke(g, edge.concat(edge.slice(0, 2)), { w: 1.5, color: PAL.sepia, alpha: 0.9, taperStart: 0.03, taperEnd: 0.12, seed: seed + 12, tremor: 0.3, smooth: false });
    // the cut top: pale weathered wood with growth rings and a few checks
    g.beginPath();
    g.ellipse(0, -H + ry * 0.1, hw, ry, 0.03, 0, TAU);
    g.fillStyle = '#c9b184';
    g.fill();
    washEllipse(g, hw * 0.1, -H, hw * 0.7, ry * 0.7, { color: '#6b5232', alpha: 0.28, layers: 2, ragged: 2, edge: 0, seed: seed + 15 });
    for (let k = 1; k <= 6; k++) {
      const f = k / 6.6;
      g.beginPath();
      g.ellipse(hw * 0.05 * (1 - f), -H + ry * 0.1, hw * f, ry * f, 0.03, 0, TAU);
      g.strokeStyle = rgba('#6b5232', 0.35 + 0.35 * (k % 2));
      g.lineWidth = 0.6;
      g.stroke();
    }
    for (let i = 0; i < 3; i++) {
      const a = rng() * TAU;
      inkStroke(g, [{ x: Math.cos(a) * hw * 0.12, y: -H + ry * 0.1 + Math.sin(a) * ry * 0.12 }, { x: Math.cos(a) * hw * 0.95, y: -H + ry * 0.1 + Math.sin(a) * ry * 0.95 }], { w: 0.8, color: '#3a2a1e', alpha: 0.7, taperStart: 0.05, taperEnd: 0.5, seed: seed + 20 + i, tremor: 0.2 });
    }
    g.beginPath();
    g.ellipse(0, -H + ry * 0.1, hw, ry, 0.03, 0, TAU);
    g.lineWidth = 1.3;
    g.strokeStyle = rgba(PAL.sepia, 0.9);
    g.stroke();
    // a mossy lip on the near rim
    washEllipse(g, -hw * 0.55, -H + ry * 0.7, hw * 0.3, ry * 0.3, { color: '#6c8a38', alpha: 0.6, layers: 2, ragged: 1.5, edge: 0.3, seed: seed + 30 });
    return hw;
  }

  function stumpInk(stump) {
    const r = clamp(num(stump.r, 28), 14, 60);
    const key = `stump|${Math.round(r)}|${num(stump.id)}|${px.toFixed(2)}`;
    return sprite(key, () => {
      const hw = clamp(r, 14, 60) * 1.05;
      const sp = makeSprite(hw * 5.2, hw * 3.6, px, hw * 2.6, hw * 2.1);
      paintStump(sp.ctx, r, 900 + num(stump.id) * 31);
      granulate(sp.ctx, sp.cw, sp.ch, 0.12, 0.45);
      return sp;
    });
  }

  function drawStump(ctx, stump) {
    const art = stumpSprite(num(stump.id));
    if (art) {
      const k = (art.worldSize * clamp(num(stump.r, 28) / 30, 0.7, 1.5)) / art.h;
      const lv = levelFor(art, art.h * k * px);
      ctx.save();
      ctx.translate(stump.x, stump.y);
      // a soft dark seat so the old stump sits on the ground
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#120a06';
      ctx.beginPath();
      ctx.ellipse(0, 1, art.w * k * 0.42, art.h * k * 0.07, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (hash32(num(stump.id), 2) & 1) ctx.scale(-1, 1);
      ctx.drawImage(lv.src, -art.anchor.x * k, -art.anchor.y * k, art.w * k, art.h * k);
      ctx.restore();
      return;
    }
    const sp = stumpInk(stump);
    ctx.drawImage(sp.canvas, stump.x - sp.ax, stump.y - sp.ay, sp.w, sp.h);
  }

  /* ------------------------------------------------------------------ honey-mushroom tufts */

  function paintHoney(g, n, seed) {
    const rng = mulberry(seed);
    const caps = [];
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2;
      caps.push({ x: u * (6 + n * 2.6) + (rng() - 0.5) * 4, h: 15 + 10 * rng() + (1 - Math.abs(u)) * 7, r: 6 + 4 * rng() + (1 - Math.abs(u)) * 2.2, lean: u * 0.22 + (rng() - 0.5) * 0.2, y: -(1 - Math.abs(u)) * 2.5 + rng() * 2 });
    }
    caps.sort((a, b) => b.h - a.h); // taller (back) ones first
    for (const c of caps) {
      const bx = c.x;
      const by = c.y;
      const tx = bx + Math.sin(c.lean) * c.h;
      const ty = by - Math.cos(c.lean) * c.h;
      // stipe: ochre, darker at the foot, with a ring (annulus)
      g.lineCap = 'round';
      g.strokeStyle = '#6f5334';
      g.lineWidth = 3.6;
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(tx, ty + 1);
      g.stroke();
      g.strokeStyle = '#d8c18b';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(bx + 0.3, by - 3);
      g.lineTo(tx, ty + 1);
      g.stroke();
      const rx = lerp(bx, tx, 0.62);
      const ryy = lerp(by, ty, 0.62);
      g.fillStyle = 'rgba(246,236,206,0.95)';
      g.strokeStyle = rgba(PAL.sepia, 0.8);
      g.lineWidth = 0.6;
      g.beginPath();
      g.ellipse(rx, ryy, 2.9, 1.2, c.lean, 0, TAU);
      g.fill();
      g.stroke();
      // cap: a honey-brown dome with a paler margin and dark scales around the crown
      g.save();
      g.translate(tx, ty);
      g.rotate(c.lean * 0.7);
      const cg = g.createRadialGradient(0, -c.r * 0.35, 0, 0, -c.r * 0.2, c.r * 1.2);
      cg.addColorStop(0, '#d9a85a');
      cg.addColorStop(0.55, '#b98438');
      cg.addColorStop(1, '#8a5e28');
      g.beginPath();
      g.moveTo(-c.r, 1);
      g.bezierCurveTo(-c.r * 1.05, -c.r * 1.1, c.r * 1.05, -c.r * 1.1, c.r, 1);
      g.quadraticCurveTo(0, c.r * 0.35, -c.r, 1);
      g.fillStyle = cg;
      g.fill();
      g.lineWidth = 0.9;
      g.strokeStyle = rgba(PAL.sepia, 0.9);
      g.stroke();
      g.strokeStyle = 'rgba(236,214,160,0.7)';
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(-c.r * 0.92, 0.2);
      g.quadraticCurveTo(0, c.r * 0.3, c.r * 0.92, 0.2);
      g.stroke();
      g.fillStyle = 'rgba(74,46,22,0.75)';
      for (let k = 0; k < 7; k++) {
        const a = rng() * Math.PI;
        const rd = rng() * c.r * 0.6;
        g.beginPath();
        g.ellipse(Math.cos(a) * rd * (rng() < 0.5 ? -1 : 1) * 0.9, -c.r * 0.35 - Math.sin(a) * rd * 0.55, 0.9, 0.6, 0, 0, TAU);
        g.fill();
      }
      g.restore();
    }
  }

  function honeyInk(n, variant) {
    return sprite(`honey|${n}|${variant}|${px.toFixed(2)}`, () => {
      const sp = makeSprite(70, 52, px, 35, 46);
      paintHoney(sp.ctx, n, 6100 + n * 17 + variant * 131);
      granulate(sp.ctx, sp.cw, sp.ch, 0.1, 0.5);
      return sp;
    });
  }

  /**
   * Honey-mushroom tufts spread around the trunk foot (rival-logic tuftLayout: a flat band, a smaller back row, no column).
   * The illustrated sprite is already a small clump, so two or three of them stand about the trunk; the ink fallback paints
   * one cap per mushroom.
   */
  function drawClusters(ctx, state, clusters) {
    for (const c of clusters) {
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
      const look = clusterLook(c);
      const k = 0.3 + 0.7 * look.grow;
      const art = honeySprite(num(c.id));
      const tree = treeOf(state, c.treeId);
      // the cluster sits where the sim put it, pulled towards the trunk so the tufts stand around the foot
      const cx = tree && Number.isFinite(tree.x) ? tree.x + (c.x - tree.x) * 0.3 : c.x;
      ctx.save();
      ctx.globalAlpha = Math.min(1, 0.2 + look.grow * 1.2);
      ctx.translate(cx, c.y);
      if (art) {
        const clumps = clamp(Math.ceil(look.n / 2.4), 2, 3);
        const layout = tuftLayout(c, hash32, clumps, 15 + clumps * 8.5);
        const base = (art.worldSize / art.h) * k * 0.82;
        for (let i = 0; i < layout.length; i++) {
          const cap = layout[i];
          const a2 = honeySprite(num(c.id) + i * 5 + 1) || art;
          const s = base * cap.scale;
          const lv = levelFor(a2, a2.h * s * px);
          ctx.save();
          ctx.translate(cap.dx * k, cap.dy * k);
          ctx.rotate(cap.lean * 0.5);
          if (cap.flip) ctx.scale(-1, 1);
          ctx.drawImage(lv.src, -a2.anchor.x * s, -a2.anchor.y * s, a2.w * s, a2.h * s);
          ctx.restore();
        }
      } else {
        const layout = tuftLayout(c, hash32, look.n, 12 + look.n * 4.5);
        const sp = honeyInk(1, hash32(num(c.id), 9) % 3);
        for (const cap of layout) {
          ctx.save();
          ctx.translate(cap.dx * k, cap.dy * k);
          ctx.scale(k * cap.scale * (cap.flip ? -1 : 1), k * cap.scale);
          ctx.drawImage(sp.canvas, -sp.ax, -sp.ay, sp.w, sp.h);
          ctx.restore();
        }
      }
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------ rot ring at a gripped trunk foot */

  /**
   * While a rhizomorph holds a root of a tree: a dark rot stain and a dashed rust ring round the trunk foot, and a small
   * «40 %» ink mark of how far the infection has come. The root-level stain (drawGrips) shows where; this shows who.
   */
  function drawRotRings(ctx, state, t) {
    const grips = rivalParts(state).grip;
    if (!grips.length) return;
    const trees = state.world && state.world.trees;
    if (!Array.isArray(trees)) return;
    const still = reducedMotion();
    const seen = new Set();
    for (const gp of grips) {
      if (!gp || seen.has(gp.treeId)) continue;
      seen.add(gp.treeId);
      const tree = trees.find((q) => q && q.id === gp.treeId);
      if (!tree || isLost(tree) || !Number.isFinite(tree.x) || !Number.isFinite(tree.baseY)) continue;
      const inf = clamp(num(tree.infection), 0, 1);
      const age = Math.max(0, num(state.time) - num(gp.since, num(state.time)));
      const k = ringStrength(age, inf);
      const stage = clamp(Math.round(num(tree.stage, 2)), 0, 3);
      const rx = 17 + 7 * stage + (still ? 0 : 0.8 * Math.sin(t * 0.9 + num(tree.id)));
      const ry = rx * 0.3;
      ctx.save();
      ctx.translate(tree.x, tree.baseY + 3);
      ctx.globalAlpha = 0.5 * k;
      ctx.fillStyle = 'rgba(36,18,7,0.7)';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 1.12, ry * 1.2, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.9 * k;
      ctx.lineCap = 'round';
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = still ? 0 : -t * 2.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
      ctx.lineWidth = 4.4;
      ctx.strokeStyle = 'rgba(236,214,170,0.4)';
      ctx.stroke();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = '#5a2c10';
      ctx.stroke();
      ctx.setLineDash([]);
      if (inf >= 0.04) {
        ctx.globalAlpha = Math.min(1, k * 1.2);
        ctx.font = 'italic 600 13px "Palatino Linotype", Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3.4;
        ctx.strokeStyle = 'rgba(246,238,216,0.92)';
        const label = infectionLabel(inf);
        ctx.strokeText(label, 0, ry + 13);
        ctx.fillStyle = '#5a2c10';
        ctx.fillText(label, 0, ry + 13);
      }
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------ barriers */

  /** A chalk ring: fine radial hatching in a band, two uneven chalk lines and a soft white wash inside. */
  function ringSprite(r, ok = true) {
    const rr = Math.max(8, Math.round(r / 2) * 2);
    return sprite(`ring|${rr}|${ok ? 1 : 0}|${px.toFixed(2)}`, () => {
      const pad = 16;
      const sp = makeSprite(rr * 2 + pad * 2, rr * 2 + pad * 2, px, rr + pad, rr + pad);
      const g = sp.ctx;
      const col = ok ? CHALK : '#f0b4a8';
      const rng = mulberry(5150 + rr);
      // the soft white wash
      const wg = g.createRadialGradient(0, 0, rr * 0.2, 0, 0, rr * 1.04);
      wg.addColorStop(0, rgba(col, 0.04));
      wg.addColorStop(0.75, rgba(col, 0.16));
      wg.addColorStop(1, rgba(col, 0.26));
      g.fillStyle = wg;
      g.beginPath();
      g.arc(0, 0, rr * 1.04, 0, TAU);
      g.fill();
      // hatching band, slightly slanted so it reads as a pen/chalk tone
      const count = Math.round(rr * 1.9);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU + (rng() - 0.5) * 0.04;
        const r0 = rr - 3.5 - rng() * 3.2;
        const r1 = rr + 0.6 + rng() * 2.4;
        const sl = 0.2;
        g.strokeStyle = rgba(col, 0.5 + 0.4 * rng());
        g.lineWidth = 0.6 + rng() * 0.5;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        g.lineTo(Math.cos(a + sl * (1 - 0 * rng())) * r1, Math.sin(a + sl) * r1);
        g.stroke();
      }
      // two uneven chalk lines with gaps
      for (const [dr, w, al, seed] of [[0, 1.5, 0.85, 1], [-5.5, 0.9, 0.55, 2]]) {
        const poly = raggedPoly(blobPoly(0, 0, rr + dr, rr + dr, seed + rr, { n: 40, jitter: 0.01 }), 0.9, seed * 7 + rr);
        const n = poly.length;
        let i = 0;
        while (i < n) {
          const len = 6 + Math.floor(rng() * 12);
          const seg = [];
          for (let k = 0; k <= len; k++) seg.push(poly[(i + k) % n]);
          inkStroke(g, seg, { w, color: col, alpha: al * (0.75 + 0.25 * rng()), taperStart: 0.15, taperEnd: 0.25, seed: seed * 91 + i, tremor: 0.25, step: 2, smooth: false });
          i += len + (rng() < 0.18 ? 1 + Math.floor(rng() * 2) : 0);
        }
      }
      stipple(g, blobPoly(0, 0, rr, rr, 3, { n: 18, jitter: 0 }), { count: Math.round(rr * 0.9), color: col, alpha: 0.35, seed: 77 + rr, rMin: 0.3, rMax: 0.9 });
      granulate(g, sp.cw, sp.ch, 0.08, 0.5);
      return sp;
    });
  }

  function drawBarriers(ctx, state, t) {
    const list = Array.isArray(state.barriers) ? state.barriers : [];
    for (const b of list) {
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
      const look = barrierLook(b);
      if (look.alpha <= 0.01) continue;
      const r = clamp(num(b.r, 60), 10, 400);
      const sp = ringSprite(r);
      ctx.save();
      if (look.draw < 1) {
        // the ring is drawn on, sweeping round from the top
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.arc(b.x, b.y, r * 1.5, -Math.PI / 2, -Math.PI / 2 + TAU * look.draw);
        ctx.closePath();
        ctx.clip();
      }
      ctx.globalAlpha = look.alpha * (0.92 + 0.08 * Math.sin(t * 1.7 + num(b.id)));
      ctx.drawImage(sp.canvas, b.x - sp.ax, b.y - sp.ay, sp.w, sp.h);
      ctx.restore();
    }
  }

  /** The barrier tool's cursor: a chalk ring where it can be put, a dashed red-wax ring where it is denied. */
  function drawPick(ctx, state, t) {
    const ui = state.ui;
    if (!ui || ui.tool !== 'barrier' || state.phase === 'title') return;
    const p = ui.barrierPick;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const r = clamp(num(p.r, 60), 10, 400);
    const ok = !!p.ok;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(14,8,4,0.4)';
    ctx.stroke();
    if (ok) {
      ctx.globalAlpha = 0.78 + 0.12 * Math.sin(t * 3.4);
      const sp = ringSprite(r, true);
      ctx.drawImage(sp.canvas, p.x - sp.ax, p.y - sp.ay, sp.w, sp.h);
      ctx.globalAlpha = 1;
      ctx.setLineDash([2, 7]);
      ctx.lineDashOffset = -t * 10;
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = rgba(CHALK, 0.8);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 5, 0, TAU);
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.5;
      const sp = ringSprite(r, false);
      ctx.drawImage(sp.canvas, p.x - sp.ax, p.y - sp.ay, sp.w, sp.h);
      ctx.globalAlpha = 1;
      ctx.setLineDash([9, 6]);
      ctx.lineDashOffset = -t * 12;
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(WAX, 0.95);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(p.x - 5.5, p.y - 5.5);
      ctx.lineTo(p.x + 5.5, p.y + 5.5);
      ctx.moveTo(p.x + 5.5, p.y - 5.5);
      ctx.lineTo(p.x - 5.5, p.y + 5.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ event effects */

  const push = (e) => {
    if (fx.length >= MAX_FX) fx.shift();
    e.born = -1;
    e.id = seq++;
    fx.push(e);
    return e;
  };

  function treeOf(state, id) {
    const list = state && state.world && state.world.trees;
    return Array.isArray(list) ? list.find((t) => t && t.id === id) || null : null;
  }

  function event(ev, state) {
    if (!ev || typeof ev !== 'object') return;
    const tr0 = ev.type === 'tree-lost' || ev.type === 'tree-freed' ? treeOf(state, ev.treeId) : null;
    const x = Number.isFinite(ev.x) ? ev.x : num(tr0 && tr0.x, NaN);
    const y = Number.isFinite(ev.y) ? ev.y : num(tr0 && tr0.baseY, NaN);
    if (!(Number.isFinite(x) && Number.isFinite(y))) return;
    const rr = mulberry(seq * 37 + 11);
    switch (ev.type) {
      case 'rival-wake':
        // an ink ripple through the ground and a puff of dust off the stump
        for (let i = 0; i < 3; i++) push({ k: 'ripple', x, y, life: 2.2, delay: i * 0.3, r1: 70 + i * 22 });
        for (let i = 0; i < 12; i++) push({ k: 'dust', x: x + (rr() - 0.5) * 30, y: y - rr() * 6, vx: (rr() - 0.5) * 22, vy: -8 - rr() * 16, life: 1.8 + rr() * 1.2, r: 5 + rr() * 8, delay: rr() * 0.4 });
        break;
      case 'rival-cut':
        for (let i = 0; i < 18; i++) push({ k: 'fleck', x: x + (rr() - 0.5) * 36, y: y + (rr() - 0.5) * 22, vx: (rr() - 0.5) * 16, vy: 4 + rr() * 14, life: 1.1 + rr() * 1.0, size: 1 + rr() * 1.9, dark: rr() < 0.65, rot: rr() * 6 });
        break;
      case 'tree-lost': {
        const tree = treeOf(state, ev.treeId);
        const stage = clamp(Math.round(num(tree && tree.stage, 2)), 0, 3);
        const top = STAGE_H[stage] * 0.8;
        const wide = [24, 42, 66, 90][stage];
        for (let i = 0; i < 16; i++) push({ k: 'leaf', x: x + (rr() - 0.5) * wide * 2, y: y - top * (0.35 + 0.65 * rr()), vx: (rr() - 0.5) * 14, vy: 18 + rr() * 16, life: 3 + rr() * 1.6, size: 3.2 + rr() * 2.6, ph: rr() * 6.28, col: mix('#b78a3c', '#8a5a2a', rr()), ground: y + 2, delay: rr() * 1.2 });
        break;
      }
      case 'tree-freed':
        push({ k: 'glow', x, y, life: 2.2, r1: 56 });
        for (let i = 0; i < 9; i++) push({ k: 'mote', x: x + (rr() - 0.5) * 60, y: y + (rr() - 0.5) * 16, vy: -10 - rr() * 16, life: 1.6 + rr() * 1.4, size: 2 + rr() * 2, ph: rr() * 6, delay: rr() * 0.5 });
        break;
      case 'barrier-placed': {
        const b = Array.isArray(state && state.barriers) ? state.barriers.find((q) => q && q.id === ev.id) : null;
        const r = num(b && b.r, 60);
        const cx = x;
        const cy = y;
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * TAU + rr() * 0.2;
          push({ k: 'chalk', x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: Math.cos(a) * (3 + rr() * 8), vy: Math.sin(a) * (3 + rr() * 8) - 2, life: 1.2 + rr() * 0.9, size: 0.9 + rr() * 1.5, delay: (i / 26) * 0.8 });
        }
        break;
      }
      case 'rival-fruit':
        for (let i = 0; i < 26; i++) push({ k: 'spore', x: x + (rr() - 0.5) * 26, y: y - rr() * 10, vx: (rr() - 0.3) * 18, vy: -14 - rr() * 24, life: 2.2 + rr() * 1.6, size: 1 + rr() * 1.4, ph: rr() * 6.28, delay: rr() * 0.35 });
        push({ k: 'glow', x, y: y - 8, life: 1.6, r1: 32, color: '#e8c870' });
        break;
      default:
    }
  }

  function drawOne(ctx, e, age, u) {
    switch (e.k) {
      case 'ripple': {
        const r = e.r1 * (1 - (1 - u) * (1 - u));
        ctx.lineWidth = 2.4 * (1 - u) + 0.5;
        ctx.strokeStyle = rgba('#2a1a10', 0.6 * (1 - u));
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + 2, r, r * 0.34, 0, 0, TAU);
        ctx.stroke();
        break;
      }
      case 'dust': {
        const x = e.x + e.vx * age;
        const y = e.y + e.vy * age;
        ctx.globalAlpha = 0.34 * (1 - u) * (1 - u);
        ctx.fillStyle = '#9b8767';
        ctx.beginPath();
        ctx.arc(x, y, e.r * (0.5 + 0.8 * u), 0, TAU);
        ctx.fill();
        break;
      }
      case 'fleck': {
        const x = e.x + e.vx * age;
        const y = e.y + e.vy * age + 6 * age * age;
        ctx.globalAlpha = (1 - u) * 0.9;
        ctx.fillStyle = e.dark ? '#2a1a10' : '#8d7d68';
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(e.rot + age * 2);
        const s = e.size * (1 - 0.6 * u);
        ctx.fillRect(-s, -s * 0.5, s * 2, s);
        ctx.restore();
        break;
      }
      case 'leaf': {
        const y = Math.min(e.ground, e.y + e.vy * age);
        const settled = y >= e.ground;
        const x = e.x + e.vx * age + (settled ? 0 : Math.sin(age * 2.3 + e.ph) * 11);
        const rot = settled ? e.ph : age * 2.1 + e.ph + Math.sin(age * 3) * 0.6;
        ctx.globalAlpha = Math.min(1, age * 4) * (u > 0.75 ? (1 - u) / 0.25 : 1);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.fillStyle = e.col;
        ctx.strokeStyle = 'rgba(58,40,22,0.8)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(-e.size, 0);
        ctx.quadraticCurveTo(0, -e.size * 0.62, e.size, 0);
        ctx.quadraticCurveTo(0, e.size * 0.62, -e.size, 0);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'glow': {
        const r = e.r1 * (0.3 + 0.7 * Math.sqrt(u));
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55 * (1 - u) * (1 - u);
        ctx.drawImage(glowSprite(e.color || '#f2ecc8', 64), e.x - r, e.y - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'mote': {
        const x = e.x + Math.sin(age * 2 + e.ph) * 4;
        const y = e.y + e.vy * age;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.sin(Math.PI * u) * 0.8;
        const r = e.size * 2.2;
        ctx.drawImage(glowSprite('#f6efd0', 32), x - r, y - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'chalk': {
        ctx.globalAlpha = 0.7 * (1 - u);
        ctx.fillStyle = CHALK;
        ctx.beginPath();
        ctx.arc(e.x + e.vx * age, e.y + e.vy * age, e.size * (1 + 0.5 * u), 0, TAU);
        ctx.fill();
        break;
      }
      case 'spore': {
        const x = e.x + e.vx * age + Math.sin(age * 2.4 + e.ph) * 5;
        const y = e.y + e.vy * age;
        ctx.globalAlpha = Math.sin(Math.PI * Math.min(1, u * 1.1)) * 0.85;
        ctx.fillStyle = '#e8cd82';
        ctx.beginPath();
        ctx.arc(x, y, e.size, 0, TAU);
        ctx.fill();
        break;
      }
      default:
    }
  }

  function drawEffects(ctx, t) {
    if (!fx.length) return;
    ctx.save();
    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      if (e.born < 0) e.born = t + (e.delay || 0);
      const age = t - e.born;
      if (age < 0) continue;
      const u = age / e.life;
      if (u >= 1) {
        fx.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = 1;
      drawOne(ctx, e, age, u);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ public */

  return {
    setScale(p) {
      if (!(p > 0) || !Number.isFinite(p)) return;
      if (Math.abs(p / px - 1) > 0.02) {
        px = p;
        sprites.clear();
      }
    },
    reset(w) {
      world = w || null;
      shapes.clear();
      curves.rival = null;
      sprites.clear();
      nodeIndex.src = null;
      cache.key = '';
      cache.baked.clear();
      fx.length = 0;
    },
    event,
    /** In the soil, over the player's hyphae and flows: rot stains, the rhizomorph web, barrier rings. */
    drawSoil(ctx, state, t) {
      if (!ctx || !hasRival(state)) {
        if (ctx && state && Array.isArray(state.barriers) && state.barriers.length) drawBarriers(ctx, state, t);
        return;
      }
      if (state.world && state.world !== world) this.reset(state.world);
      const px0 = ctx.getTransform().a;
      if (px0 > 0 && Math.abs(px0 / px - 1) > 0.02) this.setScale(px0);
      const parts = rivalParts(state);
      drawGrips(ctx, state, t, parts.grip);
      drawWeb(ctx, state, state.rival, t);
      drawBarriers(ctx, state, t);
    },
    /** On the ground line, over the trees: stumps and honey-mushroom tufts. */
    drawSurface(ctx, state, t = 0) {
      if (!ctx || !hasRival(state)) return;
      const px0 = ctx.getTransform().a;
      if (px0 > 0 && Math.abs(px0 / px - 1) > 0.02) this.setScale(px0);
      for (const s of stumpsOf(state)) drawStump(ctx, s);
      drawRotRings(ctx, state, t);
      drawClusters(ctx, state, rivalParts(state).clusters);
    },
    /** Topmost: the barrier tool's cursor and the event effects. */
    drawFx(ctx, state, t) {
      if (!ctx || !state) return;
      drawPick(ctx, state, t);
      drawEffects(ctx, t);
    },
    stats,
  };
}

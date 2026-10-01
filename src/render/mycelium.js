// Mycelium: glowing cream hyphae with a soft halo, like bioluminescent fungi.
// Old edges live in two screen-space caches (crisp core + a quarter-resolution halo that is upscaled for a free blur);
// only edges younger than FADE seconds are drawn live, growing in. A cache is only rebuilt when an edge is killed or
// gets thinner. Cache key: net.version (falls back to the edge/node counts when the sim has no version).
import { glowSprite, makeCanvas, noise1, smooth01 } from './ink.js';

const CORE = '#fff6dc';
const FADE = 1.0; // seconds an edge takes to grow in
const CHUNK = 48; // edges per stroked path
const HALO_DIV = 4;
const REBUILD_GAP = 0.45; // seconds between full rebuilds

export function createMycelium() {
  let view = null;
  let px = 1;
  let core = null;
  let halo = null;
  let cg = null;
  let hg = null;
  let net = null;
  let committed = 0;
  let lastVersion = -1;
  let lastRebuild = -9;
  let needRebuild = false;
  let seenAt = new Float64Array(1024);
  let seenCount = 0;
  let drawnW = new Float32Array(1024);
  let drawnAlive = new Uint8Array(1024);
  let shapes = []; // edge id -> cached meandering polyline
  const cords = new Map(); // mushroom id -> cord paths

  function allocate() {
    if (!view) return;
    const w = Math.round(view.cssW * view.dpr);
    const h = Math.round(view.cssH * view.dpr);
    core = makeCanvas(w, h);
    halo = makeCanvas(Math.ceil(w / HALO_DIV), Math.ceil(h / HALO_DIV));
    cg = core.getContext('2d');
    hg = halo.getContext('2d');
    cg.setTransform(px, 0, 0, px, view.ox * view.dpr, view.oy * view.dpr);
    hg.setTransform(px / HALO_DIV, 0, 0, px / HALO_DIV, (view.ox * view.dpr) / HALO_DIV, (view.oy * view.dpr) / HALO_DIV);
    cg.lineCap = 'round';
    cg.lineJoin = 'round';
    hg.lineCap = 'round';
    hg.lineJoin = 'round';
    committed = 0;
  }

  function clearCaches() {
    if (!core) return;
    cg.save();
    cg.setTransform(1, 0, 0, 1, 0, 0);
    cg.clearRect(0, 0, core.width, core.height);
    cg.restore();
    hg.save();
    hg.setTransform(1, 0, 0, 1, 0, 0);
    hg.clearRect(0, 0, halo.width, halo.height);
    hg.restore();
    committed = 0;
    drawnAlive.fill(0);
    drawnW.fill(0);
  }

  function growArrays(n) {
    if (n <= seenAt.length) return;
    let size = seenAt.length;
    while (size < n) size *= 2;
    const s = new Float64Array(size);
    s.set(seenAt);
    seenAt = s;
    const w = new Float32Array(size);
    w.set(drawnW);
    drawnW = w;
    const a = new Uint8Array(size);
    a.set(drawnAlive);
    drawnAlive = a;
  }

  const coreWidth = (w) => 1.75 + 0.7 * Math.min(Math.max(w - 1, 0), 3.2);

  /**
   * Shape of an edge: the quadratic curve from parent to child (tangent-continuous with the parent edge), sampled
   * every few units and made to meander a little, with fixed ends so joints meet. Nodes never move, so the shape is
   * cached per edge id until the network object changes. Returns { p: [x0, y0, x1, y1, ...], len, ux, uy }.
   */
  function shape(nodes, e) {
    const hit = shapes[e.id];
    if (hit && hit.a === e.a && hit.b === e.b) return hit;
    const A = nodes[e.a];
    const B = nodes[e.b];
    let from = A;
    let to = B;
    if (B.parent !== e.a && A.parent === e.b) {
      from = B;
      to = A;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    let tx = ux;
    let ty = uy;
    const par = from.parent;
    if (par >= 0 && par !== to.id && nodes[par]) {
      const pn = nodes[par];
      let ix = from.x - pn.x;
      let iy = from.y - pn.y;
      const il = Math.hypot(ix, iy) || 1;
      ix /= il;
      iy /= il;
      if (ix * ux + iy * uy > 0.15) {
        tx = ix + ux;
        ty = iy + uy;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
      }
    }
    const wob = noise1(e.id * 0.73 + 3) * 0.1 * len;
    const qx = from.x + tx * len * 0.5 - uy * wob;
    const qy = from.y + ty * len * 0.5 + ux * wob;
    const n = Math.max(2, Math.ceil(len / 4));
    const amp = Math.min(2.4, len * 0.07);
    const so = e.id * 3.17 + 11;
    const p = new Array((n + 1) * 2);
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const v = 1 - u;
      const off = amp * Math.sin(Math.PI * u) * (0.7 * noise1(so + u * len * 0.09) + 0.3 * noise1(so + 40 + u * len * 0.31));
      p[k * 2] = v * v * from.x + 2 * u * v * qx + u * u * to.x - uy * off;
      p[k * 2 + 1] = v * v * from.y + 2 * u * v * qy + u * u * to.y + ux * off;
    }
    const out = { a: e.a, b: e.b, p, len, ux, uy };
    shapes[e.id] = out;
    return out;
  }

  /** Append the polyline up to a fraction of its length to a path, optionally offset sideways by side(u). */
  function trace(path, sh, upTo = 1, side = null) {
    const p = sh.p;
    const n = p.length / 2 - 1;
    const last = Math.max(1, Math.ceil(n * upTo));
    for (let k = 0; k <= last; k++) {
      let x = p[k * 2];
      let y = p[k * 2 + 1];
      if (k === last && upTo < 1) {
        const f = n * upTo - (k - 1);
        x = p[(k - 1) * 2] + (x - p[(k - 1) * 2]) * f;
        y = p[(k - 1) * 2 + 1] + (y - p[(k - 1) * 2 + 1]) * f;
      }
      if (side) {
        const o = side(k / n);
        x -= sh.uy * o;
        y += sh.ux * o;
      }
      if (k === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
  }

  /** Stroke edges [i0, i1) into the caches, grouped by width into few paths (fibres = false: a thickening redraw). */
  function drawBatch(nodes, edges, i0, i1, fibres = true) {
    for (let a = i0; a < i1; a += CHUNK) {
      const b = Math.min(i1, a + CHUNK);
      const cores = new Map();
      const strands = new Path2D();
      const hairs = new Path2D();
      for (let i = a; i < b; i++) {
        const e = edges[i];
        if (!e.alive || !nodes[e.a] || !nodes[e.b]) continue;
        const sh = shape(nodes, e);
        const cw = Math.round(coreWidth(e.w || 1) * 2) / 2;
        let cp = cores.get(cw);
        if (!cp) cores.set(cw, (cp = new Path2D()));
        trace(cp, sh);
        if (fibres) addFibres(strands, hairs, sh, e, cw);
        drawnW[e.id] = e.w || 1;
        drawnAlive[e.id] = 1;
      }
      // halo first (quarter resolution, upscaled later for a free blur). Accumulated source-over, so a lone hypha
      // gets a clear glow while a dense mat saturates gently instead of burning out.
      hg.globalCompositeOperation = 'source-over';
      for (const [w, p] of cores) {
        hg.lineWidth = w * 10;
        hg.strokeStyle = 'rgba(255,212,146,0.065)';
        hg.stroke(p);
        hg.lineWidth = w * 4.2;
        hg.strokeStyle = 'rgba(255,236,192,0.19)';
        hg.stroke(p);
      }
      // core: crisp cream line with fine companion fibres and side hairs, a dark under-edge painted behind it
      cg.globalCompositeOperation = 'source-over';
      cg.lineWidth = 0.5;
      cg.strokeStyle = 'rgba(255,240,205,0.5)';
      cg.stroke(strands);
      cg.lineWidth = 0.55;
      cg.strokeStyle = 'rgba(255,244,214,0.62)';
      cg.stroke(hairs);
      cg.strokeStyle = CORE;
      for (const [w, p] of cores) {
        cg.lineWidth = w;
        cg.stroke(p);
      }
      cg.globalCompositeOperation = 'destination-over';
      cg.strokeStyle = 'rgba(18,9,4,0.34)';
      for (const [w, p] of cores) {
        cg.lineWidth = w + 1.2;
        cg.stroke(p);
      }
      cg.globalCompositeOperation = 'source-over';
    }
  }

  /** Fine fibres that make a hypha read as a living thread: a companion strand winding round it, side hairs. */
  function addFibres(strands, hairs, sh, e, cw) {
    const h = Math.imul(e.id + 7, 0x9e3779b1) >>> 0;
    const so = e.id * 1.93;
    const r = 0.6 + cw * 0.55;
    trace(strands, sh, 1, (u) => r * Math.sin(u * Math.PI * (1.5 + (h % 3)) + so) * Math.sin(Math.PI * u));
    if (cw >= 2) trace(strands, sh, 1, (u) => -r * Math.sin(u * Math.PI * (2.5 + (h % 2)) + so + 1.7) * Math.sin(Math.PI * u));
    if (sh.len < 7) return;
    const count = (h % 100 < 55 ? 1 : 0) + (sh.len > 22 && (h >>> 7) % 100 < 45 ? 1 : 0);
    const p = sh.p;
    const n = p.length / 2 - 1;
    for (let q = 0; q < count; q++) {
      const hq = Math.imul(h + q * 977, 0x85ebca6b) >>> 0;
      const k = Math.max(1, Math.min(n - 1, Math.round(n * (0.25 + ((hq >>> 8) % 50) / 100))));
      const mx = p[k * 2];
      const my = p[k * 2 + 1];
      const side = (hq >>> 16) & 1 ? 1 : -1;
      const ang = Math.atan2(sh.uy, sh.ux) + side * (0.7 + ((hq >>> 20) % 8) * 0.1);
      const hl = 4 + ((hq >>> 4) % 9);
      const bend = side * (0.35 + ((hq >>> 12) % 5) * 0.08);
      const ex = mx + Math.cos(ang) * hl;
      const ey = my + Math.sin(ang) * hl;
      hairs.moveTo(mx, my);
      hairs.quadraticCurveTo(mx + Math.cos(ang - bend) * hl * 0.55, my + Math.sin(ang - bend) * hl * 0.55, ex, ey);
      if (hl > 9 && (hq >>> 24) % 3 === 0) {
        // a little fork at the end of a long hair
        const fx = mx + Math.cos(ang) * hl * 0.6;
        const fy = my + Math.sin(ang) * hl * 0.6;
        hairs.moveTo(fx, fy);
        hairs.lineTo(fx + Math.cos(ang + side * 0.8) * 3.5, fy + Math.sin(ang + side * 0.8) * 3.5);
      }
    }
  }

  return {
    setScale(p, v) {
      px = p;
      view = v;
      allocate();
    },
    reset() {
      net = null;
      cords.clear();
    },
    draw(ctx, state, t) {
      const n = state.net;
      if (!core || !n) return;
      const nodes = n.nodes;
      const edges = n.edges;
      if (n !== net || edges.length < seenCount) {
        net = n;
        shapes = [];
        cords.clear();
        seenCount = 0;
        lastVersion = -1;
        clearCaches();
      }
      growArrays(edges.length + 1);
      // first sighting of new edges: fade them in unless a whole network appeared at once
      if (edges.length > seenCount) {
        const bulk = edges.length - seenCount > 160;
        for (let i = seenCount; i < edges.length; i++) seenAt[i] = bulk ? -1e9 : t;
        seenCount = edges.length;
      }
      // did anything old change? (version bump) -> cheap scan
      const version = n.version ?? edges.length * 4099 + nodes.length;
      if (version !== lastVersion) {
        lastVersion = version;
        for (let i = 0; i < committed; i++) {
          const e = edges[i];
          const alive = e.alive ? 1 : 0;
          if (alive !== drawnAlive[i] || (alive && (e.w || 1) < drawnW[i] - 0.01)) {
            needRebuild = true;
            break;
          }
        }
        // thickening cords: stroke the thicker line over the old one
        if (!needRebuild) {
          for (let i = 0; i < committed; i++) {
            const e = edges[i];
            if (e.alive && (e.w || 1) > drawnW[i] + 0.01 && coreWidth(e.w) - coreWidth(drawnW[i]) > 0.1) {
              drawBatch(nodes, edges, i, i + 1, false);
            }
          }
        }
      }
      if (needRebuild && t - lastRebuild > REBUILD_GAP) {
        needRebuild = false;
        lastRebuild = t;
        clearCaches();
      }
      // commit edges that have finished growing in
      let end = committed;
      while (end < edges.length && t - seenAt[end] >= FADE) end++;
      if (end > committed) {
        drawBatch(nodes, edges, committed, end);
        committed = end;
      }

      const breath = 0.88 + 0.12 * Math.sin(t * 0.9);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = breath;
      ctx.drawImage(halo, 0, 0, halo.width, halo.height, 0, 0, core.width, core.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(core, 0, 0);
      ctx.restore();

      // young edges: grow in along their curve
      for (let i = committed; i < edges.length; i++) {
        const e = edges[i];
        if (!e.alive || !nodes[e.a] || !nodes[e.b]) continue;
        const a = smooth01((t - seenAt[i]) / FADE);
        liveEdge(ctx, nodes, e, a);
      }

      // every fruit body is fed by the network: a glowing cord from its node up into the stipe base
      for (const m of state.mushrooms || []) if (m) fruitCord(ctx, nodes, m, t);

      // growing tips: bright moving points
      for (const gr of n.growing || []) {
        if (!gr.tip) continue;
        const last = nodes[gr.lastNode];
        const pulse = 0.75 + 0.25 * Math.sin(t * 9 + gr.id * 1.7);
        if (last) {
          ctx.strokeStyle = 'rgba(255,246,220,0.95)';
          ctx.lineWidth = 1.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(gr.tip.x, gr.tip.y);
          ctx.stroke();
        }
        glowAt(ctx, gr.tip.x, gr.tip.y, 12 + 3 * pulse, 0.95, '#fff2c4');
        glowAt(ctx, gr.tip.x, gr.tip.y, 4.2, 1, '#ffffff');
      }

      // origin nucleus and links
      const o = nodes[n.originId];
      if (o) {
        const p = 0.8 + 0.2 * Math.sin(t * 1.4);
        glowAt(ctx, o.x, o.y, 15 * p + 6, 0.7, '#ffe6a8');
        glowAt(ctx, o.x, o.y, 5.5, 0.9, '#fffaf0');
        // the spore itself: a tiny cream seed with an ink rim
        ctx.save();
        ctx.fillStyle = '#fffaf0';
        ctx.strokeStyle = 'rgba(70,44,20,0.8)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, 3.6, 2.6, -0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      for (const lk of n.links || []) {
        const nd = nodes[lk.nodeId];
        if (!nd) continue;
        const col = linkColor(lk, state);
        const p = 0.65 + 0.35 * Math.sin(t * 1.6 + lk.nodeId);
        glowAt(ctx, nd.x, nd.y, 13 + 3 * p, 0.55, col);
        glowAt(ctx, nd.x, nd.y, 3.6, 0.95, '#ffffff');
      }
    },
  };

  /**
   * The cord under a mushroom: a braid of three threads from its node to the stipe base, splaying into a little felt
   * of hairs in the litter. It grows up during the first fifth of the mushroom's growth; a mature one draws a slow
   * pulse of light upwards along it (the sugar it is fed with). Drawn under the fruit body.
   */
  function fruitCord(ctx, nodes, m, t) {
    const nd = nodes[m.nodeId];
    if (!nd || !Number.isFinite(m.x) || !Number.isFinite(m.baseY)) return;
    const growth = Number.isFinite(m.growth) ? m.growth : 1;
    const reach = smooth01(growth / 0.2 + 0.05);
    let g = cords.get(m.id);
    if (!g || g.node !== m.nodeId || g.x !== m.x || g.y !== m.baseY) {
      g = buildCord(nd, m);
      cords.set(m.id, g);
    }
    const len = g.y0 - g.y1;
    if (len < 1) return;
    const yTop = g.y0 - len * reach;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x0 - 40, yTop - 1, 80, len * reach + 30);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,222,150,0.16)';
    ctx.lineWidth = 7;
    ctx.stroke(g.main);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,244,214,0.7)';
    ctx.lineWidth = 0.7;
    ctx.stroke(g.side);
    if (reach > 0.95) ctx.stroke(g.felt);
    ctx.strokeStyle = CORE;
    ctx.lineWidth = 1.9;
    ctx.stroke(g.main);
    ctx.restore();
    if (reach < 0.98) {
      glowAt(ctx, g.x0 + (g.x1 - g.x0) * reach, yTop, 7, 0.9, '#fff2c4');
    } else if (m.mature || growth >= 1) {
      const u = (t * 0.4 + m.id * 0.37) % 1;
      const a = Math.sin(Math.PI * u);
      glowAt(ctx, g.x0 + (g.x1 - g.x0) * u, g.y0 - len * u, 6 + 3 * a, 0.75 * a, '#ffe2a0');
    }
  }

  function buildCord(nd, m) {
    const x0 = nd.x;
    const y0 = nd.y;
    const x1 = m.x;
    const y1 = m.baseY + 1.5;
    const len = Math.max(1, y0 - y1);
    const h = Math.imul((m.id | 0) + 31, 0x9e3779b1) >>> 0;
    const bow = ((h % 7) - 3) * 0.9;
    const main = new Path2D();
    main.moveTo(x0, y0);
    main.bezierCurveTo(x0 + bow, y0 - len * 0.35, x1 - bow, y1 + len * 0.4, x1, y1);
    const side = new Path2D();
    for (const s of [-1, 1]) {
      const spread = 3.5 + ((h >>> (s > 0 ? 4 : 9)) % 4);
      side.moveTo(x0, y0);
      side.bezierCurveTo(x0 + s * 2.5, y0 - len * 0.3, x1 + s * spread * 0.4, y1 + len * 0.45, x1 + s * spread, y1 + 1);
    }
    const felt = new Path2D();
    for (let k = 0; k < 7; k++) {
      const hk = Math.imul(h + k * 131, 0x85ebca6b) >>> 0;
      const a = Math.PI * (0.15 + 0.7 * (k / 6)) + ((hk % 20) - 10) * 0.02;
      const r = 3 + (hk >>> 8) % 4;
      const sx = x1 + ((hk >>> 12) % 9) - 4;
      felt.moveTo(sx, y1);
      felt.quadraticCurveTo(sx + Math.cos(a) * r * 0.5 + 1, y1 + Math.sin(a) * r * 0.4, sx + Math.cos(a) * r, y1 + Math.sin(a) * r);
    }
    return { node: m.nodeId, x: m.x, y: m.baseY, x0, y0, x1, y1, main, side, felt };
  }

  function liveEdge(ctx, nodes, e, a) {
    if (a <= 0.002) return;
    const sh = shape(nodes, e);
    const cw = coreWidth(e.w || 1);
    const path = new Path2D();
    trace(path, sh, a);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(255,222,150,${(0.16 * a).toFixed(3)})`;
    ctx.lineWidth = cw * 4.5;
    ctx.stroke(path);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = CORE;
    ctx.lineWidth = cw;
    ctx.stroke(path);
    ctx.restore();
    if (a < 0.98) {
      const p = sh.p;
      const n = p.length / 2 - 1;
      const k = Math.min(n, Math.ceil(n * a));
      glowAt(ctx, p[k * 2], p[k * 2 + 1], 8, 0.9 * (1 - a * 0.5), '#fff2c4');
    }
  }
}

function glowAt(ctx, x, y, r, alpha, color) {
  const g = glowSprite(color, 48);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.drawImage(g, x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

function linkColor(lk, state) {
  if (lk.kind === 'water') return '#59b8ff';
  if (lk.kind === 'tree') return '#ffd36b';
  const m = state.world.minerals?.[lk.targetId];
  return m && m.kind === 'nitrogen' ? '#c9dc6a' : '#b48cff';
}

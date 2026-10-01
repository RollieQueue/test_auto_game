// Interaction feedback drawn from state.ui: the dragged hypha preview as a dashed ink line (sealing-wax red when it
// cannot be afforded, an ink cross where a rock blocks it), hover highlights, and fruiting spots in the 'fruit' tool.
import { PAL, catmull, glowSprite, rgba, tracePath } from './ink.js';
import { canFruit } from '../sim/index.js';
import { sampleProfile } from '../world/query.js';

const SHOW_COST = false; // little paper tag with the sugar price at the end of the preview
const WAX = '#c9443b'; // sealing wax, a touch brighter than PAL.wax so it reads on dark soil

export function createFeedback() {
  let fruitSet = [];
  let fruitAt = -9;
  let fruitNet = null;
  let fruitCount = -1;

  function refreshFruit(state, t) {
    const net = state.net;
    if (net === fruitNet && t - fruitAt < 0.3 && net.nodes.length === fruitCount) return;
    fruitNet = net;
    fruitAt = t;
    fruitCount = net.nodes.length;
    fruitSet = [];
    const w = state.world;
    for (const n of net.nodes) {
      if (!n.alive) continue;
      if (n.y > sampleProfile(w.ground, w.step, n.x) + 300) continue;
      let ok = false;
      try {
        ok = canFruit(state, n.id);
      } catch {
        ok = false;
      }
      if (ok) fruitSet.push(n);
      if (fruitSet.length > 240) break;
    }
  }

  return {
    setScale() {},
    reset() {
      fruitSet = [];
      fruitNet = null;
    },
    draw(ctx, state, t, dt, frame) {
      const ui = state.ui;
      if (!ui) return;
      const net = state.net;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (ui.tool === 'fruit' && state.phase !== 'title') drawFruit(ctx, state, t);
      // while a hypha is being dragged only the thing it aims at matters, not the soil layer under the cursor
      const dragging = !!(ui.drag || ui.preview);
      if (ui.hoverTarget && !(dragging && ui.hoverTarget.kind === 'horizon')) drawTarget(ctx, state, ui.hoverTarget, t, frame);
      if (ui.hoverNode != null && net.nodes[ui.hoverNode]) {
        const n = net.nodes[ui.hoverNode];
        const p = 0.5 + 0.5 * Math.sin(t * 5);
        const g = glowSprite('#fff2c4', 48);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.9;
        ctx.drawImage(g, n.x - 16, n.y - 16, 32, 32);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ring(ctx, n.x, n.y, 8.5 + p * 1.6, '#fff6dc', 1.5, 0.95);
      }
      if (ui.preview && ui.preview.points && ui.preview.points.length > 1) drawPreview(ctx, ui.preview, t);
      ctx.restore();
    },
  };

  function drawFruit(ctx, state, t) {
    refreshFruit(state, t);
    const w = state.world;
    const g = glowSprite('#ffe9a8', 48);
    const hover = state.ui.hoverNode;
    for (const n of fruitSet) {
      const ground = sampleProfile(w.ground, w.step, n.x);
      const hot = n.id === hover;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3 + n.id * 0.7);
      // dotted stalk up to where the cap would stand
      ctx.save();
      ctx.setLineDash([1.5, 5]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba('#fff6dc', hot ? 0.85 : 0.35);
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(n.x, ground);
      ctx.stroke();
      ctx.restore();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = hot ? 0.9 : 0.35 + 0.25 * pulse;
      ctx.drawImage(g, n.x - 13, n.y - 13, 26, 26);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ring(ctx, n.x, n.y, 5.5 + pulse * 1.4 + (hot ? 2 : 0), '#fff6dc', hot ? 2 : 1.2, hot ? 1 : 0.7);
      if (hot) {
        // ghost mushroom: a dashed cap outline at the surface
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = rgba('#3a2a1e', 0.85);
        ctx.beginPath();
        ctx.moveTo(n.x - 12, ground - 22);
        ctx.quadraticCurveTo(n.x, ground - 44, n.x + 12, ground - 22);
        ctx.quadraticCurveTo(n.x, ground - 18, n.x - 12, ground - 22);
        ctx.moveTo(n.x, ground - 20);
        ctx.lineTo(n.x, ground);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawPreview(ctx, pv, t) {
    const pts = pv.points;
    const sm = pts.length > 2 ? catmull(pts, 3) : pts;
    const col = pv.affordable === false ? WAX : '#fff6dc';
    // dark under-line, a pale glow, then the dashed ink
    ctx.save();
    ctx.lineWidth = 4.2;
    ctx.strokeStyle = 'rgba(14,8,4,0.5)';
    ctx.beginPath();
    tracePath(ctx, sm, false, false);
    ctx.stroke();
    ctx.lineWidth = 2.1;
    ctx.setLineDash([9, 6]);
    ctx.lineDashOffset = -t * 22;
    ctx.strokeStyle = rgba(col, 0.95);
    ctx.stroke();
    ctx.restore();
    // end marker
    const end = pts[pts.length - 1];
    const g = glowSprite(pv.affordable === false ? '#ff7a6a' : '#fff2c4', 48);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85;
    ctx.drawImage(g, end.x - 11, end.y - 11, 22, 22);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // blocked: an ink cross where the way ends
    if (pv.blocked) cross(ctx, pv.blocked.x, pv.blocked.y, 8);
    if (SHOW_COST && Number.isFinite(pv.cost) && pv.cost > 0) costTag(ctx, end.x + 12, end.y - 14, pv.cost, pv.affordable !== false);
  }

  function drawTarget(ctx, state, tg, t, frame) {
    const w = state.world;
    const dashed = (fn) => {
      for (const [lw, col, a, dash] of [
        [3.6, '#0e0804', 0.4, null],
        [1.8, '#fff6dc', 0.9, [6, 5]],
      ]) {
        ctx.save();
        ctx.lineWidth = lw;
        ctx.strokeStyle = rgba(col, a);
        if (dash) {
          ctx.setLineDash(dash);
          ctx.lineDashOffset = -t * 8;
        }
        ctx.beginPath();
        fn();
        ctx.stroke();
        ctx.restore();
      }
    };
    const find = (arr) => arr?.find((o) => o.id === tg.id);
    switch (tg.kind) {
      case 'water': {
        const d = find(w.water);
        if (d) dashed(() => ctx.ellipse(d.x, d.y, d.rx + 11, d.ry + 11, 0, 0, Math.PI * 2));
        break;
      }
      case 'mineral': {
        const d = find(w.minerals);
        if (d) dashed(() => ctx.ellipse(d.x, d.y - (d.kind === 'phosphorus' ? d.r * 0.3 : 0), d.r * 1.5 + 8, d.r * 1.25 + 8, 0, 0, Math.PI * 2));
        break;
      }
      case 'rock': {
        const r = find(w.rocks);
        if (r) {
          dashed(() => {
            r.poly.forEach((p, i) => {
              const x = r.x + (p.x - r.x) * 1.12;
              const y = r.y + (p.y - r.y) * 1.14;
              if (i) ctx.lineTo(x, y);
              else ctx.moveTo(x, y);
            });
            ctx.closePath();
          });
        }
        break;
      }
      case 'tree': {
        const tr = find(w.trees);
        if (tr) {
          const b = frame?.refs?.trees?.bounds?.(tr) || { x0: tr.x - 40, x1: tr.x + 40, y0: tr.baseY - 160, y1: tr.baseY };
          brackets(ctx, b, '#3a2a1e', t);
        }
        break;
      }
      case 'mushroom': {
        const m = find(state.mushrooms);
        if (m) {
          const b = frame?.refs?.mushrooms?.bounds?.(m) || { x0: m.x - 22, x1: m.x + 22, y0: m.baseY - 80, y1: m.baseY };
          brackets(ctx, b, '#3a2a1e', t);
        }
        break;
      }
      case 'horizon': {
        const hs = w.horizons;
        const i = typeof tg.id === 'number' ? tg.id : hs.findIndex((h) => h.id === tg.id);
        if (i < 0 || !hs[i]) break;
        const top = hs[i].top;
        const bot = hs[i + 1]?.top;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,240,200,0.07)';
        ctx.beginPath();
        top.forEach((y, k) => (k ? ctx.lineTo(k * w.step, y) : ctx.moveTo(0, y)));
        if (bot) for (let k = bot.length - 1; k >= 0; k--) ctx.lineTo(k * w.step, bot[k]);
        else {
          ctx.lineTo(w.width, w.height);
          ctx.lineTo(0, w.height);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        dashed(() => top.forEach((y, k) => (k ? ctx.lineTo(k * w.step, y + 2) : ctx.moveTo(0, y + 2))));
        break;
      }
      default:
    }
  }
}

function ring(ctx, x, y, r, color, w, a) {
  ctx.save();
  ctx.lineWidth = w + 1.6;
  ctx.strokeStyle = 'rgba(14,8,4,0.4)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = w;
  ctx.strokeStyle = rgba(color, a);
  ctx.stroke();
  ctx.restore();
}

function cross(ctx, x, y, s) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const [w, col, a] of [
    [5.4, '#fff0d0', 0.6],
    [3.2, '#150c07', 1],
  ]) {
    ctx.lineWidth = w;
    ctx.strokeStyle = rgba(col, a);
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * 0.9);
    ctx.lineTo(x + s, y + s * 0.95);
    ctx.moveTo(x + s, y - s * 0.95);
    ctx.lineTo(x - s * 0.95, y + s);
    ctx.stroke();
  }
  ctx.restore();
}

function brackets(ctx, b, color, t) {
  const pad = 6 + Math.sin(t * 3) * 1;
  const x0 = b.x0 - pad;
  const x1 = b.x1 + pad;
  const y0 = b.y0 - pad;
  const y1 = b.y1 + pad;
  const a = Math.min(18, (x1 - x0) / 3, (y1 - y0) / 3);
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(color, 0.9);
  ctx.beginPath();
  for (const [cx, cy, sx, sy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x1, y1, -1, -1],
    [x0, y1, 1, -1],
  ]) {
    ctx.moveTo(cx + sx * a, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + sy * a);
  }
  ctx.stroke();
  ctx.restore();
}

function costTag(ctx, x, y, cost, ok) {
  const text = `−${Math.round(cost)}`;
  ctx.save();
  ctx.font = 'italic 600 15px "Palatino Linotype", Georgia, serif';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = ok ? 'rgba(239,228,204,0.94)' : 'rgba(239,228,204,0.94)';
  ctx.strokeStyle = ok ? 'rgba(58,42,30,0.9)' : PAL.wax;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(x, y - 9);
  ctx.lineTo(x + w, y - 9);
  ctx.lineTo(x + w, y + 8);
  ctx.lineTo(x, y + 8);
  ctx.lineTo(x - 5, y - 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ok ? '#7a4a14' : PAL.wax;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6, y);
  ctx.restore();
}

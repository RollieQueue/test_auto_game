// The mark of feeding a tree («Подкормка», sim/feed.js): a small golden drop with «+1,2/с» beside the fed tree's trunk foot, while
// state.feed.rate shows that sugar really goes to it. The golden flow along the network is flows.js's (kind 'feed').
// The mark stands on the grass to the right of the foot, past the rot ring that rival.js drawRotRings puts round a gripped trunk
// (half-width 17 + 7 per stage on the ground line, its «40 %» mark below the ring), so the two never meet.
import { B } from '../sim/balance.js';
import { rateText } from '../ui/feed.js';
import { reducedMotion } from './motion.js';

const FADE_IN = 0.4; // s
const FADE_OUT = 0.7; // s
const FONT_PX = 14;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Where the ring round a trunk foot ends (rival.js drawRotRings), plus a gap: the mark starts here, right of the trunk. */
export const markGap = (stage) => 17 + 7 * Math.max(0, Math.min(3, Math.round(num(stage)))) + 7;

/** The mark of the fed tree, or null (no feeding, a rate too small to tell, or a tree that is lost): { treeId, x, y, text, gap }. x, y: the trunk foot. */
export function feedMarkOf(state) {
  const f = state && state.feed;
  if (!f || !(num(f.rate) > B.feedFlowMin)) return null;
  const tree = state.world && state.world.trees ? state.world.trees[f.treeId] : null;
  if (!tree || tree.lost || !Number.isFinite(tree.x) || !Number.isFinite(tree.baseY)) return null;
  return { treeId: tree.id, x: tree.x, y: tree.baseY, text: `+${rateText(f.rate)}/с`, gap: markGap(tree.stage) };
}

/** The tear of a drop, tip up, `s` tall, centred at (0, 0). */
function dropPath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.62);
  ctx.bezierCurveTo(s * 0.16, -s * 0.3, s * 0.4, -s * 0.02, s * 0.4, s * 0.2);
  ctx.bezierCurveTo(s * 0.4, s * 0.46, s * 0.2, s * 0.62, 0, s * 0.62);
  ctx.bezierCurveTo(-s * 0.2, s * 0.62, -s * 0.4, s * 0.46, -s * 0.4, s * 0.2);
  ctx.bezierCurveTo(-s * 0.4, -s * 0.02, -s * 0.16, -s * 0.3, 0, -s * 0.62);
  ctx.closePath();
}

export function createFeedMark() {
  let shown = null; // the last mark, kept while it fades out
  let k = 0; // 0..1 visibility

  return {
    setScale() {},
    reset() {
      shown = null;
      k = 0;
    },
    draw(ctx, state, t, dt, frame) {
      const mark = feedMarkOf(state);
      if (mark) {
        shown = mark;
        k = reducedMotion() ? 1 : Math.min(1, k + dt / FADE_IN);
      } else if (shown) {
        k = reducedMotion() ? 0 : Math.max(0, k - dt / FADE_OUT);
        if (k <= 0) shown = null;
      }
      if (!shown || k <= 0) return;
      const ease = k * k * (3 - 2 * k);
      const pulse = reducedMotion() ? 1 : 1 + 0.08 * Math.sin(t * 2.2);
      // world units per css pixel (a smaller glade is drawn zoomed out): the mark keeps its size on the screen
      const u = Math.max(1, Math.min(1.5, 1 / (num(frame && frame.view && frame.view.scale, 1) || 1)));
      const size = 16 * u;
      ctx.save();
      ctx.globalAlpha = ease;
      ctx.font = `italic 600 ${FONT_PX * u}px "Palatino Linotype", Georgia, serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.lineJoin = 'round';
      const w = ctx.measureText(shown.text).width;
      const x0 = shown.x + shown.gap * u;
      // on the grass beside the foot: the surface hyphae and the rot ring (ground line ± 11) lie below it
      const y = shown.y - 14 * u - (1 - ease) * 4;
      // a pale paper plate with a thin ink edge, so the mark reads over soil and roots
      const pl = x0 - 11 * u;
      const pr = x0 + 9 * u + w;
      ctx.fillStyle = 'rgba(246,238,216,0.88)';
      ctx.strokeStyle = 'rgba(122,74,20,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(pl, y - 10 * u, pr - pl, 20 * u, 10 * u) : ctx.rect(pl, y - 10 * u, pr - pl, 20 * u);
      ctx.fill();
      ctx.stroke();
      // the golden drop
      ctx.save();
      ctx.translate(x0, y);
      ctx.scale(pulse, pulse);
      dropPath(ctx, size);
      const g = ctx.createLinearGradient(0, -size * 0.6, 0, size * 0.6);
      g.addColorStop(0, '#ffe08a');
      g.addColorStop(1, '#e09a1c');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#8a5a14';
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,252,230,0.85)';
      ctx.beginPath();
      ctx.ellipse(-size * 0.14, size * 0.12, size * 0.07, size * 0.14, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#7a4a14';
      ctx.fillText(shown.text, x0 + 9 * u, y + 0.5);
      ctx.restore();
    },
  };
}

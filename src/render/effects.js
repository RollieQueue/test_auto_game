// Event effects: ink ripples and colour blooms for links, golden sparkle for tree growth, red ink blots when sugar
// is short, fade puffs for exhausted deposits, tiny sparks while hyphae grow, red crosses for denied fruiting.
// The renderer feeds every state.events entry to event(); particles are kept in a small capped list here.
import { reducedMotion } from './motion.js';
import { PAL, glowSprite, inkBlot, makeSprite, mulberry, rgba } from './ink.js';

const MAX = 420;

const KIND_COLOR = { water: '#59b8ff', tree: '#ffd36b', phosphorus: '#b48cff', nitrogen: '#c9dc6a', mineral: '#b48cff', sugar: '#ffb347' };

export function createEffects() {
  const list = [];
  let px = 1;
  let blots = null;
  let seq = 1;

  const push = (e) => {
    if (list.length >= MAX) list.shift();
    e.born = -1;
    e.id = seq++;
    list.push(e);
  };

  function blotSprites() {
    if (blots) return blots;
    blots = [];
    for (let i = 0; i < 3; i++) {
      const sp = makeSprite(44, 44, Math.max(1, px), 22, 22);
      inkBlot(sp.ctx, 0, 0, 8 + i * 1.5, { color: '#a8322d', alpha: 0.92, seed: 40 + i * 7, drops: 5 });
      inkBlot(sp.ctx, 1, 1, 4, { color: '#5e1815', alpha: 0.55, seed: 80 + i, drops: 0 });
      blots.push(sp);
    }
    return blots;
  }

  const colorFor = (ev, state) => {
    if (ev.kind === 'mineral') return KIND_COLOR[state.world.minerals?.[ev.targetId]?.kind] || KIND_COLOR.mineral;
    return KIND_COLOR[ev.kind] || '#ffffff';
  };

  return {
    setScale(p) {
      if (Math.abs(p / px - 1) > 0.02) {
        px = p;
        blots = null;
      }
    },
    reset() {
      list.length = 0;
    },
    event(ev, state) {
      const { x, y } = ev;
      switch (ev.type) {
        case 'link': {
          const color = colorFor(ev, state);
          push({ k: 'ring', x, y, life: 1.5, color, r0: 4, r1: 46 });
          push({ k: 'ring', x, y, life: 1.1, color: '#fff6dc', r0: 3, r1: 28, delay: 0.08 });
          push({ k: 'bloom', x, y, life: 1.7, color, r1: 58 });
          break;
        }
        case 'tree-stage': {
          const rr = mulberry(seq * 31 + 5);
          push({ k: 'bloom', x, y, life: 2.2, color: '#ffd36b', r1: 90 });
          push({ k: 'ring', x, y, life: 1.6, color: '#ffe08a', r0: 6, r1: 70 });
          for (let i = 0; i < (reducedMotion() ? 0 : 22); i++) { // «меньше движения»: no sparkle confetti
            const a = rr() * Math.PI * 2;
            const sp = 14 + rr() * 46;
            push({ k: 'star', x: x + (rr() - 0.5) * 60, y: y - rr() * 80, vx: Math.cos(a) * sp * 0.4, vy: -8 - rr() * 26, life: 1.3 + rr() * 1.3, color: rr() < 0.7 ? '#ffd36b' : '#fff1b8', size: 3 + rr() * 4, delay: rr() * 0.5, tw: rr() * 6 });
          }
          break;
        }
        case 'insufficient':
          push({ k: 'blot', x, y, life: 1.9, variant: seq % 3, rot: (seq * 1.7) % 6.28 });
          break;
        case 'deposit-empty': {
          const color = ev.kind === 'water' ? '#a9dcf5' : ev.kind === 'nitrogen' ? '#c9d77a' : '#cbb0f2';
          const rr = mulberry(seq * 17 + 3);
          for (let i = 0; i < 9; i++) push({ k: 'puff', x: x + (rr() - 0.5) * 30, y: y + (rr() - 0.5) * 14, vx: (rr() - 0.5) * 14, vy: -6 - rr() * 14, life: 1.6 + rr() * 0.8, color, r: 8 + rr() * 12, delay: rr() * 0.25 });
          break;
        }
        case 'grow-tick': {
          const rr = mulberry(seq * 13 + 1);
          for (let i = 0; i < (reducedMotion() ? 0 : 3); i++) {
            const a = rr() * Math.PI * 2;
            const sp = 16 + rr() * 30;
            push({ k: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.35 + rr() * 0.35, color: rr() < 0.5 ? '#fff6dc' : '#ffe6a0', size: 2 + rr() * 1.6 });
          }
          break;
        }
        case 'grow-end':
          push({ k: 'ring', x, y, life: 0.9, color: '#fff6dc', r0: 2, r1: 20 });
          break;
        case 'grow-start':
          push({ k: 'ring', x, y, life: 0.6, color: '#fff6dc', r0: 12, r1: 3 });
          break;
        case 'fruit-denied':
          push({ k: 'cross', x, y, life: 1.6, size: 9 });
          break;
        default:
      }
    },
    draw(ctx, state, t, dt) {
      if (!list.length) return;
      const adv = dt;
      ctx.save();
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e.born < 0) e.born = t + (e.delay || 0);
        const age = t - e.born;
        if (age < 0) continue;
        const u = age / e.life;
        if (u >= 1) {
          list.splice(i, 1);
          continue;
        }
        drawOne(ctx, e, age, u, adv);
      }
      ctx.restore();
    },
  };

  function drawOne(ctx, e, age, u) {
    switch (e.k) {
      case 'ring': {
        const r = e.r0 + (e.r1 - e.r0) * (1 - (1 - u) * (1 - u));
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 2.2 * (1 - u) + 0.4;
        ctx.strokeStyle = rgba(e.color, 0.8 * (1 - u));
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'bloom': {
        const r = e.r1 * (0.35 + 0.65 * Math.sqrt(u));
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (reducedMotion() ? 0.22 : 0.6) * (1 - u) * (1 - u); // a soft glow instead of a flash
        ctx.drawImage(glowSprite(e.color, 64), e.x - r, e.y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        break;
      }
      case 'spark': {
        const x = e.x + e.vx * age;
        const y = e.y + e.vy * age;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - u;
        const r = e.size * (1 - u * 0.5);
        ctx.drawImage(glowSprite(e.color, 32), x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        break;
      }
      case 'star': {
        const x = e.x + e.vx * age;
        const y = e.y + e.vy * age;
        const tw = 0.55 + 0.45 * Math.sin(age * 9 + e.tw);
        const a = Math.sin(Math.PI * Math.min(1, u * 1.15)) * tw;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a;
        const r = e.size * 2.2;
        ctx.drawImage(glowSprite(e.color, 32), x - r, y - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = rgba('#fffbe8', a);
        ctx.lineWidth = 0.9;
        ctx.lineCap = 'round';
        const s = e.size * 1.2;
        ctx.beginPath();
        ctx.moveTo(x - s, y);
        ctx.lineTo(x + s, y);
        ctx.moveTo(x, y - s * 1.3);
        ctx.lineTo(x, y + s * 1.3);
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'blot': {
        const sp = blotSprites()[e.variant];
        const grow = 0.55 + 0.45 * Math.min(1, u * 5);
        const a = u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
        ctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.rot);
        ctx.globalAlpha = Math.max(0, a) * 0.95;
        const s = grow * 1.5;
        ctx.drawImage(sp.canvas, -sp.ax * s, -sp.ay * s, sp.w * s, sp.h * s);
        ctx.restore();
        break;
      }
      case 'puff': {
        const x = e.x + e.vx * age;
        const y = e.y + e.vy * age;
        const r = e.r * (0.5 + u * 1.1);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.5 * (1 - u) * Math.min(1, age * 5);
        ctx.drawImage(glowSprite(e.color, 48, 0.4), x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        break;
      }
      case 'cross': {
        const k = Math.min(1, age / 0.28);
        const a = u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35;
        const s = e.size;
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'round';
        const draw = (w, col, alpha) => {
          ctx.lineWidth = w;
          ctx.strokeStyle = rgba(col, alpha * a);
          ctx.beginPath();
          ctx.moveTo(e.x - s, e.y - s);
          ctx.lineTo(e.x - s + 2 * s * Math.min(1, k * 2), e.y - s + 2 * s * Math.min(1, k * 2));
          if (k > 0.5) {
            ctx.moveTo(e.x + s, e.y - s);
            ctx.lineTo(e.x + s - 2 * s * (k - 0.5) * 2, e.y - s + 2 * s * (k - 0.5) * 2);
          }
          ctx.stroke();
        };
        draw(5.2, '#fff0d0', 0.45);
        draw(3.2, PAL.wax, 1);
        break;
      }
      default:
    }
  }
}

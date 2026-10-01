// The resources card without the DOM: what to show for each stock and the tooltip over its row.
// Sugar is capped by state.cap.sugar, water and minerals each by state.cap.pool, spores are not capped.
import { RESOURCE_INFO, fillWords } from '../content/resources.js';
import { groundYAt } from '../world/query.js';
import * as balance from '../sim/balance.js';

export const RESOURCES = [
  { k: 'sugar', label: 'Сахар', cap: 'sugar' },
  { k: 'water', label: 'Влага', cap: 'pool' },
  { k: 'minerals', label: 'Минералы', cap: 'pool' },
  { k: 'spores', label: 'Споры', cap: null },
];

const FULL_AT = 0.985; // from this share of the cap the stock counts as full

/**
 * What the card shows for stock `k`: `value` (whole units, never above `cap`), `cap` (whole units, 0 when the game has
 * none yet or the stock is uncapped), `frac` 0..1 for the bar, `full` when the cap is reached. The sim clamps already;
 * clamping here too means a stale frame or a loaded save can never show «91 / 90».
 */
export function resourceView(state, k) {
  const def = RESOURCES.find((r) => r.k === k);
  const have = Math.max(0, (state.res && state.res[k]) || 0);
  const capRaw = def && def.cap ? (state.cap && state.cap[def.cap]) || 0 : 0;
  if (!def || !def.cap || capRaw <= 0) return { value: Math.floor(have + 1e-6), cap: 0, frac: 0, full: false, capped: Boolean(def && def.cap) };
  const clamped = Math.min(have, capRaw);
  const frac = clamped / capRaw;
  const full = frac >= FULL_AT;
  const cap = Math.floor(capRaw + 1e-6);
  const value = full ? cap : Math.min(Math.floor(clamped + 1e-6), cap);
  return { value, cap, frac, full, capped: true };
}

/** The tooltip over a row: { main, sub, body, warn } (see tooltip.js), or null for an unknown stock. */
export function resourceTip(state, k) {
  const info = RESOURCE_INFO[k];
  if (!info) return null;
  const v = resourceView(state, k);
  const main = v.capped && v.cap > 0 ? `${info.name} · ${v.value} из ${v.cap}` : `${info.name} · ${v.value}`;
  const lines = [info.what, info.use];
  if (info.limit) lines.push(v.full && info.full ? info.full : info.limit);
  return {
    main,
    sub: v.capped && v.cap > 0 ? fillWords(v.frac) : '',
    body: lines,
    warn: v.full,
  };
}

// ---- sugar at its cap: a nudge toward the mushroom tool ----------------------------------------------------------

export const NUDGE = Object.freeze({
  fullFor: 7, // s the stock has to sit at its cap before the note comes
  cooldown: 90, // s of game time between two notes
  max: 5, // notes per game
  lit: 9, // s the «Гриб» tab stays lit
});

/** True when some alive node is close enough to the ground for a mushroom (the player has a place to click). */
export function hasFruitSpot(state) {
  const maxDepth = (balance.B && balance.B.fruitMaxDepth) ?? 45;
  return state.net.nodes.some((n) => n.alive && n.y - groundYAt(state.world, n.x) <= maxDepth);
}

/**
 * Watches the sugar stock: when it sits at its cap for a while with nothing growing out of it, fires one note
 * (rate-limited by game time) and keeps the «Гриб» tab lit for a few seconds.
 * `update(state, dt)` -> { fire, active } (dt = real seconds; frozen while the game is not playing).
 */
export function createSugarNudge(cfg = NUDGE) {
  let full = 0;
  let last = -Infinity;
  let sent = 0;
  let litUntil = -Infinity;
  return {
    reset() {
      full = 0;
      last = -Infinity;
      sent = 0;
      litUntil = -Infinity;
    },
    update(state, dt) {
      const now = state.time;
      if (state.phase !== 'playing') return { fire: false, active: now < litUntil };
      const winter = Boolean(state.flags && state.flags.seasons && state.clock && state.clock.season === 'winter');
      const v = resourceView(state, 'sugar');
      // a mushroom does not grow in winter, and with no node near the ground there is nowhere to click
      full = v.full && !winter ? full + dt : 0;
      let fire = false;
      if (full >= cfg.fullFor && sent < cfg.max && now - last >= cfg.cooldown && hasFruitSpot(state)) {
        fire = true;
        sent += 1;
        last = now;
        litUntil = now + cfg.lit;
        full = 0;
      }
      return { fire, active: now < litUntil && v.full };
    },
  };
}

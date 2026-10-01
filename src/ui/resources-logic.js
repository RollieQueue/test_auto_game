// The resources card without the DOM: what to show for each stock and the tooltip over its row.
// Sugar is capped by state.cap.sugar, water and minerals each by state.cap.pool, spores are not capped.
import { RESOURCE_INFO, fillWords } from '../content/resources.js';

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

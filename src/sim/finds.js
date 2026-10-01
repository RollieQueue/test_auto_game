// Naturalist's finds: a hypha node that comes close to a world.decor item discovers it (docs/ARCHITECTURE.md «Finds»).
import { FINDS } from '../content/finds.js';
import { B } from './balance.js';

/** Distance within which a node discovers `decor`. */
export const findRadius = (decor) => B.findRadiusBase + B.findRadiusPerScale * decor.scale;

/** Small reward for a kind by its rarity: { sugar, spores }. */
export function findReward(kind) {
  const rarity = FINDS[kind]?.rarity ?? 1;
  return { sugar: B.findSugar[rarity - 1] ?? 0, spores: B.findSpores[rarity - 1] ?? 0 };
}

function hit(decor, x, y) {
  const r = findRadius(decor);
  const dx = x - decor.x;
  const dy = y - decor.y;
  return dx * dx + dy * dy <= r * r;
}

/** Called for every new node: records and announces the items it touches. */
export function checkFinds(state, node) {
  const { world, finds, res, cap, events } = state;
  if (!finds) return;
  for (const d of world.decor) {
    if (finds[d.id] || !hit(d, node.x, node.y)) continue;
    finds[d.id] = { kind: d.type, at: state.time };
    const reward = findReward(d.type);
    res.sugar = Math.min(Math.max(res.sugar, cap.sugar), res.sugar + reward.sugar);
    res.spores += reward.spores;
    events.push({ type: 'find', id: d.id, kind: d.type, x: d.x, y: d.y });
  }
}

/** Silent catch-up for a game saved before finds existed: marks everything the network already touches. */
export function rescanFinds(state) {
  const { world, finds } = state;
  for (const n of state.net.nodes) {
    if (!n.alive) continue;
    for (const d of world.decor) if (!finds[d.id] && hit(d, n.x, n.y)) finds[d.id] = { kind: d.type, at: n.born };
  }
}

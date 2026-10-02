// Fruiting bodies: planting rules, growth, spore release.
import { groundYAt } from '../world/query.js';
import { B, pressure } from './balance.js';
import { fedIndex } from './economy.js';
import { nearestNode } from './network.js';
import { fungusFx, fungusId } from './species.js';

/** Sugar a mushroom costs now. */
export const mushroomCost = (state) => {
  const P = pressure(state);
  return B.mushroomCost * P.mushCost * (1 + P.mushCount * state.mushrooms.length);
};

/** null when a mushroom may be planted on the node, otherwise 'deep' | 'crowded' | 'sugar'. */
export function fruitDenial(state, nodeId) {
  const node = state.net.nodes[nodeId];
  if (!node || !node.alive) return 'deep';
  const ground = groundYAt(state.world, node.x);
  if (node.y - ground > B.fruitMaxDepth) return 'deep';
  for (const m of state.mushrooms) {
    if (Math.hypot(m.x - node.x, m.baseY - ground) < B.fruitSpacing) return 'crowded';
  }
  if (state.res.sugar < mushroomCost(state)) return 'sugar';
  return null;
}

export const canFruit = (state, nodeId) => fruitDenial(state, nodeId) === null;

/** A mushroom id never used before (ids stay unique when cut-off mushrooms leave the list). */
function nextMushroomId(state) {
  let id = state.sim.nextMushroomId;
  for (const m of state.mushrooms) id = Math.max(id, m.id + 1);
  state.sim.nextMushroomId = id + 1;
  return id;
}

export function commandFruit(state, nodeId) {
  const reason = fruitDenial(state, nodeId);
  const node = state.net.nodes[nodeId];
  if (reason) {
    if (node) {
      const y = groundYAt(state.world, node.x);
      state.events.push({ type: 'fruit-denied', x: node.x, y, reason });
      if (reason === 'sugar') state.events.push({ type: 'insufficient', x: node.x, y });
    }
    return false;
  }
  const baseY = groundYAt(state.world, node.x);
  state.res.sugar -= mushroomCost(state);
  const m = {
    id: nextMushroomId(state),
    nodeId,
    x: node.x,
    baseY,
    species: fungusId(state), // the player's fungus (flags.species); an old game without a pick fruits 'common'
    variant: state.sim.rng.int(0, 999),
    age: 0,
    growth: 0,
    mature: false,
    spores: 0,
    burst: 0, // spores released since the last `spores` event (internal)
    burstT: 0,
  };
  state.mushrooms.push(m);
  state.events.push({ type: 'mushroom-planted', id: m.id, x: m.x, y: baseY });
  return true;
}

/**
 * The node to plant on for a click at (x, y): the nearest node that can fruit within `radius`,
 * otherwise the nearest node of any kind (so the denial reason can be shown), or null.
 */
export function pickFruitNode(state, x, y, radius = 44) {
  const ok = nearestNode(state, x, y, radius, (n) => canFruit(state, n.id));
  if (ok !== null) return ok;
  return nearestNode(state, x, y, radius + 40);
}

export function stepMushrooms(state, dt) {
  const { mushrooms, res, sim, events } = state;
  if (mushrooms.length === 0) return;
  const fed = fedIndex(state);
  const fx = sim.fx;
  const P = pressure(state);
  sim.fed = fed;
  for (const m of mushrooms) {
    m.age += dt;
    if (!m.mature) {
      m.growth = Math.min(1, m.growth + (dt / B.mushroomGrowSeconds) * (B.mushroomGrowFloor + (1 - B.mushroomGrowFloor) * fed) * fx.mushGrow);
      if (fx.mushGrow > 0) drawSugar(state, B.mushroomGrowSugar * P.mushGrowSugar * dt);
      if (m.growth >= 1) {
        m.mature = true;
        events.push({ type: 'mushroom-mature', id: m.id, x: m.x, y: m.baseY });
      }
      continue;
    }
    drawSugar(state, B.mushroomMatureSugar * P.mushMatureSugar * fx.mushSugar * dt);
    const out = B.sporeRate * P.sporeRate * (0.5 + 1.5 * fed) * fx.spore * fungusFx(m.species).spore * dt;
    m.spores += out;
    m.burst += out;
    res.spores += out;
    m.burstT += dt;
    if (m.burstT >= B.sporeEventEvery) {
      if (m.burst > 0) events.push({ type: 'spores', id: m.id, amount: m.burst, x: m.x, y: m.baseY - B.mushroomHeight });
      m.burst = 0;
      m.burstT = 0;
    }
  }
}

function drawSugar(state, amount) {
  state.res.sugar = Math.max(0, state.res.sugar - amount);
}

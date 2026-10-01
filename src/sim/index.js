// Simulation facade: see docs/ARCHITECTURE.md for the contract. Pure data, no DOM, deterministic per seed.
import { B } from './balance.js';
import { addNode, createSimData, nearestNode } from './network.js';
import { commandGrow, estimateGrowth, stepGrowth } from './growth.js';
import { stepEconomy } from './economy.js';
import { canFruit, commandFruit, pickFruitNode, stepMushrooms } from './mushrooms.js';
import { recomputeFlows } from './flows.js';
import { createObjectives, stepObjectives } from './objectives.js';

export { commandGrow, estimateGrowth, canFruit, commandFruit, pickFruitNode };

export function initSim(state) {
  const { world, net } = state;
  state.sim = createSimData(state);
  net.version ??= 0;
  net.growing ??= [];
  net.links ??= [];
  state.res.sugar = B.startSugar;
  state.res.water = 0;
  state.res.minerals = 0;
  state.res.spores = 0;
  state.cap.pool = B.poolBase;
  state.cap.sugar = B.sugarCapBase;
  const origin = addNode(state, world.origin.x, world.origin.y, -1);
  net.originId = origin.id;
  // A few short hyphae around the spore, all slightly below the fruiting depth.
  for (const a of [-0.5, 0.5, 1.6, 2.6, 3.7]) {
    addNode(state, origin.x + Math.cos(a) * B.originRingRadius, origin.y + Math.sin(a) * B.originRingRadius, origin.id);
  }
  state.objectives = createObjectives();
}

export function updateSim(state, dt) {
  const { res, sim, rates } = state;
  const before = { sugar: res.sugar, water: res.water, minerals: res.minerals, spores: res.spores };
  sim.clock += dt;
  stepGrowth(state, dt);
  stepEconomy(state, dt);
  stepMushrooms(state, dt);
  sim.flowDt += dt;
  if (sim.flowDt >= B.flowEvery) {
    recomputeFlows(state, sim.flowDt);
    sim.flowDt = 0;
  }
  stepObjectives(state);
  // Smoothed net change per second (commands run between steps, so their one-off costs are not counted).
  const k = Math.min(1, dt / B.rateTau);
  for (const key of ['sugar', 'water', 'minerals', 'spores']) rates[key] += ((res[key] - before[key]) / dt - rates[key]) * k;
}

/** Nearest alive node within `radius` of (x, y), or null. */
export function pickNode(state, x, y, radius = 22) {
  return nearestNode(state, x, y, radius);
}

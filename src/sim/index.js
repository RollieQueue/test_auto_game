// Simulation facade: see docs/ARCHITECTURE.md for the contract. Pure data, no DOM, deterministic per seed.
import { B } from './balance.js';
import { addNode, createSimData, nearestNode } from './network.js';
import { commandGrow, estimateGrowth, stepGrowth } from './growth.js';
import { stepEconomy } from './economy.js';
import { canFruit, commandFruit, mushroomCost, pickFruitNode, stepMushrooms } from './mushrooms.js';
import { recomputeFlows } from './flows.js';
import { createObjectives, stepObjectives } from './objectives.js';
import { initTime, stepTime } from './clock.js';
import { canTrap, commandTrap, pickTrapNode, stepThreats, trapDenial } from './threats.js';
import { stepStakes } from './stakes.js';
import { canFeedAny, commandFeed, feedDenial, feedThreshold, feedUnlocked, feedUseful, fedTree } from './feed.js';
import { barrierCost, barrierDenial, canBarrier, commandBarrier, pickBarrierNode, stepRival } from './rival.js';

export { commandGrow, estimateGrowth, canFruit, commandFruit, mushroomCost, pickFruitNode, canTrap, commandTrap, pickTrapNode, trapDenial };
export { barrierCost, barrierDenial, canBarrier, commandBarrier, pickBarrierNode };
export { canFeedAny, commandFeed, feedDenial, feedThreshold, feedUnlocked, feedUseful, fedTree };
export { barrierEffects, raiders, treeBarred } from './rival.js';

export function initSim(state) {
  const { world, net } = state;
  state.sim = createSimData(state);
  net.version ??= 0;
  net.growing ??= [];
  state.finds = {}; // decor id -> { kind, at }, see finds.js
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
  state.chapter = 1;
  state.fauna = []; // nematodes (state.flags.threats), see threats.js
  state.traps = []; // «ловчие кольца»
  state.rival = null; // the honey fungus (state.flags.rival): the first step with the flag creates it, see rival.js
  state.barriers = []; // barrier tool (key 4)
  state.feed = null; // the tree being fed (tool 5), see feed.js
  initTime(state);
}

export function updateSim(state, dt) {
  if (state.flags.pageClosed) return; // «страница закрыта»: the glade stands still (see stakes.js)
  const { res, sim, rates } = state;
  const before = { sugar: res.sugar, water: res.water, minerals: res.minerals, spores: res.spores };
  sim.clock += dt;
  stepTime(state);
  stepGrowth(state, dt);
  stepThreats(state, dt);
  stepRival(state, dt);
  stepEconomy(state, dt);
  stepMushrooms(state, dt);
  sim.flowDt += dt;
  if (sim.flowDt >= B.flowEvery) {
    recomputeFlows(state, sim.flowDt);
    sim.flowDt = 0;
  }
  stepObjectives(state, dt);
  stepStakes(state, dt);
  // Smoothed net change per second (commands run between steps, so their one-off costs are not counted).
  const k = Math.min(1, dt / B.rateTau);
  for (const key of ['sugar', 'water', 'minerals', 'spores']) rates[key] += ((res[key] - before[key]) / dt - rates[key]) * k;
}

/** Nearest alive node within `radius` of (x, y), or null. */
export function pickNode(state, x, y, radius = 22) {
  return nearestNode(state, x, y, radius);
}

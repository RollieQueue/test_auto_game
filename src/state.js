// Creates the whole game state for a seed. The schema is documented in docs/ARCHITECTURE.md.
import { generateWorld } from './world/generate.js';
import { initSim } from './sim/index.js';

export function createState(seed) {
  const state = {
    seed,
    time: 0,
    speed: 1,
    phase: 'title',
    world: generateWorld(seed),
    net: { nodes: [], edges: [], links: [], growing: [], originId: 0, version: 0 },
    res: { sugar: 0, water: 0, minerals: 0, spores: 0 },
    rates: { sugar: 0, water: 0, minerals: 0, spores: 0 },
    cap: { pool: 0, sugar: 0 },
    flows: [],
    mushrooms: [],
    objectives: [],
    flags: { allObjectivesDone: false },
    events: [],
    ui: { tool: 'grow', pointer: null, hoverNode: null, hoverTarget: null, drag: null, preview: null, barrierPick: null },
    stats: { hyphaeLength: 0, maxDepth: 0 },
  };
  initSim(state);
  return state;
}

// What moves through the network: flows (for visuals and sound) and the thickening of busy cords.
import { B } from './balance.js';
import { pathBetween } from './network.js';

function bestNode(net, ids) {
  let best = ids[0];
  for (const id of ids) if (net.nodes[id].dist < net.nodes[best].dist) best = id;
  return best;
}

/** Rebuilds state.flows from what was transferred during the last `dt` seconds. */
export function recomputeFlows(state, dt) {
  const { net, world, sim, mushrooms } = state;
  const flows = [];
  const origin = net.originId;
  const push = (from, to, kind, rate) => {
    if (rate < B.flowMinRate || flows.length >= B.maxFlows || from === to) return;
    flows.push({ from, to, kind, rate, path: pathBetween(net, from, to) });
  };

  // Water and minerals: deposit link -> trees that took them, the surplus goes to the origin store.
  for (const [kind, deposits, linkLists, key] of [
    ['water', world.water, sim.waterLinks, 'water'],
    ['mineral', world.minerals, sim.mineralLinks, 'minerals'],
  ]) {
    const taken = sim.taken[kind];
    const active = deposits.filter((d) => linkLists[d.id].length > 0);
    let extracted = 0;
    for (const d of active) extracted += taken[d.id] / dt;
    let intakeSum = 0;
    for (const t of world.trees) intakeSum += sim.intake[t.id][key] / dt;
    const total = Math.max(extracted, intakeSum);
    if (active.length > 0 && total >= B.flowMinRate) {
      const weight = (d) => (extracted > 0 ? taken[d.id] / dt : 1);
      const weightSum = active.reduce((s, d) => s + weight(d), 0);
      for (const d of active) {
        const share = weight(d) / weightSum;
        const from = bestNode(net, linkLists[d.id]);
        for (const t of world.trees) {
          const rate = (sim.intake[t.id][key] / dt) * share;
          if (rate >= B.flowMinRate) push(from, bestNode(net, sim.contacts[t.id]), kind, rate);
        }
        push(from, origin, kind, Math.max(0, extracted - intakeSum) * share);
      }
    }
    taken.fill(0);
  }

  // Sugar: tree contacts -> origin, origin -> growing tips and mushrooms.
  for (const t of world.trees) {
    const contacts = sim.contacts[t.id];
    const rate = sim.intake[t.id].sugar / dt;
    if (contacts.length > 0 && rate >= B.flowMinRate) {
      const used = contacts.slice(0, 3);
      for (const c of used) push(c, origin, 'sugar', rate / used.length);
    }
    const intake = sim.intake[t.id];
    intake.water = intake.minerals = intake.sugar = 0;
  }
  for (const h of net.growing) push(origin, h.lastNode, 'sugar', h.segCost[h.seg] * B.growSpeed);
  for (const m of mushrooms) push(origin, m.nodeId, 'sugar', m.mature ? B.mushroomMatureSugar : B.mushroomGrowSugar);

  state.flows = flows;
  thicken(state, flows, dt);
}

/** Busy paths slowly become thicker «rhizomorphs». */
function thicken(state, flows, dt) {
  const { net, sim } = state;
  if (flows.length === 0) return;
  const load = new Map();
  for (const f of flows) {
    const p = f.path;
    for (let i = 0; i + 1 < p.length; i++) {
      const lo = net.nodes[p[i]].parent === p[i + 1] ? p[i] : p[i + 1];
      const e = sim.parentEdge[lo];
      if (e >= 0) load.set(e, (load.get(e) || 0) + f.rate);
    }
  }
  const k = 1 - Math.exp(-dt / B.edgeThickenTau);
  let changed = false;
  for (const [id, l] of load) {
    const edge = net.edges[id];
    const target = 1 + (B.edgeMaxW - 1) * (1 - Math.exp(-l / B.edgeLoadScale));
    const cur = sim.wTrue.get(id) ?? 1;
    if (target <= cur) continue;
    const next = cur + (target - cur) * k;
    sim.wTrue.set(id, next);
    if (next - edge.w >= 0.05) {
      edge.w = Math.round(next * 20) / 20;
      changed = true;
    }
  }
  if (changed) net.version++;
}

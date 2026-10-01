// Economy: pool capacity, extraction from deposits, tree exchange and growth, sugar upkeep and baseline.
import { clamp } from '../core/geom.js';
import { B, pressure } from './balance.js';
import { recheckTips } from './network.js';

function updateCaps(state) {
  const len = state.stats.hyphaeLength;
  state.cap.pool = B.poolBase + B.poolPerLength * len;
  let stages = 0;
  for (const t of state.world.trees) if (t.linked) stages += t.stage + 1;
  state.cap.sugar = (B.sugarCapBase + B.sugarCapPerLength * len + B.sugarCapPerTreeStage * stages) * pressure(state).sugarCap;
}

/** Pockets refill; every linked deposit feeds the shared pool until it is empty. */
function extract(state, dt) {
  const { world, res, cap, sim, events } = state;
  for (const w of world.water) {
    w.amount = Math.min(w.max, w.amount + w.regen * sim.fx.regen * dt);
    const links = sim.waterLinks[w.id].length;
    if (links === 0) continue;
    if (sim.emptyFlag.water[w.id] && w.amount >= B.emptyRearm * w.max) sim.emptyFlag.water[w.id] = false;
    const take = Math.min(Math.min(links, B.maxLinksPerDeposit) * B.waterPerLink * dt, w.amount, Math.max(0, cap.pool - res.water));
    if (take <= 0) continue;
    w.amount -= take;
    res.water += take;
    sim.taken.water[w.id] += take;
    if (w.amount <= 1e-6 && !sim.emptyFlag.water[w.id]) {
      sim.emptyFlag.water[w.id] = true;
      events.push({ type: 'deposit-empty', kind: 'water', id: w.id, x: w.x, y: w.y });
    }
  }
  for (const m of world.minerals) {
    const links = sim.mineralLinks[m.id].length;
    if (links === 0 || m.amount <= 0) continue;
    const take = Math.min(Math.min(links, B.maxLinksPerDeposit) * B.mineralPerLink * dt, m.amount, Math.max(0, cap.pool - res.minerals));
    if (take <= 0) continue;
    m.amount -= take;
    res.minerals += take;
    sim.taken.mineral[m.id] += take;
    if (m.amount <= 1e-6 && !sim.emptyFlag.mineral[m.id]) {
      sim.emptyFlag.mineral[m.id] = true;
      events.push({ type: 'deposit-empty', kind: 'mineral', id: m.id, x: m.x, y: m.y });
    }
  }
}

/** Exchange with linked trees; returns the sugar they paid this step. */
function stepTrees(state, dt) {
  const { world, res, sim, events } = state;
  const fx = sim.fx;
  const linked = world.trees.filter((t) => sim.contacts[t.id].length > 0);
  if (linked.length === 0) return 0;
  const fac = (t) => B.treeContactFactor[Math.min(sim.contacts[t.id].length, B.treeContactFactor.length) - 1];
  let wantW = 0;
  let wantM = 0;
  for (const t of linked) {
    wantW += B.treeDemandWater[t.stage] * fx.drinkW * dt;
    wantM += B.treeDemandMinerals[t.stage] * fx.drinkM * dt;
  }
  const scaleW = wantW > res.water ? res.water / wantW : 1;
  const scaleM = wantM > res.minerals ? res.minerals / wantM : 1;
  let paid = 0;
  for (const t of linked) {
    const dW = B.treeDemandWater[t.stage] * fx.drinkW * dt;
    const dM = B.treeDemandMinerals[t.stage] * fx.drinkM * dt;
    const takeW = dW * scaleW;
    const takeM = dM * scaleM;
    res.water -= takeW;
    res.minerals -= takeM;
    const sat = B.treeSatWater * (takeW / dW) + (1 - B.treeSatWater) * (takeM / dM); // demands are never 0
    t.health += (sat - t.health) * Math.min(1, dt / B.treeHealthTau);
    const pay = B.treePay[t.stage] * fac(t) * sat * fx.pay * pressure(state).treePay * dt;
    paid += pay;
    const intake = sim.intake[t.id];
    intake.water += takeW;
    intake.minerals += takeM;
    intake.sugar += pay;
    if (t.stage < 3) {
      const g = clamp((t.health - B.treeGrowFromHealth) / (1 - B.treeGrowFromHealth), 0, 1);
      t.growth += (g * fx.treeGrow * pressure(state).treeGrow * dt) / B.treeGrowSeconds[t.stage];
      if (t.growth >= 1) {
        t.stage++;
        t.growth = 0;
        sim.treeStageUps++;
        events.push({ type: 'tree-stage', treeId: t.id, stage: t.stage, x: t.x, y: t.baseY });
        recheckTips(state, t);
      }
    }
  }
  res.water = Math.max(0, res.water);
  res.minerals = Math.max(0, res.minerals);
  return paid;
}

/** Saprotrophic trickle: the spore and hyphae in litter and humus decompose leaf litter. */
export function saprotrophSugar(state) {
  return Math.min(B.sapCap, B.sapBase + B.sapPerLength * state.sim.lenSap);
}

export function stepEconomy(state, dt) {
  const { res, cap, sim } = state;
  updateCaps(state);
  extract(state, dt);
  const paid = stepTrees(state, dt);
  const income = saprotrophSugar(state) + paid / dt;
  const P = pressure(state);
  let upkeep = B.upkeepPerLength * state.stats.hyphaeLength * (1 + state.stats.hyphaeLength / P.sprawl) * sim.fx.upkeep * P.upkeep;
  if (res.sugar < B.upkeepSoftFloor) upkeep = Math.min(upkeep, B.upkeepFloorShare * income);
  sim.income = income;
  res.sugar = clamp(res.sugar + (income - upkeep) * dt, 0, cap.sugar);
  res.water = Math.min(res.water, cap.pool);
  res.minerals = Math.min(res.minerals, cap.pool);
  updateCaps(state); // trees may have changed stage
}

/** Share of the network that is well supplied with water and minerals (0..1). */
export function fedIndex(state) {
  const { res } = state;
  return 0.5 * (Math.min(1, res.water / B.fedWater) + Math.min(1, res.minerals / B.fedMinerals));
}

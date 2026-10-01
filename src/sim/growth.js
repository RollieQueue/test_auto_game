// Hypha growth: validating drag paths, queueing hyphae, advancing tips, paying sugar as they go.
import { resample } from '../core/geom.js';
import { costAt } from '../world/query.js';
import { B, pressure } from './balance.js';
import { addNode } from './network.js';

/** Sugar already promised to hyphae that are still growing. */
export function committedSugar(net) {
  let sum = 0;
  for (const h of net.growing) {
    for (let i = h.seg; i < h.segCost.length; i++) {
      const done = i === h.seg ? h.grown - h.cum[i] : 0;
      sum += (h.cum[i + 1] - h.cum[i] - done) * h.segCost[i];
    }
  }
  return sum;
}

/** Preview of a drag from node `fromId` along `points`: cut at the first impassable point. */
export function estimateGrowth(state, fromId, points) {
  const from = state.net.nodes[fromId];
  const none = { from: fromId, points: [], blocked: null, length: 0, cost: 0, affordable: false };
  if (!from || !from.alive) return none;
  const path = resample([{ x: from.x, y: from.y }, ...points], B.pathStep);
  const hard = pressure(state).growCost;
  const reachable = [path[0]];
  const segCost = [];
  let blocked = null;
  let length = 0;
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const c0 = costAt(state.world, path[i].x, path[i].y);
    if (!Number.isFinite(c0)) {
      blocked = path[i];
      break;
    }
    const c = c0 * hard;
    const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    length += seg;
    cost += seg * c;
    segCost.push(c);
    reachable.push(path[i]);
  }
  const free = state.res.sugar - committedSugar(state.net);
  const plan = { from: fromId, points: reachable, blocked, length, cost, affordable: cost <= free + 1e-9, segCost };
  // the part of the path the purse pays for (what commandGrow grows when the whole is out of reach)
  plan.affordableLength = plan.affordable ? length : affordablePrefix(plan, free).length;
  return plan;
}

/** The longest prefix of the planned path that costs at most `budget` sugar: { points, segCost, length }. */
function affordablePrefix(plan, budget) {
  const points = [plan.points[0]];
  const segCost = [];
  let length = 0;
  let spent = 0;
  for (let i = 1; i < plan.points.length; i++) {
    const a = plan.points[i - 1];
    const b = plan.points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    const c = plan.segCost[i - 1];
    if (spent + seg * c <= budget + 1e-9) {
      spent += seg * c;
      length += seg;
      points.push(b);
      segCost.push(c);
      continue;
    }
    const part = Math.max(0, (budget - spent) / c); // the last bit, up to where the sugar runs out
    if (part > 0.01) {
      const t = part / seg;
      points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      segCost.push(c);
      length += part;
    }
    break;
  }
  return { points, segCost, length };
}

/**
 * Queues a growing hypha. When the whole path is out of reach of the purse the affordable first part is grown instead
 * (`insufficient { partial: true, got, want }` at the new tip, lengths in u); when not even a minimal step is affordable
 * the command is refused with a plain `insufficient` at the start node. Returns false for refusals and zero-length commands.
 */
export function commandGrow(state, fromId, points) {
  const plan = estimateGrowth(state, fromId, points);
  if (plan.points.length < 2 || plan.length < B.minGrowLength) return false;
  const from = state.net.nodes[fromId];
  let p = plan;
  if (!plan.affordable) {
    const part = affordablePrefix(plan, state.res.sugar - committedSugar(state.net) - 1e-6);
    if (part.length < B.minGrowLength) {
      state.events.push({ type: 'insufficient', x: from.x, y: from.y });
      return false;
    }
    p = { ...plan, points: part.points, segCost: part.segCost, length: part.length };
    const tip = part.points[part.points.length - 1];
    state.events.push({ type: 'insufficient', x: tip.x, y: tip.y, partial: true, got: Math.round(part.length), want: Math.round(plan.length) });
  }
  const cum = [0];
  for (let i = 1; i < p.points.length; i++) {
    const a = p.points[i - 1];
    const b = p.points[i];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  state.net.growing.push({
    id: state.sim.nextGrowId++,
    from: fromId,
    path: p.points,
    grown: 0,
    total: cum[cum.length - 1],
    lastNode: fromId,
    tip: { x: from.x, y: from.y },
    // internal bookkeeping
    cum,
    segCost: p.segCost,
    seg: 0,
    nodeS: 0, // path distance of the last created node
    tickAt: B.growTickEvery,
  });
  state.events.push({ type: 'grow-start', x: from.x, y: from.y });
  return true;
}

function pointAt(h, s) {
  const { cum, path } = h;
  let i = Math.min(h.seg, path.length - 2);
  while (i > 0 && cum[i] > s) i--;
  while (i < path.length - 2 && cum[i + 1] < s) i++;
  const len = cum[i + 1] - cum[i];
  const t = len > 0 ? Math.min(1, Math.max(0, (s - cum[i]) / len)) : 1;
  return { x: path[i].x + (path[i + 1].x - path[i].x) * t, y: path[i].y + (path[i + 1].y - path[i].y) * t };
}

/** Advances every growing hypha by dt. Sugar is paid per grown segment; an empty purse stops the tip. */
export function stepGrowth(state, dt) {
  const { net, res, sim, events } = state;
  if (net.growing.length === 0) return;
  const finished = [];
  for (const h of net.growing) {
    const adv = Math.min(B.growSpeed * dt, h.total - h.grown);
    let moved = 0;
    let spent = 0;
    let limited = false;
    const budget = res.sugar;
    while (moved < adv - 1e-9) {
      const room = h.cum[h.seg + 1] - (h.grown + moved);
      const part = Math.min(adv - moved, room);
      const c = h.segCost[h.seg];
      if (spent + part * c > budget) {
        const afford = Math.max(0, (budget - spent) / c);
        moved += afford;
        spent = budget;
        limited = true;
        break;
      }
      moved += part;
      spent += part * c;
      if (part >= room - 1e-9 && h.seg < h.segCost.length - 1) h.seg++;
      else if (part >= room - 1e-9) break;
    }
    res.sugar = Math.max(0, res.sugar - spent);
    h.grown += moved;

    while (h.grown - h.nodeS >= B.nodeSpacing - 1e-9) {
      h.nodeS += B.nodeSpacing;
      const p = pointAt(h, h.nodeS);
      h.lastNode = addNode(state, p.x, p.y, h.lastNode).id;
    }
    h.tip = pointAt(h, h.grown);
    while (h.grown >= h.tickAt) {
      events.push({ type: 'grow-tick', x: h.tip.x, y: h.tip.y });
      h.tickAt += B.growTickEvery;
    }

    const done = h.grown >= h.total - 1e-9;
    if (done || limited) {
      if (h.grown - h.nodeS > 3) h.lastNode = addNode(state, h.tip.x, h.tip.y, h.lastNode).id;
      if (limited && !done) events.push({ type: 'insufficient', x: h.tip.x, y: h.tip.y });
      events.push({ type: 'grow-end', x: h.tip.x, y: h.tip.y });
      finished.push(h);
    }
  }
  if (finished.length) net.growing = net.growing.filter((h) => !finished.includes(h));
}

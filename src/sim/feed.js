// Feeding a tree («Подкормка»): the player picks ONE linked, living tree and the surplus sugar of the pantry goes to it through
// the common network, as carbon goes to a mother tree in Simard's forests. Only what lies above B.feedFrom x cap.sugar moves (the
// stock is never pushed under that line), at up to B.feedRate sugar/s. Fed sugar speeds the tree's growth and, with the honey
// fungus on, thickens its mantle. state.feed = null | { treeId, rate } (rate: smoothed sugar/s moved, for the HUD; only treeId is
// saved). Events: feed-start { treeId }, feed-stop { treeId, reason: 'player' | 'lost' | 'unlinked' }, feed-denied { treeId, reason }.
import { clamp } from '../core/geom.js';
import { B, pressure, treeFx } from './balance.js';
import { recheckTips } from './network.js';

const RATE_TAU = 2; // s: smoothing of the shown rate
const MANTLE_FULL = 0.99; // a mantle this thick needs no more

/** Why the tree cannot be fed: 'none' (no such tree), 'lost' (the rival killed it) or 'unlinked' (no root tip of ours touches it); null when it can. */
export function feedDenial(state, treeId) {
  const tree = Number.isInteger(treeId) ? state.world.trees[treeId] : undefined;
  if (!tree) return 'none';
  if (tree.lost) return 'lost';
  const contacts = state.sim.contacts[tree.id];
  if (!(contacts ? contacts.length > 0 : tree.linked)) return 'unlinked';
  return null;
}

/** The sugar stock above which the surplus is given away. */
export const feedThreshold = (state) => B.feedFrom * state.cap.sugar;

/** The tree being fed, or null. */
export function fedTree(state) {
  const f = state.feed;
  return f ? state.world.trees[f.treeId] || null : null;
}

/** Is any tree there to feed (the tool tab is shown)? A tree that is linked and alive. */
export function canFeedAny(state) {
  return state.world.trees.some((t) => feedDenial(state, t.id) === null);
}

/** Picking the fed tree again stops the feeding; another tree takes it over. Returns 'on' | 'switch' | 'off', or false when refused. */
export function commandFeed(state, treeId) {
  const f = state.feed;
  if (f && f.treeId === treeId) {
    state.feed = null;
    state.events.push({ type: 'feed-stop', treeId, reason: 'player' });
    return 'off';
  }
  const why = feedDenial(state, treeId);
  if (why) {
    state.events.push({ type: 'feed-denied', treeId: Number.isInteger(treeId) ? treeId : -1, reason: why });
    return false;
  }
  state.feed = { treeId, rate: 0 };
  state.events.push({ type: 'feed-start', treeId });
  return f ? 'switch' : 'on';
}

/** Moves `fed` sugar into the tree's growth (a stage up works as in economy.js stepTrees) and mantle. */
function nourish(state, tree, fed) {
  const { sim, events } = state;
  if (tree.stage < 3) {
    const sp = treeFx(tree);
    const g = growthFactor(tree);
    tree.growth += (fed * B.feedGrowSeconds * g * sp.grow * sim.fx.treeGrow * pressure(state).treeGrow * (1 - (tree.infection ?? 0))) / B.treeGrowSeconds[tree.stage];
    if (tree.growth >= 1) {
      tree.stage++;
      tree.growth = 0;
      sim.treeStageUps++;
      events.push({ type: 'tree-stage', treeId: tree.id, stage: tree.stage, x: tree.x, y: tree.baseY });
      recheckTips(state, tree);
    }
  }
  if (state.flags.rival) {
    const m = tree.mantle ?? 0;
    tree.mantle = m + (1 - m) * Math.min(1, fed * B.feedMantle);
  }
}

/** 0..1: how well a tree grows at its health (as stepTrees reckons it). */
function growthFactor(tree) {
  return clamp((tree.health - B.treeGrowFromHealth) / (1 - B.treeGrowFromHealth), 0, 1);
}

/** Could the tree use fed sugar? A grown tree with no honey fungus about (or a full mantle) takes nothing: the surplus stays where it is. */
export function feedUseful(state, tree) {
  return (tree.stage < 3 && growthFactor(tree) > 0) || (Boolean(state.flags.rival) && (tree.mantle ?? 0) < MANTLE_FULL);
}

/**
 * One step. `raw` is the sugar stock this step would reach before the cap clamps it (so what the clamp would have thrown away is
 * part of the surplus). Returns the sugar given to the tree, which the caller takes off the stock. Stops the feeding (with an event)
 * when the tree is lost or no longer linked.
 */
export function stepFeed(state, raw, dt) {
  const f = state.feed;
  if (!f) return 0;
  const why = feedDenial(state, f.treeId);
  if (why) {
    state.feed = null;
    state.events.push({ type: 'feed-stop', treeId: f.treeId, reason: why });
    return 0;
  }
  const tree = state.world.trees[f.treeId];
  const moved = feedUseful(state, tree) ? Math.min(B.feedRate * dt, Math.max(0, raw - feedThreshold(state))) : 0;
  if (moved > 0) nourish(state, tree, moved);
  f.rate += (moved / dt - f.rate) * Math.min(1, dt / RATE_TAU);
  return moved;
}

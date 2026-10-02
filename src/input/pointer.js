// Pointer input. Drag from a network node to grow a hypha (right click cancels the drag); in 'fruit'
// mode a click plants a mushroom, in 'trap' mode it grows a «ловчее кольцо» on the node, in 'barrier' mode it puts a barrier
// against the honey fungus on the node. Keeps state.ui.pointer / hoverNode / hoverTarget / trapPick / barrierPick / drag /
// preview current.
// Keyboard handling belongs to the UI (actions.cancelDrag, actions.setTool, ...).
import { targetAt } from '../world/query.js';
import { B } from '../sim/balance.js';

const MIN_POINT_SPACING = 6;
const MAX_DRAG_POINTS = 800;

export function attachInput(canvas, game) {
  const toWorld = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const v = game.view;
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale, sx, sy };
  };

  const cancelDrag = () => {
    const ui = game.state.ui;
    if (!ui.drag) return false;
    ui.drag = null;
    ui.preview = null;
    return true;
  };

  const updateHover = (state, p) => {
    const ui = state.ui;
    if (state.phase !== 'playing') {
      ui.hoverNode = null;
      ui.hoverTarget = null;
      ui.trapPick = null;
      ui.barrierPick = null;
      return;
    }
    ui.hoverNode = game.sim.pickNode(state, p.x, p.y);
    ui.hoverTarget = targetAt(state.world, state.mushrooms, p.x, p.y);
    ui.trapPick = null;
    ui.barrierPick = null;
    if (ui.tool === 'barrier' && game.sim.pickBarrierNode) {
      const id = game.sim.pickBarrierNode(state, p.x, p.y);
      if (id !== null) {
        const node = state.net.nodes[id];
        const reason = game.sim.barrierDenial(state, id);
        ui.barrierPick = { nodeId: id, x: node.x, y: node.y, r: B.barrierRadius, ok: reason === null, reason, cost: game.sim.barrierCost(state) };
      }
    }
    if (ui.tool === 'trap' && game.sim.pickTrapNode) {
      const id = game.sim.pickTrapNode(state, p.x, p.y);
      if (id !== null) {
        const node = state.net.nodes[id];
        const reason = game.sim.trapDenial(state, id);
        ui.trapPick = { nodeId: id, x: node.x, y: node.y, ok: reason === null, reason };
      }
    }
  };

  const onDown = (ev) => {
    const state = game.state;
    if (state.phase !== 'playing') return;
    if (ev.button === 2) {
      cancelDrag();
      return;
    }
    if (ev.button !== 0 || state.ui.drag) return;
    const p = toWorld(ev);
    if (state.ui.tool === 'fruit') {
      const node = game.sim.pickFruitNode(state, p.x, p.y);
      if (node !== null) game.sim.commandFruit(state, node);
      return;
    }
    if (state.ui.tool === 'trap') {
      const node = game.sim.pickTrapNode(state, p.x, p.y);
      if (node !== null) game.sim.commandTrap(state, node);
      return;
    }
    if (state.ui.tool === 'barrier') {
      const node = game.sim.pickBarrierNode(state, p.x, p.y);
      if (node !== null) game.sim.commandBarrier(state, node);
      return;
    }
    const node = game.sim.pickNode(state, p.x, p.y);
    if (node === null) return;
    canvas.setPointerCapture?.(ev.pointerId);
    state.ui.drag = { from: node, points: [] };
    state.ui.preview = null;
  };

  const onMove = (ev) => {
    const state = game.state;
    const p = toWorld(ev);
    state.ui.pointer = { ...p, inside: true };
    updateHover(state, p);
    const drag = state.ui.drag;
    if (!drag) return;
    if (state.phase !== 'playing' || (ev.buttons & 2) !== 0) {
      cancelDrag(); // right button pressed while dragging
      return;
    }
    const last = drag.points[drag.points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= MIN_POINT_SPACING) {
      if (drag.points.length < MAX_DRAG_POINTS) drag.points.push({ x: p.x, y: p.y });
      state.ui.preview = game.sim.estimateGrowth(state, drag.from, drag.points);
    }
  };

  const onUp = (ev) => {
    const state = game.state;
    const drag = state.ui.drag;
    if (!drag) return;
    if (ev.type === 'pointerup' && ev.button === 0 && state.phase === 'playing' && drag.points.length > 0) {
      game.sim.commandGrow(state, drag.from, drag.points);
    }
    cancelDrag();
  };

  const onLeave = () => {
    const state = game.state;
    if (state.ui.pointer) state.ui.pointer.inside = false;
    if (!state.ui.drag) state.ui.hoverTarget = null;
    state.ui.trapPick = null;
    state.ui.barrierPick = null;
  };

  const onContextMenu = (ev) => {
    ev.preventDefault();
    cancelDrag();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('contextmenu', onContextMenu);

  // A tool pick goes stale while the pointer rests: sugar comes in, a barrier ends, the tool is switched by key. The
  // frame loop calls refresh() so the ring and its tooltip follow (a few times a second is plenty).
  let refreshedAt = -Infinity;
  return {
    refresh(now) {
      const state = game.state;
      const ui = state.ui;
      if ((ui.tool !== 'barrier' && ui.tool !== 'trap') || !ui.pointer || !ui.pointer.inside || ui.drag) return;
      if (now - refreshedAt < 150) return;
      refreshedAt = now;
      updateHover(state, ui.pointer);
    },
    detach() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
  };
}

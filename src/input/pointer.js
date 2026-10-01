// Pointer input (basic version; the simulation task owns and extends it).
// Drag from a network node to grow a hypha; in 'fruit' mode click a node to plant a mushroom.

const MIN_POINT_SPACING = 6;

export function attachInput(canvas, game) {
  const toWorld = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const v = game.view;
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale, sx, sy };
  };

  const onDown = (ev) => {
    const state = game.state;
    if (state.phase !== 'playing' || ev.button !== 0) return;
    const p = toWorld(ev);
    const node = game.sim.pickNode(state, p.x, p.y);
    if (node === null) return;
    if (state.ui.tool === 'fruit') {
      game.sim.commandFruit(state, node);
      return;
    }
    canvas.setPointerCapture(ev.pointerId);
    state.ui.drag = { from: node, points: [] };
    state.ui.preview = null;
  };

  const onMove = (ev) => {
    const state = game.state;
    const p = toWorld(ev);
    state.ui.pointer = { ...p, inside: true };
    state.ui.hoverNode = state.phase === 'playing' ? game.sim.pickNode(state, p.x, p.y) : null;
    const drag = state.ui.drag;
    if (!drag) return;
    const last = drag.points[drag.points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= MIN_POINT_SPACING) {
      drag.points.push({ x: p.x, y: p.y });
      state.ui.preview = game.sim.estimateGrowth(state, drag.from, drag.points);
    }
  };

  const onUp = () => {
    const state = game.state;
    const drag = state.ui.drag;
    if (!drag) return;
    if (drag.points.length > 0) game.sim.commandGrow(state, drag.from, drag.points);
    state.ui.drag = null;
    state.ui.preview = null;
  };

  const onLeave = () => {
    if (game.state.ui.pointer) game.state.ui.pointer.inside = false;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  return {
    detach() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
    },
  };
}

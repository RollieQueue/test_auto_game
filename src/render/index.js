// STUB renderer: flat shapes so the skeleton is visible. The rendering task replaces this module
// (same exported API: createRenderer(canvas) -> { resize(view), draw(state, view, dt) }).

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  function resize(view) {
    canvas.width = Math.round(view.cssW * view.dpr);
    canvas.height = Math.round(view.cssH * view.dpr);
  }

  function polyline(pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  }

  function draw(state, view) {
    const { world, net } = state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2a211a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const s = view.scale * view.dpr;
    ctx.setTransform(s, 0, 0, s, view.ox * view.dpr, view.oy * view.dpr);

    ctx.fillStyle = '#efe4cc';
    ctx.fillRect(0, 0, world.width, world.height);
    for (const h of world.horizons) {
      ctx.beginPath();
      h.top.forEach((y, k) => (k ? ctx.lineTo(k * world.step, y) : ctx.moveTo(0, y)));
      ctx.lineTo(world.width, world.height);
      ctx.lineTo(0, world.height);
      ctx.closePath();
      ctx.fillStyle = h.color;
      ctx.fill();
    }
    ctx.fillStyle = '#8a8178';
    for (const r of world.rocks) {
      polyline(r.poly);
      ctx.closePath();
      ctx.fill();
    }
    for (const w of world.water) {
      ctx.beginPath();
      ctx.ellipse(w.x, w.y, w.rx, w.ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#5c9fb8';
      ctx.fill();
    }
    for (const m of world.minerals) {
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fillStyle = m.kind === 'phosphorus' ? '#8d6bb3' : '#9caa5a';
      ctx.fill();
    }
    for (const t of world.trees) {
      ctx.strokeStyle = '#2b1d14';
      for (const r of t.roots) {
        if (r.minStage > t.stage) continue;
        ctx.lineWidth = r.width * 0.6;
        polyline(r.points);
        ctx.stroke();
      }
      const h = 120 + t.stage * 70;
      ctx.fillStyle = '#4a3324';
      ctx.fillRect(t.x - 6 - t.stage * 2, t.baseY - h, 12 + t.stage * 4, h);
      ctx.beginPath();
      ctx.arc(t.x, t.baseY - h, 40 + t.stage * 22, 0, Math.PI * 2);
      ctx.fillStyle = '#6f8a4a';
      ctx.fill();
    }
    ctx.strokeStyle = '#fff6dc';
    ctx.lineWidth = 1.6;
    for (const e of net.edges) {
      if (!e.alive) continue;
      const a = net.nodes[e.a];
      const b = net.nodes[e.b];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    const p = state.ui.preview;
    if (p && p.points.length > 1) {
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = p.affordable ? '#fff6dc' : '#c0392b';
      polyline(p.points);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  return { resize, draw };
}

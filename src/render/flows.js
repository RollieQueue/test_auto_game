// Flows: little glowing beads running along the hyphae. Water blue, minerals violet (phosphorus) or olive (nitrogen),
// sugar amber. Each flow keeps only a phase; positions are walked along the node path every frame.
import { makeCanvas, rgba } from './ink.js';

const KINDS = {
  water: { halo: '#4aa8f0', core: '#d6f0ff' },
  sugar: { halo: '#ffa22a', core: '#fff0bd' },
  mineral: { halo: '#a46bff', core: '#efe2ff' },
  nitrogen: { halo: '#b4ca34', core: '#f4fbb8' },
};

const beadCache = new Map();
function bead(kind) {
  let c = beadCache.get(kind);
  if (!c) {
    const k = KINDS[kind] || KINDS.sugar;
    const s = 48;
    c = { halo: makeCanvas(s, s), core: makeCanvas(16, 16) };
    let g = c.halo.getContext('2d');
    let gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, rgba(k.halo, 0.85));
    gr.addColorStop(0.3, rgba(k.halo, 0.4));
    gr.addColorStop(1, rgba(k.halo, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    g = c.core.getContext('2d');
    gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    gr.addColorStop(0, rgba(k.core, 1));
    gr.addColorStop(0.45, rgba(k.core, 0.96));
    gr.addColorStop(0.7, rgba(k.halo, 0.9));
    gr.addColorStop(1, rgba(k.halo, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 16, 16);
    beadCache.set(kind, c);
  }
  return c;
}

export function createFlows() {
  const flows = new Map();
  let frame = 0;
  let netRef = null;

  function geometry(st, net, ids) {
    const n = ids.length;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const cum = new Float32Array(n);
    let m = 0;
    for (let i = 0; i < n; i++) {
      const nd = net.nodes[ids[i]];
      if (!nd) continue;
      xs[m] = nd.x;
      ys[m] = nd.y;
      cum[m] = m ? cum[m - 1] + Math.hypot(nd.x - xs[m - 1], nd.y - ys[m - 1]) : 0;
      m++;
    }
    st.xs = xs;
    st.ys = ys;
    st.cum = cum;
    st.n = m;
    st.len = m ? cum[m - 1] : 0;
  }

  return {
    setScale() {},
    reset() {
      flows.clear();
    },
    draw(ctx, state, t, dt) {
      const net = state.net;
      if (!net || !state.flows || !state.flows.length) return;
      if (net !== netRef) {
        netRef = net;
        flows.clear();
      }
      frame++;
      const version = net.version ?? net.nodes.length;
      const adv = state.phase === 'paused' ? 0 : dt * (state.speed || 1);
      ctx.save();
      for (const f of state.flows) {
        if (!f || !(f.rate > 0)) continue;
        const key = `${f.kind}:${f.from}>${f.to}`;
        let st = flows.get(key);
        if (!st) {
          st = { off: Math.random() * 60, ver: -1, ids: null, n: 0, len: 0 };
          flows.set(key, st);
        }
        st.seen = frame;
        const ids = f.path && f.path.length >= 2 ? f.path : [f.from, f.to];
        if (st.ver !== version || st.ids !== ids) {
          st.ver = version;
          st.ids = ids;
          geometry(st, net, ids);
        }
        if (st.n < 2 || st.len < 4) continue;
        const rate = Math.max(0.05, f.rate);
        const spacing = Math.max(26, Math.min(120, 120 / (1 + 1.1 * Math.sqrt(rate))));
        const speed = 34 + 16 * Math.sqrt(rate);
        st.off = (st.off + speed * adv) % spacing;
        let kind = f.kind;
        if (kind === 'mineral') {
          const lk = net.links?.find((l) => l.kind === 'mineral' && (l.nodeId === f.from || l.nodeId === f.to));
          if (lk && state.world.minerals?.[lk.targetId]?.kind === 'nitrogen') kind = 'nitrogen';
        }
        const b = bead(kind);
        // walk the polyline once; draw halo pass then core pass
        for (let pass = 0; pass < 2; pass++) {
          ctx.globalCompositeOperation = pass === 0 ? 'lighter' : 'source-over';
          let seg = 1;
          let k = 0;
          for (let s = st.off; s < st.len; s += spacing, k++) {
            while (seg < st.n - 1 && st.cum[seg] < s) seg++;
            const c0 = st.cum[seg - 1];
            const c1 = st.cum[seg];
            const u = c1 > c0 ? (s - c0) / (c1 - c0) : 0;
            const x = st.xs[seg - 1] + (st.xs[seg] - st.xs[seg - 1]) * u;
            const y = st.ys[seg - 1] + (st.ys[seg] - st.ys[seg - 1]) * u;
            const sz = 0.85 + 0.3 * ((k * 7 + (f.from | 0)) % 5) / 4;
            // fade at the very ends of the path so beads appear and vanish softly
            const edge = Math.min(1, s / 24, (st.len - s) / 24);
            if (edge <= 0) continue;
            if (pass === 0) {
              ctx.globalAlpha = 0.7 * edge;
              const r = 12 * sz;
              ctx.drawImage(b.halo, x - r, y - r, r * 2, r * 2);
            } else {
              ctx.globalAlpha = edge;
              const r = 3.4 * sz;
              ctx.drawImage(b.core, x - r, y - r, r * 2, r * 2);
              // short comet tail behind the bead
              for (let tail = 1; tail <= 2; tail++) {
                const ts = s - tail * 5.5;
                if (ts <= 0) break;
                let sg = seg;
                while (sg > 1 && st.cum[sg - 1] > ts) sg--;
                const d0 = st.cum[sg - 1];
                const d1 = st.cum[sg];
                const uu = d1 > d0 ? (ts - d0) / (d1 - d0) : 0;
                ctx.globalAlpha = edge * (0.5 - tail * 0.18);
                const rr = r * (1 - tail * 0.28);
                ctx.drawImage(b.core, st.xs[sg - 1] + (st.xs[sg] - st.xs[sg - 1]) * uu - rr, st.ys[sg - 1] + (st.ys[sg] - st.ys[sg - 1]) * uu - rr, rr * 2, rr * 2);
              }
            }
          }
        }
      }
      ctx.restore();
      for (const [key, st] of flows) if (st.seen !== frame) flows.delete(key);
    },
  };
}

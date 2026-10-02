// Flows: little glowing beads running along the hyphae. Water blue, minerals violet (phosphorus) or olive (nitrogen),
// sugar amber; fed sugar («Подкормка», kind 'feed') is a slower, larger, yellower-gold pulse over a faint glowing thread. Each flow keeps only a phase; positions are walked along the node path every frame.
import { makeCanvas, rgba } from './ink.js';

const KINDS = {
  water: { halo: '#4aa8f0', core: '#d6f0ff' },
  sugar: { halo: '#ffa22a', core: '#fff0bd' },
  mineral: { halo: '#a46bff', core: '#efe2ff' },
  nitrogen: { halo: '#b4ca34', core: '#f4fbb8' },
  feed: { halo: '#ffd23a', core: '#fffbe2' }, // yellower than the sugar's amber, and drawn bigger and slower (see below)
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

/** The fed-sugar flow: a faint golden glow along the whole path and big soft drops drifting slowly, breathing in size. */
function drawFeed(ctx, st, f, adv, night, t) {
  const k = KINDS.feed;
  const spacing = 64;
  const speed = 22 + 6 * Math.sqrt(Math.max(0.05, f.rate));
  st.off = (st.off + speed * adv) % spacing;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(st.xs[0], st.ys[0]);
  for (let i = 1; i < st.n; i++) ctx.lineTo(st.xs[i], st.ys[i]);
  ctx.globalAlpha = 0.2 + 0.05 * night;
  ctx.strokeStyle = rgba(k.halo, 1);
  ctx.lineWidth = 13;
  ctx.stroke();
  // a thin warm-gold thread over the glow: it stays gold where many bright sugar beads cross the same hyphae
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#e8a41c';
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  const b = bead('feed');
  let seg = 1;
  for (let s = st.off; s < st.len; s += spacing) {
    while (seg < st.n - 1 && st.cum[seg] < s) seg++;
    const c0 = st.cum[seg - 1];
    const c1 = st.cum[seg];
    const u = c1 > c0 ? (s - c0) / (c1 - c0) : 0;
    const x = st.xs[seg - 1] + (st.xs[seg] - st.xs[seg - 1]) * u;
    const y = st.ys[seg - 1] + (st.ys[seg] - st.ys[seg - 1]) * u;
    const edge = Math.min(1, s / 30, (st.len - s) / 30);
    if (edge <= 0) continue;
    const breath = 1 + 0.16 * Math.sin(t * 2.1 - s * 0.045);
    const r = 17 * breath * (1 + 0.25 * night);
    ctx.globalAlpha = Math.min(1, 0.8 * edge);
    ctx.drawImage(b.halo, x - r, y - r, r * 2, r * 2);
    const rc = 5.4 * breath;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = edge;
    ctx.drawImage(b.core, x - rc, y - rc, rc * 2, rc * 2);
    ctx.globalCompositeOperation = 'lighter';
  }
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
    draw(ctx, state, t, dt, fr) {
      const night = fr?.atmos?.night || 0; // brighter beads in the dark
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
        if (f.kind === 'feed') {
          drawFeed(ctx, st, f, adv, night, t);
          continue;
        }
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
              ctx.globalAlpha = Math.min(1, (0.7 + 0.3 * night) * edge);
              const r = 12 * sz * (1 + 0.3 * night);
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

// Atmosphere (S2, only with state.flags.seasons): the time of day, the weather and the snow cover as live washes over
// the cached plate. Everything is a handful of fills of cached world-space paths plus small particle pools: no pixel
// filters, no blur, no per-frame path building beyond a few hundred points.
//   drawSky   after the plate: sky wash (dawn rose-gold, dusk amber, night indigo, overcast, drought), stars, moon,
//             sun, heat haze, snow cover on the ground line
//   drawSoil  after roots and water pockets, before the glowing mycelium: soil darkens at night, wet or dry topsoil
//   drawOver  after trees and mushrooms: the same night/twilight/weather tint over the sky, crowns and caps, then rain,
//             splashes, snowfall and the wash sweep of a new season
// `night` (0..1) is published for the glow of the mycelium and the flows.
import { glowSprite, makeSprite, mulberry, noise1, rgb, seedOf, smooth01, subSeed } from './ink.js';
import { sampleProfile } from '../world/query.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const TAU = Math.PI * 2;

// Multiply tints (what the paper shows through): night, the warm light of dawn and dusk, grey rain light, ...
const NIGHT_MUL = [128, 140, 190];
const SKY_NIGHT_TOP = '#2b3777';
const SKY_NIGHT_LOW = '#5f6fb0';
const ROSE = {
  top: '#fbf3f4', mid: '#f9dccb', low: '#ffd9a0', mul: [255, 214, 192],
  glow: [[0, 'rgba(250,170,170,0)'], [0.4, 'rgba(250,160,170,0.2)'], [0.72, 'rgba(255,170,140,0.5)'], [1, 'rgba(255,205,125,0.9)']],
};
const AMBER = {
  top: '#faf1ea', mid: '#f6c9a0', low: '#fbac60', mul: [255, 206, 154],
  glow: [[0, 'rgba(235,120,110,0)'], [0.4, 'rgba(235,120,110,0.22)'], [0.72, 'rgba(255,140,80,0.52)'], [1, 'rgba(255,150,55,0.9)']],
};
const RAIN_MUL = [186, 196, 210];
const SNOW_MUL = [208, 218, 234];
const DROUGHT_MUL = [255, 236, 178];
// Light of the season (multiply, gentle): autumn gold, winter blue-grey; spring and summer stay paper-neutral
const GRADE = { autumn: [248, 224, 184], winter: [214, 224, 238] };
const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_SWEEP = { spring: '#bfe39a', summer: '#f6d77a', autumn: '#e0944a', winter: '#c4d6ec' };

/** Product of tints: [[rgb, strength 0..1], ...] -> 'rgb(r,g,b)' */
function composeMul(list) {
  let r = 1;
  let g = 1;
  let b = 1;
  for (const [c, s] of list) {
    if (s <= 0.002) continue;
    r *= 1 - s + (s * c[0]) / 255;
    g *= 1 - s + (s * c[1]) / 255;
    b *= 1 - s + (s * c[2]) / 255;
  }
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

export function createAtmosphere() {
  let px = 1;
  let view = null;
  let world = null;
  let ext = null;
  let built = null; // cached paths, gradients and layouts; rebuilt on a new world or view
  let sprites = null; // moon, sun, flakes (device resolution)
  const api = { night: 0, snowCover: 0, on: false };

  // smoothed weather intensities, snow cover, one-shot cues
  const wx = { rain: 0, drought: 0, snow: 0, cover: -1 };
  let sweep = null; // { t0, color }
  let frameT = null;
  const st = { night: 0, twi: 0, warm: ROSE, dayFrac: 0, daylight: 1, season: 'spring', seasonFrac: 0, clock: null, mulB: '', mulA: '' };

  // particle pools
  const RAIN_N = 190;
  const SNOW_N = 130;
  const rain = { x: new Float32Array(RAIN_N), y: new Float32Array(RAIN_N), len: new Float32Array(RAIN_N), v: new Float32Array(RAIN_N) };
  const flake = { x: new Float32Array(SNOW_N), y: new Float32Array(SNOW_N), v: new Float32Array(SNOW_N), ph: new Float32Array(SNOW_N), k: new Uint8Array(SNOW_N) };
  const splash = { x: new Float32Array(16), y: new Float32Array(16), t: new Float32Array(16).fill(-1) };
  let splashAcc = 0;
  let particlesReady = false;

  const groundAt = (x) => sampleProfile(world.ground, world.step, x);

  /* ---------------------------------------------------------------- caches */

  function build(ctx) {
    const W = ext.x1 - ext.x0;
    const step = 8;
    const xs = [];
    for (let x = Math.floor((ext.x0 - 20) / step) * step; x <= ext.x1 + 20 + step; x += step) xs.push(x);
    const gy = xs.map((x) => groundAt(x));
    const gm = Math.min(...world.ground);
    const region = (dyTop, dyBot, topY = ext.y0 - 20) => {
      // area between two lines relative to the ground (or the sky edge when dyTop is null)
      const p = new Path2D();
      if (dyTop === null) p.moveTo(xs[0], topY);
      else p.moveTo(xs[0], gy[0] + dyTop);
      for (let i = 0; i < xs.length; i++) p.lineTo(xs[i], dyTop === null ? topY : gy[i] + dyTop);
      if (dyTop === null) {
        for (let i = xs.length - 1; i >= 0; i--) p.lineTo(xs[i], gy[i] + dyBot);
      } else {
        for (let i = xs.length - 1; i >= 0; i--) p.lineTo(xs[i], gy[i] + dyBot);
      }
      p.closePath();
      return p;
    };
    const so = seedOf(world.seed);
    const rng = mulberry(subSeed(world.seed, 'atmosphere'));

    const lin = (stops, y0 = ext.y0, y1 = gm + 6) => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      for (const [o, c] of stops) g.addColorStop(o, c);
      return g;
    };
    const warmGrad = (c) => lin([[0, c.top], [0.55, c.mid], [1, c.low]]);

    // stars: fixed in the sky, kept clear of the tree-line
    const stars = [];
    const skyH = Math.max(40, gm - 90 - ext.y0);
    for (let i = 0; i < 110; i++) {
      const big = i < 18;
      stars.push({
        x: ext.x0 + rng() * W,
        y: ext.y0 + 6 + Math.pow(rng(), 0.8) * skyH,
        r: big ? 1.3 + rng() * 0.9 : 0.6 + rng() * 0.6,
        big,
        ph: rng() * TAU,
        b: i % 3,
      });
    }

    // thin cracks in the dry topsoil: each shows from its own drought threshold
    const cracks = [];
    for (let x = ext.x0; x < ext.x1; x += 14 + rng() * 26) {
      const pts = [];
      let cx = x;
      let cy = groundAt(x) + 0.6;
      const depth = 9 + rng() * 26;
      const y0 = cy;
      pts.push(cx, cy);
      while (cy < y0 + depth) {
        cy += 3.5 + rng() * 4.5;
        cx += (rng() - 0.5) * 6;
        pts.push(cx, cy);
      }
      const branch = [];
      if (rng() < 0.55 && pts.length > 6) {
        const k = 2 + Math.floor(rng() * (pts.length / 2 - 3));
        let bx = pts[k * 2];
        let by = pts[k * 2 + 1];
        const dir = rng() < 0.5 ? -1 : 1;
        branch.push(bx, by);
        for (let j = 0; j < 2 + Math.floor(rng() * 3); j++) {
          bx += dir * (3 + rng() * 5);
          by += 1 + rng() * 4;
          branch.push(bx, by);
        }
      }
      cracks.push({ th: rng() * 0.8, pts, branch, w: 0.7 + rng() * 0.6 });
    }

    // snow cover profile: lumps along the ground line
    const lump = xs.map((x) => 0.5 + 0.5 * noise1(x * 0.021 + so) * 0.8 + 0.5 * noise1(x * 0.07 + so + 9) * 0.25);

    built = {
      xs,
      gy,
      gm,
      lump,
      stars,
      cracks,
      sky: region(null, 0),
      above: region(null, 8),
      below: region(8, 4000),
      wet: [region(0, 10), region(0, 22), region(0, 38)],
      dry: region(0, 16),
      grads: {
        night: lin([[0, SKY_NIGHT_TOP], [1, SKY_NIGHT_LOW]]),
        rose: warmGrad(ROSE),
        amber: warmGrad(AMBER),
        roseGlow: lin(ROSE.glow),
        amberGlow: lin(AMBER.glow),
        rain: lin([[0, '#8e9aaa'], [1, '#c6ced4']]),
        snow: lin([[0, '#aebccf'], [1, '#d4dde8']]),
        drought: lin([[0, '#fdf6dc'], [1, '#f6e4ac']]),
      },
    };
    particlesReady = false;
  }

  function buildSprites() {
    sprites = {};
    // the moon: a fat crescent cut out of a pale disc, the unlit rim hinted in ink
    {
      const R = 19;
      const pad = 34;
      const sp = makeSprite(R * 2 + pad * 2, R * 2 + pad * 2, px, R + pad, R + pad);
      const g = sp.ctx;
      const halo = g.createRadialGradient(0, 0, R * 0.8, 0, 0, R + pad);
      halo.addColorStop(0, 'rgba(226,232,255,0.38)');
      halo.addColorStop(1, 'rgba(226,232,255,0)');
      g.fillStyle = halo;
      g.fillRect(-R - pad, -R - pad, 2 * (R + pad), 2 * (R + pad));
      g.beginPath();
      g.arc(0, 0, R, 0, TAU);
      g.strokeStyle = 'rgba(214,222,250,0.4)';
      g.lineWidth = 0.55;
      g.stroke();
      const lit = document.createElement('canvas');
      lit.width = sp.cw;
      lit.height = sp.ch;
      const lg = lit.getContext('2d');
      lg.setTransform(px, 0, 0, px, (R + pad) * px, (R + pad) * px);
      lg.beginPath();
      lg.arc(0, 0, R, 0, TAU);
      const body = lg.createRadialGradient(-4, -4, 2, 0, 0, R);
      body.addColorStop(0, '#fbf6e2');
      body.addColorStop(1, '#e6dcb8');
      lg.fillStyle = body;
      lg.fill();
      // craters
      const r = mulberry(77);
      lg.fillStyle = 'rgba(176,166,132,0.45)';
      for (let i = 0; i < 9; i++) {
        const a = r() * TAU;
        const d = Math.sqrt(r()) * R * 0.78;
        lg.beginPath();
        lg.ellipse(Math.cos(a) * d, Math.sin(a) * d, 1 + r() * 2.6, 0.8 + r() * 2, r() * 3, 0, TAU);
        lg.fill();
      }
      lg.globalCompositeOperation = 'destination-out';
      lg.beginPath();
      lg.arc(10.5, -3, R * 0.93, 0, TAU);
      lg.fill();
      lg.globalCompositeOperation = 'source-over';
      lg.beginPath();
      lg.arc(0, 0, R, Math.PI * 0.62, Math.PI * 1.55);
      lg.strokeStyle = 'rgba(70,64,60,0.55)';
      lg.lineWidth = 0.7;
      lg.stroke();
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(lit, 0, 0);
      g.restore();
      sprites.moon = sp;
    }
    // the sun: a pale wash disc with fine engraved rays
    {
      const R = 13;
      const pad = 34;
      const sp = makeSprite(R * 2 + pad * 2, R * 2 + pad * 2, px, R + pad, R + pad);
      const g = sp.ctx;
      const halo = g.createRadialGradient(0, 0, R * 0.5, 0, 0, R + pad);
      halo.addColorStop(0, 'rgba(255,226,150,0.5)');
      halo.addColorStop(1, 'rgba(255,226,150,0)');
      g.fillStyle = halo;
      g.fillRect(-R - pad, -R - pad, 2 * (R + pad), 2 * (R + pad));
      g.strokeStyle = 'rgba(120,80,30,0.55)';
      g.lineWidth = 0.55;
      g.lineCap = 'round';
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * TAU + 0.05;
        const l0 = R + 2.5;
        const l1 = R + (i % 2 ? 8 : 15) + (i % 4 === 0 ? 4 : 0);
        g.beginPath();
        g.moveTo(Math.cos(a) * l0, Math.sin(a) * l0);
        g.lineTo(Math.cos(a) * l1, Math.sin(a) * l1);
        g.stroke();
      }
      const body = g.createRadialGradient(-3, -3, 1, 0, 0, R);
      body.addColorStop(0, '#fff0b8');
      body.addColorStop(1, '#f2c45e');
      g.beginPath();
      g.arc(0, 0, R, 0, TAU);
      g.fillStyle = body;
      g.fill();
      g.strokeStyle = 'rgba(110,70,26,0.6)';
      g.lineWidth = 0.7;
      g.stroke();
      sprites.sun = sp;
    }
    // snowflakes: white wash dots with a faint blue ink rim; a few as six-rayed stars
    sprites.flakes = [0, 1, 2].map((k) => {
      const R = [2.1, 2.9, 4.2][k];
      const sp = makeSprite(R * 2 + 4, R * 2 + 4, px, R + 2, R + 2);
      const g = sp.ctx;
      if (k === 2) {
        g.strokeStyle = 'rgba(244,248,255,0.95)';
        g.lineWidth = 0.75;
        g.lineCap = 'round';
        g.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI;
          g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
          g.lineTo(-Math.cos(a) * R, -Math.sin(a) * R);
        }
        g.stroke();
        g.strokeStyle = 'rgba(110,128,150,0.5)';
        g.lineWidth = 0.3;
        g.stroke();
      } else {
        g.beginPath();
        g.arc(0, 0, R, 0, TAU);
        g.fillStyle = 'rgba(250,252,255,0.96)';
        g.fill();
        g.strokeStyle = 'rgba(110,128,150,0.55)';
        g.lineWidth = 0.4;
        g.stroke();
      }
      return sp;
    });
  }

  function seedParticles() {
    particlesReady = true;
    const W = ext.x1 - ext.x0;
    const H = Math.max(80, built.gm - ext.y0);
    for (let i = 0; i < RAIN_N; i++) {
      rain.x[i] = ext.x0 - 40 + Math.random() * (W + 80);
      rain.y[i] = ext.y0 + Math.random() * H;
      rain.len[i] = 9 + Math.random() * 10;
      rain.v[i] = 430 + Math.random() * 150;
    }
    for (let i = 0; i < SNOW_N; i++) {
      flake.x[i] = ext.x0 - 30 + Math.random() * (W + 60);
      flake.y[i] = ext.y0 + Math.random() * H;
      flake.v[i] = 20 + Math.random() * 26;
      flake.ph[i] = Math.random() * TAU;
      flake.k[i] = Math.random() < 0.18 ? 2 : Math.random() < 0.5 ? 1 : 0;
    }
  }

  /* ---------------------------------------------------------------- per-frame state */

  function update(state, t, dt) {
    if (frameT === t) return;
    frameT = t;
    const force = typeof window !== 'undefined' ? window.__atmosForce : null;
    const on = !!(state.flags && state.flags.seasons && state.clock);
    api.on = on;
    if (!on) {
      api.night = 0;
      api.snowCover = 0;
      st.mulA = st.mulB = '';
      return;
    }
    const clock = force && force.clock ? { ...state.clock, ...force.clock } : state.clock;
    const weather = force && force.weather ? force.weather : state.weather || { kind: 'clear', intensity: 0 };
    st.clock = clock;
    st.dayFrac = clock.dayFrac;
    st.daylight = clock.daylight;
    st.season = clock.season;
    st.seasonFrac = clock.seasonFrac;
    const night = clamp(1 - clock.daylight, 0, 1);
    st.night = night;
    st.twi = 4 * clock.daylight * (1 - clock.daylight);
    st.warm = clock.dayFrac < 0.5 ? ROSE : AMBER;
    api.night = night;
    // season grading: the current season at full strength, the previous one dissolving over its first 15 %
    const prevName = SEASON_ORDER[(SEASON_ORDER.indexOf(clock.season) + 3) % 4];
    const fadeIn = smooth01(clock.seasonFrac / 0.15);
    st.gradeCur = GRADE[clock.season] ? [GRADE[clock.season], fadeIn] : null;
    st.gradePrev = GRADE[prevName] && fadeIn < 1 && !(clock.season === "spring" && !clock.year) ? [GRADE[prevName], 1 - fadeIn] : null;

    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 1.8);
    const kind = weather.kind;
    const inten = clamp(weather.intensity || 0, 0, 1);
    wx.rain += ((kind === 'rain' ? inten : 0) - wx.rain) * k;
    wx.drought += ((kind === 'drought' ? inten : 0) - wx.drought) * k;
    wx.snow += ((kind === 'snow' ? inten : 0) - wx.snow) * k;
    if (force && force.weather) {
      wx.rain = kind === 'rain' ? inten : 0;
      wx.drought = kind === 'drought' ? inten : 0;
      wx.snow = kind === 'snow' ? inten : 0;
    }

    // snow cover builds up in winter (faster while it snows) and melts away in early spring
    let target = 0;
    if (clock.season === 'winter') target = Math.min(1, 0.3 + 0.55 * clock.seasonFrac + 0.25 * wx.snow);
    else if (clock.season === 'spring' && clock.year > 0 && clock.seasonFrac < 0.3) target = 0.7 * (1 - clock.seasonFrac / 0.3);
    if (force && force.cover !== undefined) target = force.cover;
    if (wx.cover < 0 || (force && force.cover !== undefined)) wx.cover = target;
    else wx.cover += (target - wx.cover) * (1 - Math.exp(-Math.min(dt, 0.1) / (target > wx.cover ? 7 : 12)));
    api.snowCover = wx.cover;

    const nightK = Math.pow(night, 1.25) * 0.9;
    const wet = wx.rain;
    st.mulB = composeMul([
      [NIGHT_MUL, nightK],
      [st.warm.mul, st.twi * 0.5],
      [RAIN_MUL, wet * 0.62],
      [SNOW_MUL, wx.snow * 0.5],
      [DROUGHT_MUL, wx.drought * 0.55],
      st.gradeCur ? [st.gradeCur[0], st.gradeCur[1] * 0.5] : [NIGHT_MUL, 0],
      st.gradePrev ? [st.gradePrev[0], st.gradePrev[1] * 0.5] : [NIGHT_MUL, 0],
    ]);
    st.mulA = composeMul([[NIGHT_MUL, nightK * 0.85]]);
  }

  /* ---------------------------------------------------------------- drawing */

  function ensure(ctx, state) {
    if (!view || !world) return false;
    if (!ext) return false;
    if (!built) build(ctx);
    if (!sprites) buildSprites();
    return true;
  }

  function celestial(ctx, t) {
    const gm = built.gm;
    const top = ext.y0 + 0.17 * (gm - ext.y0);
    const horizonY = gm - 120;
    const W = ext.x1 - ext.x0;
    const cloud = 1 - 0.9 * Math.max(wx.rain, wx.snow);
    // stars
    const starA = smooth01((st.night - 0.35) / 0.5) * cloud;
    if (starA > 0.02) {
      ctx.save();
      ctx.fillStyle = '#fff4d4';
      for (let b = 0; b < 3; b++) {
        ctx.globalAlpha = starA * (0.62 + 0.38 * Math.sin(t * (0.9 + b * 0.4) + b * 2.1));
        ctx.beginPath();
        for (const s of built.stars) {
          if (s.b !== b || s.big) continue;
          ctx.moveTo(s.x + s.r, s.y);
          ctx.arc(s.x, s.y, s.r, 0, TAU);
        }
        ctx.fill();
      }
      ctx.globalAlpha = starA * 0.9;
      ctx.strokeStyle = '#fff4d4';
      ctx.lineWidth = 0.55;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const s of built.stars) {
        if (!s.big) continue;
        const L = s.r * 3.2 * (0.8 + 0.2 * Math.sin(t * 1.2 + s.ph));
        ctx.moveTo(s.x - L, s.y);
        ctx.lineTo(s.x + L, s.y);
        ctx.moveTo(s.x, s.y - L);
        ctx.lineTo(s.x, s.y + L);
        const d = L * 0.45;
        ctx.moveTo(s.x - d, s.y - d);
        ctx.lineTo(s.x + d, s.y + d);
        ctx.moveTo(s.x - d, s.y + d);
        ctx.lineTo(s.x + d, s.y - d);
      }
      ctx.stroke();
      ctx.restore();
    }
    // moon: rises at dusk, highest at midnight, sets at dawn
    const um = (((st.dayFrac - 0.7) % 1) + 1) % 1 / 0.6;
    const moonA = um <= 1 ? smooth01((st.night - 0.15) / 0.4) * cloud : 0;
    if (moonA > 0.02 && sprites.moon) {
      const sp = sprites.moon;
      const x = ext.x0 + W * (0.14 + 0.72 * um);
      const y = lerp(horizonY, top, Math.pow(Math.sin(Math.PI * um), 0.8));
      ctx.save();
      ctx.globalAlpha = moonA;
      ctx.drawImage(sp.canvas, x - sp.ax, y - sp.ay, sp.w, sp.h);
      ctx.restore();
    }
    // sun: a pale engraved disc, stronger at the horizon than at noon
    const us = (st.dayFrac - 0.2) / 0.6;
    if (us > 0 && us < 1 && sprites.sun) {
      const a = smooth01((st.daylight - 0.08) / 0.3) * (0.42 + 0.5 * st.twi) * (1 - 0.92 * Math.max(wx.rain, wx.snow)) * (1 - 0.5 * wx.drought);
      if (a > 0.02) {
        const sp = sprites.sun;
        const x = ext.x0 + W * (0.1 + 0.8 * us);
        const y = lerp(horizonY + 20, top + 8, Math.pow(Math.sin(Math.PI * us), 0.85));
        ctx.save();
        ctx.globalAlpha = a;
        ctx.drawImage(sp.canvas, x - sp.ax, y - sp.ay, sp.w, sp.h);
        ctx.restore();
      }
    }
  }

  function snowCover(ctx) {
    const c = wx.cover;
    if (c < 0.02) return;
    const { xs, gy, lump } = built;
    const A = 15;
    const n = xs.length;
    const hts = new Array(n);
    for (let i = 0; i < n; i++) hts[i] = A * smooth01(c * 1.35 - (1 - lump[i])) * (0.55 + 0.45 * c);
    // body: a white mantle riding on the ground line
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(xs[0], gy[0] + 2.5);
    for (let i = 0; i < n; i++) ctx.lineTo(xs[i], gy[i] - hts[i]);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(xs[i], gy[i] + 2.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(250,251,250,0.97)';
    ctx.fill();
    // the shaded foot of the drift: pale blue wash along the ground line
    ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(xs[i], gy[i] - hts[i] * 0.42);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(xs[i], gy[i] + 2.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(160,178,204,0.55)';
    ctx.fill();
    // a few short hatching strokes in the shadow of the drift
    ctx.beginPath();
    for (let i = 1; i < n; i += 2) {
      if (hts[i] < 2.5) continue;
      const x = xs[i] + lump[i] * 4;
      ctx.moveTo(x, gy[i] - hts[i] * 0.4);
      ctx.lineTo(x - 2.6, gy[i] + 1.4);
    }
    ctx.strokeStyle = 'rgba(86,104,134,0.4)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    // a broken pen line over the top of the drift
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (hts[i] < 0.6) continue;
      if (i === 0 || hts[i - 1] < 0.6) ctx.moveTo(xs[i], gy[i] - hts[i]);
      else ctx.lineTo(xs[i], gy[i] - hts[i]);
    }
    ctx.strokeStyle = 'rgba(86,104,134,0.62)';
    ctx.lineWidth = 0.9;
    ctx.lineJoin = 'round';
    ctx.setLineDash([22, 4, 11, 3]);
    ctx.stroke();
    ctx.restore();
  }

  function heatHaze(ctx, t) {
    const d = wx.drought;
    if (d < 0.05) return;
    const { xs, gy } = built;
    ctx.save();
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      const up = 12 + k * 15;
      for (let i = 0; i < xs.length; i += 2) {
        const y = gy[i] - up + Math.sin(xs[i] * 0.045 + t * (1.4 + k * 0.3) + k * 1.7) * (1.6 + k * 0.5);
        if (i === 0) ctx.moveTo(xs[i], y);
        else ctx.lineTo(xs[i], y);
      }
      ctx.strokeStyle = `rgba(255,236,170,${(0.34 * d) / (1 + k * 0.45)})`;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSky(ctx, state, t, dt) {
    update(state, t, dt);
    if (!api.on || !ensure(ctx, state)) return;
    const g = built.grads;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    // night indigo, dawn / dusk glow, overcast, drought yellow
    if (st.night > 0.02) {
      ctx.globalAlpha = Math.pow(st.night, 1.3) * 0.97;
      ctx.fillStyle = g.night;
      ctx.fill(built.sky);
    }
    if (st.twi > 0.02) {
      const rose = st.warm === ROSE;
      ctx.globalAlpha = st.twi * 0.6;
      ctx.fillStyle = rose ? g.rose : g.amber;
      ctx.fill(built.sky);
      // the light itself: a luminous band along the horizon (source-over, so it can be brighter than the paper)
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = st.twi * 0.9;
      ctx.fillStyle = rose ? g.roseGlow : g.amberGlow;
      ctx.fill(built.sky);
      ctx.globalCompositeOperation = 'multiply';
    }
    if (wx.rain > 0.02) {
      ctx.globalAlpha = wx.rain * 0.85;
      ctx.fillStyle = g.rain;
      ctx.fill(built.sky);
    }
    if (wx.snow > 0.02) {
      ctx.globalAlpha = wx.snow * 0.8;
      ctx.fillStyle = g.snow;
      ctx.fill(built.sky);
    }
    if (wx.drought > 0.02) {
      ctx.globalAlpha = wx.drought * 0.8;
      ctx.fillStyle = g.drought;
      ctx.fill(built.sky);
    }
    ctx.restore();
    ctx.save();
    celestial(ctx, t);
    heatHaze(ctx, t);
    snowCover(ctx);
    ctx.restore();
  }

  function drawSoil(ctx, state, t, dt) {
    if (!api.on || !built) return;
    ctx.save();
    // the soil darkens at night (the mycelium drawn next stays bright)
    if (st.night > 0.02) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = st.mulA;
      ctx.fill(built.below);
    }
    // wet topsoil: three layered washes, darker toward the surface
    if (wx.rain > 0.03) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgb(168,152,146)';
      for (let k = 0; k < 3; k++) {
        ctx.globalAlpha = wx.rain * 0.2;
        ctx.fill(built.wet[k]);
      }
    }
    // dry topsoil: paler, with thin inked cracks
    if (wx.drought > 0.03) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = wx.drought * 0.3;
      ctx.fillStyle = '#e9d092';
      ctx.fill(built.dry);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const c of built.cracks) {
        const v = smooth01((wx.drought - c.th) / 0.18);
        if (v < 0.03) continue;
        ctx.globalAlpha = v * 0.78;
        ctx.strokeStyle = '#25180f';
        ctx.lineWidth = c.w;
        ctx.beginPath();
        ctx.moveTo(c.pts[0], c.pts[1]);
        for (let i = 2; i < c.pts.length; i += 2) ctx.lineTo(c.pts[i], c.pts[i + 1]);
        if (c.branch.length) {
          ctx.moveTo(c.branch[0], c.branch[1]);
          for (let i = 2; i < c.branch.length; i += 2) ctx.lineTo(c.branch[i], c.branch[i + 1]);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function rainfall(ctx, dt) {
    const i = wx.rain;
    const n = Math.round(RAIN_N * i);
    const slope = 0.3;
    const d = Math.min(dt, 0.05);
    ctx.save();
    ctx.lineCap = 'round';
    // wash streaks (wide and pale), then pen streaks
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const x = rain.x[k];
        const y = rain.y[k];
        const L = rain.len[k] * (pass ? 1 : 1.5);
        ctx.moveTo(x, y);
        ctx.lineTo(x - L * slope, y - L);
      }
      ctx.strokeStyle = pass ? `rgba(46,60,86,${0.55 * i + 0.1})` : `rgba(236,243,250,${0.42 * i})`;
      ctx.lineWidth = pass ? 0.85 : 2;
      ctx.stroke();
    }
    for (let k = 0; k < RAIN_N; k++) {
      rain.y[k] += rain.v[k] * d;
      rain.x[k] += rain.v[k] * d * slope;
      const gy = groundAt(rain.x[k]);
      if (rain.y[k] >= gy) {
        if (k < n && splashAcc < 16 && Math.random() < 0.18) {
          for (let s = 0; s < 16; s++) {
            if (splash.t[s] < 0) {
              splash.x[s] = rain.x[k];
              splash.y[s] = gy;
              splash.t[s] = 0;
              break;
            }
          }
        }
        rain.y[k] = ext.y0 - Math.random() * 80;
        rain.x[k] = ext.x0 - 90 + Math.random() * (ext.x1 - ext.x0 + 100);
      }
    }
    // splashes at the ground line: a flat ring and two droplets
    ctx.lineWidth = 0.7;
    splashAcc = 0;
    for (let s = 0; s < 16; s++) {
      if (splash.t[s] < 0) continue;
      splash.t[s] += d;
      const u = splash.t[s] / 0.42;
      if (u >= 1) {
        splash.t[s] = -1;
        continue;
      }
      splashAcc++;
      ctx.strokeStyle = `rgba(70,88,112,${0.6 * (1 - u)})`;
      ctx.beginPath();
      ctx.ellipse(splash.x[s], splash.y[s] - 0.6, 1.2 + 5 * u, 0.5 + 1.5 * u, 0, 0, TAU);
      ctx.moveTo(splash.x[s] - 2 - 3 * u, splash.y[s] - 1 - 6 * Math.sin(u * 3));
      ctx.lineTo(splash.x[s] - 3 - 4 * u, splash.y[s] - 2 - 7 * Math.sin(u * 3));
      ctx.moveTo(splash.x[s] + 2 + 3 * u, splash.y[s] - 1 - 5 * Math.sin(u * 3));
      ctx.lineTo(splash.x[s] + 3 + 4 * u, splash.y[s] - 2 - 6 * Math.sin(u * 3));
      ctx.stroke();
    }
    ctx.restore();
  }

  function snowfall(ctx, t, dt) {
    const n = Math.round(SNOW_N * wx.snow);
    const d = Math.min(dt, 0.05);
    const wind = 9 + 4 * Math.sin(t * 0.35);
    ctx.save();
    for (let k = 0; k < SNOW_N; k++) {
      flake.y[k] += flake.v[k] * d;
      flake.x[k] += (wind + Math.sin(t * 1.3 + flake.ph[k]) * 9) * d;
      const gy = groundAt(flake.x[k]);
      if (flake.y[k] >= gy - 1) {
        flake.y[k] = ext.y0 - Math.random() * 60;
        flake.x[k] = ext.x0 - 30 + Math.random() * (ext.x1 - ext.x0 + 60);
      }
      if (k >= n) continue;
      const sp = sprites.flakes[flake.k[k]];
      ctx.globalAlpha = 0.55 + 0.4 * wx.snow;
      ctx.drawImage(sp.canvas, flake.x[k] - sp.ax, flake.y[k] - sp.ay, sp.w, sp.h);
    }
    ctx.restore();
  }

  function drawOver(ctx, state, t, dt) {
    if (!api.on || !built) return;
    ctx.save();
    // the tint over everything above the ground: sky, clouds, crowns, caps
    if (st.mulB !== 'rgb(255,255,255)') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = st.mulB;
      ctx.fill(built.above);
    }
    ctx.restore();
    if (!particlesReady) seedParticles();
    if (wx.rain > 0.02) rainfall(ctx, dt);
    else if (splashAcc) splash.t.fill(-1);
    if (wx.snow > 0.02) snowfall(ctx, t, dt);
    // a new season passes over the page as a soft wash
    if (sweep) {
      const u = (t - sweep.t0) / 3.2;
      if (u >= 1) sweep = null;
      else {
        const W = ext.x1 - ext.x0;
        const cx = ext.x0 - W * 0.15 + W * 1.3 * u;
        const gr = ctx.createLinearGradient(cx - W * 0.22, 0, cx + W * 0.22, 0);
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.5, sweep.color);
        gr.addColorStop(1, 'rgba(255,255,255,1)');
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = 0.35 * Math.sin(Math.PI * u);
        ctx.fillStyle = gr;
        ctx.fill(built.above);
        ctx.restore();
      }
    }
  }

  return {
    get night() {
      return api.night;
    },
    setScale(p, v) {
      px = p;
      view = v;
      if (v) ext = { x0: -v.ox / v.scale, x1: (v.cssW - v.ox) / v.scale, y0: -v.oy / v.scale, y1: (v.cssH - v.oy) / v.scale };
      built = null;
      sprites = null;
    },
    reset(w, v) {
      world = w;
      if (v && !ext) ext = { x0: -v.ox / v.scale, x1: (v.cssW - v.ox) / v.scale, y0: -v.oy / v.scale, y1: (v.cssH - v.oy) / v.scale };
      wx.cover = -1;
      built = null;
      sprites = null;
    },
    event(ev) {
      if (ev && ev.type === 'season' && SEASON_SWEEP[ev.season]) sweep = { t0: frameT ?? 0, color: SEASON_SWEEP[ev.season] };
    },
    drawSky,
    drawSoil,
    drawOver,
  };
}

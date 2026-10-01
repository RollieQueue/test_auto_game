// Ambient layers of the S2 soundscape: crickets, distant birds, cicadas, rain, cold wind, plus the
// drought / snow colouring of the base wind and air. Built once per AudioContext by index.js.
//
//   createScape(kit) -> { apply(mix, now), step(dt, mix), debug }
//
// kit: { ctx, out, send, muffle, wind:{bp,gain}, air:{gain}, noiseBuffer(sec,color), tone(freq,t,opts), room(n) }
//   out     bus the layers feed (already phase-faded and routed to the master by index.js)
//   send    reverb input, used for a little distance on the birds
//   muffle  low-pass in front of the base ambience (winter/snow)
//   room(n) true when n more one-shot voices fit the shared voice budget (with a reserve for events)
//
// Continuous layers are a handful of always-running nodes whose gains are ramped: crickets are sine
// carriers keyed by looping pulse-pattern buffers, rain is stereo filtered noise plus looping buffers
// of drop ticks, so none of them costs voices. Only birds and the occasional rain plink are one-shots.

import { muffleHz } from './scales.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// base levels of the base-ambience nodes (index.js builds them with these values)
export const BASE = { windHz: 420, windQ: 0.6, windGain: 0.55, airGain: 0.045 };

const TC = 0.12; // time constant of the ramps applied on every apply()

export function createScape(kit) {
  const { ctx, out, send, muffle, wind, air, noiseBuffer, tone, room } = kit;
  const sr = ctx.sampleRate;
  const stats = { phrases: 0, plinks: 0, skipped: 0 };

  const lfo = (freq, depth, target) => {
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const dg = ctx.createGain();
    dg.gain.value = depth;
    o.connect(dg);
    dg.connect(target);
    o.start();
    return o;
  };
  const panner = (v) => {
    const p = ctx.createStereoPanner();
    p.pan.value = v;
    return p;
  };
  const filter = (type, f, q = 0.7) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  };
  const loopSrc = (buf, offset) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, offset);
    return s;
  };
  /** A gain node starting silent that feeds `dest`. */
  const layerGain = (dest) => {
    const gn = ctx.createGain();
    gn.gain.value = 0;
    gn.connect(dest);
    return gn;
  };

  const pink = noiseBuffer(6, 'pink');
  const brown = noiseBuffer(6, 'brown');

  // ------------------------------------------------------------ crickets
  // Each cricket: a high sine whose amplitude is keyed by a looping buffer of short pulse trains
  // (a "chirp" = a few pulses). Different loop lengths and rates keep them from locking together.
  function chirpBuffer(len, chirps, pulses, pulseDur, gap) {
    const n = Math.floor(sr * len);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const period = n / chirps;
    for (let c = 0; c < chirps; c++) {
      const start = c * period + period * rand(0.05, 0.25);
      const amp = rand(0.6, 1);
      for (let p = 0; p < pulses; p++) {
        const p0 = start + p * (pulseDur + gap) * sr;
        const plen = Math.floor(pulseDur * sr);
        for (let i = 0; i < plen; i++) {
          const k = Math.sin((Math.PI * i) / plen);
          const idx = Math.floor(p0 + i) % n;
          d[idx] = Math.max(d[idx], k * k * amp * (1 - 0.12 * p));
        }
      }
    }
    return buf;
  }
  const CRICKETS = [
    { hz: 4350, buf: [1.3, 2, 3, 0.017, 0.033], rate: 1, pan: -0.5, swell: 0.071 },
    { hz: 4720, buf: [1.8, 2, 4, 0.014, 0.03], rate: 0.93, pan: 0.45, swell: 0.093 },
    { hz: 5140, buf: [2.3, 3, 3, 0.012, 0.028], rate: 1.06, pan: 0.05, swell: 0.057 },
  ].map((c) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = c.hz;
    const key = ctx.createGain();
    key.gain.value = 0;
    const keySrc = ctx.createBufferSource();
    keySrc.buffer = chirpBuffer(...c.buf);
    keySrc.loop = true;
    keySrc.playbackRate.value = c.rate;
    keySrc.connect(key.gain);
    const swell = ctx.createGain();
    swell.gain.value = 0.65;
    lfo(c.swell, 0.35, swell.gain);
    const level = layerGain(out);
    osc.connect(key);
    key.connect(swell);
    swell.connect(panner(c.pan)).connect(level);
    osc.start();
    keySrc.start(0, Math.random() * c.buf[0]);
    return level;
  });

  // ------------------------------------------------------------ cicada (dry summer hiss)
  const cicadaMod = ctx.createGain();
  cicadaMod.gain.value = 0.5;
  lfo(41, 0.36, cicadaMod.gain); // the rattle
  lfo(0.13, 0.14, cicadaMod.gain); // slow swell
  const cicadaLevel = layerGain(out);
  loopSrc(pink, 1.3).connect(filter('bandpass', 6900, 7)).connect(cicadaMod);
  cicadaMod.connect(cicadaLevel);

  // ------------------------------------------------------------ rain
  const rainHiss = layerGain(out);
  const rainBody = layerGain(out);
  for (const [off, pan] of [[0.2, -0.6], [3.1, 0.6]]) {
    loopSrc(pink, off).connect(filter('highpass', 800, 0.5)).connect(filter('lowpass', 7200, 0.5)).connect(panner(pan)).connect(rainHiss);
  }
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.8;
  lfo(0.07, 0.2, bodyGain.gain); // the shower breathes
  loopSrc(brown, 0.7).connect(filter('bandpass', 380, 0.6)).connect(bodyGain).connect(rainBody);

  function dropBuffer(len, rate) {
    const n = Math.floor(sr * len);
    const buf = ctx.createBuffer(2, n, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const count = Math.round(len * rate);
    for (let k = 0; k < count; k++) {
      const at = Math.floor(Math.random() * n);
      const amp = 0.15 + Math.random() ** 2 * 0.85;
      const wL = rand(0.2, 1);
      const wR = 1.2 - wL;
      if (Math.random() < 0.8) {
        const dur = Math.floor(sr * rand(0.004, 0.012));
        let prev = 0;
        for (let i = 0; i < dur; i++) {
          const raw = Math.random() * 2 - 1;
          const v = (raw - prev) * Math.exp((-i / dur) * 5) * amp; // differentiated = bright tick
          prev = raw;
          L[(at + i) % n] += v * wL;
          R[(at + i) % n] += v * wR;
        }
      } else {
        const f0 = rand(1500, 3600);
        const dur = Math.floor(sr * rand(0.015, 0.03));
        for (let i = 0; i < dur; i++) {
          const f = f0 * (1 + (0.3 * i) / dur);
          const v = Math.sin((2 * Math.PI * f * i) / sr) * Math.exp((-i / dur) * 4.5) * amp * 0.5;
          L[(at + i) % n] += v * wL;
          R[(at + i) % n] += v * wR;
        }
      }
    }
    return buf;
  }
  const dropsSparse = layerGain(out);
  const dropsDense = layerGain(out);
  for (const [gn, rate, off] of [[dropsSparse, 5, 0], [dropsDense, 26, 0]]) {
    const s = ctx.createBufferSource();
    s.buffer = dropBuffer(7, rate);
    s.loop = true;
    s.connect(filter('highpass', 600, 0.5)).connect(gn);
    s.start(0, off + Math.random() * 3);
  }

  // ------------------------------------------------------------ cold wind (winter / snow)
  const coldLevel = layerGain(out);
  const coldBp = filter('bandpass', 1050, 3);
  const coldGust = ctx.createGain();
  coldGust.gain.value = 0.7;
  lfo(0.05, 0.3, coldGust.gain);
  lfo(0.037, 360, coldBp.frequency);
  loopSrc(pink, 4.2).connect(coldBp).connect(coldGust).connect(coldLevel);
  const coldHigh = filter('bandpass', 2350, 6);
  const coldHighGain = ctx.createGain();
  coldHighGain.gain.value = 0.35;
  lfo(0.083, 0.3, coldHighGain.gain);
  lfo(0.061, 480, coldHigh.frequency);
  loopSrc(pink, 2.2).connect(coldHigh).connect(coldHighGain).connect(coldLevel);

  // ------------------------------------------------------------ distant birds (one-shot phrases)
  const birdBus = ctx.createGain();
  birdBus.gain.value = 1;
  birdBus.connect(out);
  const birdSend = ctx.createGain();
  birdSend.gain.value = 0.55; // far away: mostly reverb
  birdBus.connect(birdSend);
  birdSend.connect(send);
  let birdTimer = rand(2, 6);

  function birdPhrase(level, season) {
    const t0 = ctx.currentTime + 0.05;
    const g0 = 0.02 + 0.022 * level;
    const pan = rand(-0.75, 0.75);
    const note = (f, t, dur, slide, gain = g0) =>
      tone(f, t, { gain, decay: dur, attack: 0.006, slideTo: slide, slideTime: dur * 0.9, lowpass: 5600, pan, bus: birdBus });
    const kinds = ['tweet', 'tweet', 'trill', 'whistle', 'warble'];
    if (season === 'spring') kinds.push('cuckoo', 'warble');
    if (season === 'summer' && Math.random() < 0.4) kinds.push('cuckoo');
    const kind = pick(kinds);
    if (kind === 'tweet') {
      const n = 1 + Math.floor(Math.random() * 3);
      const f0 = rand(2500, 4300);
      for (let i = 0; i < n; i++) note(f0 * rand(0.92, 1.1), t0 + i * rand(0.09, 0.15), rand(0.05, 0.1), f0 * rand(0.72, 1.4));
      return n;
    }
    if (kind === 'trill') {
      const n = 5 + Math.floor(Math.random() * 4);
      const f0 = rand(2800, 4000);
      const step = rand(0.045, 0.06);
      for (let i = 0; i < n; i++) note(i % 2 ? f0 * 1.13 : f0, t0 + i * step, 0.03, undefined, g0 * 0.8);
      return n;
    }
    if (kind === 'whistle') {
      const f0 = rand(1800, 2600);
      note(f0, t0, 0.26, f0 * rand(1.3, 1.6), g0 * 1.1);
      note(f0 * 1.45, t0 + 0.3, 0.2, f0 * rand(0.8, 1), g0 * 0.9);
      return 2;
    }
    if (kind === 'cuckoo') {
      const f0 = rand(640, 760);
      const lo = { gain: g0 * 1.5, decay: 0.2, attack: 0.03, lowpass: 1600, pan, bus: birdBus };
      tone(f0, t0, lo);
      tone(f0 * 0.79, t0 + 0.34, lo);
      return 2;
    }
    // warble
    const n = 4 + Math.floor(Math.random() * 3);
    let t = t0;
    let f = rand(2300, 3600);
    for (let i = 0; i < n; i++) {
      const dur = rand(0.04, 0.09);
      const f2 = f * rand(0.8, 1.3);
      note(f, t, dur, f2);
      f = f2;
      t += dur + rand(0.02, 0.06);
    }
    return n;
  }

  // ------------------------------------------------------------ public
  const set = (param, value, now) => param.setTargetAtTime(value, now, TC);

  return {
    /** Push a (smoothed) mix into the node graph. Called ~10 times per second. */
    apply(mix, now) {
      const m = mix;
      CRICKETS.forEach((lv, i) => set(lv.gain, m.cricket * [0.022, 0.018, 0.015][i], now));
      set(cicadaLevel.gain, m.cicada * 0.05, now);
      set(rainHiss.gain, m.rain ** 0.85 * 0.085, now);
      set(rainBody.gain, m.rain * 0.05, now);
      set(dropsSparse.gain, m.rain * (1 - 0.6 * m.rain) * 0.1, now);
      set(dropsDense.gain, m.rain ** 2 * 0.11, now);
      set(coldLevel.gain, m.coldWind * 0.065, now);
      // thinner, drier air in a drought: the wind loses its body, the high rustle sharpens
      set(wind.bp.frequency, BASE.windHz * (1 + 0.55 * m.drought), now);
      set(wind.bp.Q, BASE.windQ + 0.9 * m.drought, now);
      set(wind.gain.gain, BASE.windGain * (1 - 0.4 * m.drought - 0.3 * m.rain), now);
      set(air.gain.gain, BASE.airGain * (1 + 1.1 * m.drought), now);
      set(muffle.frequency, muffleHz(m.muffle), now);
    },

    /** Schedule the one-shot sounds (birds, rain plinks); call only while playing. */
    step(dt, mix) {
      if (mix.bird > 0.06) {
        birdTimer -= dt;
        if (birdTimer <= 0) {
          birdTimer = rand(6, 17) / (0.35 + 0.65 * mix.bird);
          if (room(9)) {
            birdPhrase(mix.bird, mix.season);
            stats.phrases++;
          } else stats.skipped++;
        }
      } else if (birdTimer > 3) {
        birdTimer = rand(1.5, 4); // the first phrase comes soon after the light returns
      }
      if (mix.rain > 0.08 && room(2)) {
        // a few single drops on leaves, on top of the looping texture
        if (Math.random() < dt * (0.3 + 2.4 * mix.rain)) {
          const f = rand(1400, 3800);
          tone(f, ctx.currentTime + 0.02, {
            gain: rand(0.004, 0.011) * (0.4 + mix.rain),
            decay: rand(0.05, 0.1),
            attack: 0.002,
            slideTo: f * 1.3,
            slideTime: 0.04,
            lowpass: 6000,
            pan: rand(-0.8, 0.8),
            bus: birdBus,
          });
          stats.plinks++;
        }
      }
    },

    get debug() {
      return { ...stats, birdTimer };
    },
  };
}

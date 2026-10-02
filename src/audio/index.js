// Procedural audio (WebAudio only, no samples). API: createAudio() -> { unlock(), update(state, dt), setMuted(bool), setVolume(0..1), muted, volume }.
// createAudio({ context }) takes a ready (Offline)AudioContext instead of making its own (tests, src/audio/lab.html).
//
// Sound design (see docs/GDD.md "Звук"):
//   ambience   filtered-noise wind + a faint high "air", a low warm drone (C2/G2/C3) that brightens with activity
//   music      sparse kalimba-like notes on a C major pentatonic; their density follows network activity
//   events     grow crackle, link bells (a pitch per resource), warm chord for tree growth, wooden pop for
//              mushrooms, sparkly spore shimmer, dull thud on "not enough sugar"
//   S2 layers  (only when state.clock exists and state.flags.seasons is on; otherwise exactly the above)
//              day/night by clock.daylight: distant birds by day, crickets at night, a darker drone;
//              weather: rain, drought (dry thin air, cicadas), snow/winter (muffled ambience, cold wind);
//              seasons: kalimba scale, register and density per season; cues on dawn/dusk/season/year-end
//              (see scales.js for the numbers, scape.js for the layers, cues.js for the cues)
// Everything goes through one master gain and a gentle compressor; nothing starts before unlock().

import { PALETTES, buildLadder, computeMix, readWorld, NO_LAYERS, muffleHz } from './scales.js';
import { createScape, BASE } from './scape.js';
import { createCues } from './cues.js';
import { FINDS } from '../content/finds.js';

const STORE_KEY = 'roots-threads.muted';
const MASTER_LEVEL = 0.9;
const MAX_VOICES = 36;
const AMBIENT_RESERVE = 8; // ambient one-shots (birds, drops) leave this many voices to event sounds
const SCAPE_LEVEL = 1; // gain of the S2 layer bus relative to the phase fade (the base ambience uses 0.32)
const MIX_STEP = 0.1; // seconds between pushes of the smoothed mix into the graph
const MIX_TAU = 1.8; // seconds: crossfade time of the day/night and weather layers

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const LADDER = buildLadder(PALETTES.default); // C4 .. D6, the major pentatonic

function readMuted() {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(value) {
  try {
    localStorage.setItem(STORE_KEY, value ? '1' : '0');
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

export function createAudio(options = {}) {
  let muted = readMuted();
  let volume = 1; // 0..1, the settings slider (the player's choice is stored by ui/settings.js, not here)
  const level = () => (muted ? 0 : MASTER_LEVEL * volume * volume); // squared: the slider then feels even to the ear
  let ctx = null;
  let g = null; // graph nodes
  let voices = 0;
  let suspendTimer = 0;
  let ambTarget = -1;
  let activity = 0;
  let noteTimer = 3;
  let ladderIdx = 4;
  let ladder = LADDER; // note ladder of the current season palette
  let pal = PALETTES.default;
  let scape = null;
  let cues = null;
  let target = { ...NO_LAYERS }; // mix the sim asks for
  const cur = { ...NO_LAYERS }; // the same, smoothed in JS
  let mixTimer = 0;
  let mixReady = false;
  let seasonsOn = false; // the sim provides a clock and the seasons flag is on
  let peakVoices = 0;
  const queue = []; // { at, fn }: sounds a few seconds ahead, counted down by update()
  const lastPlayed = Object.create(null);
  const counts = Object.create(null);

  // ------------------------------------------------------------ graph
  function noiseBuffer(seconds, color) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (color === 'pink') {
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
      } else {
        last = (last + 0.02 * white) / 1.02; // brown
        d[i] = last * 3.2;
      }
    }
    // short crossfade of the loop seam
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[len - fade + i] = d[len - fade + i] * (1 - t) + d[i] * t;
    }
    return buf;
  }

  function impulse(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += (Math.random() * 2 - 1 - lp) * 0.45;
        d[i] = lp * (1 - t) ** 3.2 * 1.6;
      }
    }
    return buf;
  }

  function build() {
    const AC = options.context ? null : window.AudioContext || window.webkitAudioContext;
    if (!AC && !options.context) return false;
    ctx = options.context || new AC({ latencyHint: 'playback' });

    const master = ctx.createGain();
    master.gain.value = level();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 24;
    comp.ratio.value = 5;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    master.connect(comp);
    comp.connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(1.9);
    const reverbIn = ctx.createGain();
    reverbIn.gain.value = 1;
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.42;
    reverbIn.connect(reverb);
    reverb.connect(reverbOut);
    reverbOut.connect(master);

    // base ambience -> low-pass (opens fully unless it is winter/snow) -> master
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    muffle.Q.value = 0.5;
    muffle.connect(master);
    const amb = ctx.createGain();
    amb.gain.value = 0;
    amb.connect(muffle);

    // S2 layers (crickets, birds, rain, ...): phase-faded like amb, not muffled
    const scapeBus = ctx.createGain();
    scapeBus.gain.value = 0;
    scapeBus.connect(master);

    const music = ctx.createGain();
    music.gain.value = 0.9;
    music.connect(master);
    music.connect(reverbIn);

    const fx = ctx.createGain();
    fx.gain.value = 1.6;
    fx.connect(master);
    const fxWet = ctx.createGain();
    fxWet.gain.value = 0.5;
    fx.connect(fxWet);
    fxWet.connect(reverbIn);

    // wind: brown noise through a wandering band-pass
    const brown = noiseBuffer(6, 'brown');
    const pink = noiseBuffer(5, 'pink');
    const wind = ctx.createBufferSource();
    wind.buffer = brown;
    wind.loop = true;
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.frequency.value = BASE.windHz;
    windBp.Q.value = BASE.windQ;
    const windGain = ctx.createGain();
    windGain.gain.value = BASE.windGain;
    wind.connect(windBp);
    windBp.connect(windGain);
    windGain.connect(amb);
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
    lfo(0.057, 190, windBp.frequency);
    lfo(0.091, 0.22, windGain.gain);

    // air: a thin high rustle
    const air = ctx.createBufferSource();
    air.buffer = pink;
    air.loop = true;
    const airHp = ctx.createBiquadFilter();
    airHp.type = 'highpass';
    airHp.frequency.value = 3200;
    const airLp = ctx.createBiquadFilter();
    airLp.type = 'lowpass';
    airLp.frequency.value = 7600;
    const airGain = ctx.createGain();
    airGain.gain.value = BASE.airGain;
    air.connect(airHp);
    airHp.connect(airLp);
    airLp.connect(airGain);
    airGain.connect(amb);
    lfo(0.13, 0.03, airGain.gain);

    // drone: C2 + G2 + C3 through a low-pass
    const droneLp = ctx.createBiquadFilter();
    droneLp.type = 'lowpass';
    droneLp.frequency.value = 260;
    droneLp.Q.value = 0.4;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.075;
    droneLp.connect(droneGain);
    droneGain.connect(amb);
    const droneSpec = [
      ['triangle', 36, 0, 0.9],
      ['sine', 43, 3, 0.55],
      ['sine', 48, -4, 0.4],
      ['sine', 55, 6, 0.12],
    ];
    for (const [type, midi, cents, level] of droneSpec) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(midi);
      o.detune.value = cents;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og);
      og.connect(droneLp);
      o.start();
    }
    lfo(0.043, 0.018, droneGain.gain);

    wind.start(0, Math.random() * 5);
    air.start(0, Math.random() * 4);

    g = {
      master,
      amb,
      scapeBus,
      music,
      fx,
      droneLp,
    };
    scape = createScape({
      ctx,
      out: scapeBus,
      send: reverbIn,
      muffle,
      wind: { bp: windBp, gain: windGain },
      air: { gain: airGain },
      noiseBuffer,
      tone,
      room: (n) => voices + n <= MAX_VOICES - AMBIENT_RESERVE,
    });
    cues = createCues({
      tone,
      pluck,
      bell,
      noise: noiseBurst,
      throttled,
      later,
      fx: () => g.fx,
      room: (n) => voices + n <= MAX_VOICES - AMBIENT_RESERVE,
    });
    return true;
  }

  // ------------------------------------------------------------ voices
  function track(node, extraStop) {
    voices++;
    if (voices > peakVoices) peakVoices = voices;
    node.onended = () => {
      voices--;
      if (extraStop) extraStop();
    };
  }

  /** One enveloped oscillator. */
  function tone(freq, t, o = {}) {
    if (voices >= MAX_VOICES && !o.force) return;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + (o.slideTime || o.decay || 0.2));
    if (o.detune) osc.detune.value = o.detune;
    const env = ctx.createGain();
    const peak = o.gain ?? 0.1;
    const attack = o.attack ?? 0.004;
    const decay = o.decay ?? 1;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peak, t + attack);
    if (o.sustain) env.gain.setValueAtTime(peak, t + o.sustain);
    env.gain.exponentialRampToValueAtTime(0.0001, t + (o.sustain || 0) + attack + decay);
    let out = env;
    osc.connect(env);
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      env.connect(p);
      out = p;
    }
    if (o.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.lowpass;
      out.connect(lp);
      out = lp;
    }
    out.connect(o.bus || g.fx);
    const end = t + (o.sustain || 0) + attack + decay + 0.05;
    if (o.wobble) {
      // slow pitch wobble (cents): an LFO into the detune, stopped with the voice
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.wobble.rate || 3;
      const depth = ctx.createGain();
      depth.gain.value = o.wobble.depth || 20;
      lfo.connect(depth);
      depth.connect(osc.detune);
      lfo.start(t);
      lfo.stop(end);
    }
    osc.start(t);
    osc.stop(end);
    track(osc);
  }

  let noiseSrcBuf = null;
  function noiseBurst(t, o = {}) {
    if (voices >= MAX_VOICES) return;
    if (!noiseSrcBuf) noiseSrcBuf = noiseBuffer(1, 'pink');
    const src = ctx.createBufferSource();
    src.buffer = noiseSrcBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.value = o.freq || 2500;
    f.Q.value = o.q || 2;
    const env = ctx.createGain();
    const dur = o.dur || 0.03;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(o.gain ?? 0.05, t + (o.attack || 0.002));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(env);
    env.connect(o.bus || g.fx);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.03);
    track(src);
  }

  /** Kalimba-like pluck: fundamental + a short bright partial. `style` is a season palette (bright, decay, lowpass). */
  function pluck(midi, t, gain = 0.1, bus, style = PALETTES.default) {
    const f = mtof(midi);
    const pan = rand(-0.4, 0.4);
    const lowpass = style.lowpass || undefined;
    const b = bus || g.music;
    tone(f, t, { gain, decay: (1.7 + (84 - midi) * 0.02) * style.decay, attack: 0.003, bus: b, pan, lowpass });
    tone(f * 4.02, t, { gain: gain * 0.2 * style.bright, decay: 0.12, attack: 0.002, bus: b, pan, lowpass });
    tone(f * 9.1, t, { gain: gain * 0.05 * style.bright, decay: 0.05, attack: 0.001, bus: b, pan, lowpass });
  }

  /** Small metallic bell: inharmonic partials with a long soft tail. */
  function bell(midi, t, gain = 0.1, decay = 1.9, bus) {
    const f = mtof(midi);
    tone(f, t, { gain, decay, attack: 0.004, bus });
    tone(f * 2.76, t, { gain: gain * 0.32, decay: decay * 0.5, attack: 0.003, bus });
    tone(f * 5.4, t, { gain: gain * 0.1, decay: decay * 0.22, attack: 0.002, bus });
  }

  /** Run `fn(t)` `delay` seconds from now (counted down by update(); at most 16 pending). */
  function later(delay, fn) {
    if (queue.length < 16) queue.push({ at: delay, fn });
  }
  function runQueue(dt) {
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      q.at -= dt;
      if (q.at <= 0.05) {
        queue.splice(i, 1);
        try {
          q.fn(ctx.currentTime + Math.max(0, q.at) + 0.02);
        } catch (err) {
          if (typeof console !== 'undefined') console.warn('[audio] queued', err);
        }
      }
    }
  }

  // ------------------------------------------------------------ event sounds
  const throttled = (key, gap) => {
    const now = ctx.currentTime;
    if (now - (lastPlayed[key] ?? -Infinity) < gap) return true;
    lastPlayed[key] = now;
    return false;
  };

  const LINK_NOTES = { water: 76, mineral: 81, tree: 69 };
  // A find is a small glint of bells, richer and brighter the rarer it is (rarity 1..4 in src/content/finds.js).
  const FIND_STEPS = [[79], [79, 84], [76, 81, 84], [76, 79, 84, 88]];

  const handlers = {
    'grow-start'(t) {
      noiseBurst(t, { type: 'bandpass', freq: 700, q: 0.8, dur: 0.16, gain: 0.04 });
      tone(mtof(52), t, { gain: 0.05, decay: 0.3, lowpass: 900 });
    },
    'grow-tick'(t) {
      if (throttled('grow-tick', 0.075)) return;
      noiseBurst(t, { freq: rand(1700, 4300), q: rand(2, 5), dur: rand(0.012, 0.03), gain: rand(0.09, 0.16) });
      if (Math.random() < 0.22) tone(rand(900, 1500), t, { gain: 0.03, decay: 0.03, attack: 0.001, type: 'triangle' });
    },
    'grow-end'(t) {
      tone(mtof(57), t, { gain: 0.06, decay: 0.45, lowpass: 1400 });
      noiseBurst(t, { type: 'lowpass', freq: 600, q: 0.5, dur: 0.07, gain: 0.04 });
    },
    link(t, ev) {
      if (throttled(`link:${ev.kind}`, 0.12)) return;
      const midi = LINK_NOTES[ev.kind] ?? 76;
      bell(midi, t, ev.kind === 'tree' ? 0.12 : 0.1, ev.kind === 'tree' ? 2.6 : 1.8);
      if (ev.kind === 'tree') bell(midi + 7, t + 0.12, 0.08, 2.4);
    },
    'tree-stage'(t, ev) {
      if (throttled('tree-stage', 0.4)) return;
      const root = 48 + clamp(ev.stage || 1, 0, 4) * 2; // brighter with every stage
      const chord = [0, 7, 12, 16, 19];
      chord.forEach((iv, i) => {
        const tt = t + i * 0.07;
        tone(mtof(root + iv), tt, { gain: 0.07, attack: 0.3, decay: 2.8, type: 'triangle', lowpass: 1700, bus: g.fx });
        tone(mtof(root + iv) * 2.003, tt, { gain: 0.025, attack: 0.4, decay: 2.4, lowpass: 2600, bus: g.fx });
      });
    },
    'mushroom-planted'(t) {
      tone(430, t, { gain: 0.26, slideTo: 150, slideTime: 0.1, decay: 0.16, attack: 0.002, lowpass: 1600 });
      noiseBurst(t, { type: 'bandpass', freq: 900, q: 1.2, dur: 0.035, gain: 0.07 });
    },
    'mushroom-mature'(t) {
      tone(560, t, { gain: 0.22, slideTo: 190, slideTime: 0.09, decay: 0.15, attack: 0.002, lowpass: 2000 });
      noiseBurst(t, { type: 'bandpass', freq: 1200, q: 1.2, dur: 0.035, gain: 0.06 });
      pluck(84, t + 0.1, 0.07, g.fx);
      pluck(88, t + 0.2, 0.05, g.fx);
    },
    spores(t, ev) {
      if (throttled('spores', 0.25)) return;
      const n = clamp(3 + Math.round(Math.sqrt(ev.amount || 1)), 4, 9);
      for (let i = 0; i < n; i++) {
        const m = LADDER[clamp(7 + Math.floor(Math.random() * 5), 0, LADDER.length - 1)] + 24;
        tone(mtof(m), t + i * rand(0.035, 0.07), {
          gain: rand(0.018, 0.035),
          decay: rand(0.22, 0.45),
          attack: 0.002,
          pan: rand(-0.8, 0.8),
        });
      }
    },
    insufficient(t) {
      if (throttled('insufficient', 0.45)) return;
      tone(120, t, { gain: 0.3, slideTo: 52, slideTime: 0.2, decay: 0.24, attack: 0.003, lowpass: 400 });
      noiseBurst(t, { type: 'lowpass', freq: 380, q: 0.7, dur: 0.1, gain: 0.07 });
    },
    'fruit-denied'(t) {
      if (throttled('insufficient', 0.45)) return;
      tone(160, t, { gain: 0.2, slideTo: 80, slideTime: 0.14, decay: 0.2, attack: 0.003, lowpass: 500 });
    },
    'deposit-empty'(t) {
      if (throttled('deposit-empty', 0.8)) return;
      pluck(69, t, 0.07, g.fx);
      pluck(64, t + 0.16, 0.06, g.fx);
    },
    find(t, ev) {
      if (throttled('find', 0.1)) return;
      const rarity = clamp((FINDS[ev.kind] && FINDS[ev.kind].rarity) || 1, 1, 4);
      let steps = FIND_STEPS[rarity - 1];
      // a bell is 3 voices, the glint 1: stay inside the cap, leaving the ambient reserve alone
      const room = MAX_VOICES - AMBIENT_RESERVE - voices;
      if (room < 4) return;
      if (room < steps.length * 3 + 1) steps = steps.slice(-Math.max(1, Math.floor((room - 1) / 3)));
      steps.forEach((m, i) => bell(m, t + i * 0.09, 0.04 + 0.005 * rarity, 0.9 + 0.45 * rarity));
      const last = steps.length - 1;
      tone(mtof(steps[last] + 12), t + last * 0.09, { gain: 0.008 * rarity, decay: 0.2 + 0.1 * rarity, attack: 0.002, pan: rand(-0.4, 0.4) });
    },
    objective(t) {
      if (throttled('objective', 0.5)) return;
      bell(84, t + 0.0, 0.07, 1.4);
      bell(88, t + 0.13, 0.07, 1.6);
    },
    'all-objectives'(t) {
      [72, 76, 79, 84, 88].forEach((m, i) => bell(m, t + i * 0.16, 0.08, 2.6));
    },
    // Threats (nematodes and trap rings): quiet, dry and organic; every cue checks the voice room first
    bite(t) {
      if (throttled('bite', 0.35) || voices + 3 > MAX_VOICES - AMBIENT_RESERVE) return;
      noiseBurst(t, { type: 'bandpass', freq: rand(1500, 2100), q: 2.2, dur: 0.02, gain: 0.13 });
      noiseBurst(t + 0.045, { type: 'bandpass', freq: rand(1900, 2600), q: 2.2, dur: 0.016, gain: 0.1 });
    },
    severed(t) {
      if (throttled('severed', 0.5) || voices + 6 > MAX_VOICES - AMBIENT_RESERVE) return;
      noiseBurst(t, { type: 'bandpass', freq: 3000, q: 3, dur: 0.012, gain: 0.09 }); // the dry snap
      noiseBurst(t + 0.004, { type: 'highpass', freq: 5200, q: 0.7, dur: 0.03, gain: 0.03 });
      tone(76, t + 0.01, { gain: 0.12, slideTo: 44, slideTime: 0.22, decay: 0.3, attack: 0.004, lowpass: 320 }); // soft low thud
      // a slightly unsettling minor second, barely there
      tone(mtof(58), t + 0.04, { gain: 0.016, attack: 0.05, decay: 0.7, type: 'triangle', lowpass: 800 });
      tone(mtof(59), t + 0.04, { gain: 0.012, attack: 0.05, decay: 0.7, type: 'triangle', lowpass: 800 });
    },
    'worm-caught'(t) {
      if (throttled('worm-caught', 0.3) || voices + 8 > MAX_VOICES - AMBIENT_RESERVE) return;
      // a small bright wooden tick with a bell tail, then two soft gulps
      tone(1320, t, { gain: 0.06, decay: 0.09, attack: 0.002, type: 'triangle' });
      tone(1320 * 2.76, t, { gain: 0.02, decay: 0.05, attack: 0.001 });
      bell(88, t + 0.02, 0.035, 1.1);
      tone(190, t + 0.14, { gain: 0.13, slideTo: 95, slideTime: 0.09, decay: 0.13, attack: 0.004, lowpass: 520 });
      tone(160, t + 0.27, { gain: 0.1, slideTo: 80, slideTime: 0.09, decay: 0.12, attack: 0.004, lowpass: 480 });
    },
    'trap-placed'(t) {
      if (throttled('trap-placed', 0.15) || voices + 3 > MAX_VOICES - AMBIENT_RESERVE) return;
      noiseBurst(t, { type: 'bandpass', freq: 3200, q: 1.4, dur: 0.05, gain: 0.05 }); // a soft rustle
      noiseBurst(t + 0.05, { type: 'bandpass', freq: 2400, q: 1.4, dur: 0.06, gain: 0.04 });
      tone(560, t + 0.02, { gain: 0.05, slideTo: 380, slideTime: 0.07, decay: 0.1, attack: 0.002, lowpass: 1800 });
    },
    'trap-ready'(t) {
      if (throttled('trap-ready', 0.3) || voices + 2 > MAX_VOICES - AMBIENT_RESERVE) return;
      tone(mtof(86), t, { gain: 0.016, decay: 0.25, attack: 0.004 });
      tone(mtof(91), t + 0.08, { gain: 0.013, decay: 0.32, attack: 0.004 });
    },
    'trap-denied': (t, ev) => handlers.insufficient(t, ev),
    'worm-sense': (t, ev) => voices + 4 <= MAX_VOICES - AMBIENT_RESERVE && cues['worm-sense'](t, ev),
    // The honey-fungus rival (state.flags.rival): quieter than the threat cues, built in cues.js. There is no
    // 'barrier-gone' cue on purpose; a denied barrier sounds like any other "not allowed".
    'rival-wake': (t, ev) => cues['rival-wake'](t, ev),
    'rival-grip': (t, ev) => cues['rival-grip'](t, ev),
    'tree-infected': (t, ev) => cues['tree-infected'](t, ev),
    'tree-lost': (t, ev) => cues['tree-lost'](t, ev),
    'tree-freed': (t, ev) => cues['tree-freed'](t, ev),
    'barrier-placed': (t, ev) => cues['barrier-placed'](t, ev),
    'barrier-denied': (t, ev) => handlers.insufficient(t, ev),
    'rival-cut': (t, ev) => cues['rival-cut'](t, ev),
    'rival-fruit': (t, ev) => cues['rival-fruit'](t, ev),
    'rival-tip': (t, ev) => cues['rival-tip'](t, ev),
    // S2: cues live in cues.js; ignored while the seasons are off
    dawn: (t, ev) => seasonsOn && cues.dawn(t, ev),
    dusk: (t, ev) => seasonsOn && cues.dusk(t, ev),
    season: (t, ev) => seasonsOn && cues.season(t, ev),
    'year-end': (t, ev) => seasonsOn && cues['year-end'](t, ev),
  };

  function handleEvents(state) {
    const events = state.events;
    if (!events || events.length === 0) return;
    const t = ctx.currentTime + 0.01;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const h = handlers[ev.type];
      if (!h) continue;
      counts[ev.type] = (counts[ev.type] || 0) + 1;
      try {
        h(t + (i === 0 ? 0 : Math.min(i, 6) * 0.012), ev);
      } catch (err) {
        // a sound must never break the game loop
        if (typeof console !== 'undefined') console.warn('[audio]', ev.type, err);
      }
    }
  }

  // ------------------------------------------------------------ ambience + music
  function activityOf(state) {
    const flows = state.flows ? state.flows.length : 0;
    const growing = state.net && state.net.growing ? state.net.growing.length : 0;
    return clamp(Math.min(1, flows / 14) * 0.7 + Math.min(1, growing / 2) * 0.55, 0, 1);
  }

  function setPalette(key) {
    const next = PALETTES[key] || PALETTES.default;
    if (next === pal) return;
    const nl = buildLadder(next);
    ladderIdx = Math.round((ladderIdx / Math.max(1, ladder.length - 1)) * (nl.length - 1)); // keep the relative register
    pal = next;
    ladder = nl;
  }

  function stepMusic(dt) {
    noteTimer -= dt;
    if (noteTimer > 0) return;
    const gap = ((8.5 - 6.7 * activity) * rand(0.6, 1.4)) / target.noteDensity;
    noteTimer = gap;
    ladderIdx = clamp(ladderIdx + Math.round(rand(-2.4, 2.4)), 0, ladder.length - 1);
    const t = ctx.currentTime + 0.02;
    const level = (0.07 + 0.03 * activity) * pal.level;
    const note = (idx, at, gain) => {
      if (pal.bellProb && Math.random() < pal.bellProb) bell(ladder[idx], at, gain * 0.7, 2.2 * pal.decay, g.music);
      else pluck(ladder[idx], at, gain, undefined, pal);
    };
    note(ladderIdx, t, level);
    if (activity > 0.35 && Math.random() < activity * 0.6) {
      const second = clamp(ladderIdx + (Math.random() < 0.5 ? 2 : -2), 0, ladder.length - 1);
      note(second, t + rand(0.18, 0.4), level * 0.7);
    } else if (pal.sigh && Math.random() < pal.sigh) {
      note(clamp(ladderIdx - 1, 0, ladder.length - 1), t + rand(0.55, 0.9), level * 0.6); // a falling answer
    }
  }

  // ------------------------------------------------------------ public API
  let wantUnlock = false;
  let hooked = false; // the persistent gesture and visibility hooks are installed
  const resumeOnGesture = () => {
    if (wantUnlock && !hooked) api.unlock();
    else if (ctx && ctx.state === 'suspended' && !muted && !document.hidden) ctx.resume();
  };
  const running = () => ctx.state === 'running' || Boolean(options.context); // an injected offline context only runs while rendering

  const MIX_KEYS = Object.keys(NO_LAYERS).filter((k) => typeof NO_LAYERS[k] === 'number');
  /** Follow the sim's clock and weather: target mix, note palette, smoothed layer levels. */
  function followWorld(state, dt, now) {
    const world = readWorld(state);
    seasonsOn = world.active;
    target = computeMix(world);
    setPalette(target.season);
    const k = mixReady ? 1 - Math.exp(-dt / MIX_TAU) : 1; // the first look snaps (a save loaded at night starts at night)
    mixReady = true;
    for (const key of MIX_KEYS) cur[key] += (target[key] - cur[key]) * k;
    mixTimer -= dt;
    if (mixTimer <= 0) {
      mixTimer = MIX_STEP;
      scape.apply(cur, now);
    }
  }

  function applyMute(now) {
    if (!ctx) return;
    clearTimeout(suspendTimer);
    g.master.gain.cancelScheduledValues(now);
    g.master.gain.setTargetAtTime(level(), now, 0.08);
    if (muted) {
      suspendTimer = setTimeout(() => {
        if (muted && ctx.state === 'running') ctx.suspend();
      }, 700);
    } else if (ctx.state === 'suspended') {
      ctx.resume();
    }
  }

  const api = {
    /** Create / resume the context. Call from a user gesture (without one, it waits for the first). */
    unlock() {
      wantUnlock = true;
      try {
        if (!ctx && options.context) {
          build();
          return;
        }
        if (!hooked) {
          const active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
          if (!active) {
            // autoplay policy: no gesture yet (e.g. ?autostart=1), so build (or resume) on the first click or key
            for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, resumeOnGesture, { once: true, passive: true });
            return;
          }
          if (!ctx && !build()) return;
          hooked = true;
          for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, resumeOnGesture, { passive: true });
          document.addEventListener('visibilitychange', () => {
            if (!ctx) return;
            if (document.hidden) ctx.suspend();
            else if (!muted) ctx.resume();
          });
        }
        if (!muted && ctx.state !== 'running') ctx.resume();
        else if (muted) applyMute(ctx.currentTime);
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[audio] unlock failed', err);
      }
    },

    /**
     * Builds the context and the graph ahead of the first gesture (it stays suspended until unlock() resumes it), so
     * the click on «Начать» does not pay for it: creating the context and synthesizing the noise takes a long while.
     * Call it when the page is idle; unlock() without it builds on the spot as before.
     */
    prepare() {
      if (ctx || options.context) return;
      try {
        build();
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[audio] prepare failed', err);
        ctx = null;
      }
    },

    update(state, dt) {
      if (!ctx || muted || !wantUnlock || !running()) return;
      const now = ctx.currentTime;
      const phaseGain = state.phase === 'playing' ? 1 : state.phase === 'paused' ? 0.08 : 0.35;
      if (phaseGain !== ambTarget) {
        ambTarget = phaseGain;
        g.amb.gain.cancelScheduledValues(now);
        g.amb.gain.setTargetAtTime(phaseGain * 0.32, now, 0.5);
        g.scapeBus.gain.setTargetAtTime(phaseGain * SCAPE_LEVEL, now, 0.5);
      }
      followWorld(state, dt, now);
      handleEvents(state); // events live one frame; one that pauses the game (summary) must still sound
      runQueue(dt);
      if (state.phase === 'playing') {
        activity += (activityOf(state) - activity) * Math.min(1, dt * 0.7);
        g.droneLp.frequency.setTargetAtTime((240 + activity * 260) * (1 - 0.32 * cur.droneDark), now, 0.6);
        stepMusic(dt);
        scape.step(dt, cur);
      }
    },

    setMuted(value) {
      muted = Boolean(value);
      writeMuted(muted);
      if (ctx) applyMute(ctx.currentTime);
    },

    /** Master volume 0..1 (anything else is clamped; NaN is ignored). Applies at once, also before the first unlock. */
    setVolume(value) {
      const v = Number(value);
      if (!Number.isFinite(v)) return;
      volume = clamp(v, 0, 1);
      if (ctx) {
        g.master.gain.cancelScheduledValues(ctx.currentTime);
        g.master.gain.setTargetAtTime(level(), ctx.currentTime, 0.05);
      }
    },

    get muted() {
      return muted;
    },

    get volume() {
      return volume;
    },

    /** For tests and debugging. */
    get debug() {
      return {
        context: ctx,
        state: ctx ? ctx.state : 'none',
        voices,
        activity,
        peakVoices,
        maxVoices: MAX_VOICES,
        counts: { ...counts },
        mix: { ...cur },
        target: { ...target },
        palette: Object.keys(PALETTES).find((k) => PALETTES[k] === pal),
        seasonsOn,
        queued: queue.length,
        scape: scape ? scape.debug : null,
        master: g ? g.master : null,
      };
    },
  };
  return api;
}

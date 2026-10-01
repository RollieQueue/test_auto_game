// Short musical cues for the S2 events: dawn, dusk, a new season, the end of the year.
// All of them are quiet (about the level of the "objective" bells) and play through index.js helpers.
//
//   createCues({ tone, pluck, bell, noise, throttled, later, fx, room }) -> { dawn, dusk, season, 'year-end', 'worm-sense',
//     and the honey-fungus rival: 'rival-wake', 'rival-grip', 'tree-infected', 'tree-lost', 'tree-freed',
//     'barrier-placed', 'rival-cut', 'rival-fruit', 'rival-tip' }
// Each handler is (t, event) like the other event handlers.

import { PALETTES } from './scales.js';

/** Season motifs: [midi, delay in s, gain] over C; they speak the palette's own style. */
const MOTIFS = {
  spring: { notes: [[72, 0, 1], [76, 0.13, 0.9], [79, 0.26, 0.9], [84, 0.4, 1]], kind: 'pluck' },
  summer: { notes: [[67, 0, 1], [72, 0.22, 0.9], [76, 0.44, 0.9], [79, 0.7, 1]], kind: 'pluck' },
  autumn: { notes: [[70, 0, 1], [67, 0.34, 0.9], [63, 0.7, 0.9], [60, 1.15, 1]], kind: 'pluck' },
  winter: { notes: [[84, 0, 1], [79, 0.5, 0.9], [74, 1, 0.9], [67, 1.6, 1]], kind: 'bell' },
};

export function createCues({ tone, pluck, bell, noise = () => {}, throttled, later, fx, room = () => true }) {
  const rand = (a, b) => a + Math.random() * (b - a);
  const f = (midi) => 440 * 2 ** ((midi - 69) / 12);
  const pad = (midi, t, gain, decay) => {
    tone(f(midi), t,{ gain, attack: 0.28, decay, type: 'triangle', lowpass: 1500, bus: fx() });
  };

  return {
    dawn(t) {
      if (throttled('dawn', 6)) return;
      bell(79, t, 0.032, 1.6);
      bell(84, t + 0.22, 0.032, 1.7);
      bell(88, t + 0.46, 0.028, 2.1);
    },

    dusk(t) {
      if (throttled('dusk', 6)) return;
      pluck(76, t, 0.05, fx(), PALETTES.autumn);
      pluck(72, t + 0.3, 0.045, fx(), PALETTES.autumn);
      pluck(67, t + 0.62, 0.04, fx(), PALETTES.autumn);
      pad(48, t, 0.03, 2.4);
    },

    season(t, ev) {
      if (throttled('season', 3)) return;
      const key = ev && MOTIFS[ev.season] ? ev.season : 'spring';
      const m = MOTIFS[key];
      for (const [midi, dt, gain] of m.notes) {
        if (m.kind === 'bell') bell(midi, t + dt, 0.055 * gain, 2.4);
        else pluck(midi, t + dt, 0.08 * gain, fx(), PALETTES[key]);
      }
    },

    // a worm has caught the scent of a hypha: two soft wooden notes, a falling minor third, barely above the ambience
    'worm-sense'(t) {
      if (throttled('worm-sense', 2.5)) return;
      tone(f(74), t, { gain: 0.032, attack: 0.006, decay: 0.2, type: 'triangle', lowpass: 1800 });
      tone(f(71), t + 0.17, { gain: 0.026, attack: 0.006, decay: 0.3, type: 'triangle', lowpass: 1400 });
    },

    // ---- the honey-fungus rival: dull, woody and quiet, below the threat cues; every cue checks the voice room.
    // There are no cues for barrier-gone (silence) and barrier-denied (index.js reuses the denial blip).

    // the old stump wakes: a slow low wooden creak, two detuned saws through a low-pass with a wobbling pitch
    'rival-wake'(t) {
      if (throttled('rival-wake', 8) || !room(4)) return;
      tone(f(40), t, { gain: 0.034, attack: 0.35, decay: 0.8, type: 'sawtooth', lowpass: 340, slideTo: f(37), slideTime: 1.1, wobble: { rate: 2.6, depth: 45 } });
      tone(f(40) * 1.508, t + 0.1, { gain: 0.02, attack: 0.4, decay: 0.7, type: 'sawtooth', lowpass: 300, slideTo: f(38), slideTime: 1, wobble: { rate: 3.4, depth: 55 } });
      noise(t, { type: 'bandpass', freq: 240, q: 5, dur: 1, gain: 0.05, attack: 0.3 });
    },

    // a rhizomorph takes hold of a root: a muffled thud
    'rival-grip'(t) {
      if (throttled('rival-grip', 0.8) || !room(2)) return;
      tone(80, t, { gain: 0.07, slideTo: 42, slideTime: 0.18, decay: 0.26, attack: 0.004, lowpass: 260 });
      noise(t, { type: 'lowpass', freq: 320, q: 0.5, dur: 0.06, gain: 0.05 });
    },

    // infection reached 25 / 50 / 75 %: a very quiet low hint (a minor second), a little stronger with each level
    'tree-infected'(t, ev) {
      if (throttled('tree-infected', 0.6) || !room(3)) return;
      const level = ev && Number.isFinite(ev.level) ? Math.min(0.75, Math.max(0.25, ev.level)) : 0.25;
      const k = (level - 0.25) / 0.5; // 0..1
      const gain = 0.011 + 0.012 * k;
      tone(f(45), t, { gain, attack: 0.18, decay: 1 + 0.4 * k, type: 'triangle', lowpass: 420 });
      tone(f(46), t + 0.05, { gain: gain * 0.8, attack: 0.18, decay: 1 + 0.4 * k, type: 'triangle', lowpass: 420 });
      if (k > 0.9) tone(f(33), t, { gain: 0.016, attack: 0.1, decay: 1.2, lowpass: 200 });
    },

    // a tree is lost: a dry crack and a low knock of wood
    'tree-lost'(t) {
      if (throttled('tree-lost', 0.8) || !room(5)) return;
      noise(t, { type: 'bandpass', freq: 2300, q: 1.6, dur: 0.03, gain: 0.05 });
      noise(t + 0.03, { type: 'bandpass', freq: 1500, q: 1.4, dur: 0.02, gain: 0.03 });
      tone(112, t + 0.01, { gain: 0.05, slideTo: 62, slideTime: 0.12, decay: 0.2, attack: 0.003, lowpass: 420 });
      tone(94, t + 0.12, { gain: 0.035, slideTo: 56, slideTime: 0.1, decay: 0.16, attack: 0.003, lowpass: 380 });
    },

    // a tree is freed: a soft two-note rise (C - G of the pentatonic)
    'tree-freed'(t) {
      if (throttled('tree-freed', 0.6) || !room(2)) return;
      tone(f(72), t, { gain: 0.02, attack: 0.02, decay: 0.55, type: 'triangle', lowpass: 2200 });
      tone(f(79), t + 0.15, { gain: 0.022, attack: 0.02, decay: 0.9, type: 'triangle', lowpass: 2600 });
    },

    // a barrier is set: a chalk scratch and a quiet bell
    'barrier-placed'(t) {
      if (throttled('barrier-placed', 0.2) || !room(5)) return;
      noise(t, { type: 'bandpass', freq: 5000, q: 1.2, dur: 0.09, gain: 0.035, attack: 0.01 });
      noise(t + 0.06, { type: 'bandpass', freq: 4200, q: 1.2, dur: 0.07, gain: 0.03, attack: 0.01 });
      bell(88, t + 0.1, 0.02, 1.1);
    },

    // the barrier eats the rhizomorph: a crumble of short filtered grains over half a second
    'rival-cut'(t, ev) {
      if (throttled('rival-cut', 0.4)) return;
      const edges = ev && Number.isFinite(ev.edges) ? ev.edges : 1;
      const grains = Math.min(7, Math.max(4, 3 + Math.round(edges)));
      let at = 0;
      for (let i = 0; i < grains; i++) {
        if (!room(1)) break;
        noise(t + at, { type: 'bandpass', freq: rand(700, 2400), q: 1.5, dur: rand(0.03, 0.07), gain: rand(0.035, 0.06) });
        at += rand(0.05, 0.09);
      }
    },

    // honey mushrooms appear on an infected trunk: a soft airy puff
    'rival-fruit'(t) {
      if (throttled('rival-fruit', 0.5) || !room(2)) return;
      noise(t, { type: 'bandpass', freq: 1800, q: 0.5, dur: 0.3, gain: 0.035, attack: 0.06 });
      noise(t + 0.04, { type: 'highpass', freq: 3800, q: 0.5, dur: 0.18, gain: 0.012, attack: 0.05 });
    },

    // the tip of a rhizomorph creeps on: at most a barely audible whisper, rarely
    'rival-tip'(t) {
      if (throttled('rival-tip', 3) || !room(2)) return;
      noise(t, { type: 'bandpass', freq: 4500, q: 3, dur: 0.35, gain: 0.008, attack: 0.12 });
    },

    // a calm cadence F - G - C(add9): three soft chords, then two bells
    'year-end'(t) {
      if (throttled('year-end', 20)) return;
      const chord = (notes, gain, decay) => (at) => notes.forEach((n, i) => pad(n, at + i * 0.06, gain, decay));
      chord([53, 57, 60, 65], 0.03, 2.8)(t);
      later(1.7, chord([55, 59, 62, 67], 0.03, 2.8));
      later(3.6, (at) => {
        chord([48, 55, 64, 67, 74], 0.034, 4.2)(at);
        bell(84, at + 0.3, 0.04, 3.2);
        bell(91, at + 0.8, 0.03, 3.4);
      });
    },
  };
}

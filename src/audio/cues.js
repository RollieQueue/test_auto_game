// Short musical cues for the S2 events: dawn, dusk, a new season, the end of the year.
// All of them are quiet (about the level of the "objective" bells) and play through index.js helpers.
//
//   createCues({ tone, pluck, bell, throttled, later, fx }) -> { dawn, dusk, season, 'year-end' }
// Each handler is (t, event) like the other event handlers.

import { PALETTES } from './scales.js';

/** Season motifs: [midi, delay in s, gain] over C; they speak the palette's own style. */
const MOTIFS = {
  spring: { notes: [[72, 0, 1], [76, 0.13, 0.9], [79, 0.26, 0.9], [84, 0.4, 1]], kind: 'pluck' },
  summer: { notes: [[67, 0, 1], [72, 0.22, 0.9], [76, 0.44, 0.9], [79, 0.7, 1]], kind: 'pluck' },
  autumn: { notes: [[70, 0, 1], [67, 0.34, 0.9], [63, 0.7, 0.9], [60, 1.15, 1]], kind: 'pluck' },
  winter: { notes: [[84, 0, 1], [79, 0.5, 0.9], [74, 1, 0.9], [67, 1.6, 1]], kind: 'bell' },
};

export function createCues({ tone, pluck, bell, throttled, later, fx }) {
  const pad = (midi, t, gain, decay) => {
    const f = 440 * 2 ** ((midi - 69) / 12);
    tone(f, t, { gain, attack: 0.28, decay, type: 'triangle', lowpass: 1500, bus: fx() });
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

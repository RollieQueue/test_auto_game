// Pure data and maths for the seasonal soundscape (no WebAudio here, so it can be tested in Node).
//
//   readWorld(state)  -> what the sim says about time and weather, or { active:false } when it says nothing
//   computeMix(world) -> target levels (0..1) for every ambient layer plus the kalimba palette of the season
//   buildLadder(pal)  -> the note ladder (MIDI) a palette plays from
//
// With no clock (or `flags.seasons` off) computeMix returns the "default" palette and all layers at 0,
// which is exactly the pre-S2 soundscape.

export const SEASON_KEYS = ['spring', 'summer', 'autumn', 'winter'];

/**
 * Kalimba palettes. `pcs` are pitch classes over C (the drone stays on C, so every scale fits it),
 * `lo` the lowest MIDI note, `steps` the ladder length. `density` multiplies how often notes come,
 * `level` their loudness, `bright` the high partials, `decay` the ring time, `bellProb` the chance
 * that a note is a small bell instead of a pluck, `lowpass` a warm roll-off (0 = none),
 * `sigh` the chance of a falling answer note (autumn melancholy).
 */
export const PALETTES = {
  default: { pcs: [0, 2, 4, 7, 9], lo: 60, steps: 12, density: 1, level: 1, bright: 1, decay: 1, bellProb: 0, lowpass: 0, sigh: 0 },
  spring: { pcs: [0, 2, 4, 7, 9, 11], lo: 64, steps: 12, density: 1.45, level: 0.86, bright: 1.6, decay: 0.8, bellProb: 0.08, lowpass: 0, sigh: 0 },
  summer: { pcs: [0, 2, 4, 7, 9], lo: 60, steps: 12, density: 1, level: 1, bright: 0.65, decay: 1.15, bellProb: 0, lowpass: 3200, sigh: 0 },
  autumn: { pcs: [0, 3, 5, 7, 10], lo: 55, steps: 12, density: 0.72, level: 1.05, bright: 0.4, decay: 1.4, bellProb: 0.06, lowpass: 2300, sigh: 0.4 },
  winter: { pcs: [0, 2, 7, 9], lo: 72, steps: 8, density: 0.5, level: 0.78, bright: 1, decay: 1, bellProb: 0.85, lowpass: 0, sigh: 0 },
};

/** How much birds / crickets sing in each season (before day, night and weather). */
const BIRDS = { spring: 1, summer: 0.75, autumn: 0.35, winter: 0 };
const CRICKETS = { spring: 0.35, summer: 1, autumn: 0.55, winter: 0 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Note ladder of a palette: its pitch classes from `lo` upwards, `steps` notes. */
export function buildLadder(pal) {
  const out = [];
  for (let m = pal.lo; out.length < pal.steps && m < pal.lo + 60; m++) if (pal.pcs.includes(m % 12)) out.push(m);
  return out;
}

/** Reads the clock and weather defensively. Anything missing or malformed means "no seasons". */
export function readWorld(state) {
  const clock = state && state.clock;
  const seasonsOn = Boolean(state && state.flags && state.flags.seasons);
  if (!clock || typeof clock !== 'object' || !seasonsOn) return { active: false };
  const season = SEASON_KEYS.includes(clock.season) ? clock.season : SEASON_KEYS[clock.seasonIndex | 0] || 'spring';
  const w = state.weather || {};
  const kinds = ['clear', 'rain', 'drought', 'snow'];
  const kind = kinds.includes(w.kind) ? w.kind : 'clear';
  return {
    active: true,
    season,
    daylight: clamp(num(clock.daylight, 1), 0, 1),
    kind,
    intensity: kind === 'clear' ? 0 : clamp(num(w.intensity, 0.6), 0, 1),
  };
}

export const NO_LAYERS = Object.freeze({
  active: false,
  season: 'default',
  day: 0,
  night: 0,
  bird: 0,
  cricket: 0,
  cicada: 0,
  rain: 0,
  drought: 0,
  snow: 0,
  muffle: 0,
  coldWind: 0,
  droneDark: 0,
  noteDensity: 1,
});

/** Target mix for a world (see readWorld). All layer levels are 0..1. */
export function computeMix(world) {
  if (!world || !world.active) return { ...NO_LAYERS };
  const { season, daylight: d, kind } = world;
  const I = world.intensity;
  const rain = kind === 'rain' ? I : 0;
  const drought = kind === 'drought' ? I : 0;
  const snow = kind === 'snow' ? I : 0;
  const day = smooth(0.3, 0.78, d);
  const night = 1 - smooth(0.08, 0.5, d);
  const winter = season === 'winter';

  const quiet = (1 - 0.85 * rain) * (1 - snow);
  const bird = day * BIRDS[season] * quiet * (1 - 0.3 * drought);
  const cricket = night * CRICKETS[season] * (1 - 0.7 * rain) * (1 - snow);
  // dry cicada hiss: summer days, much more in a drought (and a little in any dry warm day)
  const cicada = smooth(0.5, 0.85, d) * (season === 'summer' ? 0.45 + 0.55 * drought : season === 'winter' ? 0 : 0.5 * drought) * (1 - rain);
  const muffle = clamp(Math.max(winter ? 0.5 : 0, snow * 0.9), 0, 1);
  const coldWind = clamp((winter ? 0.6 : 0) + snow * 0.4, 0, 1);
  const noteDensity = PALETTES[season].density * (1 - 0.25 * rain) * (1 - 0.3 * snow) * (0.75 + 0.25 * day);

  return { active: true, season, day, night, bird, cricket, cicada, rain, drought, snow, muffle, coldWind, droneDark: night * 0.8, noteDensity };
}

/** Frequency of the ambience low-pass for a muffle amount: 20 kHz (open) .. 1.5 kHz (snow). */
export const muffleHz = (m) => 20000 * (1500 / 20000) ** clamp(m, 0, 1);

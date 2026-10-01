// Clock, day/night, seasons and weather (S2). The clock always runs; its effects (state.sim.fx) and events apply only
// when state.flags.seasons is set. Everything is a pure function of the elapsed time (state.sim.clock) and the seed,
// so a save needs no weather or season internals beyond the clock itself.
import { clamp } from '../core/geom.js';
import { createRng, hash32 } from '../core/rng.js';
import { B, nightFloor } from './balance.js';

export const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'];

/** Effects of an unseasonal game: all multipliers 1. */
export const NEUTRAL_FX = Object.freeze({
  pay: 1, drinkW: 1, drinkM: 1, regen: 1, treeGrow: 1, mushGrow: 1, spore: 1, mushSugar: 1, upkeep: 1,
});

const smooth = (t) => t * t * (3 - 2 * t);

/** Smooth 0..1 light level at a time of day (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset). */
export function daylightAt(dayFrac) {
  const sun = Math.sin(2 * Math.PI * (dayFrac - 0.25));
  return smooth(clamp((sun + B.daylightEdge) / (2 * B.daylightEdge), 0, 1));
}

/** The state.clock fields after `t` elapsed game seconds. */
export function clockAt(t) {
  const dayPos = B.startDayFrac + t / B.daySeconds;
  const day = Math.floor(dayPos);
  const dayFrac = dayPos - day;
  const yearSeconds = B.seasonSeconds * 4;
  const year = Math.floor(t / yearSeconds);
  const inYear = t - year * yearSeconds;
  const seasonIndex = Math.min(3, Math.floor(inYear / B.seasonSeconds));
  return {
    day,
    dayFrac,
    daylight: daylightAt(dayFrac),
    season: SEASON_NAMES[seasonIndex],
    seasonIndex,
    seasonFrac: clamp((inYear - seasonIndex * B.seasonSeconds) / B.seasonSeconds, 0, 1),
    year,
  };
}

/** Counters whose increase marks a dawn, a dusk or a new season (events fire when they grow). */
function marksAt(t) {
  const dayPos = B.startDayFrac + t / B.daySeconds;
  return { dawn: Math.floor(dayPos - 0.25), dusk: Math.floor(dayPos - 0.75), season: Math.floor(t / B.seasonSeconds) };
}

// Cache of the current season's episodes per sim (kept out of state.sim: it is derived data, never saved).
const plans = new WeakMap();

/** Weather episodes of one absolute season: [{ start, end, kind, peak }] in seconds from the season start. */
function scheduleFor(seed, absSeason) {
  const W = B.seasons[SEASON_NAMES[absSeason % 4]].weather;
  const rng = createRng(hash32(seed, 'weather', absSeason));
  const slot = (B.seasonSeconds - B.weatherLead) / W.count;
  const list = [];
  for (let i = 0; i < W.count; i++) {
    const dur = rng.range(W.min, W.max);
    const start = B.weatherLead + i * slot + rng.range(2, Math.max(2, slot - dur - 2));
    list.push({ start, end: start + dur, kind: W.kind, peak: rng.range(W.peakMin, W.peakMax) });
  }
  return list;
}

/** Weather at time t: { kind, intensity } following the seeded episodes with smooth ramps. */
export function weatherAt(state, t) {
  const sim = state.sim;
  const abs = Math.floor(t / B.seasonSeconds);
  let plan = plans.get(sim);
  if (plan?.abs !== abs) plans.set(sim, (plan = { abs, list: scheduleFor(state.seed, abs) }));
  const local = t - abs * B.seasonSeconds;
  for (const e of plan.list) {
    if (local < e.start || local >= e.end) continue;
    const env = smooth(clamp(Math.min((local - e.start) / B.weatherRampIn, (e.end - local) / B.weatherRampOut), 0, 1));
    const intensity = Math.round(e.peak * env * 1000) / 1000;
    if (intensity > 0.02) return { kind: e.kind, intensity };
  }
  return { kind: 'clear', intensity: 0 };
}

/** The multipliers the rest of the sim reads (state.sim.fx), from the clock and the weather (and `t`, the game time: see B.firstLight). */
export function effectsFor(clock, weather, t) {
  const S = B.seasons[clock.season];
  const rain = weather.kind === 'rain' ? weather.intensity : 0;
  const drought = weather.kind === 'drought' ? weather.intensity : 0;
  return {
    pay: S.pay * (nightFloor(t) + (1 - nightFloor(t)) * clock.daylight),
    drinkW: S.drinkW * (1 + B.droughtThirst * drought),
    drinkM: S.drinkM,
    regen: S.regen * (1 + S.rain * rain) * (1 - B.droughtRegenCut * drought),
    treeGrow: S.treeGrow,
    mushGrow: S.mushGrow,
    spore: S.spore * (1 + B.nightSpores * (1 - clock.daylight)),
    mushSugar: S.mushSugar,
    upkeep: S.upkeep,
  };
}

/** Called by initSim: the game starts in spring, in the morning, with clear weather. */
export function initTime(state) {
  state.clock = clockAt(0);
  state.weather = { kind: 'clear', intensity: 0 };
  state.flags.yearDone ??= false;
  state.sim.marks = marksAt(0);
  state.sim.fx = NEUTRAL_FX;
}

/**
 * After state.clock, state.weather and state.sim.clock were restored from a save: re-derive the internal
 * marks and effects. Emits nothing.
 */
export function restoreTime(state) {
  const t = state.sim.clock;
  state.clock = clockAt(t);
  state.sim.marks = marksAt(t);
  if (state.flags.seasons) {
    state.weather = weatherAt(state, t);
    state.sim.fx = effectsFor(state.clock, state.weather, t);
  } else {
    state.weather = { kind: 'clear', intensity: 0 };
    state.sim.fx = NEUTRAL_FX;
  }
}

/** One sim step: advances state.clock (always); with seasons on also weather, effects and events. */
export function stepTime(state) {
  const { sim, flags, events, clock } = state;
  const t = sim.clock;
  Object.assign(clock, clockAt(t));
  const prev = sim.marks;
  const marks = marksAt(t);
  sim.marks = marks;
  if (!flags.seasons) {
    sim.fx = NEUTRAL_FX;
    return;
  }
  if (marks.season > prev.season) {
    if (marks.season % 4 === 0) {
      flags.yearDone = true;
      events.push({ type: 'year-end', year: clock.year - 1 });
    }
    events.push({ type: 'season', season: clock.season });
  }
  if (marks.dawn > prev.dawn) events.push({ type: 'dawn' });
  if (marks.dusk > prev.dusk) events.push({ type: 'dusk' });
  const w = weatherAt(state, t);
  if (w.kind !== state.weather.kind) events.push({ type: 'weather', kind: w.kind });
  state.weather.kind = w.kind;
  state.weather.intensity = w.intensity;
  sim.fx = effectsFor(clock, state.weather, t);
}

// Sound lab: live audition of the seasonal layers with a fake sim state, and offline level measurements.
//   labRender({ clock, weather, seconds, activity, events }) -> { peakDb, rmsDb, windowMaxRmsDb, ... }
//   labReport() -> levels of the plain (no clock) ambience vs day/night/weather/season states
import { createAudio } from './index.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const db = (v) => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -Infinity);

function fakeState({ clock, weather, activity = 0 } = {}) {
  const flows = Array.from({ length: Math.round(activity * 14) }, () => ({}));
  return {
    phase: 'playing',
    events: [],
    flows,
    net: { growing: activity > 0.5 ? [{}, {}] : [] },
    flags: { seasons: Boolean(clock) },
    clock,
    weather,
  };
}

export const clockOf = (season, daylight) => ({
  day: 0,
  dayFrac: 0.5,
  daylight,
  season,
  seasonIndex: SEASONS.indexOf(season),
  seasonFrac: 0.5,
  year: 0,
});

const BANDS = [[0, 200], [200, 800], [800, 2000], [2000, 4000], [4000, 6000], [6000, 10000]];

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** Mean and max (over 0.5 s windows) level per frequency band of the left channel, in dB (bands: <200, 200-800, 0.8-2k, 2-4k, 4-6k, 6-10k Hz). */
function bandLevels(L, from, sr) {
  const N = 4096;
  const hop = Math.floor(sr * 0.5);
  const mean = BANDS.map(() => 0);
  const max = BANDS.map(() => 0);
  let count = 0;
  for (let at = from; at + N < L.length; at += hop) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = L[at + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    BANDS.forEach(([lo, hi], bi) => {
      let p = 0;
      for (let k = Math.max(1, Math.floor((lo * N) / sr)); k < Math.min(N / 2, Math.floor((hi * N) / sr)); k++) p += re[k] * re[k] + im[k] * im[k];
      p /= N * N * 0.375; // window power gain
      mean[bi] += p;
      max[bi] = Math.max(max[bi], p);
    });
    count++;
  }
  const f = (p) => db(Math.sqrt(p));
  return { meanDb: mean.map((p) => f(p / count)), maxDb: max.map(f) };
}

/** Render `seconds` of the module offline, driving update() every 0.1 s like the game loop. */
export async function labRender({ clock, weather, seconds = 40, activity = 0, events = [], warm = 8, sr = 44100, module } = {}) {
  const create = module || createAudio;
  const ctx = new OfflineAudioContext(2, Math.floor(sr * seconds), sr);
  const audio = create({ context: ctx });
  audio.setMuted(false);
  audio.unlock();
  const state = fakeState({ clock, weather, activity });
  const step = 0.1;
  let peakVoices = 0;
  for (let i = 0; i < seconds / step; i++) {
    ctx.suspend(i * step).then(() => {
      state.events = events.filter((e) => Math.abs(e.at - i * step) < step / 2).map((e) => e.ev);
      audio.update(state, step);
      peakVoices = Math.max(peakVoices, audio.debug.peakVoices || 0);
      ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const from = Math.floor(warm * sr);
  let peak = 0;
  let sum = 0;
  let wsum = 0;
  let wmax = 0;
  let n = 0;
  for (let i = from; i < L.length; i++) {
    const a = L[i];
    const b = R[i];
    peak = Math.max(peak, Math.abs(a), Math.abs(b));
    const e = (a * a + b * b) / 2;
    sum += e;
    wsum += e;
    if (++n % sr === 0) {
      wmax = Math.max(wmax, wsum / sr);
      wsum = 0;
    }
  }
  const d = audio.debug;
  return {
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(sum / (L.length - from))),
    windowMaxRmsDb: db(Math.sqrt(wmax)),
    peakVoices,
    palette: d.palette,
    scape: d.scape,
    bands: bandLevels(L, from, sr),
  };
}

export const SCENES = {
  'plain (no clock) = pre-S2': {},
  'spring noon clear': { clock: clockOf('spring', 1), weather: { kind: 'clear', intensity: 0 } },
  'summer noon clear': { clock: clockOf('summer', 1), weather: { kind: 'clear', intensity: 0 } },
  'summer night clear': { clock: clockOf('summer', 0), weather: { kind: 'clear', intensity: 0 } },
  'summer noon drought': { clock: clockOf('summer', 1), weather: { kind: 'drought', intensity: 0.9 } },
  'spring day rain 0.9': { clock: clockOf('spring', 0.8), weather: { kind: 'rain', intensity: 0.9 } },
  'spring day rain 0.3': { clock: clockOf('spring', 0.8), weather: { kind: 'rain', intensity: 0.3 } },
  'autumn day clear': { clock: clockOf('autumn', 0.9), weather: { kind: 'clear', intensity: 0 } },
  'autumn night': { clock: clockOf('autumn', 0), weather: { kind: 'clear', intensity: 0 } },
  'winter day clear': { clock: clockOf('winter', 0.8), weather: { kind: 'clear', intensity: 0 } },
  'winter snow 0.8': { clock: clockOf('winter', 0.6), weather: { kind: 'snow', intensity: 0.8 } },
};

export async function labReport({ seconds = 40, activity = 0.3, module } = {}) {
  const rows = {};
  for (const [name, scene] of Object.entries(SCENES)) {
    const r = await labRender({ ...scene, seconds, activity, module });
    rows[name] = { peakDb: r.peakDb, rmsDb: r.rmsDb, winMaxRmsDb: r.windowMaxRmsDb, peakVoices: r.peakVoices, bandMean: r.bands.meanDb.join(' '), bandMax: r.bands.maxDb.join(' ') };
  }
  return rows;
}

// ------------------------------------------------------------ live audition
const live = { audio: null, timer: 0, events: [] };
const $ = (id) => document.getElementById(id);
const out = $('out');

function liveState() {
  const kind = $('weather').value;
  return {
    phase: 'playing',
    events: live.events.splice(0),
    flows: Array.from({ length: 4 }, () => ({})),
    net: { growing: [] },
    flags: { seasons: true },
    clock: clockOf($('season').value, Number($('daylight').value)),
    weather: { kind, intensity: kind === 'clear' ? 0 : Number($('intensity').value) },
  };
}

$('play').onclick = () => {
  if (!live.audio) live.audio = createAudio();
  live.audio.setMuted(false);
  live.audio.unlock();
  clearInterval(live.timer);
  live.timer = setInterval(() => {
    live.audio.update(liveState(), 0.1);
    const d = live.audio.debug;
    const mix = Object.fromEntries(Object.entries(d.mix).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v]));
    out.textContent = JSON.stringify({ state: d.state, voices: d.voices, peakVoices: d.peakVoices, palette: d.palette, mix, scape: d.scape }, null, 1);
  }, 100);
};
$('stop').onclick = () => {
  clearInterval(live.timer);
  if (live.audio) live.audio.setMuted(true);
};
for (const b of document.querySelectorAll('[data-ev]')) {
  b.onclick = () => live.events.push({ type: b.dataset.ev, season: $('season').value, year: 0 });
}
window.labRender = labRender;
window.labReport = labReport;
window.labClock = clockOf;

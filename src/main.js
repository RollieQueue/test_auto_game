// Bootstrap: state, fixed-step simulation, rendering, HUD, input and audio wiring.
import { WORLD_W, WORLD_H } from './config.js';
import { createState } from './state.js';
import * as sim from './sim/index.js';
import { createRenderer } from './render/index.js';
import { createHud } from './ui/hud.js';
import { attachInput } from './input/pointer.js';
import { createAudio } from './audio/index.js';
import * as persist from './persist.js';
import { getSettings } from './ui/settings.js';
import { setReducedMotion } from './render/motion.js';
import { loadChoice, parseSpecies, saveChoice, startingSpecies } from './ui/species-logic.js';

const FIXED_DT = 1 / 60;
const MAX_STEPS = 8;

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene');
const hudRoot = document.getElementById('hud');
const settings = getSettings(); // volume and «Меньше движения» from localStorage (roots-threads.settings.*)
// Seasons with day and night, and threats in the soil, are on by default; ?seasons=0 / ?threats=0 turn them off.
const SEASONS = params.get('seasons') !== '0';
const THREATS = params.get('threats') !== '0';
// The honey fungus rides with the threats; ?rival=0 turns it off, ?rival=1 turns it on and wakes it at once (see sim/rival.js).
const RIVAL = params.get('rival') === '0' ? false : params.get('rival') === '1' ? 'now' : THREATS;

function pickSeed(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Math.floor(Math.random() * 1e9) + 1;
}

// the fungus a new glade starts with: ?species=<id>, else the last pick on the title page (kept in localStorage)
let lastSpecies = parseSpecies(params.get('species')) ?? loadChoice();

function newState(seed, species) {
  const state = createState(pickSeed(seed));
  state.flags.species = startingSpecies(state.world, parseSpecies(species) ?? lastSpecies);
  state.flags.seasons = SEASONS;
  state.flags.threats = THREATS;
  state.flags.rival = RIVAL;
  return state;
}

const game = {
  state: newState(params.get('seed')),
  view: { scale: 1, ox: 0, oy: 0, cssW: 1, cssH: 1, dpr: 1 },
  debug: params.has('debug'),
  sim,
};

game.actions = {
  start() {
    if (game.state.phase === 'title') game.state.phase = 'playing';
    game.audio.unlock();
  },
  /** The title page picks the fungus of the glade that is about to start (a game under way keeps its own). */
  setSpecies(id) {
    const species = parseSpecies(id);
    if (!species) return;
    lastSpecies = species;
    saveChoice(species);
    if (game.state.phase === 'title') game.state.flags.species = species;
  },
  togglePause() {
    const s = game.state;
    if (s.phase === 'playing') s.phase = 'paused';
    else if (s.phase === 'paused') s.phase = 'playing';
  },
  setSpeed(speed) {
    game.state.speed = speed;
  },
  setTool(tool) {
    game.state.ui.tool = tool;
  },
  cancelDrag() {
    game.state.ui.drag = null;
    game.state.ui.preview = null;
  },
  /** A fresh game: a random glade, or glade `seed` (with the fungus `species` of the game that closed: «Попробовать снова»). */
  restart(seed, species) {
    const previous = game.state.world && game.state.world.biome;
    let next = newState(seed, species);
    // a random new glade that keeps the biome of the last one gets one more roll, so «Новая поляна» looks new
    if (!Number.isFinite(Number(seed)) && previous && next.world.biome === previous) next = newState(seed, species);
    game.state = next;
    game.state.phase = 'playing';
    game.audio.unlock();
  },
  hasSave() {
    return persist.hasSave();
  },
  /** The saved glade's seed and name for the title page («Сохранённая поляна: …»), or null. Read once per title screen. */
  savedGlade() {
    const saved = persist.hasSave() ? persist.loadSave() : null;
    return saved ? { seed: saved.seed, world: { name: saved.world && saved.world.name } } : null;
  },
  continueSaved() {
    const saved = persist.loadSave();
    if (!saved) return false;
    game.state = saved;
    game.state.phase = 'playing';
    game.audio.unlock();
    return true;
  },
  setMuted(muted) {
    game.audio.setMuted(muted);
  },
  isMuted() {
    return game.audio.muted;
  },
  // settings of the pause page: stored by ui/settings.js, applied to audio and renderer below (and at boot)
  setVolume(v) {
    settings.setVolume(v);
  },
  setReducedMotion(on) {
    settings.setReduceMotion(on);
  },
};

game.renderer = createRenderer(canvas);
game.audio = createAudio();
game.hud = createHud(hudRoot, game.actions);
game.input = attachInput(canvas, game);
const applySettings = () => {
  game.audio.setVolume(settings.volume);
  setReducedMotion(settings.reduceMotion);
};
settings.onChange(applySettings);
applySettings();
window.__game = game;

function resize() {
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  const scale = Math.min(cssW / WORLD_W, cssH / WORLD_H);
  game.view = {
    scale,
    ox: (cssW - WORLD_W * scale) / 2,
    oy: (cssH - WORLD_H * scale) / 2,
    cssW,
    cssH,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  };
  game.renderer.resize(game.view);
}
window.addEventListener('resize', resize);
resize();

// Save when the page is hidden or closed; persist.tick() autosaves while playing.
const saveOnLeave = () => {
  if (game.state.phase === 'playing' || game.state.phase === 'paused') persist.saveNow(game.state);
};
window.addEventListener('pagehide', saveOnLeave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveOnLeave();
});

if (params.get('autostart') === '1') game.actions.start();

let last = performance.now();
let acc = 0;

function frame(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  const state = game.state;
  if (state.phase === 'playing') {
    acc += dtReal * state.speed;
    let steps = 0;
    while (acc >= FIXED_DT && steps < MAX_STEPS) {
      sim.updateSim(state, FIXED_DT);
      state.time += FIXED_DT;
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
    persist.tick(state, dtReal);
  } else {
    acc = 0;
  }
  game.input.refresh(now);
  game.renderer.draw(state, game.view, dtReal);
  game.hud.update(state, dtReal, game.view);
  game.audio.update(state, dtReal);
  state.events.length = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

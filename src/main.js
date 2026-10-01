// Bootstrap: state, fixed-step simulation, rendering, HUD, input and audio wiring.
import { WORLD_W, WORLD_H } from './config.js';
import { createState } from './state.js';
import * as sim from './sim/index.js';
import { createRenderer } from './render/index.js';
import { createHud } from './ui/hud.js';
import { attachInput } from './input/pointer.js';
import { createAudio } from './audio/index.js';
import * as persist from './persist.js';

const FIXED_DT = 1 / 60;
const MAX_STEPS = 8;

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene');
const hudRoot = document.getElementById('hud');
// Seasons with day and night, and threats in the soil, are on by default; ?seasons=0 / ?threats=0 turn them off.
const SEASONS = params.get('seasons') !== '0';
const THREATS = params.get('threats') !== '0';

function pickSeed(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Math.floor(Math.random() * 1e9) + 1;
}

function newState(seed) {
  const state = createState(pickSeed(seed));
  state.flags.seasons = SEASONS;
  state.flags.threats = THREATS;
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
  restart(seed) {
    game.state = newState(seed);
    game.state.phase = 'playing';
    game.audio.unlock();
  },
  hasSave() {
    return persist.hasSave();
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
};

game.renderer = createRenderer(canvas);
game.audio = createAudio();
game.hud = createHud(hudRoot, game.actions);
game.input = attachInput(canvas, game);
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
  game.renderer.draw(state, game.view, dtReal);
  game.hud.update(state, dtReal, game.view);
  game.audio.update(state, dtReal);
  state.events.length = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

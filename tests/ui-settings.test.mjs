// Pause-page settings: the volume and «Меньше движения» (src/ui/settings.js), the master volume of the audio
// (setVolume) and the render-side motion flag. No DOM, no real audio device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_KEYS, createSettings, motionText, volumeText } from '../src/ui/settings.js';
import { createAudio } from '../src/audio/index.js';
import { reducedMotion, setReducedMotion } from '../src/render/motion.js';

function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

test('defaults: full volume, motion follows the system preference until the player chooses', () => {
  const calm = createSettings({ storage: memory(), prefersReducedMotion: () => true });
  assert.equal(calm.volume, 1);
  assert.equal(calm.percent, 100);
  assert.equal(calm.reduceMotion, true, 'prefers-reduced-motion is the default');
  assert.equal(createSettings({ storage: memory(), prefersReducedMotion: () => false }).reduceMotion, false);
  // an explicit choice beats the system, both ways
  const st = memory();
  const s = createSettings({ storage: st, prefersReducedMotion: () => true });
  s.setReduceMotion(false);
  assert.equal(s.reduceMotion, false);
  assert.equal(st.data.get(SETTINGS_KEYS.reduceMotion), '0');
  assert.equal(createSettings({ storage: st, prefersReducedMotion: () => true }).reduceMotion, false, 'the choice survives a reload');
});

test('both settings persist under roots-threads.settings.* and come back at boot', () => {
  assert.equal(SETTINGS_KEYS.volume, 'roots-threads.settings.volume');
  assert.equal(SETTINGS_KEYS.reduceMotion, 'roots-threads.settings.reduceMotion');
  const st = memory();
  const s = createSettings({ storage: st, prefersReducedMotion: () => false });
  s.setVolume(0.35);
  s.setReduceMotion(true);
  assert.equal(st.data.get(SETTINGS_KEYS.volume), '0.35');
  assert.equal(st.data.get(SETTINGS_KEYS.reduceMotion), '1');
  const again = createSettings({ storage: st, prefersReducedMotion: () => false });
  assert.equal(again.volume, 0.35);
  assert.equal(again.percent, 35);
  assert.equal(again.reduceMotion, true);
});

test('volume is clamped to 0..1 in whole percents; garbage is ignored; storage garbage falls back to the defaults', () => {
  const s = createSettings({ storage: memory(), prefersReducedMotion: () => false });
  s.setVolume(1.7);
  assert.equal(s.volume, 1);
  s.setVolume(-3);
  assert.equal(s.volume, 0);
  s.setVolume(0.123456);
  assert.equal(s.volume, 0.12);
  s.setVolume(NaN);
  s.setVolume('loud');
  assert.equal(s.volume, 0.12);
  const bad = createSettings({ storage: memory({ [SETTINGS_KEYS.volume]: 'loud', [SETTINGS_KEYS.reduceMotion]: 'maybe' }), prefersReducedMotion: () => true });
  assert.equal(bad.volume, 1);
  assert.equal(bad.reduceMotion, true, 'an unreadable choice counts as not chosen');
  assert.equal(createSettings({ storage: memory({ [SETTINGS_KEYS.volume]: '7' }) }).volume, 1, 'out of range is clamped');
  assert.equal(createSettings({ storage: memory({ [SETTINGS_KEYS.volume]: '' }) }).volume, 1);
});

test('blocked or missing storage: the settings still work for the session', () => {
  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  for (const storage of [throwing, null]) {
    const s = createSettings({ storage, prefersReducedMotion: () => false });
    s.setVolume(0.4);
    s.setReduceMotion(true);
    assert.equal(s.volume, 0.4);
    assert.equal(s.reduceMotion, true);
  }
});

test('onChange fires on real changes only and can be unsubscribed', () => {
  const s = createSettings({ storage: memory(), prefersReducedMotion: () => false });
  let calls = 0;
  const off = s.onChange(() => calls++);
  s.setVolume(0.5);
  s.setVolume(0.5);
  s.setReduceMotion(false); // already the system's value, but the first explicit choice is a change
  s.setReduceMotion(false);
  assert.equal(calls, 2);
  off();
  s.setVolume(0.9);
  assert.equal(calls, 2);
});

test('texts', () => {
  assert.equal(volumeText(35), '35 %');
  assert.equal(motionText(true), 'Меньше движения: вкл');
  assert.equal(motionText(false), 'Меньше движения: выкл');
});

test('render motion flag: off by default, set and read back', () => {
  assert.equal(reducedMotion(), false);
  setReducedMotion(true);
  assert.equal(reducedMotion(), true);
  setReducedMotion(0);
  assert.equal(reducedMotion(), false);
});

// ---- audio: the master gain follows the volume --------------------------------------------------------------------

/** An AudioContext stand-in: every node is a recording stub, params keep their last target. */
function fakeContext() {
  const nodes = [];
  const param = (v = 0) => ({
    value: v,
    targets: [],
    setValueAtTime(x) { this.value = x; return this; },
    setTargetAtTime(x) { this.value = x; this.targets.push(x); return this; },
    linearRampToValueAtTime(x) { this.value = x; return this; },
    exponentialRampToValueAtTime(x) { this.value = x; return this; },
    cancelScheduledValues() { return this; },
    cancelAndHoldAtTime() { return this; },
  });
  const node = () => {
    const store = {};
    const n = new Proxy(function stub() {}, {
      get(_, key) {
        if (key === 'then') return undefined;
        if (key in store) return store[key];
        if (key === 'gain' || key === 'frequency' || key === 'Q' || key === 'detune' || key === 'pan' || key === 'threshold' || key === 'knee' || key === 'ratio' || key === 'attack' || key === 'release' || key === 'delayTime') return (store[key] = param());
        return (...args) => (args.length && typeof args[0] === 'object' && args[0] && 'gain' in args[0] ? args[0] : n);
      },
      set(_, key, v) {
        store[key] = v;
        return true;
      },
    });
    nodes.push(n);
    return n;
  };
  const ctx = {
    state: 'running',
    sampleRate: 8000,
    currentTime: 0,
    destination: node(),
    createBuffer: (ch, len) => ({ length: len, numberOfChannels: ch, duration: len / 8000, getChannelData: () => new Float32Array(len) }),
    resume() { this.state = 'running'; return Promise.resolve(); },
    suspend() { this.state = 'suspended'; return Promise.resolve(); },
  };
  return new Proxy(ctx, {
    get(t, key) {
      if (key in t) return t[key];
      if (typeof key === 'string' && key.startsWith('create')) return () => node();
      return undefined;
    },
  });
}

test('audio: setVolume scales the master gain (squared), M still mutes, and it works before the context exists', () => {
  const ctx = fakeContext();
  const audio = createAudio({ context: ctx });
  audio.setVolume(0.5); // before unlock: remembered
  assert.equal(audio.volume, 0.5);
  audio.setMuted(false);
  audio.unlock();
  const master = audio.debug.master;
  assert.ok(master, 'the graph is built');
  assert.ok(Math.abs(master.gain.value - 0.9 * 0.25) < 1e-9, `master ${master.gain.value}`);
  audio.setVolume(1);
  assert.ok(Math.abs(master.gain.value - 0.9) < 1e-9);
  audio.setVolume(0);
  assert.equal(master.gain.value, 0);
  audio.setVolume(0.8);
  audio.setMuted(true);
  assert.equal(master.gain.value, 0, 'muted stays silent at any volume');
  audio.setVolume(0.6);
  assert.equal(master.gain.value, 0, 'moving the slider while muted does not unmute');
  audio.setMuted(false);
  assert.ok(Math.abs(master.gain.value - 0.9 * 0.36) < 1e-9, 'unmuting returns to the chosen volume');
  audio.setVolume(NaN);
  audio.setVolume('x');
  assert.equal(audio.volume, 0.6, 'garbage is ignored');
  audio.setVolume(9);
  assert.equal(audio.volume, 1, 'clamped');
});

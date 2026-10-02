// Player settings of the pause page: the volume (0..100 %) and «Меньше движения». Kept in localStorage under
// roots-threads.settings.* (guarded: with blocked storage they live in memory for the session) and applied at boot by
// main.js. The logic (createSettings) is DOM-free; initSettingsPanel wires the pause-page controls to the actions.
//   settings.volume          0..1, whole percents (default 1)
//   settings.reduceMotion    boolean; until the player chooses, follows the system's prefers-reduced-motion
//   settings.setVolume(v) / setReduceMotion(on) / onChange(fn) -> unsubscribe

export const SETTINGS_KEYS = {
  volume: 'roots-threads.settings.volume',
  reduceMotion: 'roots-threads.settings.reduceMotion',
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function defaultStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function systemPrefersReducedMotion() {
  try {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/** `storage`: a localStorage-like object (or null); `prefersReducedMotion`: () => boolean, the default of the toggle. */
export function createSettings({ storage = defaultStorage(), prefersReducedMotion = systemPrefersReducedMotion } = {}) {
  const listeners = new Set();
  const read = (key) => {
    try {
      return storage ? storage.getItem(key) : null;
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      if (storage) storage.setItem(key, value);
    } catch {
      /* storage unavailable or full: the choice holds for this session only */
    }
  };

  let volume = 1;
  const storedVolume = read(SETTINGS_KEYS.volume);
  if (storedVolume !== null && storedVolume !== '' && Number.isFinite(Number(storedVolume))) volume = Math.round(clamp01(Number(storedVolume)) * 100) / 100;
  const storedMotion = read(SETTINGS_KEYS.reduceMotion);
  let chosen = storedMotion === '1' || storedMotion === '0' ? storedMotion === '1' : null; // null: not chosen yet
  const fire = () => {
    for (const fn of [...listeners]) fn(api);
  };

  const api = {
    get volume() {
      return volume;
    },
    get percent() {
      return Math.round(volume * 100);
    },
    get reduceMotion() {
      return chosen === null ? Boolean(prefersReducedMotion()) : chosen;
    },
    setVolume(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      const next = Math.round(clamp01(n) * 100) / 100;
      if (next === volume) return;
      volume = next;
      write(SETTINGS_KEYS.volume, String(volume));
      fire();
    },
    setReduceMotion(on) {
      const next = Boolean(on);
      if (chosen === next) return;
      chosen = next;
      write(SETTINGS_KEYS.reduceMotion, next ? '1' : '0');
      fire();
    },
    /** fn(settings) after every change; returns an unsubscribe function. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return api;
}

/** The settings of this page (created on first use, so importing the module has no side effects). */
let shared = null;
export function getSettings() {
  return shared || (shared = createSettings());
}

export const volumeText = (percent) => `${Math.round(percent)} %`;
export const motionText = (on) => `Меньше движения: ${on ? 'вкл' : 'выкл'}`;

/**
 * Wires the controls inside `root` (markup in hud.js, .pause-page): `input[data-set="volume"]` (range 0..100),
 * `.set-val` (its percent) and `[data-act="motion-toggle"]`. Changes go through `actions` (setVolume, setReducedMotion);
 * the controls repaint from the settings, which also toggle the `reduce-motion` class on root (it calms the CSS
 * animations of the HUD). Returns an unsubscribe function.
 */
export function initSettingsPanel(root, actions, settings = getSettings()) {
  const slider = root.querySelector('input[data-set="volume"]');
  const val = root.querySelector('.set-val');
  const toggle = root.querySelector('[data-act="motion-toggle"]');
  const paint = () => {
    const percent = settings.percent;
    if (slider) {
      if (slider.value !== String(percent)) slider.value = String(percent);
      slider.setAttribute('aria-valuetext', volumeText(percent));
      slider.style.setProperty('--fill', `${percent}%`);
    }
    if (val) val.textContent = volumeText(percent);
    if (toggle) {
      const on = settings.reduceMotion;
      toggle.textContent = motionText(on);
      toggle.setAttribute('aria-pressed', String(on));
    }
    root.classList.toggle('reduce-motion', settings.reduceMotion);
  };
  if (slider) {
    slider.addEventListener('input', () => actions.setVolume(Number(slider.value) / 100));
    // a click on the slider must stay on the page: nothing below it (the game) hears it
    for (const type of ['pointerdown', 'pointerup', 'click']) slider.addEventListener(type, (ev) => ev.stopPropagation());
  }
  if (toggle) {
    toggle.addEventListener('click', (ev) => {
      actions.setReducedMotion(!settings.reduceMotion);
      // hud.js lets go of a button after a click; by keyboard (Enter) keep the focus here so Tab goes on from this spot
      if (ev.detail === 0) requestAnimationFrame(() => toggle.focus());
    });
  }
  const off = settings.onChange(paint);
  paint();
  return off;
}

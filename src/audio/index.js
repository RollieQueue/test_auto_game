// STUB audio: silent. The UI/audio task replaces this module
// (same exported API: createAudio() -> { unlock(), update(state, dt), setMuted(bool), muted }).

export function createAudio() {
  let muted = false;
  return {
    unlock() {},
    update() {},
    setMuted(value) {
      muted = Boolean(value);
    },
    get muted() {
      return muted;
    },
  };
}

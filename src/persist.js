// Saving and loading a game in localStorage. STUB: the persistence task replaces it (same API).
// The state passed in is never mutated; loadSave() returns a fresh, playable state or null.

/** True when a saved game can be continued. */
export function hasSave() {
  return false;
}

/** The saved game as a full state object (phase 'paused'), or null when there is none or it is unreadable. */
export function loadSave() {
  return null;
}

/** Writes the game now. */
export function saveNow(state) {
  void state;
}

/** Forgets the saved game. */
export function clearSave() {}

/** Called every frame while playing; autosaves now and then. */
export function tick(state, dtReal) {
  void state;
  void dtReal;
}

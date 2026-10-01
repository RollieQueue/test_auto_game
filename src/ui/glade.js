// The glade's name for the pages: «Поляна: Сосновый бор на холме · №7». world.name is made by world generation
// (a Russian name for the glade's character); a world without one falls back to the number alone.
const text = (s) => (typeof s === 'string' ? s.trim() : '');

/** «Поляна: <name> · №<seed>», or «Поляна №<seed>» when the world has no name. `word` replaces «Поляна» (e.g. «Новая поляна»). */
export function gladeLabel(state, word = 'Поляна') {
  const seed = state && state.seed !== undefined && state.seed !== null ? state.seed : state && state.world && state.world.seed;
  const num = seed === undefined || seed === null ? '' : `№${seed}`;
  const name = text(state && state.world && state.world.name);
  if (name) return num ? `${word}: ${name} · ${num}` : `${word}: ${name}`;
  return num ? `${word} ${num}` : word;
}

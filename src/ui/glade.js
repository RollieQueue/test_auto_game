// The glade's name for the pages: «Поляна: Сосновый бор на холме · №7». world.name is made by world generation
// (a Russian name for the glade's character); a world without one falls back to the number alone.
const text = (s) => (typeof s === 'string' ? s.trim() : '');

/**
 * The label in two parts: `head` («Поляна: <name>», the part that may be cut short with an ellipsis when the line is too
 * narrow) and `tail` (« · №<seed>», which always stays whole). head + tail is the whole label.
 * `word` replaces «Поляна» (e.g. «Новая поляна»); a world without a name gives «Поляна №<seed>» (all in the tail).
 */
export function gladeParts(state, word = 'Поляна') {
  const seed = state && state.seed !== undefined && state.seed !== null ? state.seed : state && state.world && state.world.seed;
  const num = seed === undefined || seed === null ? '' : `№${seed}`;
  const name = text(state && state.world && state.world.name);
  if (name) return { head: `${word}: ${name}`, tail: num ? ` · ${num}` : '' };
  return num ? { head: word, tail: ` ${num}` } : { head: word, tail: '' };
}

/** «Поляна: <name> · №<seed>», or «Поляна №<seed>» when the world has no name. `word` replaces «Поляна» (e.g. «Новая поляна»). */
export function gladeLabel(state, word = 'Поляна') {
  const { head, tail } = gladeParts(state, word);
  return head + tail;
}

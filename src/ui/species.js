// Title page: «Каким грибом ты будешь?» - a row of four specimen cards (fly agaric, porcini, saffron milk cap, chanterelle).
// A click, or the arrow keys (Tab to a card and Enter / Space), picks one; actions.setSpecies keeps it for the glade that starts.
// The pictures are <img> elements set through .src, so the single-file build's bootstrap shim finds them embedded.
import { gladeNote, parseSpecies, speciesCards, stepSpecies } from './species-logic.js';

const ARROWS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

function node(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * host: the empty `.species` block of the title page. actions: { setSpecies(id) }.
 * Returns { show(state, hasSave) } (the title page calls it for every new game state) and { current() }.
 */
export function createSpeciesPicker(host, actions) {
  const cards = new Map();
  let current = null;
  let state = null;

  const head = node('div', 'sp-head', 'Каким грибом ты будешь?');
  const row = node('div', 'sp-row');
  host.setAttribute('role', 'radiogroup');
  host.setAttribute('aria-label', 'Вид гриба');
  for (const c of speciesCards()) {
    const btn = node('button', 'sp-card');
    btn.type = 'button';
    btn.dataset.sp = c.id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.setAttribute('aria-label', `${c.name}, ${c.latin}. ${c.partnerLine}. ${c.strength}`);
    btn.title = c.tip;
    const pic = node('span', 'sp-pic');
    const img = node('img');
    img.alt = '';
    img.draggable = false;
    img.addEventListener('error', () => img.remove());
    img.src = c.art;
    pic.append(img);
    const tag = node('span', 'sp-tag');
    btn.append(pic, node('span', 'sp-name', c.name), node('span', 'sp-latin', c.latin), node('span', 'sp-partner', c.partnerLine), node('span', 'sp-strength', c.strength), tag);
    row.append(btn);
    cards.set(c.id, { btn, tag });
  }
  host.append(head, row);

  function paint() {
    for (const [id, c] of cards) {
      const on = id === current;
      c.btn.classList.toggle('sel', on);
      c.btn.setAttribute('aria-checked', String(on));
      const note = state ? gladeNote(state, id) : '';
      if (c.tag.textContent !== note) c.tag.textContent = note;
      c.tag.hidden = note === '';
    }
  }

  function choose(id, focus = false) {
    if (!cards.has(id)) return;
    current = id;
    actions.setSpecies?.(id);
    paint();
    if (focus) cards.get(id).btn.focus({ preventScroll: true });
  }

  row.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.sp-card');
    if (!btn) return;
    choose(btn.dataset.sp);
    btn.blur(); // like the other buttons: a later Enter or Space starts the game
  });
  // Enter or Space on a focused card picks it (the page's own Enter / Space would start the game)
  row.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || (ev.code !== 'Enter' && ev.code !== 'Space' && ev.code !== 'NumpadEnter')) return;
    const btn = ev.target.closest?.('.sp-card');
    if (!btn) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (!ev.repeat) choose(btn.dataset.sp);
  });
  // arrows step through the species anywhere on the title page (the help page, when open, keeps them for scrolling)
  window.addEventListener('keydown', (ev) => {
    const dir = ARROWS[ev.code];
    if ((!dir && ev.code !== 'Tab') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const hud = host.closest('#hud');
    if (!hud || hud.dataset.phase !== 'title' || hud.querySelector('.help-screen.open')) return;
    if (ev.code === 'Tab') {
      // the game's own (hidden) tool buttons come first in the page: the first Tab goes straight to the chosen card
      if (host.closest('.title-screen')?.contains(document.activeElement)) return;
      ev.preventDefault();
      (cards.get(current) ?? cards.values().next().value).btn.focus({ preventScroll: true });
      return;
    }
    if (ev.shiftKey) return;
    ev.preventDefault();
    choose(stepSpecies(current, dir), document.activeElement?.closest?.('.sp-card') != null);
  });

  return {
    /** A new game state is on the title page: show its pick (and the glade's note); hasSave words the head. */
    show(next, hasSave = false) {
      state = next;
      current = parseSpecies(next.flags.species) ?? current;
      head.textContent = hasSave ? 'Вид гриба для новой поляны' : 'Каким грибом ты будешь?';
      paint();
    },
    current: () => current,
  };
}

// «Пометки на полях»: the HUD side of the achievements. `createMarks` watches the game each frame (marks-logic.js),
// remembers what was earned (marks-store.js) and says it in a margin note; `buildMarksPage` is the atlas's second tab.
import { flourish, icons } from './icons.js';
import { MARKS, checkMarks, markById, marksModel, newTracker, noteText } from './marks-logic.js';
import { createMarksStore } from './marks-store.js';
import { slipOf } from './slips-logic.js';

const NOTE_GAP = 3.2; // s between two marks' notes when several are earned at once (the slips queue up by themselves: no gap)
const NOTE_LIFE = 10;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The tab bar of the atlas: `active` is 'finds' or 'marks'; the marks tab shows how many marks are inked. */
export function tabsHtml(active, earned = 0, total = MARKS.length) {
  const tab = (id, label, extra = '') =>
    `<button class="atl-tab${active === id ? ' on' : ''}" type="button" role="tab" aria-selected="${active === id}" data-act="atlas-tab" data-tab="${id}">${label}${extra}</button>`;
  return `<div class="atl-tabs" role="tablist" aria-label="Страницы атласа">${tab('finds', 'Находки')}${tab('marks', 'Пометки', ` <span class="atl-tab-n">${earned}/${total}</span>`)}</div>`;
}

function markHtml(e) {
  const ico = icons[e.icon] || icons.mk_fruit;
  if (e.earned) {
    const where = [e.date, e.glade].filter(Boolean).join(' · ');
    return `<article class="mk-entry earned" data-mark="${e.id}">
      <div class="mk-ico">${ico}</div>
      <div class="mk-text"><h4 class="mk-title">${esc(e.title)}</h4>
      <p class="mk-line">${esc(e.line)}</p>
      <div class="mk-when">${esc(where) || 'записано'}</div></div></article>`;
  }
  const more = e.progressText ? ` <span class="mk-prog">${esc(e.progressText)}</span>` : '';
  return `<article class="mk-entry pencil" data-mark="${e.id}">
    <div class="mk-ico">${ico}</div>
    <div class="mk-text"><h4 class="mk-title">${esc(e.title)}</h4>
    <p class="mk-cond">${esc(e.cond)}${more}</p></div></article>`;
}

/** Inner HTML of the marks tab; `memory` is the store's memory, `kinds` the atlas's lifetime counts. */
export function buildMarksPage(memory, kinds = {}) {
  const m = marksModel(memory, kinds);
  return `
    <div class="overline">Тетрадь натуралиста · поля страниц</div>
    <h2>Пометки на полях</h2>
    ${flourish}
    ${tabsHtml('marks', m.earned, m.total)}
    <div class="atl-head">
      <div class="sub">Чернилом записано то, что удалось на самом деле; карандашом намечено то, что ещё предстоит. Пометки помнят все игры.</div>
      <div class="atl-progress">${icons.mk_fruit}<span>${esc(m.progress)}</span></div>
    </div>
    <div class="mk-grid">${m.entries.map(markHtml).join('')}</div>
    <div class="actions"><button class="ink-btn" data-act="atlas-close" type="button">Закрыть <kbd>A</kbd></button></div>`;
}

/**
 * The watcher. `slips` shows an earned mark on a paper slip (slips.js); without it `notes` is the margin notes
 * (notes.say) the mark is said in. `atlasStore` the lifetime atlas (its counts feed two marks);
 * `storage` and `now` are for tests. `update(state, dt)` is called every frame, after the frame's events are final.
 */
export function createMarks({ notes, slips = null, atlasStore = null, storage, now } = {}) {
  const store = createMarksStore(storage, now);
  let tracker = newTracker();
  let owner = null; // the state the tracker belongs to: a new game (a new state object) starts a fresh one
  let ownerSeed = null;
  const queue = []; // earned ids waiting for their note
  let wait = 0;
  // the stores read the storage on every call: the frame works on a copy that is refreshed now and then
  let memory = store.memory();
  let kindsNow = atlasStore ? atlasStore.kinds() : {};
  let age = 0;
  const kinds = () => (atlasStore ? atlasStore.kinds() : {});

  function say(id) {
    const mark = markById(id);
    if (mark && slips) slips.show(slipOf(mark));
    else if (mark && notes) notes.say({ key: `mark:${id}`, text: noteText(mark), tone: 'good', icon: mark.icon, life: NOTE_LIFE });
  }

  return {
    store,
    update(state, dt = 0) {
      if (!state || state.phase === 'title') return;
      if (state !== owner || state.seed !== ownerSeed) {
        owner = state;
        ownerSeed = state.seed;
        tracker = newTracker();
        store.noteGame(state);
        age = Infinity;
      }
      age += dt;
      if (age >= 1.5) {
        memory = store.memory();
        kindsNow = kinds();
        age = 0;
      }
      const ids = checkMarks(state, state.events, tracker, memory, kindsNow);
      if (ids.length) {
        queue.push(...store.award(ids, state));
        memory = store.memory();
      }
      wait -= dt;
      if (queue.length && wait <= 0) {
        say(queue.shift());
        wait = slips ? 0 : NOTE_GAP;
      }
    },
    /** What the atlas tab shows. */
    pageHtml: () => buildMarksPage(store.memory(), kinds()),
    /** { earned, total } for the tab label. */
    counts() {
      const m = marksModel(store.memory(), kinds());
      return { earned: m.earned, total: m.total };
    },
  };
}

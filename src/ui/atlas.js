// The «Атлас находок» page: one entry per kind of curiosity, discovered ones with the naturalist's note, the
// rest as faint «?» silhouettes. Pictures come from assets/art/manifest.json (group 'decor') when the art helper
// has produced them; otherwise an ink-framed initial stands in. The page never depends on the art being there.
import { FINDS_INTRO } from '../content/finds.js';
import { icons, flourish } from './icons.js';
import { artByKind, plateByKind, atlasModel, openableKinds, stepKind } from './atlas-logic.js';
import { buildSpecimen, paintSpecimen } from './specimen.js';

const MANIFEST_URL = 'assets/art/manifest.json';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const dots = (n) => '●'.repeat(n) + '<span class="off">' + '●'.repeat(4 - n) + '</span>';

let artPromise = null;

/**
 * Fetches the manifest (a missing or broken one means no art); a failed attempt is retried on the next call.
 * Resolves { decor: { kind: file }, plate: { kind: file } }: small cutouts for the grid, large pictures for the page.
 */
export function loadArt() {
  if (artPromise) return artPromise;
  artPromise = fetch(MANIFEST_URL)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => {
      if (!m) artPromise = null;
      return { decor: artByKind(m), plate: plateByKind(m) };
    })
    .catch(() => {
      artPromise = null;
      return { decor: {}, plate: {} };
    });
  return artPromise;
}

function picture(e) {
  const initial = `<span class="atl-initial">${esc(e.discovered ? e.initial : '?')}</span>`;
  if (!e.art) return `<div class="atl-pic">${initial}</div>`;
  return `<div class="atl-pic has-img"><img src="${esc(e.art)}" alt="" draggable="false" />${initial}</div>`;
}

function entryHtml(e) {
  if (!e.discovered) {
    return `<article class="atl-entry unknown">${picture(e)}
      <div class="atl-head-text"><h4 class="atl-name">не открыто</h4>
      <div class="atl-zone">лежит: ${esc(e.zone)}</div></div></article>`;
  }
  const count = !e.here
    ? e.total > 0
      ? `на этой поляне пока нет`
      : `на этой поляне не лежит`
    : e.total > e.found
      ? `${e.found} из ${e.total} на поляне`
      : e.total > 1
        ? `все ${e.total} на поляне`
        : 'найдена на поляне';
  const ever = e.ever > e.found ? ` <span class="atl-ever">· в тетради: ${e.ever}</span>` : '';
  return `<article class="atl-entry found${e.here ? ' here' : ''}" data-kind="${e.kind}" data-open="${e.kind}" tabindex="0" role="button" title="Открыть страницу находки" aria-label="${esc(e.name)}: открыть страницу">${picture(e)}
      <div class="atl-head-text"><h4 class="atl-name">${esc(e.name)}</h4>
      <div class="atl-latin">${esc(e.latin)}</div>
      <div class="atl-zone">${esc(e.zone)} · <span class="atl-rar" title="редкость">${dots(e.rarity)}</span></div></div>
      ${e.here ? '<span class="atl-here-mark" title="найдено на этой поляне">здесь</span>' : ''}
      <p class="atl-note">${esc(e.note)}</p>
      <div class="atl-count">${count}${ever}</div></article>`;
}

/** Inner HTML of the atlas page; `lifetime` is { [kind]: n } from the atlas store (null: this game only). */
export function buildAtlas(state, art = {}, lifetime = null) {
  const m = atlasModel(state, art, lifetime);
  return `
    <div class="overline">Тетрадь натуралиста · страница находок</div>
    <h2>Атлас находок</h2>
    ${flourish}
    <div class="atl-head">
      <div>
        <div class="sub">${esc(FINDS_INTRO.replace(/^Атлас находок\.\s*/, ''))}</div>
        <div class="atl-here-line">на этой поляне найдено ${m.hereKinds} из ${m.gladeKinds} ${m.gladeKinds === 1 ? 'вида' : 'видов'}; остальные виды лежат на других полянах</div>
      </div>
      <div class="atl-progress">${icons.find}<span>${m.progress}</span></div>
    </div>
    <div class="atl-grid">
      ${m.entries.map(entryHtml).join('')}
      <aside class="atl-tip">Нажми на найденное, чтобы открыть страницу. Редкое лежит глубже: тянись вниз, к галечнику.</aside>
    </div>
    <div class="actions"><button class="ink-btn" data-act="atlas-close" type="button">Закрыть <kbd>A</kbd></button></div>`;
}

/** Fills `page` on open (and again when the art manifest arrives). */
export function createAtlas(page, store = null) {
  let art = { decor: {}, plate: {} };
  let state = null;
  let token = 0;
  let kind = null; // the kind whose specimen page is open, null for the grid

  // a picture that fails to load falls back to the initial
  page.addEventListener(
    'error',
    (ev) => {
      const img = ev.target;
      if (img && img.tagName === 'IMG') {
        img.parentElement.classList.remove('has-img');
        img.remove();
      }
    },
    true,
  );

  const lifetime = () => (store ? store.kinds() : null);

  function paint() {
    const top = page.scrollTop;
    const spec = kind ? buildSpecimen(state, kind, { ...art.decor, ...art.plate }, lifetime()) : '';
    if (kind && !spec) kind = null; // not openable (unknown or not found): back to the grid
    page.classList.toggle('spec-mode', Boolean(kind));
    page.innerHTML = spec || buildAtlas(state, art.decor, lifetime());
    page.scrollTop = kind ? 0 : top;
    const canvas = page.querySelector('.spec-canvas');
    if (canvas) paintSpecimen(canvas);
  }

  function show(next) {
    if (!state) return;
    kind = next;
    paint();
    page.scrollTop = 0;
    if (kind) page.querySelector('.spec-nav [data-act="spec-back"]')?.focus({ preventScroll: true });
  }

  const kinds = () => openableKinds(atlasModel(state, {}, lifetime()));
  const go = (dir) => {
    const next = stepKind(kinds(), kind, dir);
    if (next && next !== kind) show(next);
  };

  page.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (btn && kind) {
      if (btn.dataset.act === 'spec-back') show(null);
      else if (btn.dataset.act === 'spec-prev') go(-1);
      else if (btn.dataset.act === 'spec-next') go(1);
      return;
    }
    const card = ev.target.closest('[data-open]');
    if (card && !kind) show(card.dataset.open);
  });

  return {
    open(s) {
      state = s;
      kind = null;
      if (store) store.sync(s); // finds made while the store could not hear them (a loaded save)
      paint();
      const mine = ++token;
      loadArt().then((a) => {
        if (mine !== token || !state || JSON.stringify(a) === JSON.stringify(art)) return;
        art = a;
        paint();
      });
    },
    close() {
      token++;
      state = null;
      kind = null;
      page.classList.remove('spec-mode');
    },
    /** True while a specimen page is open (Esc and a click outside go back to the grid, not out of the atlas). */
    isSpecimen: () => kind !== null,
    /** Back from a specimen page to the grid; false when the grid is already showing. */
    back() {
      if (kind === null) return false;
      show(null);
      return true;
    },
    /**
     * Keyboard on the atlas page: ← → between specimens, Esc / Space / Enter back to the grid, Enter on a focused card
     * opens it. Returns true when the key was used.
     */
    key(code) {
      if (!state) return false;
      if (kind) {
        if (code === 'ArrowLeft') return go(-1), true;
        if (code === 'ArrowRight') return go(1), true;
        if (code === 'Escape' || code === 'Space' || code === 'Enter') return show(null), true;
        return false;
      }
      if (code === 'Enter' || code === 'Space') {
        const card = document.activeElement && document.activeElement.closest ? document.activeElement.closest('[data-open]') : null;
        if (card && page.contains(card)) return show(card.dataset.open), true;
      }
      return false;
    },
  };
}

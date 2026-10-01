// The «Атлас находок» page: one entry per kind of curiosity, discovered ones with the naturalist's note, the
// rest as faint «?» silhouettes. Pictures come from assets/art/manifest.json (group 'decor') when the art helper
// has produced them; otherwise an ink-framed initial stands in. The page never depends on the art being there.
import { FINDS_INTRO } from '../content/finds.js';
import { icons, flourish } from './icons.js';
import { artByKind, atlasModel } from './atlas-logic.js';

const MANIFEST_URL = 'assets/art/manifest.json';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const dots = (n) => '●'.repeat(n) + '<span class="off">' + '●'.repeat(4 - n) + '</span>';

let artPromise = null;

/** Fetches the manifest (a missing or broken one means no art); a failed attempt is retried on the next call. */
export function loadArt() {
  if (artPromise) return artPromise;
  artPromise = fetch(MANIFEST_URL)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => {
      const art = artByKind(m);
      if (!m) artPromise = null;
      return art;
    })
    .catch(() => {
      artPromise = null;
      return {};
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
  return `<article class="atl-entry found${e.here ? ' here' : ''}" data-kind="${e.kind}">${picture(e)}
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
      <aside class="atl-tip">Редкое лежит глубже: тянись вниз, к галечнику. Атлас помнит все поляны.</aside>
    </div>
    <div class="actions"><button class="ink-btn" data-act="atlas-close" type="button">Закрыть <kbd>A</kbd></button></div>`;
}

/** Fills `page` on open (and again when the art manifest arrives). */
export function createAtlas(page, store = null) {
  let art = {};
  let state = null;
  let token = 0;

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

  function paint() {
    const top = page.scrollTop;
    page.innerHTML = buildAtlas(state, art, store ? store.kinds() : null);
    page.scrollTop = top;
  }

  return {
    open(s) {
      state = s;
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
    },
  };
}

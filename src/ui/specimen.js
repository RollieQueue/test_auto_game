// The full-screen specimen page of the finds atlas: a large drawing on the left, the naturalist's entry on the right.
// buildSpecimen() returns the inner HTML (tested without a DOM); paintSpecimen() draws the procedural picture into the
// canvas it contains when there is no art asset (it reuses the renderer's own decor drawers, read-only).
import { flourish } from './icons.js';
import { specimenModel } from './atlas-logic.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const dots = (n) => '●'.repeat(n) + '<span class="off">' + '●'.repeat(4 - n) + '</span>';

export const CANVAS_PX = 760;

/** Counts «3 из 5 на поляне», «все 5», «пока нет» as the page words them. */
export function hereWords(e) {
  if (e.found === 0) return e.total > 0 ? `пока не найдена, здесь лежит: ${e.total}` : 'здесь такого не лежит';
  if (e.total > e.found) return `найдено ${e.found} из ${e.total}`;
  return e.total > 1 ? `найдены все ${e.total}` : 'найдена';
}

function whereRows(e) {
  const rows = [];
  const first = e.spots[0];
  if (first) {
    const depth = first.depthCm === null ? '' : `, на глубине ${first.depthCm} см`;
    rows.push(['Где', `${esc(first.horizon || 'в земле')}${depth}`]);
    rows.push(['Когда', `${first.atText} от начала наблюдений${first.season ? `, ${first.season}` : ''}`]);
    if (e.spots.length > 1) {
      const rest = e.spots.slice(1, 4).map((s) => `${esc(s.horizon || 'в земле')}${s.depthCm === null ? '' : `, ${s.depthCm} см`}, на ${s.atText}`);
      rows.push(['Ещё', rest.join('; ') + (e.spots.length > 4 ? '…' : '')]);
    }
  } else {
    rows.push(['Где', 'на этой поляне не находили; запись сделана на другой']);
  }
  rows.push(['На этой поляне', hereWords(e)]);
  rows.push(['В тетради', e.ever > 1 ? `${e.ever} находок за все поляны` : e.ever === 1 ? '1 находка за все поляны' : '—']);
  return rows;
}

/** Picture block: an art file when there is one, otherwise the canvas that paintSpecimen() fills. */
function plate(e, artFile) {
  const cap = `Fig. ${e.index + 1} · ${esc(e.latin)}`;
  const inner = artFile
    ? `<img class="spec-img" src="${esc(artFile)}" alt="${esc(e.name)}" draggable="false" />`
    : `<canvas class="spec-canvas" width="${CANVAS_PX}" height="${CANVAS_PX}" data-kind="${e.kind}" data-seed="${e.drawSeed}" aria-label="${esc(e.name)}"></canvas>`;
  return `<figure class="spec-plate">${inner}<figcaption>${cap}</figcaption></figure>`;
}

/**
 * Inner HTML of the specimen page for `kind`, or '' when the kind is unknown or not found yet (the atlas keeps those
 * cards closed). `art`: { kind: file } from the manifest (a 'plate' picture, else a 'decor' cutout).
 */
export function buildSpecimen(state, kind, art = {}, lifetime = null) {
  const e = specimenModel(state, kind, lifetime);
  if (!e || !e.discovered) return '';
  const many = e.count > 1;
  const rows = whereRows(e)
    .map(([k, v]) => `<div class="spec-row"><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');
  return `
    <div class="spec" data-kind="${e.kind}">
      <div class="spec-left">${plate(e, art[kind] || null)}</div>
      <div class="spec-right">
        <div class="overline">Тетрадь натуралиста · атлас находок · ${e.index + 1} из ${e.count}</div>
        <h2 class="spec-name">${esc(e.name)}</h2>
        <div class="spec-latin">${esc(e.latin)}</div>
        <div class="spec-meta"><span class="spec-zone">лежит: ${esc(e.zone)}</span><span class="spec-rar" title="редкость">${dots(e.rarity)} <i>${esc(e.rarityWord)}</i></span></div>
        ${flourish}
        <p class="spec-note">${esc(e.note)}</p>
        <h3 class="spec-sub">Пометки натуралиста</h3>
        <p class="spec-more">${esc(e.more)}</p>
        <dl class="spec-where">${rows}</dl>
      </div>
      <div class="spec-nav">
        <button class="ink-btn spec-arrow" data-act="spec-prev" type="button" title="Предыдущая находка (←)" aria-label="Предыдущая находка"${many ? '' : ' disabled'}>←</button>
        <button class="ink-btn" data-act="spec-back" type="button">К атласу <kbd>Esc</kbd></button>
        <button class="ink-btn spec-arrow" data-act="spec-next" type="button" title="Следующая находка (→)" aria-label="Следующая находка"${many ? '' : ' disabled'}>→</button>
      </div>
    </div>`;
}

const FILL = 0.76; // share of the plate the drawing's longer side takes
const PROBE = 360;

/** Real extent of a drawing in its own units: { extent (longer side), cx, cy (centre) }, from the alpha of a probe. */
function measure(draw, seed, size) {
  const probe = document.createElement('canvas');
  probe.width = PROBE;
  probe.height = PROBE;
  const c = probe.getContext('2d', { willReadFrequently: true });
  const s = (PROBE * 0.22) / size; // generous: shapes may be several times wider than their nominal size
  c.translate(PROBE / 2, PROBE / 2);
  c.scale(s, s);
  draw(c, seed, size);
  const data = c.getImageData(0, 0, PROBE, PROBE).data;
  let x0 = PROBE;
  let y0 = PROBE;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < PROBE; y++) {
    for (let x = 0; x < PROBE; x++) {
      if (data[(y * PROBE + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { extent: size, cx: 0, cy: 0 };
  return {
    extent: Math.max(x1 - x0 + 1, y1 - y0 + 1) / s,
    cx: ((x0 + x1 + 1) / 2 - PROBE / 2) / s,
    cy: ((y0 + y1 + 1) / 2 - PROBE / 2) / s,
  };
}

let drawers = null;
const loadDrawers = () => (drawers ||= import('../render/decor.js').catch(() => null));

/**
 * Paints the big drawing into `canvas` (from buildSpecimen): the renderer's DRAWERS[kind](ctx, seed, size) on a dark
 * swatch of soil, as if the specimen were pinned to a card. Resolves false when the renderer is unavailable.
 */
export async function paintSpecimen(canvas) {
  const mod = await loadDrawers();
  if (!mod || !canvas.isConnected) return false;
  const kind = canvas.dataset.kind;
  const draw = mod.DRAWERS && mod.DRAWERS[kind];
  const ctx = canvas.getContext('2d');
  if (!draw || !ctx) return false;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  // the soil the specimen lay in: a dark wash with a little grain, so the pale gouache of the drawing reads as drawn
  const g = ctx.createRadialGradient(W * 0.42, H * 0.38, W * 0.05, W / 2, H / 2, W * 0.75);
  g.addColorStop(0, '#5b4330');
  g.addColorStop(0.6, '#3f2d20');
  g.addColorStop(1, '#2a1c13');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const size = mod.DECOR_SIZE[kind] || 30;
  const seed = Number(canvas.dataset.seed) || 1;
  ctx.save();
  try {
    // the drawers know only a nominal width; measure the real extent on a probe, then fit it to the plate
    const fit = measure(draw, seed, size);
    const scale = (W * FILL) / fit.extent;
    ctx.translate(W / 2 - fit.cx * scale, H / 2 - fit.cy * scale);
    ctx.scale(scale, scale);
    draw(ctx, seed, size);
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('specimen drawing failed for', kind, err);
  }
  ctx.restore();
  return true;
}

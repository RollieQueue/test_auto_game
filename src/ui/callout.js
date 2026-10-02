// The first-encounter card (callout-logic.js decides when): a dimmed scene with a spotlight and a hand-drawn ring round the thing,
// an ink arrow from the note to it, and a note with «Понятно». The layer is a .screen of the HUD: hud.js opens, pauses and closes it.
import { arrowPath, hashSeed, placeNote, ringPath, setRichText } from './guide.js';
import { CARDS, CARD_BUTTON, spotRadius, toScreen } from './callout-logic.js';

const f1 = (v) => v.toFixed(1);

/**
 * @param {HTMLElement} host    the .callout layer (a full-viewport .screen)
 * @param {() => {l,t,r,b}[]} rects  the HUD cards (CSS px) the note must not cover
 */
export function createCallout(host, rects) {
  host.innerHTML = `
    <svg class="guide-svg co-svg" width="100%" height="100%" aria-hidden="true">
      <g class="g-ring"><path class="halo" /><path class="ink" /></g>
      <g class="g-arrow"><path class="halo" /><path class="ink" /></g>
    </svg>
    <div class="co-card scrap tape" role="alertdialog" aria-live="assertive">
      <div class="g-title"></div>
      <p class="g-text"></p>
      <button class="ink-btn co-ok" data-act="callout-ok" type="button">${CARD_BUTTON}</button>
    </div>`;
  const ringG = host.querySelector('.g-ring');
  const arrowG = host.querySelector('.g-arrow');
  const ringPaths = [...ringG.querySelectorAll('path')];
  const arrowPaths = [...arrowG.querySelectorAll('path')];
  for (const p of [...ringPaths, ...arrowPaths]) p.setAttribute('pathLength', '1');
  const card = host.querySelector('.co-card');
  const titleEl = host.querySelector('.g-title');
  const textEl = host.querySelector('.g-text');

  let shown = null; // { kind, target: { x, y, spot } } of the card on screen
  let laidOut = '';

  function place(view) {
    const size = { w: card.offsetWidth, h: card.offsetHeight };
    const t = shown.target;
    let tg = null;
    if (t && t.spot) {
      const c = toScreen(view, t.x, t.y);
      const r = spotRadius(view);
      tg = { cx: c.x, cy: c.y, rx: r * 0.8, ry: r * 0.8 };
    }
    const noSpot = !tg;
    host.classList.toggle('no-spot', noSpot);
    host.style.setProperty('--sx', `${f1(tg ? tg.cx : view.cssW / 2)}px`);
    host.style.setProperty('--sy', `${f1(tg ? tg.cy : view.cssH / 2)}px`);
    host.style.setProperty('--sr', `${f1(tg ? tg.rx * 1.35 : 0)}px`);
    let r;
    if (tg) r = placeNote(view, size, tg, [], rects());
    else r = { l: (view.cssW - size.w) / 2, t: (view.cssH - size.h) / 2, r: (view.cssW + size.w) / 2, b: (view.cssH + size.h) / 2 };
    card.style.left = `${Math.round(r.l)}px`;
    card.style.top = `${Math.round(r.t)}px`;
    if (!tg) return;
    const seed = hashSeed(shown.kind);
    const ncx = (r.l + r.r) / 2;
    const ncy = (r.t + r.b) / 2;
    let dx = tg.cx - ncx;
    let dy = tg.cy - ncy;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const hw = (r.r - r.l) / 2;
    const hh = (r.b - r.t) / 2;
    const tEdge = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
    const tail = { x: ncx + dx * (tEdge + 6), y: ncy + dy * (tEdge + 6) };
    const tip = { x: tg.cx - dx * (tg.rx * 1.1 + 8), y: tg.cy - dy * (tg.rx * 1.1 + 8) };
    const ringD = ringPath(tg.cx, tg.cy, tg.rx * 1.08 + 3, tg.ry * 1.08 + 3, seed);
    const arrowD = arrowPath(tail, tip, seed ^ 0x9e3779b9);
    for (const p of ringPaths) p.setAttribute('d', ringD);
    for (const p of arrowPaths) p.setAttribute('d', arrowD);
    ringG.style.setProperty('--cx', `${f1(tg.cx)}px`);
    ringG.style.setProperty('--cy', `${f1(tg.cy)}px`);
    arrowG.style.setProperty('--bx', `${f1(dx * 5)}px`);
    arrowG.style.setProperty('--by', `${f1(dy * 5)}px`);
  }

  return {
    get kind() {
      return shown ? shown.kind : null;
    },
    /** Fills and places the card; the caller opens the layer (setScreen) around it. `target`: { x, y, spot } in world units or null. */
    show(kind, target, view) {
      shown = { kind, target };
      titleEl.textContent = CARDS[kind].title;
      setRichText(textEl, CARDS[kind].text);
      host.dataset.kind = kind;
      host.classList.add('on'); // measurable (display is set by the layer's own .open)
      for (const g of [ringG, arrowG]) {
        g.classList.remove('draw');
        void g.getBoundingClientRect();
        g.classList.add('draw');
      }
      laidOut = '';
      this.layout(view);
    },
    /** Re-places the card when the window changed. */
    layout(view) {
      if (!shown || !view) return;
      const key = `${view.cssW}x${view.cssH}|${view.scale.toFixed(4)}|${view.ox.toFixed(1)}|${view.oy.toFixed(1)}`;
      if (key === laidOut) return;
      laidOut = key;
      place(view);
    },
    hide() {
      shown = null;
      laidOut = '';
      host.classList.remove('on');
    },
  };
}

// The notebook's season calendar: a hand-drawn circle of four seasons with an ink pointer, the day and the hour of
// the day in words, a sun or a moon in the hub, and the weather as a small drawing with a word.
// Numbers come from season-logic.js; this file is the drawing and the guarded DOM writes (it runs every frame).
import { icons } from './icons.js';
import { calendarModel } from './season-logic.js';
import { gradeLine } from './year-logic.js';

const INK = '#3a2a1e';

// Quarters clockwise from the top: spring, summer, autumn, winter. Each is a wedge of a wobbly circle.
const WEDGES = [
  ['spring', 'M32 32 L32 4.4 C41 3.6 55 11 59.6 31.6 Z', '#8fb55a'],
  ['summer', 'M32 32 L59.6 31.6 C60.4 44 52 58 32.4 59.6 Z', '#e3b23c'],
  ['autumn', 'M32 32 L32.4 59.6 C20 60.4 6 52 4.4 32.4 Z', '#c8693f'],
  ['winter', 'M32 32 L4.4 32.4 C3.8 20 12 6 32 4.4 Z', '#8fb0c9'],
];

const dial =
  `<svg class="cal-dial" viewBox="0 0 64 64" width="52" height="52" fill="none" aria-hidden="true">` +
  WEDGES.map(([k, d, fill]) => `<path class="wedge" data-season="${k}" d="${d}" fill="${fill}" stroke="none"/>`).join('') +
  `<path d="M32 4.4 L32.4 59.6 M4.4 32.4 L59.6 31.6" stroke="${INK}" stroke-width="1" opacity=".55"/>` +
  `<path d="M32.2 3.4 C48 2.8 61.4 15 60.8 32.4 C60.2 49 47 61 31.6 60.8 C15 60.4 3 47.6 3.2 31.8 C3.6 16 16 3.8 32.2 3.4 Z" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>` +
  `<path d="M33.4 5.6 C47 6.4 58 17 57.8 31 M30 58.2 C16 57.4 6.4 46 6.6 33" stroke="${INK}" stroke-width=".8" opacity=".4"/>` +
  `<g class="hand"><path d="M32 32 L32.4 9.4" stroke="#26304a" stroke-width="2.1" stroke-linecap="round"/>` +
  `<path d="M28.6 13.6 L32.4 7.2 L36 13.8" stroke="#26304a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>` +
  `<circle cx="32" cy="32" r="9.6" fill="#f4ecd8" stroke="${INK}" stroke-width="1.3"/>` +
  `<g class="hub-sun"><circle cx="32" cy="32" r="3.6" fill="#e8b23c" stroke="${INK}" stroke-width="1"/>` +
  `<path d="M32 24.6 L32 26.4 M32 37.6 L32 39.4 M24.6 32 L26.4 32 M37.6 32 L39.4 32 M26.8 26.8 L28 28 M36 36 L37.2 37.2 M37.2 26.8 L36 28 M28 36 L26.8 37.2" stroke="${INK}" stroke-width="1" stroke-linecap="round"/></g>` +
  `<g class="hub-moon" hidden><path d="M34.4 25.4 A7 7 0 1 0 38.6 34.6 A5.6 5.6 0 0 1 34.4 25.4 Z" fill="#e9dfb8" stroke="${INK}" stroke-width="1"/></g>` +
  `</svg>`;

/** The calendar block, to be put into the resources card; hidden until seasons are on. */
export const calendarHtml = `
  <div class="cal" hidden>
    ${dial}
    <div class="cal-name"><span class="cal-season"></span><span class="cal-wx"><span class="cal-wx-ico"></span><span class="cal-wx-word"></span></span></div>
    <div class="cal-sub"></div>
  </div>`;

export function createCalendar(host) {
  const q = (s) => host.querySelector(s);
  const el = {
    root: q('.cal'),
    wedges: [...host.querySelectorAll('.cal .wedge')],
    hand: q('.cal .hand'),
    sun: q('.cal .hub-sun'),
    moon: q('.cal .hub-moon'),
    season: q('.cal-season'),
    wx: q('.cal-wx'),
    wxIco: q('.cal-wx-ico'),
    wxWord: q('.cal-wx-word'),
    sub: q('.cal-sub'),
  };
  const shown = {};
  // the grade line of the tooltip is worked out only while the pointer is over the calendar
  let hover = false;
  let last = null;

  function set(key, value, write) {
    if (shown[key] === value) return;
    shown[key] = value;
    write(value);
  }

  function paintTitle(m) {
    const line = hover ? gradeLine(last) : null;
    set('title', line ? `${m.title}\n${line}` : m.title, (t) => {
      el.root.title = t;
    });
  }

  const hovered = (on) => () => {
    hover = on;
    const m = calendarModel(last);
    if (m) paintTitle(m);
  };
  el.root.addEventListener('pointerenter', hovered(true));
  el.root.addEventListener('pointerleave', hovered(false));

  return {
    /** Paints the calendar for `state`; hides it when seasons are off. */
    update(state) {
      last = state;
      const m = calendarModel(state);
      set('on', Boolean(m), (on) => {
        el.root.hidden = !on;
      });
      if (!m) return;
      set('angle', m.angle, (a) => el.hand.setAttribute('transform', `rotate(${a} 32 32)`));
      set('season', m.season, () => {
        el.wedges.forEach((w) => w.setAttribute('fill-opacity', w.dataset.season === m.season ? '0.8' : '0.28'));
        el.season.textContent = m.name;
      });
      set('glyph', m.glyph, (g) => {
        // SVG elements have no `hidden` property: toggle the attribute that hud.css hides
        el.sun.toggleAttribute('hidden', g !== 'sun');
        el.moon.toggleAttribute('hidden', g !== 'moon');
      });
      set('sub', `${m.day}|${m.word}`, () => {
        el.sub.textContent = `сутки ${m.day} · ${m.word}`;
      });
      set('wx', m.weather, () => {
        el.wxIco.innerHTML = icons[m.weather] || '';
        el.wxWord.textContent = m.weatherWord;
      });
      set('wxi', Math.round(m.intensity * 10), (v) => {
        el.wx.style.setProperty('--wx', m.weather === 'clear' ? '1' : String(0.62 + 0.38 * (v / 10)));
      });
      paintTitle(m);
    },
  };
}

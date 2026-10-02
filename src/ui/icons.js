// Small inline-SVG ink icons (24x24): sepia outline, translucent watercolor fill.
// Every icon is a string so the HUD can drop it into innerHTML once.

const INK = '#3a2a1e';
const open = (cls = '') =>
  `<svg class="ico ${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`;
const close = '</svg>';

export const icons = {
  sugar:
    open('ico-sugar') +
    `<path d="M12 2.8 L20.2 7.4 L20 16.7 L12 21.2 L4 16.6 L3.9 7.5 Z" fill="#e0a43a" fill-opacity=".72"/>` +
    `<path d="M3.9 7.5 L12 12 L20.2 7.4 M12 12 L12 21.2" stroke-width="1.1"/>` +
    `<path d="M6.2 9.4 L10.2 11.8 M14.2 5.2 L17.2 6.9" stroke="#fff6dc" stroke-width="1" opacity=".8"/>` +
    close,
  water:
    open('ico-water') +
    `<path d="M12 2.8 C11.2 4.2 5.4 10.4 5.4 14.8 A6.6 6.6 0 0 0 18.6 14.8 C18.6 10.4 12.8 4.2 12 2.8 Z" fill="#5f9fc9" fill-opacity=".72"/>` +
    `<path d="M8.6 14.6 A3.6 3.6 0 0 0 11.6 18.4" stroke="#f4f0e2" stroke-width="1.3" opacity=".85"/>` +
    close,
  minerals:
    open('ico-minerals') +
    `<path d="M4.6 20.6 L3.8 11.4 L8.2 3.8 L12.6 10.6 L11.8 20.6 Z" fill="#8760b4" fill-opacity=".74"/>` +
    `<path d="M12.2 20.6 L13 13 L17.4 7.6 L20.6 13.4 L19.4 20.6 Z" fill="#7d8a3a" fill-opacity=".7"/>` +
    `<path d="M8.2 3.8 L8.4 20.4 M3.8 11.4 L8.3 12.8 L12.6 10.6 M17.4 7.6 L16.4 20.6" stroke-width="1"/>` +
    close,
  spores:
    open('ico-spores') +
    `<circle cx="12" cy="12.5" r="4.4" fill="#c7a566" fill-opacity=".6"/>` +
    `<circle cx="12" cy="12.5" r="1.1" fill="${INK}" stroke="none"/>` +
    `<circle cx="5.2" cy="8" r="1.8" fill="#c7a566" fill-opacity=".7"/><circle cx="19" cy="7" r="1.4" fill="#c7a566" fill-opacity=".7"/>` +
    `<circle cx="18.6" cy="18.8" r="1.9" fill="#c7a566" fill-opacity=".7"/><circle cx="5.6" cy="19" r="1.2" fill="#c7a566" fill-opacity=".7"/>` +
    `<circle cx="12" cy="3.6" r=".8" fill="${INK}" stroke="none"/><circle cx="21" cy="12.6" r=".7" fill="${INK}" stroke="none"/>` +
    close,
  thread:
    open('ico-thread') +
    `<path d="M3.2 18.4 C6.8 7.8 9.6 21.4 13.6 12 S19 9.4 20.8 5.2"/>` +
    `<circle cx="3.2" cy="18.4" r="1.7" fill="#fff6dc"/><circle cx="20.8" cy="5.2" r="1.7" fill="#fff6dc"/><circle cx="13.6" cy="12" r="1.2" fill="#fff6dc"/>` +
    close,
  mushroom:
    open('ico-mushroom') +
    `<path d="M3.6 13 C3.6 7.6 7.4 4 12 4 C16.6 4 20.4 7.6 20.4 13 C16 14.4 8 14.4 3.6 13 Z" fill="#c8693f" fill-opacity=".62"/>` +
    `<path d="M9.8 14 C9.6 16.8 9.6 18.6 8.8 20.6 L15.2 20.6 C14.4 18.6 14.4 16.8 14.2 14" fill="#f1e6c8" fill-opacity=".9"/>` +
    `<circle cx="8.6" cy="9.2" r="1.1" fill="#f6ecd2" stroke="none"/><circle cx="13.4" cy="7.6" r="1.3" fill="#f6ecd2" stroke="none"/><circle cx="16.4" cy="10.8" r=".9" fill="#f6ecd2" stroke="none"/>` +
    close,
  find:
    open('ico-find') +
    `<circle cx="10.2" cy="10.2" r="6.2" fill="#f1e6c8" fill-opacity=".7"/>` +
    `<path d="M14.8 14.8 L20.6 20.6" stroke-width="2.6"/>` +
    `<path d="M7.4 8.6 C8 7.2 9 6.6 10.4 6.5" stroke="#fff6dc" stroke-width="1.1" opacity=".9"/>` +
    close,
  // ---- soil threats (S3): a trapping ring on a hypha, a nematode, a cut thread ----
  ring:
    open('ico-ring') +
    `<ellipse cx="12" cy="11" rx="6.2" ry="8" fill="#9dbb5c" fill-opacity=".38" stroke="none"/>` +
    `<path d="M5.8 11 A6.2 8 0 0 1 18.2 11" stroke-width="1.9"/>` +
    `<path d="M2.4 17.6 C6.6 17.6 8.4 12.6 12 12.6 S17.4 8.2 21.6 8.2" stroke-width="1.5"/>` +
    `<path d="M5.8 11 A6.2 8 0 0 0 18.2 11" stroke-width="1.9"/>` +
    `<circle cx="2.4" cy="17.6" r="1.3" fill="#fff6dc"/><circle cx="21.6" cy="8.2" r="1.3" fill="#fff6dc"/>` +
    close,
  worm:
    open('ico-worm') +
    `<path d="M3.8 16.6 C5.4 9.4 9.2 19.8 12.4 13.2 S18 8 19.6 10.2" stroke-width="4"/>` +
    `<path d="M3.8 16.6 C5.4 9.4 9.2 19.8 12.4 13.2 S18 8 19.6 10.2" stroke="#e5c3a8" stroke-width="2.3"/>` +
    `<path d="M8.4 13.2 L8.6 15.6 M12.6 14.2 L13.6 12.2 M16.4 9.4 L16.8 11.8" stroke-width=".9" opacity=".7"/>` +
    `<circle cx="20.2" cy="9.8" r="1.5" fill="#d99a7f"/>` +
    close,
  snip:
    open('ico-snip') +
    `<path d="M2.6 13.4 C5 12 6.6 12.6 9 11.6 M15 12.6 C17.4 12 19.4 12.8 21.4 11.2"/>` +
    `<circle cx="2.6" cy="13.4" r="1.3" fill="#fff6dc"/><circle cx="21.4" cy="11.2" r="1.3" fill="#fff6dc"/>` +
    `<path d="M9.4 4.8 L14.8 19.6 M14.6 4.8 L9.2 19.6" stroke="#a8322d" stroke-width="1.9"/>` +
    close,
  // ---- the honey-fungus rival (S3b): a barrier round a hypha with a black rhizomorph stopped at its edge, and a honey-mushroom tuft ----
  barrier:
    open('ico-barrier') +
    `<circle cx="13.4" cy="12.4" r="7.6" fill="#8fb55a" fill-opacity=".34" stroke-dasharray="2.6 2.2" stroke-width="1.3"/>` +
    `<path d="M2.4 19 C6.8 19 8.6 14 12.6 13 S18.2 8.6 21.6 7.6" stroke-width="1.5"/>` +
    `<circle cx="2.4" cy="19" r="1.3" fill="#fff6dc"/><circle cx="21.6" cy="7.6" r="1.3" fill="#fff6dc"/><circle cx="12.6" cy="13" r="1.2" fill="#fff6dc"/>` +
    `<path d="M1.8 5.4 C4.6 5 6.2 7.4 8 7.4" stroke="#2b1b14" stroke-width="2.7"/>` +
    `<path d="M8.4 4.6 L10.6 9.8 M10.8 4.6 L8.2 9.8" stroke="#a8322d" stroke-width="1.5"/>` +
    close,
  // ---- feeding a tree (key 5): a crown on a trunk, a thread to its root, a lump of sugar riding along ----
  feed:
    open('ico-feed') +
    `<path d="M11.8 11.6 L11.8 17.4 M11.8 14.4 L9.4 12.4 M11.8 15.4 L14.2 13.2" stroke-width="1.5"/>` +
    `<circle cx="11.8" cy="7.2" r="5" fill="#8fb55a" fill-opacity=".7"/>` +
    `<path d="M9.6 6.2 C10.4 4.8 11.8 4.4 13 4.8" stroke="#f4f0e2" stroke-width="1.1" opacity=".85"/>` +
    `<path d="M2.4 21 C6.2 19.4 8.6 21 11.8 17.4 S18.2 19.6 21.6 18.4" stroke-width="1.4"/>` +
    `<circle cx="2.4" cy="21" r="1.2" fill="#fff6dc"/>` +
    `<path d="M16.8 11.6 L19.4 12.8 L19.3 15.4 L16.7 16.6 L14.4 15.2 L14.5 12.9 Z" fill="#e0a43a" fill-opacity=".85" stroke-width="1.1"/>` +
    close,
  honey:
    open('ico-honey') +
    `<path d="M3.4 20.8 C5 19.4 8 19.6 11 20.8 M13.4 20.8 C15.6 19.6 18.6 19.6 20.8 20.8" stroke="#2b1b14" stroke-width="1.9"/>` +
    `<path d="M10.6 12.6 C10.4 15.4 10 18 9 20.4 L14.6 20.4 C13.8 18 13.6 15.4 13.4 12.6" fill="#e6cf9c" fill-opacity=".92"/>` +
    `<path d="M10.7 15.4 C11.6 16.2 12.6 16.2 13.5 15.4" stroke-width="1"/>` +
    `<path d="M5.6 12.8 C5.4 8 8.4 5 12 5 C15.6 5 18.6 8 18.4 12.8 C15 14 9 14 5.6 12.8 Z" fill="#c9962e" fill-opacity=".72"/>` +
    `<path d="M9 8.6 L9.4 9.4 M13 7.4 L13.4 8.2 M15.6 10.4 L16 11.2 M11.6 10.6 L12 11.4" stroke="#6b4310" stroke-width="1.2"/>` +
    `<path d="M2.6 15 C2.4 12.6 3.6 11.2 5 11 C5.8 12 5.8 14 5.4 15.4 Z" fill="#c9962e" fill-opacity=".6"/>` +
    close,
  // ---- seasons and weather (S2): the same ink and watercolor, for notes and the calendar ----
  sun:
    open('ico-sun') +
    `<circle cx="12" cy="12" r="4.6" fill="#e8b23c" fill-opacity=".8"/>` +
    `<path d="M12 2.6 L12 5.2 M12 18.8 L12 21.4 M2.6 12 L5.2 12 M18.8 12 L21.4 12 M5.4 5.4 L7.2 7.2 M16.8 16.8 L18.6 18.6 M18.6 5.4 L16.8 7.2 M7.2 16.8 L5.4 18.6" stroke-width="1.3"/>` +
    close,
  moon:
    open('ico-moon') +
    `<path d="M15.2 3.6 A8.6 8.6 0 1 0 20.6 15.4 A6.8 6.8 0 0 1 15.2 3.6 Z" fill="#e9dfb8" fill-opacity=".9"/>` +
    `<path d="M18.6 6.2 L18.6 8 M17.7 7.1 L19.5 7.1" stroke-width="1"/>` +
    close,
  rain:
    open('ico-rain') +
    `<path d="M6.8 14.4 A3.9 3.9 0 0 1 7.4 6.6 A5.3 5.3 0 0 1 17.2 7.8 A3.4 3.4 0 0 1 17.6 14.4 Z" fill="#aeb9c6" fill-opacity=".85"/>` +
    `<path d="M8.2 17 L7.2 20.4 M12.4 17 L11.4 20.4 M16.4 17 L15.4 20.4" stroke="#2f6f9f" stroke-width="1.7"/>` +
    close,
  drought:
    open('ico-drought') +
    `<path d="M7 12.6 A5 5 0 0 1 17 12.6 Z" fill="#d9822b" fill-opacity=".8"/>` +
    `<path d="M12 3.2 L12 5.2 M4.6 6.6 L6.2 8 M19.4 6.6 L17.8 8" stroke-width="1.3"/>` +
    `<path d="M2.8 15.6 L8 14.8 L11 16.4 L14 14.8 L21.2 15.8" stroke-width="1.4"/>` +
    `<path d="M11 16.4 L9.8 20.8 M14 14.8 L15.4 19 M8 14.8 L6.4 18.4" stroke-width="1.1"/>` +
    close,
  snow:
    open('ico-snow') +
    `<path d="M12 2.8 L12 21.2 M4 7.4 L20 16.6 M20 7.4 L4 16.6" stroke="#4f7fa3" stroke-width="1.5"/>` +
    `<path d="M9.6 4.6 L12 6.8 L14.4 4.6 M9.6 19.4 L12 17.2 L14.4 19.4 M4.2 11 L7.2 10.4 L6.4 7.6 M19.8 13 L16.8 13.6 L17.6 16.4 M19.8 11 L16.8 10.4 L17.6 7.6 M4.2 13 L7.2 13.6 L6.4 16.4" stroke="#4f7fa3" stroke-width="1.1"/>` +
    close,
  clear:
    open('ico-clear') +
    `<path d="M3.6 10.6 C5.4 7.4 8 7.4 9.6 10.4 C11.2 7.4 13.8 7.4 15.6 10.6" stroke-width="1.5"/>` +
    `<path d="M11.6 17.6 C12.8 15.4 14.6 15.4 15.8 17.4 C17 15.4 18.8 15.4 20 17.6" stroke-width="1.3"/>` +
    close,
  spring:
    open('ico-spring') +
    `<path d="M12 21 L12 11.4" stroke-width="1.6"/>` +
    `<path d="M12 14 C6.8 14 4.6 10.4 4.8 6.6 C9 6.6 11.6 9 12 14 Z" fill="#8fb55a" fill-opacity=".8"/>` +
    `<path d="M12 11.6 C12 7.4 14.6 4.4 19.4 4.2 C19.6 8.6 16.8 11.6 12 11.6 Z" fill="#a8c46a" fill-opacity=".8"/>` +
    close,
  autumn:
    open('ico-autumn') +
    `<path d="M4.6 19.4 C3.6 10.4 9 4 19.6 4 C20 14.4 14.6 19.8 4.6 19.4 Z" fill="#c8693f" fill-opacity=".72"/>` +
    `<path d="M4.6 19.4 L14.6 9.4 M9.6 14.4 L9.4 10.2 M12.4 11.8 L16.6 11.8" stroke-width="1.1"/>` +
    close,
  pause: open('ico-pause') + `<path d="M8 5.5 L8 18.5 M16 5.5 L16 18.5" stroke-width="2.6"/>` + close,
  play: open('ico-play') + `<path d="M7.4 4.8 L19 12 L7.4 19.2 Z" fill="${INK}" fill-opacity=".85"/>` + close,
  speed:
    open('ico-speed') +
    `<path d="M3.6 6.2 L11 12 L3.6 17.8 Z M12.6 6.2 L20 12 L12.6 17.8 Z" fill="${INK}" fill-opacity=".85"/>` +
    close,
  sound:
    open('ico-sound') +
    `<path d="M4 9.6 L8 9.6 L13 5.4 L13 18.6 L8 14.4 L4 14.4 Z" fill="${INK}" fill-opacity=".8"/>` +
    `<path d="M16 9 C17.6 10.6 17.6 13.4 16 15 M18.6 6.6 C21.6 9.6 21.6 14.4 18.6 17.4" stroke-width="1.5"/>` +
    close,
  muted:
    open('ico-muted') +
    `<path d="M4 9.6 L8 9.6 L13 5.4 L13 18.6 L8 14.4 L4 14.4 Z" fill="${INK}" fill-opacity=".8"/>` +
    `<path d="M16 9.4 L21.4 14.6 M21.4 9.4 L16 14.6" stroke="#a8322d" stroke-width="1.9"/>` +
    close,
};

icons.summer = icons.sun;
icons.winter = icons.snow;

/** Hand-drawn checkbox: wobbly square plus a check that can be "drawn" by CSS. */
export const checkbox =
  `<svg class="cbox" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path class="cbox-frame" d="M4 4.6 L19.6 3.8 L20.2 19.2 L3.6 20 Z" stroke="${INK}" stroke-width="1.5"/>` +
  `<path class="cbox-tick" d="M5 12.4 L10 18 L21.4 2.6" stroke="#26304a" stroke-width="2.6" pathLength="1"/>` +
  `</svg>`;

/** Flourish under the title: a wavy thread with three nodes, drawn in ink. */
export const flourish =
  `<svg class="flourish" viewBox="0 0 360 28" width="360" height="28" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">` +
  `<path d="M6 16 C40 4 64 26 100 14 S150 4 180 15 S240 26 268 12 S330 6 354 14"/>` +
  `<path d="M100 14 C108 20 112 24 120 26 M180 15 C176 21 176 24 170 27 M268 12 C274 18 280 20 286 24" stroke-width="1.1" opacity=".75"/>` +
  `<circle cx="100" cy="14" r="2.6" fill="#fff6dc"/><circle cx="180" cy="15" r="2.6" fill="#fff6dc"/><circle cx="268" cy="12" r="2.6" fill="#fff6dc"/>` +
  `</svg>`;

/**
 * Thin ink tube under a capped stock (sugar, water, minerals). The fill is a separate rect that CSS scales from the
 * left to the share of the cap; it turns wax-red when the stock is full. `id` keeps the clip path and the gradient
 * of the bars apart.
 */
export function capBar(id, from, to) {
  const tube = 'M2.5 1.6 C30 0.8 100 1.8 147.5 1.3 C149 2.4 148.8 4.4 147.5 5.4 C100 6 30 5.2 2.5 5.4 C1.1 4.4 1.1 2.7 2.5 1.6 Z';
  return (
    `<svg class="gauge" viewBox="0 0 150 7" width="150" height="7" preserveAspectRatio="none" fill="none" aria-hidden="true">` +
    `<defs><clipPath id="${id}-clip"><path d="${tube}"/></clipPath>` +
    `<linearGradient id="${id}-fill" x1="0" x2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<g clip-path="url(#${id}-clip)"><rect class="gauge-back" x="0" y="0" width="150" height="7" fill="#3a2a1e" opacity=".12"/>` +
    `<rect class="gauge-fill" x="0" y="0" width="150" height="7" fill="url(#${id}-fill)" opacity=".9"/></g>` +
    `<path d="${tube}" stroke="#3a2a1e" stroke-width="1" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

/** Ink icons of the marks in the margins (src/ui/marks-logic.js names them in MARKS[].icon). */
export const markIcons = {
  // first fruit: a cap on a stem
  mk_fruit:
    open('ico-mk') +
    `<path d="M10 14.4 C9.6 17.6 9.4 19.4 8.8 21 L15.4 21 C14.8 19.4 14.4 17.6 14 14.4 Z" fill="#efe3c4" fill-opacity=".85"/>` +
    `<path d="M3.6 13.8 C3.8 7.6 8 4 12 4 C16.4 4 20.4 7.6 20.4 13.8 C16 15.2 8 15.2 3.6 13.8 Z" fill="#b8472f" fill-opacity=".75"/>` +
    `<path d="M8.4 9 L9.4 9.4 M13 7.2 L14.2 7.8 M15.8 11 L16.8 11.4" stroke="#fff6dc" stroke-width="1.5"/>` +
    close,
  // union of three trees: three crowns joined by a thread underground
  mk_trio:
    open('ico-mk') +
    `<path d="M5.6 11 L5.6 15 M12 8 L12 14 M18.4 10.4 L18.4 15" stroke-width="1.6"/>` +
    `<circle cx="5.6" cy="7.8" r="3.4" fill="#7da15a" fill-opacity=".7"/><circle cx="12" cy="4.8" r="3.4" fill="#7da15a" fill-opacity=".7"/><circle cx="18.4" cy="7.4" r="3.4" fill="#7da15a" fill-opacity=".7"/>` +
    `<path d="M2.6 15.2 L21.4 15.2" stroke-width="1" opacity=".55"/>` +
    `<path d="M5.6 15 C6.4 19 9.6 19.6 12 14 C14.6 19.6 17.6 19 18.4 15" stroke-width="1.3"/>` +
    `<circle cx="5.6" cy="15" r="1.2" fill="#fff6dc"/><circle cx="12" cy="14" r="1.2" fill="#fff6dc"/><circle cx="18.4" cy="15" r="1.2" fill="#fff6dc"/>` +
    close,
  // a second year: growth rings of a stump
  mk_year:
    open('ico-mk') +
    `<ellipse cx="12" cy="12" rx="9" ry="8.2" fill="#d9b27a" fill-opacity=".7"/>` +
    `<ellipse cx="12" cy="12" rx="5.9" ry="5.2" stroke-width="1.1"/><ellipse cx="12" cy="12" rx="2.7" ry="2.3" stroke-width="1.1"/>` +
    `<path d="M12 12 L19.4 6.6" stroke-width="1" opacity=".6"/>` +
    close,
  // a worm in a ring
  mk_trap:
    open('ico-mk') +
    `<circle cx="12" cy="12" r="8.4" fill="#a7c27c" fill-opacity=".38" stroke-width="1.6"/>` +
    `<path d="M7.6 14.4 C8.6 9.6 12.4 14.4 13.6 10.4 C14.4 8 16.6 9.6 16.4 11.6" stroke="#a8322d" stroke-width="2.2"/>` +
    `<circle cx="16.4" cy="11.6" r="1" fill="${INK}" stroke="none"/>` +
    close,
  // a tree let go: crown, trunk, a broken grip
  mk_freed:
    open('ico-mk') +
    `<path d="M12 11.6 L12 20 M9 20.6 L15 20.6" stroke-width="1.6"/>` +
    `<path d="M5 9.4 C4.4 5 8 2.8 12 3 C16.4 2.8 19.6 5.6 19 9.4 C17 12 7.4 12.4 5 9.4 Z" fill="#7da15a" fill-opacity=".72"/>` +
    `<path d="M3.2 17 C5.4 15.2 8.6 15.2 10.4 17" stroke="#c28a2e" stroke-width="1.6"/>` +
    `<path d="M13.6 17 C15.4 15.2 18.6 15.2 20.8 17" stroke="#c28a2e" stroke-width="1.6"/>` +
    close,
  // ten finds: a heap of pebbles with a tally
  mk_ten:
    open('ico-mk') +
    `<path d="M3.6 19.6 C2.8 15.6 6.4 13.4 9.4 14 C12.6 13.4 14.4 17 13 19.6 Z" fill="#a89f8e" fill-opacity=".85"/>` +
    `<path d="M11.6 19.6 C11.2 16.4 14.6 14.4 17.4 15 C20.6 15 21.4 18.6 19.8 19.6 Z" fill="#c9bfa6" fill-opacity=".85"/>` +
    `<path d="M6.4 3.6 L6.6 11 M9.2 3.6 L9.4 11 M12 3.6 L12.2 11 M14.8 3.6 L15 11 M4.8 9.6 L16.6 5" stroke-width="1.5"/>` +
    close,
  // three forests: a birch, a broad oak, a pine
  mk_forests:
    open('ico-mk') +
    `<path d="M5 9 L5 20.6 M12 11.4 L12 20.6 M19 11 L19 20.6" stroke-width="1.5"/>` +
    `<ellipse cx="5" cy="6.4" rx="2.2" ry="4" fill="#9fc07c" fill-opacity=".75"/>` +
    `<circle cx="12" cy="8.2" r="4.2" fill="#6f9648" fill-opacity=".75"/>` +
    `<path d="M19 2.6 L15.4 9 L22.6 9 Z M19 6.4 L14.8 13 L23.2 13 Z" fill="#4f7a4a" fill-opacity=".75"/>` +
    close,
  // a good year: three mushrooms of different size
  mk_basket:
    open('ico-mk') +
    `<path d="M5.6 15 L5.4 20.4 M13 11.4 L13.4 20.4 M19 15.6 L19.2 20.4" stroke-width="1.6"/>` +
    `<path d="M2 15.4 C2 11.6 4.4 9.6 6.2 9.6 C8.8 9.6 10 12 9.8 15.4 Z" fill="#c8693f" fill-opacity=".75"/>` +
    `<path d="M8.4 11.8 C8.4 6.4 11 3.8 13.6 3.8 C16.6 3.8 18.4 7 18.2 11.8 Z" fill="#b8472f" fill-opacity=".75"/>` +
    `<path d="M15.6 16 C15.8 12.8 17.4 11.8 19.2 11.8 C21.4 12 22.4 14.4 22.2 16 Z" fill="#d9b27a" fill-opacity=".8"/>` +
    close,
  // winter without loss: a snowflake
  mk_frost:
    open('ico-mk') +
    `<path d="M12 2.8 L12 21.2 M4 7.4 L20 16.6 M4 16.6 L20 7.4" stroke="#4f7a9f" stroke-width="1.6"/>` +
    `<path d="M9.6 4.6 L12 6.8 L14.4 4.6 M9.6 19.4 L12 17.2 L14.4 19.4" stroke="#4f7a9f" stroke-width="1.2"/>` +
    `<circle cx="12" cy="12" r="2.4" fill="#e9f1f6" fill-opacity=".9"/>` +
    close,
  // a page without bites: a leaf of paper, a worm struck out
  mk_page:
    open('ico-mk') +
    `<path d="M5.4 3.4 L18.4 3 L18.8 20.4 L5.6 20.8 Z" fill="#f2e8cc" fill-opacity=".9"/>` +
    `<path d="M8.4 8 C9.6 6.4 11.2 9.6 12.6 8 C13.6 6.8 14.8 7.8 15 8.6" stroke="#a8322d" stroke-width="1.5"/>` +
    `<path d="M7.6 12.6 L16.4 12.6 M7.6 15.4 L13.6 15.4" stroke-width="1" opacity=".6"/>` +
    `<path d="M8 17.8 L10.6 20.2 L16.6 14.2" stroke="#26304a" stroke-width="2.2"/>` +
    close,
  // a year without losses to the honey fungus: a shield over a clump of honey fungus
  mk_honey:
    open('ico-mk') +
    `<path d="M12 2.8 L19.6 5.6 C19.8 12 17.2 17.6 12 21 C6.8 17.6 4.2 12 4.4 5.6 Z" fill="#d9b27a" fill-opacity=".6"/>` +
    `<path d="M7.6 12.4 C7.6 9.6 9 8.4 10.2 8.4 C11.6 8.4 12.4 9.6 12.2 12.4 Z" fill="#b97a14" fill-opacity=".85"/>` +
    `<path d="M11.4 14.8 C11.4 11.6 13.2 10 14.8 10 C16.6 10 17.4 11.8 17.2 14.8 Z" fill="#b97a14" fill-opacity=".85"/>` +
    `<path d="M9.8 12.4 L9.6 16.4 M14.2 14.8 L14.2 18" stroke-width="1.4"/>` +
    close,
  // the whole glade in the net: nodes in a ring joined by threads
  mk_net:
    open('ico-mk') +
    `<path d="M12 3.6 L19.6 8.4 L17.4 17.6 L6.6 17.6 L4.4 8.4 Z M12 3.6 L12 11.8 L19.6 8.4 M12 11.8 L4.4 8.4 M12 11.8 L17.4 17.6 M12 11.8 L6.6 17.6" stroke-width="1.2"/>` +
    `<circle cx="12" cy="3.6" r="2" fill="#7da15a"/><circle cx="19.6" cy="8.4" r="2" fill="#7da15a"/><circle cx="17.4" cy="17.6" r="2" fill="#7da15a"/><circle cx="6.6" cy="17.6" r="2" fill="#7da15a"/><circle cx="4.4" cy="8.4" r="2" fill="#7da15a"/>` +
    `<circle cx="12" cy="11.8" r="1.8" fill="#fff6dc"/>` +
    close,
  // four fungi: four caps in a row
  mk_four:
    open('ico-mk') +
    `<path d="M3.8 14 L3.8 19.6 M9.2 12 L9.2 19.6 M14.8 12 L14.8 19.6 M20.2 14 L20.2 19.6" stroke-width="1.4"/>` +
    `<path d="M1.6 14 C1.6 9.8 6 9.8 6 14 Z" fill="#b8472f" fill-opacity=".78"/>` +
    `<path d="M6.4 12 C6.4 6.6 12 6.6 12 12 Z" fill="#8a5a34" fill-opacity=".78"/>` +
    `<path d="M12 12 C12 6.6 17.6 6.6 17.6 12 Z" fill="#d6872f" fill-opacity=".78"/>` +
    `<path d="M17.6 14 C17.6 9.8 22.4 9.8 22.4 14 Z" fill="#e0b04a" fill-opacity=".8"/>` +
    close,
  // full atlas: an open book with a pebble pressed in
  mk_atlas:
    open('ico-mk') +
    `<path d="M2.6 5.6 C6.4 4.4 9.6 4.8 12 6.6 C14.4 4.8 17.6 4.4 21.4 5.6 L21.4 19 C17.6 17.8 14.4 18.2 12 20 C9.6 18.2 6.4 17.8 2.6 19 Z" fill="#f2e8cc" fill-opacity=".9"/>` +
    `<path d="M12 6.6 L12 20" stroke-width="1.2"/>` +
    `<ellipse cx="7.2" cy="12.2" rx="2.4" ry="1.8" fill="#a89f8e" fill-opacity=".85"/>` +
    `<path d="M15.4 9.4 C16.8 8.6 18.4 9.8 17.4 11.4 C16.6 12.6 15 11.8 15.4 9.4 Z M15 14.6 L19 14" fill="#7da15a" fill-opacity=".7" stroke-width="1.1"/>` +
    close,
};
Object.assign(icons, markIcons);

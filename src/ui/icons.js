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

/** Ink tube for the pool gauge. The fill is a separate rect scaled from the left by CSS. */
export const gauge =
  `<svg class="gauge" viewBox="0 0 150 14" width="150" height="14" fill="none" aria-hidden="true">` +
  `<defs><clipPath id="gauge-clip"><path d="M3 3.4 C30 1.6 100 3.6 147 2.8 C148.8 5 148.6 9 147 11.2 C100 12.6 30 11 3 11 C1.2 8.6 1.2 5.6 3 3.4 Z"/></clipPath>` +
  `<linearGradient id="gauge-fill" x1="0" x2="1"><stop offset="0" stop-color="#5f9fc9"/><stop offset=".55" stop-color="#6f7cb6"/><stop offset="1" stop-color="#8760b4"/></linearGradient></defs>` +
  `<g clip-path="url(#gauge-clip)"><rect class="gauge-back" x="0" y="0" width="150" height="14" fill="#3a2a1e" opacity=".1"/>` +
  `<rect class="gauge-fill" x="0" y="0" width="150" height="14" fill="url(#gauge-fill)" opacity=".85"/>` +
  `<path d="M6 4 L10 11 M13 4 L17 11 M20 4 L24 11 M27 4 L31 11 M34 4 L38 11 M41 4 L45 11 M48 4 L52 11 M55 4 L59 11 M62 4 L66 11 M69 4 L73 11 M76 4 L80 11 M83 4 L87 11 M90 4 L94 11 M97 4 L101 11 M104 4 L108 11 M111 4 L115 11 M118 4 L122 11 M125 4 L129 11 M132 4 L136 11 M139 4 L143 11" stroke="#3a2a1e" stroke-width=".7" opacity=".28"/></g>` +
  `<path d="M3 3.4 C30 1.6 100 3.6 147 2.8 C148.8 5 148.6 9 147 11.2 C100 12.6 30 11 3 11 C1.2 8.6 1.2 5.6 3 3.4 Z" stroke="#3a2a1e" stroke-width="1.3" stroke-linejoin="round"/>` +
  `</svg>`;

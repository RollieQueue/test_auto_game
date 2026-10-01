// DOM HUD: a naturalist's notebook around the scene. API: createHud(root, actions) -> { update(state, dt, view) }.
// update() runs every frame, so every write below is guarded by a "changed?" check.
import { icons, checkbox, flourish, capBar } from './icons.js';
import { RESOURCES, resourceView, resourceTip } from './resources-logic.js';
import { gladeLabel } from './glade.js';
import { createNotes } from './notes.js';
import { createTooltip } from './tooltip.js';
import { createLabels } from './labels.js';
import { createGuide } from './guide.js';
import { buildHelp } from './help.js';
import { createAtlas } from './atlas.js';
import { createAtlasStore } from './atlas-store.js';
import { calendarHtml, createCalendar } from './calendar.js';
import { seasonNote } from './season-logic.js';
import { buildYearPage } from './year.js';
import { guideEnabled, setGuideEnabled, onGuideChange, atlasHintSeen, markAtlasHint } from './prefs.js';

// bar colours of the capped stocks (spores have no cap and no bar)
const BAR_COLORS = { sugar: ['#e0b04a', '#b97a14'], water: ['#78b6dc', '#2f6f9f'], minerals: ['#8d7bc0', '#6a4a8c'] };

const ART_URL = 'assets/art/frontispiece.webp';
const OBJ_REVEAL_START = 8; // s the objectives card is open at the start of a game
const OBJ_REVEAL_TICK = 6; // s it opens when an objective is ticked off
const OBJ_HOLD = 0.35; // s it stays open after the pointer moved away

const nf = new Intl.NumberFormat('ru-RU');

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatRate(r) {
  if (Math.abs(r) < 0.05) return '';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1).replace('.', ',')}/с`;
}

/** Sets textContent / className only when the value differs from the cached one. */
function setText(el, cache, key, value) {
  if (cache[key] === value) return;
  cache[key] = value;
  el.textContent = value;
}

export function createHud(root, actions) {
  root.dataset.phase = 'title';
  root.innerHTML = `
    <div class="hud-game">
      <section class="scrap tape res-card" aria-label="Запасы">
        ${calendarHtml}
        ${RESOURCES.map(
          (r) => `
        <div class="res-row" data-k="${r.k}">
          ${icons[r.k]}<span class="lbl">${r.label}</span><span class="val"><b class="num">0</b><span class="cap"></span></span><span class="rate"></span>${
            BAR_COLORS[r.k] ? capBar(`cb-${r.k}`, ...BAR_COLORS[r.k]) : ''
          }
        </div>`,
        ).join('')}
      </section>

      <section class="scrap tape obj-card" aria-label="Наблюдения">
        <div class="obj-head">
          <h3 class="card-title">Наблюдения</h3>
          <span class="obj-count">0 / 0</span>
          <span class="obj-cur"></span>
        </div>
        <div class="obj-glade"></div>
        <div class="obj-body"><ul class="obj-list"></ul></div>
      </section>

      <div class="notes" aria-live="polite"></div>
      <div class="notes-zone" aria-hidden="true"></div>

      <div class="tools" role="tablist" aria-label="Инструмент">
        <button class="tool" data-tool="grow" type="button" role="tab">${icons.thread}<span>Нить</span><kbd>1</kbd></button>
        <button class="tool" data-tool="fruit" type="button" role="tab">${icons.mushroom}<span>Гриб</span><kbd>2</kbd></button>
      </div>

      <div class="stamps">
        <button class="stamp" data-act="pause" type="button" title="Пауза (Пробел)"><span class="sp-ico"></span><span class="cap">Пробел</span></button>
        <button class="stamp" data-act="speed" type="button" title="Скорость (F)"><span class="sp-text">×1</span><span class="cap">F</span></button>
        <button class="stamp" data-act="sound" type="button" title="Звук (M)"><span class="sp-ico"></span><span class="cap">M</span></button>
        <button class="stamp small" data-act="atlas" type="button" title="Атлас находок (A)"><span class="sp-ico">${icons.find}</span><span class="badge" hidden></span><span class="cap">A</span></button>
        <button class="stamp small" data-act="help" type="button" title="Как играть (H)"><span class="sp-text">?</span><span class="cap">H</span></button>
      </div>
    </div>

    <div class="guide" aria-live="polite"></div>
    <div class="labels" aria-hidden="true"></div>

    <div class="tip" aria-hidden="true"></div>

    <div class="screen title-screen">
      <div class="page title-page">
        <figure class="plate"><img alt="" /><figcaption>Fig. 1 · Mycelium juvenile</figcaption></figure>
        <div class="title-body">
          <div class="overline">Тетрадь натуралиста · страница первая</div>
          <h1>Корни и нити</h1>
          <div class="sub">наблюдения за юной грибницей</div>
          <div class="glade-line" data-glade="title"></div>
          ${flourish}
          <div class="intro">
            <p>Под лесной поляной, в тёплом перегное, проросла одна спора. Тяни нити сквозь землю к воде и минералам, заключай союз с корнями деревьев: они заплатят тебе сахаром.</p>
            <p>Чем сильнее лес, тем сильнее ты. А над землёй вырастут грибы, и ветер разнесёт споры.</p>
          </div>
          <div class="actions">
            <button class="ink-btn primary" data-act="continue-save" type="button" hidden>Продолжить наблюдения</button>
            <button class="ink-btn primary" data-act="start" type="button">Начать наблюдения</button>
            <button class="ink-btn" data-act="start-new" type="button" hidden>Новая поляна</button>
          </div>
          <div class="actions extras">
            <button class="ink-btn quiet" data-act="help" type="button">Как играть</button>
            <button class="ink-btn quiet" data-act="guide-toggle" type="button">Подсказки: вкл</button>
          </div>
          <div class="hint">
            <span>Нить: зажми мышь на узле и веди</span>
            <span><kbd>1</kbd> <kbd>2</kbd> инструмент</span>
            <span><kbd>Пробел</kbd> пауза</span>
            <span><kbd>F</kbd> скорость</span>
            <span><kbd>M</kbd> звук</span>
          </div>
        </div>
      </div>
    </div>

    <div class="screen pause-screen light">
      <div class="page pause-page">
        <div class="overline">страница заложена</div>
        <h2>Пауза</h2>
        <div class="sub">время в лесу замерло</div>
        <div class="actions">
          <button class="ink-btn" data-act="resume" type="button">Продолжить</button>
          <button class="ink-btn quiet" data-act="help" type="button">Как играть</button>
          <button class="ink-btn quiet" data-act="guide-toggle" type="button">Подсказки: вкл</button>
        </div>
        <div class="hint"><kbd>Пробел</kbd> или <kbd>Esc</kbd></div>
      </div>
    </div>

    <div class="screen help-screen">
      <div class="page help-page" role="dialog" aria-label="Как играть"></div>
    </div>

    <div class="screen atlas-screen">
      <div class="page atlas-page" role="dialog" aria-label="Атлас находок"></div>
    </div>

    <div class="screen year-screen">
      <div class="page sum-page year-page" role="dialog" aria-label="Итог года"></div>
    </div>

    <div class="screen summary-screen">
      <div class="page sum-page">
        <div class="stamp-seal">наблюдения<br />завершены</div>
        <div class="overline">Тетрадь натуралиста · итог</div>
        <h2>Поляна изучена</h2>
        <div class="sub">все наблюдения отмечены</div>
        <div class="glade-line" data-glade="summary"></div>
        ${flourish}
        <ul class="stats">
          <li><span class="k">Споры</span><span class="v" data-s="spores"></span></li>
          <li><span class="k">Длина нитей</span><span class="v" data-s="length"></span></li>
          <li><span class="k">Наибольшая глубина</span><span class="v" data-s="depth"></span></li>
          <li><span class="k">Время наблюдений</span><span class="v" data-s="time"></span></li>
        </ul>
        <div class="actions">
          <button class="ink-btn" data-act="continue" type="button">Продолжить наблюдения</button>
          <button class="ink-btn" data-act="restart" type="button">Новая поляна</button>
        </div>
      </div>
    </div>`;

  const q = (sel) => root.querySelector(sel);
  const el = {
    resRows: Object.fromEntries(RESOURCES.map((r) => [r.k, q(`.res-row[data-k="${r.k}"]`)])),
    resCard: q('.res-card'),
    objGlade: q('.obj-glade'),
    gladeTitle: q('[data-glade="title"]'),
    gladeSummary: q('[data-glade="summary"]'),
    objCard: q('.obj-card'),
    objCount: q('.obj-count'),
    objCur: q('.obj-cur'),
    objList: q('.obj-list'),
    notes: q('.notes'),
    notesZone: q('.notes-zone'),
    guide: q('.guide'),
    labels: q('.labels'),
    help: q('.help-screen'),
    helpPage: q('.help-page'),
    atlas: q('.atlas-screen'),
    atlasPage: q('.atlas-page'),
    atlasBadge: q('[data-act="atlas"] .badge'),
    continueBtn: q('[data-act="continue-save"]'),
    startBtn: q('[data-act="start"]'),
    newBtn: q('[data-act="start-new"]'),
    guideBtns: [...root.querySelectorAll('[data-act="guide-toggle"]')],
    tools: [...root.querySelectorAll('.tool')],
    pause: q('[data-act="pause"]'),
    speed: q('[data-act="speed"]'),
    sound: q('[data-act="sound"]'),
    tip: q('.tip'),
    title: q('.title-screen'),
    titlePage: q('.title-page'),
    pauseScreen: q('.pause-screen'),
    summary: q('.summary-screen'),
    year: q('.year-screen'),
    yearPage: q('.year-page'),
  };
  for (const k of RESOURCES) {
    const row = el.resRows[k.k];
    el.resRows[k.k] = {
      row,
      num: row.querySelector('.num'),
      cap: row.querySelector('.cap'),
      rate: row.querySelector('.rate'),
      fill: row.querySelector('.gauge-fill'),
    };
  }
  const stat = (s) => q(`[data-s="${s}"]`);
  const statEls = { spores: stat('spores'), length: stat('length'), depth: stat('depth'), time: stat('time') };
  const pauseIco = el.pause.querySelector('.sp-ico');
  const speedText = el.speed.querySelector('.sp-text');
  const soundIco = el.sound.querySelector('.sp-ico');

  const notes = createNotes(el.notes);
  const atlasStore = createAtlasStore();
  const atlas = createAtlas(el.atlasPage, atlasStore);
  const calendar = createCalendar(q('.res-card'));
  const tooltip = createTooltip(el.tip);
  const labels = createLabels(el.labels);
  const guide = createGuide(el.guide, () => [
    q('.res-card'),
    q('.obj-card'),
    q('.tools'),
    q('.stamps'),
    el.notesZone,
  ]);

  // "Подсказки: вкл / выкл" on the title and pause pages mirrors the stored preference.
  function paintGuideButtons() {
    const on = guideEnabled();
    for (const b of el.guideBtns) {
      b.textContent = `Подсказки: ${on ? 'вкл' : 'выкл'}`;
      b.classList.toggle('off', !on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
  onGuideChange((on) => {
    if (on) guide.reset(); // turned back on: start the hints again
    paintGuideButtons();
  });
  paintGuideButtons();

  // Frontispiece: shown only when the art helper has produced it.
  const art = q('.plate img');
  art.addEventListener('load', () => el.titlePage.classList.add('has-art'));
  art.addEventListener('error', () => art.remove());
  art.src = ART_URL;

  // ---- screens -----------------------------------------------------------
  const screenTokens = new WeakMap();
  const screenTargets = new WeakMap();
  function setScreen(screen, open) {
    // Called every frame: act only when the wanted state changes. Re-running a close on every frame
    // used to cancel its own delayed cleanup, leaving an invisible full-screen page over the game.
    if (screenTargets.get(screen) === open) return;
    screenTargets.set(screen, open);
    const token = (screenTokens.get(screen) || 0) + 1;
    screenTokens.set(screen, token);
    if (open) {
      screen.classList.add('open');
      requestAnimationFrame(() => {
        if (screenTokens.get(screen) === token) screen.classList.add('shown');
      });
    } else {
      screen.classList.remove('shown');
      setTimeout(() => {
        if (screenTokens.get(screen) === token) screen.classList.remove('open');
      }, 380);
    }
  }

  // ---- per-game UI state (reset when the state object is replaced) --------
  let cur = null;
  let objKeys = [];
  let objLen = -1;
  let objRows = [];
  let objDone = [];
  let summaryOpen = false;
  let summaryShown = false;
  let pausedBySummary = false;
  let helpOpen = false;
  let pausedByHelp = false;
  let atlasOpen = false;
  let pausedByAtlas = false;
  let yearOpen = false;
  let pausedByYear = false;
  let pendingYear = null; // a year-end waiting for the page that is open now (the summary) to close
  let objReveal = 0; // s the objectives card stays open (a new game, a fresh tick)
  let objHold = 0; // s the card stays open after the pointer left it
  let seasonIntro = false; // the first season's note was shown for this game
  let saveFor = null; // the state object hasSave() was last asked for (once per title screen)
  let hasSave = false;
  const shown = {}; // text cache of the DOM
  const smooth = { sugar: 0, water: 0, minerals: 0, spores: 0 };
  const lastVal = {};

  function resetFor(state) {
    cur = state;
    objKeys = [];
    objLen = -1;
    objRows = [];
    objDone = [];
    summaryOpen = false;
    summaryShown = Boolean(state.flags && state.flags.allObjectivesDone);
    pausedBySummary = false;
    helpOpen = false;
    pausedByHelp = false;
    atlasOpen = false;
    pausedByAtlas = false;
    yearOpen = false;
    pausedByYear = false;
    pendingYear = null;
    objReveal = state.time < 2 ? OBJ_REVEAL_START : 0;
    objHold = 0;
    seasonIntro = false;
    atlas.close();
    for (const key of Object.keys(shown)) delete shown[key];
    for (const key of Object.keys(lastVal)) delete lastVal[key];
    for (const r of RESOURCES) smooth[r.k] = (state.rates && state.rates[r.k]) || 0;
    notes.reset(state);
    labels.reset();
    tooltip.reset();
    setScreen(el.summary, false);
    setScreen(el.pauseScreen, false);
    setScreen(el.help, false);
    setScreen(el.atlas, false);
    setScreen(el.year, false);
  }

  // ---- actions -----------------------------------------------------------
  function dismissSummary() {
    if (!summaryOpen) return false;
    summaryOpen = false;
    setScreen(el.summary, false);
    if (pausedBySummary && cur && cur.phase === 'paused') actions.togglePause();
    pausedBySummary = false;
    return true;
  }

  function openSummary(state) {
    summaryShown = true;
    summaryOpen = true;
    statEls.spores.textContent = nf.format(Math.floor(state.res.spores));
    statEls.length.textContent = `${nf.format(Math.round(state.stats.hyphaeLength))} ед.`;
    statEls.depth.textContent = `${nf.format(Math.round(state.stats.maxDepth))} ед.`;
    statEls.time.textContent = formatTime(state.time);
    el.gladeSummary.textContent = gladeLabel(state);
    setScreen(el.summary, true);
    if (state.phase === 'playing') {
      pausedBySummary = true;
      actions.togglePause();
    }
  }

  function openYear(state, year) {
    yearOpen = true;
    el.yearPage.innerHTML = buildYearPage(state, year);
    setScreen(el.year, true);
    if (state.phase === 'playing') {
      pausedByYear = true; // the game waits while the page is open; «Продолжить» resumes it
      actions.togglePause();
    }
  }

  function dismissYear() {
    if (!yearOpen) return false;
    yearOpen = false;
    setScreen(el.year, false);
    if (pausedByYear && cur && cur.phase === 'paused') actions.togglePause();
    pausedByYear = false;
    return true;
  }

  function openHelp() {
    if (helpOpen || atlasOpen || summaryOpen || yearOpen || !cur) return;
    helpOpen = true;
    el.helpPage.innerHTML = buildHelp(cur);
    setScreen(el.help, true);
    if (cur.phase === 'playing') {
      pausedByHelp = true; // the game waits while the page is open
      actions.togglePause();
    }
  }

  function closeHelp() {
    if (!helpOpen) return false;
    helpOpen = false;
    setScreen(el.help, false);
    if (pausedByHelp && cur && cur.phase === 'paused') actions.togglePause();
    pausedByHelp = false;
    return true;
  }

  function openAtlas() {
    if (atlasOpen || helpOpen || summaryOpen || yearOpen || !cur || cur.phase === 'title') return;
    atlasOpen = true;
    atlas.open(cur);
    setScreen(el.atlas, true);
    if (cur.phase === 'playing') {
      pausedByAtlas = true; // the game waits while the page is open
      actions.togglePause();
    }
  }

  function closeAtlas() {
    if (!atlasOpen) return false;
    atlasOpen = false;
    atlas.close();
    setScreen(el.atlas, false);
    if (pausedByAtlas && cur && cur.phase === 'paused') actions.togglePause();
    pausedByAtlas = false;
    return true;
  }

  /** Title page: the main button continues a saved game when there is one. */
  function startPrimary() {
    if (hasSave && actions.continueSaved?.()) return;
    actions.start();
  }

  function refreshSave(state) {
    hasSave = Boolean(actions.hasSave?.());
    el.continueBtn.hidden = !hasSave;
    el.newBtn.hidden = !hasSave;
    el.startBtn.hidden = hasSave;
    el.titlePage.classList.toggle('has-save', hasSave);
    saveFor = state;
  }

  const toggleMute = () => actions.setMuted(!actions.isMuted());
  const toggleSpeed = () => actions.setSpeed(cur && cur.speed === 2 ? 1 : 2);

  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    btn.blur();
    if (btn.dataset.tool) return actions.setTool(btn.dataset.tool);
    switch (btn.dataset.act) {
      case 'start':
      case 'start-new':
        return actions.start();
      case 'continue-save':
        return startPrimary();
      case 'help':
        return helpOpen ? void closeHelp() : openHelp();
      case 'help-close':
        return void closeHelp();
      case 'atlas':
        return atlasOpen ? void closeAtlas() : openAtlas();
      case 'atlas-close':
        return void closeAtlas();
      case 'guide-toggle':
        return setGuideEnabled(!guideEnabled());
      case 'resume':
      case 'pause':
        return actions.togglePause();
      case 'speed':
        return toggleSpeed();
      case 'sound':
        return toggleMute();
      case 'continue':
        return void dismissSummary();
      case 'year-continue':
        return void dismissYear();
      case 'restart':
        return actions.restart();
      default:
    }
  });

  // a click on the dark margin around the atlas page: back from a specimen to the grid, or out of the atlas
  el.atlas.addEventListener('click', (ev) => {
    if (ev.target !== el.atlas) return;
    if (!atlas.back()) closeAtlas();
  });

  // ---- keyboard ----------------------------------------------------------
  // e.code is layout-independent: F and M keep working on a Russian layout.
  window.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || !cur) return;
    const phase = cur.phase;
    let handled = true;
    if (helpOpen) {
      // the help page owns the keyboard: H, Esc, Space and Enter close it
      if (['KeyH', 'Escape', 'Space', 'Enter'].includes(ev.code)) {
        if (!ev.repeat) closeHelp();
        ev.preventDefault();
      }
      return;
    }
    if (atlasOpen) {
      // the atlas owns the keyboard: a specimen page takes ← → Esc Space Enter itself; otherwise A, Esc, Space and Enter close it
      if (ev.repeat && ['Escape', 'Space', 'Enter'].includes(ev.code)) {
        ev.preventDefault(); // a held key must not walk back out of the atlas
        return;
      }
      if (atlas.key(ev.code)) {
        ev.preventDefault();
        return;
      }
      if (['KeyA', 'Escape', 'Space', 'Enter'].includes(ev.code)) {
        if (!ev.repeat) closeAtlas();
        ev.preventDefault();
      }
      return;
    }
    switch (ev.code) {
      case 'Digit1':
      case 'Numpad1':
        if (phase !== 'title') actions.setTool('grow');
        break;
      case 'Digit2':
      case 'Numpad2':
        if (phase !== 'title') actions.setTool('fruit');
        break;
      case 'Space':
        if (ev.repeat) break;
        if (phase === 'title') startPrimary();
        else if (summaryOpen) dismissSummary();
        else if (yearOpen) dismissYear();
        else actions.togglePause();
        break;
      case 'Enter':
        if (ev.repeat) break;
        if (phase === 'title') startPrimary();
        else if (summaryOpen) dismissSummary();
        else if (yearOpen) dismissYear();
        else handled = false;
        break;
      case 'KeyH':
        if (!ev.repeat) openHelp();
        break;
      case 'KeyA':
        if (!ev.repeat) openAtlas();
        break;
      case 'KeyF':
        if (!ev.repeat && phase !== 'title') toggleSpeed();
        break;
      case 'KeyM':
        if (!ev.repeat) toggleMute();
        break;
      case 'Escape':
        if (ev.repeat) break;
        if (cur.ui.drag) actions.cancelDrag();
        else if (summaryOpen) dismissSummary();
        else if (yearOpen) dismissYear();
        else if (phase === 'paused' || phase === 'playing') actions.togglePause();
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) ev.preventDefault();
  });
  // A focused button must not be "clicked" by Space on key release.
  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space') ev.preventDefault();
  });

  // ---- per-frame pieces --------------------------------------------------
  function updateResources(state, dt) {
    const k = Math.min(1, dt * 4);
    for (const r of RESOURCES) {
      const row = el.resRows[r.k];
      const view = resourceView(state, r.k);
      const value = view.value;
      setText(row.num, shown, `${r.k}.v`, String(value));
      if (r.cap) {
        // «71 / 90» and a thin bar under it that fills toward the cap and goes wax-red when the stock is full
        setText(row.cap, shown, `${r.k}.c`, view.cap > 0 ? ` / ${view.cap}` : '');
        const fracKey = Math.round(view.frac * 200);
        if (shown[`${r.k}.f`] !== fracKey) {
          shown[`${r.k}.f`] = fracKey;
          row.fill.style.transform = `scaleX(${view.frac.toFixed(3)})`;
        }
        if (shown[`${r.k}.full`] !== view.full) {
          shown[`${r.k}.full`] = view.full;
          row.row.classList.toggle('full', view.full);
        }
      }
      const prev = lastVal[r.k];
      if (prev !== undefined && value > prev && (r.k === 'spores' || value - prev >= 3)) {
        row.row.classList.remove('bump');
        void row.row.offsetWidth;
        row.row.classList.add('bump');
      }
      lastVal[r.k] = value;
      smooth[r.k] += ((state.rates[r.k] || 0) - smooth[r.k]) * k;
      // a full stock says so instead of a rate (it cannot grow, the sim clamps it)
      const full = view.full;
      const text = full ? 'полно' : state.phase === 'paused' ? '' : formatRate(smooth[r.k]);
      if (shown[`${r.k}.r`] !== text) {
        shown[`${r.k}.r`] = text;
        row.rate.textContent = text;
        row.rate.className = `rate${full ? ' full' : text ? (smooth[r.k] > 0 ? ' pos' : ' neg') : ''}`;
      }
    }
    // sugar at zero: warn colour on the figure
    const dry = state.res.sugar < 1;
    if (shown.dry !== dry) {
      shown.dry = dry;
      el.resRows.sugar.row.classList.toggle('warn', dry);
    }
  }

  /** The tooltip of the resources row under the pointer (the cards let the pointer through to the scene). */
  function resourceHover(state) {
    const p = state.ui.pointer;
    let hit = null;
    const pageOpen = helpOpen || atlasOpen || summaryOpen || yearOpen;
    if (state.phase !== 'title' && !pageOpen && p && p.inside !== false && !state.ui.drag && p.sx < 480 && p.sy < 560) {
      const c = el.resCard.getBoundingClientRect();
      if (p.sx >= c.left && p.sx <= c.right && p.sy >= c.top && p.sy <= c.bottom) {
        for (const r of RESOURCES) {
          const b = el.resRows[r.k].row.getBoundingClientRect();
          if (p.sy >= b.top - 1 && p.sy <= b.bottom + 1) {
            hit = r.k;
            break;
          }
        }
      }
    }
    if (shown.resHover !== hit) {
      if (shown.resHover) el.resRows[shown.resHover].row.classList.remove('hover');
      if (hit) el.resRows[hit].row.classList.add('hover');
      shown.resHover = hit;
    }
    if (!hit) return null;
    const tip = resourceTip(state, hit);
    const b = el.resRows[hit].row.getBoundingClientRect();
    const c = el.resCard.getBoundingClientRect();
    if (tip) tip.at = { x: c.right + 10, y: b.top - 6 };
    return tip;
  }

  function updateObjectives(state) {
    const list = state.objectives || [];
    let changed = list.length !== objLen;
    for (let i = 0; !changed && i < list.length; i++) changed = objKeys[i] !== list[i].text;
    if (changed) {
      objLen = list.length;
      objKeys = list.map((o) => o.text);
      el.objList.innerHTML = list
        .map((o) => `<li class="obj"><span class="box">${checkbox}</span><span class="txt"></span></li>`)
        .join('');
      objRows = [...el.objList.children];
      objRows.forEach((row, i) => {
        row.querySelector('.txt').textContent = list[i].text;
      });
      objDone = list.map(() => null);
    }
    for (let i = 0; i < list.length; i++) {
      const done = Boolean(list[i].done);
      if (objDone[i] === done) continue;
      const first = objDone[i] === null;
      objDone[i] = done;
      const row = objRows[i];
      row.classList.toggle('done', done);
      row.classList.toggle('just', done && !first);
      if (done && !first) objReveal = OBJ_REVEAL_TICK; // show the tick being drawn
    }
    // the compact line: «2 / 5» and the first objective still open
    const doneCount = list.filter((o) => o.done).length;
    setText(el.objCount, shown, 'obj.count', `${doneCount} / ${list.length}`);
    const next = list.find((o) => !o.done);
    setText(el.objCur, shown, 'obj.cur', next ? next.text : list.length ? 'всё отмечено' : '');
    setText(el.objGlade, shown, 'obj.glade', gladeLabel(state));
  }

  /**
   * The objectives card is one line by default (it would hide the pine and the crowns) and opens to the full list
   * while the pointer is over it, for a few seconds after a new game or a ticked objective.
   */
  function updateObjCard(state, dt) {
    const playing = state.phase !== 'title';
    if (playing) {
      objReveal = Math.max(0, objReveal - dt);
      objHold = Math.max(0, objHold - dt);
    }
    const p = state.ui.pointer;
    if (playing && p && p.inside !== false && !state.ui.drag && p.sy < 360) { // the card lives in the top-right corner
      const r = el.objCard.getBoundingClientRect();
      if (p.sx >= r.left - 6 && p.sx <= r.right + 6 && p.sy >= r.top - 6 && p.sy <= r.bottom + 6) objHold = OBJ_HOLD;
    }
    const open = playing && (objReveal > 0 || objHold > 0);
    if (shown.objOpen !== open) {
      shown.objOpen = open;
      el.objCard.classList.toggle('open', open);
    }
  }

  /** The first season's note once play starts, so the calendar's words do not come out of nowhere. */
  function updateSeasons(state) {
    calendar.update(state);
    if (!seasonIntro && state.phase === 'playing' && state.flags && state.flags.seasons && state.clock) {
      seasonIntro = true;
      if (state.time < 3) {
        const n = seasonNote(state.clock.season);
        if (n) notes.say({ key: n.key, text: n.text, tone: 'good', icon: n.season, life: 9 });
      }
    }
  }

  /** Count badge on the atlas stamp, and a one-time pointer to the atlas after the very first find. */
  function updateFinds(state) {
    const n = Object.keys(state.finds || {}).length;
    if (shown.finds !== n) {
      const grew = shown.finds !== undefined && n > shown.finds;
      shown.finds = n;
      atlasStore.sync(state); // the lifetime atlas remembers what this glade gave
      el.atlasBadge.hidden = n === 0;
      el.atlasBadge.textContent = String(n);
      if (grew) {
        el.atlasBadge.classList.remove('bump');
        void el.atlasBadge.offsetWidth;
        el.atlasBadge.classList.add('bump');
      }
    }
    if (state.phase === 'playing' && state.events.some((e) => e.type === 'find') && !atlasHintSeen()) {
      markAtlasHint();
      notes.say({ key: 'atlas-hint', text: 'Находка записана в атлас: клавиша A', icon: 'find' });
    }
  }

  function updateControls(state) {
    const tool = state.ui.tool;
    for (const t of el.tools) {
      const on = t.dataset.tool === tool;
      if (t.classList.contains('active') !== on) {
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
      }
    }
    const paused = state.phase === 'paused';
    if (shown.paused !== paused) {
      shown.paused = paused;
      pauseIco.innerHTML = paused ? icons.play : icons.pause;
      el.pause.classList.toggle('on', paused);
      el.pause.title = paused ? 'Продолжить (Пробел)' : 'Пауза (Пробел)';
    }
    const fast = state.speed === 2;
    if (shown.fast !== fast) {
      shown.fast = fast;
      speedText.textContent = fast ? '×2' : '×1';
      el.speed.classList.toggle('fast', fast);
    }
    const muted = Boolean(actions.isMuted());
    if (shown.muted !== muted) {
      shown.muted = muted;
      soundIco.innerHTML = muted ? icons.muted : icons.sound;
      el.sound.classList.toggle('on', muted);
    }
  }

  return {
    update(state, dt, view) {
      if (state !== cur) resetFor(state);
      const phase = state.phase;
      if (root.dataset.phase !== phase) root.dataset.phase = phase;
      if (phase === 'title' && saveFor !== state) refreshSave(state);

      setScreen(el.title, phase === 'title');
      setScreen(el.pauseScreen, phase === 'paused' && !summaryOpen && !helpOpen && !atlasOpen && !yearOpen);

      if (phase === 'title') setText(el.gladeTitle, shown, 'glade.title', gladeLabel(state, hasSave ? 'Новая поляна' : 'Поляна'));
      updateResources(state, dt);
      updateObjectives(state);
      updateObjCard(state, dt);
      updateControls(state);
      updateSeasons(state);

      // events -> floating labels at their place (local) and margin notes (global), summary trigger
      const labelled = labels.process(state, view);
      notes.process(state, labelled);
      updateFinds(state);
      notes.tick(dt);
      labels.tick(dt);
      guide.update(state, dt, view, phase === 'playing' && !summaryOpen && !helpOpen && !atlasOpen && !yearOpen);
      if (!summaryShown && phase !== 'title') {
        let trigger = Boolean(state.flags && state.flags.allObjectivesDone);
        if (!trigger) {
          for (const ev of state.events) if (ev.type === 'all-objectives') trigger = true;
        }
        if (trigger) openSummary(state);
      }
      // the end of the first (and every later) year: its page waits for the summary page if that is open
      for (const ev of state.events) if (ev.type === 'year-end') pendingYear = ev.year;
      if (pendingYear !== null && phase !== 'title' && !summaryOpen && !helpOpen && !atlasOpen && !yearOpen) {
        openYear(state, pendingYear);
        pendingYear = null;
      }

      tooltip.update(state, resourceHover(state));
    },
  };
}

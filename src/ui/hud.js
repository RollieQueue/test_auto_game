// DOM HUD: a naturalist's notebook around the scene. API: createHud(root, actions) -> { update(state, dt, view) }.
// update() runs every frame, so every write below is guarded by a "changed?" check.
import { icons, checkbox, flourish, capBar } from './icons.js';
import { RESOURCES, resourceView, resourceTip, createSugarNudge } from './resources-logic.js';
import { coverage, cardMode, pointerIn, crownRect, mushroomRect, openCardRect, stumpsUnder, wantFold, foldStep } from './cards-logic.js';
import { objectiveText } from './trees-logic.js';
import { gladeLabel, gladeParts } from './glade.js';
import { foldedLine } from './obj-fold.js';
import { createNotes, smallWindow } from './notes.js';
import { notesShift } from './labels-logic.js';
import { createTooltip } from './tooltip.js';
import { createLabels } from './labels.js';
import { tooltipDenialFamily } from './labels-logic.js';
import { createGuide } from './guide.js';
import { buildHelp } from './help.js';
import { createAtlas } from './atlas.js';
import { createAtlasStore } from './atlas-store.js';
import { createSpeciesPicker } from './species.js';
import { calendarHtml, createCalendar } from './calendar.js';
import { seasonNote } from './season-logic.js';
import { buildClosedPage, buildYearPage } from './year.js';
import { stakesSlip } from './year-logic.js';
import { pageClosed } from '../sim/stakes.js';
import { guideEnabled, setGuideEnabled, onGuideChange, atlasHintSeen, markAtlasHint, wormNoteSeen, markWormNote } from './prefs.js';
import { FIRST_WORM_NOTE, WORM_SENSE_NOTE, chapterOf, createSenseGate, objectivesTitle, summaryTexts, threatsOn, trapCost, trapTabTitle } from './threats.js';
import { feedTabShown, feedTabTitle } from './feed.js';
import { barrierCostOf, barrierTabShown, barrierTabTitle, markRivalHint, rivalOn, rivalStats, rivalSummaryLine } from './rival.js';
import { initSettingsPanel } from './settings.js';
import { createMarks } from './marks.js';
import { createSlips } from './slips.js';
import * as balance from '../sim/balance.js';

// bar colours of the capped stocks (spores have no cap and no bar)
const BAR_COLORS = { sugar: ['#e0b04a', '#b97a14'], water: ['#78b6dc', '#2f6f9f'], minerals: ['#8d7bc0', '#6a4a8c'] };

const ART_URL = 'assets/art/frontispiece.webp';
const OBJ_REVEAL_START = 8; // s the objectives card is open at the start of a game
const OBJ_REVEAL_TICK = 6; // s it opens when an objective is ticked off
const OBJ_QUIET_WAKE = 12; // s the objectives card stays folded after the honey fungus woke
const OBJ_REVEAL_STUMP = 2; // s it opens by itself at most, when open it would cover the rival's stump (it opens under the pointer as ever)
const OBJ_REVEAL_BEHIND = 3.5; // s it opens by itself at most, when open it would cover a crown or a mushroom
const OBJ_HOLD = 0.35; // s it stays open after the pointer moved away

const nf = new Intl.NumberFormat('ru-RU');

// keys that scroll the help page: pixels, or a share of the page height (±1), or 'start' / 'end'
const HELP_SCROLL = { ArrowDown: 60, ArrowUp: -60, PageDown: 1, PageUp: -1, Home: 'start', End: 'end' };

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

/** A glade line of the title: the name cuts itself short with an ellipsis, the «· №seed» tail stays whole, and the title attribute holds the whole label. */
function setGladeLine(el, cache, key, parts) {
  const full = parts ? parts.head + parts.tail : '';
  if (cache[key] === full) return;
  cache[key] = full;
  el.textContent = '';
  el.title = full;
  if (!parts) return;
  const head = document.createElement('span');
  head.className = 'gl-head';
  head.textContent = parts.head;
  el.append(head);
  if (parts.tail) {
    const tail = document.createElement('span');
    tail.className = 'gl-tail';
    tail.textContent = parts.tail;
    el.append(tail);
  }
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
          <h3 class="card-title" data-k="obj-title">Наблюдения</h3>
          <span class="obj-count">0 / 0</span>
          <span class="obj-cur"></span>
        </div>
        <div class="obj-glade"></div>
        <div class="obj-body"><ul class="obj-list"></ul></div>
      </section>

      <div class="notes" aria-live="polite"></div>
      <div class="notes-zone" aria-hidden="true"></div>
      <div class="slips" aria-live="polite"></div>

      <div class="tools" role="tablist" aria-label="Инструмент">
        <button class="tool" data-tool="grow" type="button" role="tab">${icons.thread}<span>Нить</span><kbd>1</kbd></button>
        <button class="tool" data-tool="fruit" type="button" role="tab">${icons.mushroom}<span>Гриб</span><kbd>2</kbd></button>
        <button class="tool" data-tool="trap" type="button" role="tab" hidden>${icons.ring}<span>Кольцо</span><kbd>3</kbd></button>
        <button class="tool" data-tool="barrier" type="button" role="tab" hidden>${icons.barrier}<span>Барьер</span><kbd>4</kbd></button>
        <button class="tool" data-tool="feed" type="button" role="tab" hidden>${icons.feed}<span>Подкормка</span><kbd>5</kbd></button>
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
          <div class="glade-line fresh" data-glade="fresh"></div>
          ${flourish}
          <div class="intro">
            <p>Под лесной поляной, в тёплом перегное, проросла одна спора. Тяни нити сквозь землю к воде и минералам, заключай союз с корнями деревьев: они заплатят тебе сахаром.</p>
            <p>Чем сильнее лес, тем сильнее ты. А над землёй вырастут грибы, и ветер разнесёт споры.</p>
          </div>
          <div class="species"></div>
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
            <span><kbd>1</kbd> <kbd>2</kbd> <kbd class="k3" hidden>3</kbd> инструмент</span>
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
        <div class="settings" role="group" aria-label="Настройки">
          <label class="set-row">
            <span class="set-name">Громкость</span>
            <input class="set-range" type="range" min="0" max="100" step="5" value="100" data-set="volume" aria-label="Громкость" />
            <output class="set-val">100 %</output>
          </label>
          <button class="ink-btn quiet set-toggle" data-act="motion-toggle" type="button" aria-pressed="false">Меньше движения: выкл</button>
        </div>
        <div class="new-glade">
          <button class="ink-btn quiet" data-act="new-ask" type="button">Новая поляна</button>
          <div class="new-confirm" role="group" aria-label="Новая поляна" hidden>
            <div class="new-q">Точно? Эта поляна пропадёт</div>
            <div class="new-btns">
              <button class="ink-btn quiet warn" data-act="new-yes" type="button">Да, новая</button>
              <button class="ink-btn quiet" data-act="new-no" type="button">Нет</button>
            </div>
          </div>
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
    <div class="stakes-slip" role="status" hidden><span class="sl-main"></span><span class="sl-hint"></span></div>

    <div class="screen summary-screen">
      <div class="page sum-page" data-sum="page">
        <div class="stamp-seal" data-sum="seal">наблюдения<br />завершены</div>
        <div class="overline" data-sum="overline">Тетрадь натуралиста · итог</div>
        <h2 data-sum="title">Поляна изучена</h2>
        <div class="sub" data-sum="sub">все наблюдения отмечены</div>
        <div class="glade-line" data-glade="summary"></div>
        ${flourish}
        <ul class="stats">
          <li><span class="k">Споры</span><span class="v" data-s="spores"></span></li>
          <li><span class="k">Длина нитей</span><span class="v" data-s="length"></span></li>
          <li><span class="k">Наибольшая глубина</span><span class="v" data-s="depth"></span></li>
          <li><span class="k">Время наблюдений</span><span class="v" data-s="time"></span></li>
          <li class="threat-stat" hidden><span class="k">Поймано нематод</span><span class="v" data-s="caught"></span></li>
          <li class="threat-stat" hidden><span class="k">Отмерло узлов</span><span class="v" data-s="lost"></span></li>
          <li class="rival-stat" hidden><span class="k">Опёнок</span><span class="v" data-s="rival"></span></li>
        </ul>
        <div class="actions">
          <button class="ink-btn" data-act="continue" data-sum="button" type="button">Продолжить наблюдения</button>
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
    gladeFresh: q('[data-glade="fresh"]'),
    gladeSummary: q('[data-glade="summary"]'),
    objCard: q('.obj-card'),
    objTitle: q('[data-k="obj-title"]'),
    trapTab: q('.tool[data-tool="trap"]'),
    barrierTab: q('.tool[data-tool="barrier"]'),
    feedTab: q('.tool[data-tool="feed"]'),
    kbd3: q('.hint .k3'),
    objCount: q('.obj-count'),
    objCur: q('.obj-cur'),
    objList: q('.obj-list'),
    notes: q('.notes'),
    notesZone: q('.notes-zone'),
    slips: q('.slips'),
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
    newAsk: q('.pause-page [data-act="new-ask"]'),
    newConfirm: q('.pause-page .new-confirm'),
    summary: q('.summary-screen'),
    year: q('.year-screen'),
    yearPage: q('.year-page'),
    slip: q('.stakes-slip'),
    slipMain: q('.sl-main'),
    slipHint: q('.sl-hint'),
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
  const statEls = {
    spores: stat('spores'),
    length: stat('length'),
    depth: stat('depth'),
    time: stat('time'),
    caught: stat('caught'),
    lost: stat('lost'),
    rival: stat('rival'),
  };
  const sumEls = {
    seal: q('[data-sum="seal"]'),
    overline: q('[data-sum="overline"]'),
    title: q('[data-sum="title"]'),
    sub: q('[data-sum="sub"]'),
    button: q('[data-sum="button"]'),
    page: q('[data-sum="page"]'),
  };
  const pauseIco = el.pause.querySelector('.sp-ico');
  const speedText = el.speed.querySelector('.sp-text');
  const soundIco = el.sound.querySelector('.sp-ico');

  const notes = createNotes(el.notes);
  const atlasStore = createAtlasStore();
  const slips = createSlips(el.slips); // the paper slip of an earned mark
  const marks = createMarks({ notes, slips, atlasStore }); // «Пометки на полях»: achievements, the atlas's second tab
  const atlas = createAtlas(el.atlasPage, atlasStore, marks);
  const calendar = createCalendar(q('.res-card'));
  const tooltip = createTooltip(el.tip);
  // floating labels keep out of the column of margin notes: the notes on screen and the slot of the next one
  const labels = createLabels(el.labels, () => {
    const out = [];
    // The cards and bars stay readable too: a label born under them (a stump at the glade's edge) floats clear.
    out.push(...cardRects());
    let bottom = -Infinity;
    for (const n of el.notes.children) {
      const r = n.getBoundingClientRect();
      if (r.width < 2) continue;
      out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
      bottom = Math.max(bottom, r.bottom);
    }
    const z = el.notesZone.getBoundingClientRect();
    const top = out.length ? bottom + 6 : z.top;
    const slot = 3.4 * (parseFloat(getComputedStyle(root).fontSize) || 16);
    out.push({ l: z.left, t: top, r: z.right, b: top + slot });
    return out;
  });
  const tipMain = el.tip.querySelector('.t-main');
  /** The refusal the cursor tooltip says right now («Не хватает сахара (нужно 20)»): the floating label would only repeat it. */
  const tipDenial = () => (el.tip.classList.contains('show') ? tooltipDenialFamily(tipMain.textContent) : null);
  const nudge = createSugarNudge();
  const senseGate = createSenseGate();
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
  initSettingsPanel(root, actions); // volume and «Меньше движения» on the pause page (src/ui/settings.js)

  // Frontispiece: shown only when the art helper has produced it.
  const art = q('.plate img');
  art.addEventListener('load', () => el.titlePage.classList.add('has-art'));
  art.addEventListener('error', () => art.remove());
  art.src = ART_URL;
  const speciesPicker = createSpeciesPicker(q('.species'), actions);

  // The cards and bars that float labels and the cursor tooltip keep clear of. The objectives card opens and shuts over
  // 0.3 s, so its rectangle is the one it settles at (a label born in the first frames must not see it half-open).
  function cardRects() {
    const out = [];
    for (const sel of ['.res-card', '.obj-card', '.tools', '.stamps']) {
      const node = q(sel);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 2) continue;
      let bottom = r.bottom;
      if (node === el.objCard) {
        const fs = parseFloat(getComputedStyle(root).fontSize) || 16;
        const head = node.querySelector('.obj-head').offsetHeight;
        bottom =
          r.top +
          (shown.objOpen
            ? head + el.objGlade.offsetHeight + el.objList.scrollHeight + 1.9 * fs
            : head + 0.6 * fs);
      }
      out.push({ l: r.left, t: r.top, r: r.right, b: bottom });
    }
    return out;
  }

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
  let objTxt = []; // the text elements of the rows and what they show now (the progress changes without a rebuild)
  let objTxtShown = [];
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
  let closedOpen = false; // the year page shows the closed page (no «Продолжить»: the notebook is shut until a new game)
  let pendingYear = null; // a year-end waiting for the page that is open now (the summary) to close
  let prevChapter = 1; // the chapter at the previous frame (the page that just closed when all-objectives arrives)
  let muteDoneFlag = false; // a new page turned while allObjectivesDone was still set: ignore it until it drops
  let caught = 0; // worms caught and nodes lost in this game (the summary page tells them)
  let lostNodes = 0;
  let freedTrees = 0; // trees the honey fungus let go of in this game (the summary and year pages tell them)
  let objReveal = 0; // s the objectives card stays open (a new game, a fresh tick)
  let objHold = 0; // s the card stays open after the pointer left it
  let objQuiet = 0; // s the card stays folded after the honey fungus woke (the stump and its label must show)
  let objHides = false; // the card, were it open, would lie over a stump (updateCards sets it)
  let seasonIntro = false; // the first season's note was shown for this game
  let cardT = 0; // s until the cards look again at what lies under them
  let cardAcc = 0; // s since they last looked
  let resFold = { folded: false, t: 0 }; // the resources card folded to its header and sugar row (something lies under its rows)
  let resFullH = 0; // px, the card's height with all its rows (measured while it is open)
  let resFoldFs = 0; // the font size resFullH was measured at
  let objBehind = false; // the card, were it open, would lie over a crown or a mushroom
  let saveFor = null; // the state object hasSave() was last asked for (once per title screen)
  let hasSave = false;
  let savedParts = null; // «Сохранённая поляна: …»: the glade «Продолжить наблюдения» opens (the title's own state is the new one)
  const shown = {}; // text cache of the DOM
  const smooth = { sugar: 0, water: 0, minerals: 0, spores: 0 };
  const lastVal = {};

  function resetFor(state) {
    cur = state;
    objKeys = [];
    objLen = -1;
    objRows = [];
    objTxt = [];
    objTxtShown = [];
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
    closedOpen = false;
    pendingYear = null;
    prevChapter = chapterOf(state);
    muteDoneFlag = false;
    caught = 0;
    lostNodes = 0;
    freedTrees = 0;
    objReveal = state.time < 2 ? OBJ_REVEAL_START : 0;
    objHold = 0;
    objQuiet = 0;
    seasonIntro = false;
    cardT = 0;
    nudge.reset();
    senseGate.reset();
    atlas.close();
    for (const key of Object.keys(shown)) delete shown[key];
    for (const key of Object.keys(lastVal)) delete lastVal[key];
    for (const r of RESOURCES) smooth[r.k] = (state.rates && state.rates[r.k]) || 0;
    notes.reset(state);
    labels.reset();
    slips.reset();
    tooltip.reset();
    setScreen(el.summary, false);
    setScreen(el.pauseScreen, false);
    setNewAsk(false);
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

  function openSummary(state, completed) {
    summaryShown = true;
    summaryOpen = true;
    const t = summaryTexts(state, completed);
    sumEls.overline.textContent = t.overline;
    sumEls.title.textContent = t.title;
    sumEls.sub.textContent = t.sub;
    sumEls.seal.innerHTML = t.seal;
    sumEls.button.textContent = t.button;
    sumEls.page.classList.toggle('chapter', threatsOn(state));
    statEls.caught.parentElement.hidden = !(threatsOn(state) && caught > 0);
    statEls.lost.parentElement.hidden = !(threatsOn(state) && lostNodes > 0);
    statEls.caught.textContent = nf.format(caught);
    statEls.lost.textContent = nf.format(lostNodes);
    statEls.rival.parentElement.hidden = !rivalOn(state);
    statEls.rival.textContent = rivalSummaryLine(rivalStats(state, freedTrees));
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
    el.yearPage.innerHTML = buildYearPage(state, year, { freed: freedTrees });
    setScreen(el.year, true);
    if (state.phase === 'playing') {
      pausedByYear = true; // the game waits while the page is open; «Продолжить» resumes it
      actions.togglePause();
    }
  }

  /** «Страница закрыта»: the year screen shows the closing page; the game stays paused behind it, only the two buttons go on. */
  function openClosed(state) {
    closedOpen = true;
    yearOpen = true;
    pendingYear = null;
    el.yearPage.setAttribute('aria-label', 'Страница закрыта');
    el.yearPage.innerHTML = buildClosedPage(state);
    setScreen(el.year, true);
    if (state.phase === 'playing') actions.togglePause();
  }

  function dismissYear() {
    if (!yearOpen || closedOpen) return false;
    yearOpen = false;
    setScreen(el.year, false);
    if (pausedByYear && cur && cur.phase === 'paused') actions.togglePause();
    pausedByYear = false;
    return true;
  }

  // a help page taller than the window scrolls; «дальше ↓» fades in at its foot while there is more below
  function updateHelpMore() {
    const p = el.helpPage;
    p.classList.toggle('more', p.scrollHeight - p.clientHeight - p.scrollTop > 10);
  }
  el.helpPage.addEventListener('scroll', updateHelpMore, { passive: true });
  window.addEventListener('resize', () => helpOpen && updateHelpMore());

  function openHelp() {
    if (helpOpen || atlasOpen || summaryOpen || yearOpen || !cur) return;
    helpOpen = true;
    el.helpPage.innerHTML = buildHelp(cur);
    el.helpPage.scrollTop = 0;
    setScreen(el.help, true);
    requestAnimationFrame(() => requestAnimationFrame(updateHelpMore)); // after the page has its size
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
    const saved = hasSave ? actions.savedGlade?.() : null;
    savedParts = saved ? gladeParts(saved, 'Сохранённая поляна') : null;
    el.continueBtn.hidden = !hasSave;
    el.newBtn.hidden = !hasSave;
    el.startBtn.hidden = hasSave;
    el.titlePage.classList.toggle('has-save', hasSave);
    speciesPicker.show(state, hasSave);
    saveFor = state;
  }

  /** The pause page's «Новая поляна» asks once: the first click turns the button into «Точно? …» with «Да, новая» / «Нет». */
  function setNewAsk(on) {
    el.newAsk.hidden = on;
    el.newConfirm.hidden = !on;
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
      case 'guide-toggle': {
        const next = !guideEnabled();
        if (!next) markRivalHint(); // hints turned off by hand: no arrow at the honey fungus either
        return setGuideEnabled(next);
      }
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
      case 'retry': // the same glade and fungus, from the start
        return actions.restart(cur.seed, cur.flags.species);
      case 'restart':
        return actions.restart();
      case 'new-ask':
        return setNewAsk(true);
      case 'new-no':
        return setNewAsk(false);
      case 'new-yes': // the same action as «Новая поляна» on the summary: a new random glade (never the glade just left)
        setNewAsk(false);
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
      // the help page owns the keyboard: H, Esc, Space and Enter close it; arrows, PageUp/PageDown, Home/End scroll it
      if (['KeyH', 'Escape', 'Space', 'Enter'].includes(ev.code)) {
        if (!ev.repeat) closeHelp();
        ev.preventDefault();
      } else if (HELP_SCROLL[ev.code]) {
        const page = el.helpPage;
        const by = HELP_SCROLL[ev.code];
        if (by === 'start') page.scrollTop = 0;
        else if (by === 'end') page.scrollTop = page.scrollHeight;
        else page.scrollBy({ top: by * (Math.abs(by) > 1 ? 1 : page.clientHeight * 0.85), behavior: 'smooth' });
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
      case 'Digit3':
      case 'Numpad3':
        if (phase !== 'title' && threatsOn(cur)) actions.setTool('trap');
        break;
      case 'Digit4':
      case 'Numpad4':
        if (phase !== 'title' && barrierTabShown(cur)) actions.setTool('barrier');
        break;
      case 'Digit5':
      case 'Numpad5':
        if (phase !== 'title' && feedTabShown(cur)) actions.setTool('feed');
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
        else if (cur.ui.tool === 'trap' || cur.ui.tool === 'barrier' || cur.ui.tool === 'feed') actions.setTool('grow'); // the ring, barrier and feeding tools let go first, a second Esc pauses
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
      objTxt = objRows.map((row) => row.querySelector('.txt'));
      objTxtShown = list.map(() => null);
      objDone = list.map(() => null);
    }
    // the line with its progress («Подрастить деревья · 12/25 %»)
    const lines = list.map((o) => objectiveText(state, o));
    for (let i = 0; i < list.length; i++) {
      if (objTxtShown[i] !== lines[i]) {
        objTxtShown[i] = lines[i];
        objTxt[i].textContent = lines[i];
      }
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
    // the compact line: «2 / 5» and the open observation that is furthest along (obj-fold.js)
    const doneCount = list.filter((o) => o.done).length;
    setText(el.objTitle, shown, 'obj.title', objectivesTitle(state));
    setText(el.objCount, shown, 'obj.count', `${doneCount} / ${list.length}`);
    setText(el.objCur, shown, 'obj.cur', foldedLine(state, list));
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
      objQuiet = Math.max(0, objQuiet - dt);
      if (objHides) objReveal = Math.min(objReveal, OBJ_REVEAL_STUMP); // the stump at the glade's edge is not covered for long
      else if (objBehind) objReveal = Math.min(objReveal, OBJ_REVEAL_BEHIND); // nor a crown or a mushroom
      if (state.events.some((ev) => ev.type === 'rival-wake')) {
        objQuiet = OBJ_QUIET_WAKE;
        objReveal = 0;
      }
    }
    const p = state.ui.pointer;
    if (playing && p && p.inside !== false && !state.ui.drag && p.sy < 360) { // the card lives in the top-right corner
      const r = el.objCard.getBoundingClientRect();
      if (p.sx >= r.left - 6 && p.sx <= r.right + 6 && p.sy >= r.top - 6 && p.sy <= r.bottom + 6) objHold = OBJ_HOLD;
    }
    const open = playing && ((objReveal > 0 && objQuiet <= 0) || objHold > 0);
    if (shown.objOpen !== open) {
      shown.objOpen = open;
      el.objCard.classList.toggle('open', open);
    }
  }

  /**
   * The two cards must not hide the game, and must stay readable: a card is never more than a hair see-through (while
   * something lies under it or the pointer is on it). What the resources card hides, it frees by folding to its header and
   * sugar row (and opens at once under the pointer); the objectives card is a header line unless open for a moment.
   */
  function updateCards(state, dt, view) {
    const live = (state.phase === 'playing' || state.phase === 'paused') && view && view.scale > 0;
    cardT -= dt;
    cardAcc += dt;
    if (cardT > 0 && live) return;
    const step = cardAcc;
    cardT = 0.12;
    cardAcc = 0;
    if (live) updateNotesSpot(state, view);
    const p = state.ui.pointer;
    const pointer = Boolean(live && p && p.inside !== false);
    const fs = parseFloat(getComputedStyle(root).fontSize) || 16;
    for (const [key, card] of [['res', el.resCard], ['obj', el.objCard]]) {
      let mode = 'solid';
      if (live) {
        const b = card.getBoundingClientRect();
        let rect = { l: b.left, t: b.top, r: b.right, b: b.bottom };
        const onCard = pointer && pointerIn(p, rect, 4);
        if (key === 'res') {
          if (fs !== resFoldFs) {
            resFoldFs = fs;
            resFold = { folded: false, t: 0 };
          } else if (!resFold.folded) resFullH = b.height;
          // what the card hides is judged on its open rect and on the folded one, so a folded card does not flip back at once
          const foldB = el.resRows.sugar.row.getBoundingClientRect().bottom + 0.6 * fs;
          const full = resFold.folded ? { ...rect, b: rect.t + resFullH } : rect;
          const folded = { ...rect, b: Math.min(full.b, foldB) };
          resFold = foldStep(resFold, wantFold(coverage(state, view, full), coverage(state, view, folded)), onCard, step);
          rect = resFold.folded ? folded : full;
          mode = cardMode(coverage(state, view, rect), onCard);
        } else {
          mode = cardMode(coverage(state, view, rect), onCard);
          const open = openCardRect(rect, fs, smallWindow());
          objHides = stumpsUnder(state, view, open) > 0;
          const under = coverage(state, view, open);
          objBehind = under.crowns + under.mushrooms > 0;
        }
      } else if (key === 'obj') {
        objHides = false;
        objBehind = false;
      } else resFold = { folded: false, t: 0 };
      if (key === 'res' && shown.resFolded !== resFold.folded) {
        shown.resFolded = resFold.folded;
        card.classList.toggle('folded', resFold.folded);
      }
      if (shown[`card.${key}`] !== mode) {
        const prev = shown[`card.${key}`];
        shown[`card.${key}`] = mode;
        if (prev) card.classList.remove(`m-${prev}`);
        if (mode !== 'solid') card.classList.add(`m-${mode}`);
      }
    }
  }

  /**
   * The margin notes stack at the top centre; while none is on screen the stack picks the spot between the cards where it
   * covers the fewest tree crowns and mushrooms (a stack on screen stays put). The spot is the CSS variable --notes-dx.
   */
  function updateNotesSpot(state, view) {
    if (el.notes.children.length) return;
    const fs = parseFloat(getComputedStyle(root).fontSize) || 16;
    const z = el.notesZone.getBoundingClientRect();
    const dx0 = parseFloat(root.style.getPropertyValue('--notes-dx')) || 0;
    const res = el.resCard.getBoundingClientRect();
    const obj = el.objCard.getBoundingClientRect();
    const trees = (state.world && state.world.trees) || [];
    const things = [];
    for (const t of trees) things.push({ ...crownRect(t, view), w: 2 });
    for (const m of state.mushrooms || []) things.push({ ...mushroomRect(m, view, trees, state.world), w: 3 });
    const box = { cx: z.left + z.width / 2 - dx0, w: z.width, t: z.top, h: (smallWindow() ? 6.5 : 9.5) * fs };
    const dx = notesShift(box, { l: res.right + 8, r: obj.right - 21.5 * fs - 8 }, things);
    if (dx !== dx0) root.style.setProperty('--notes-dx', `${dx}px`);
  }

  /** Sugar sits at its cap: say what to do with it (a short, rate-limited note and the «Гриб» tab lit up for a while). */
  function updateNudge(state, dt) {
    const r = nudge.update(state, dt);
    if (r.fire) {
      const text =
        state.ui.tool === 'fruit'
          ? 'Сахар на пределе: щёлкни по узлу у земли, и вырастет гриб'
          : 'Сахар на пределе: нажми 2 и вырасти гриб у самой земли';
      notes.say({ key: 'nudge:fruit', text, tone: 'good', icon: 'mushroom', life: 9 });
    }
    const lit = r.active && state.ui.tool !== 'fruit';
    if (shown.nudge !== lit) {
      shown.nudge = lit;
      const tab = el.tools.find((t) => t.dataset.tool === 'fruit');
      if (tab) tab.classList.toggle('nudge', lit);
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

  /** The ring tab and the «3» of the title page exist only while the soil threats are on. */
  function updateThreatTab(state) {
    const on = threatsOn(state);
    if (shown.threats === on) return;
    shown.threats = on;
    el.trapTab.hidden = !on;
    el.kbd3.hidden = !on;
    el.trapTab.title = trapTabTitle(trapCost(balance.B));
  }

  /** The barrier tab and key 4 exist once the honey fungus is awake; its title carries the price now (it can grow with the barriers standing). */
  function updateBarrierTab(state) {
    const on = barrierTabShown(state);
    if (shown.barrier !== on) {
      shown.barrier = on;
      el.barrierTab.hidden = !on;
    }
    if (!on) return;
    const title = barrierTabTitle(barrierCostOf(state));
    if (shown.barrierTitle !== title) {
      shown.barrierTitle = title;
      el.barrierTab.title = title;
    }
  }

  /** The feeding tab and key 5 exist once a tree is linked; the title says which tree is fed. With no tree left to feed the tool lets go. */
  function updateFeedTab(state) {
    const on = feedTabShown(state);
    if (shown.feed !== on) {
      shown.feed = on;
      el.feedTab.hidden = !on;
    }
    if (!on) {
      if (state.ui.tool === 'feed') actions.setTool('grow');
      return;
    }
    const title = feedTabTitle(state);
    if (shown.feedTitle !== title) {
      shown.feedTitle = title;
      el.feedTab.title = title;
    }
  }

  /** The warning slip of the stakes (no ally for a while, the last tree rotting): bottom centre above the tools, quiet otherwise. */
  function updateSlip(state) {
    const slip = phaseShowsSlip(state) ? stakesSlip(state) : null;
    const text = slip ? `${slip.text}|${slip.hint}` : '';
    if (shown.slip === text) return;
    shown.slip = text;
    el.slip.hidden = !slip;
    el.slips.classList.toggle('lifted', Boolean(slip)); // a mark's slip stands above the warning, never under it
    el.slipMain.textContent = slip ? slip.text : '';
    el.slipHint.textContent = slip ? slip.hint : '';
    el.slip.dataset.tone = slip ? slip.tone : '';
  }
  const phaseShowsSlip = (state) => state.phase === 'playing' && !yearOpen && !summaryOpen && !helpOpen && !atlasOpen;

  /** Counts the trees freed from the honey fungus for the summary and year pages. */
  function updateRival(state) {
    if (!rivalOn(state) || state.phase === 'title') return;
    for (const ev of state.events) if (ev.type === 'tree-freed') freedTrees += 1;
  }

  /** One-time pointer to the nematodes at the first worm ever, and the counters of the summary page. */
  function updateThreats(state) {
    if (!threatsOn(state) || state.phase === 'title') return;
    for (const ev of state.events) {
      if (ev.type === 'worm-caught') caught += 1;
      else if (ev.type === 'severed') lostNodes += Number.isFinite(ev.nodes) ? ev.nodes : Number.isFinite(ev.lost) ? ev.lost : 0;
      else if (ev.type === 'worm-sense' && state.ui.tool !== 'trap' && senseGate.take(state.time)) {
        notes.say({ key: 'threat:sense', text: WORM_SENSE_NOTE, tone: 'warn', icon: 'worm', life: 9 });
      } else if (ev.type === 'worm-spawn' && !wormNoteSeen()) {
        markWormNote();
        notes.say({ key: 'threat:first-worm', text: FIRST_WORM_NOTE, tone: 'warn', icon: 'worm', life: 13 });
      }
    }
  }

  function updateControls(state) {
    updateThreatTab(state);
    updateBarrierTab(state);
    updateFeedTab(state);
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
      const pauseOpen = phase === 'paused' && !summaryOpen && !helpOpen && !atlasOpen && !yearOpen;
      setScreen(el.pauseScreen, pauseOpen);
      if (!pauseOpen && !el.newConfirm.hidden) setNewAsk(false); // a closed pause page never keeps the question armed

      if (phase === 'title') {
        // with a save the first line is the saved glade («Продолжить»), the second the new one («Новая поляна» starts it)
        setGladeLine(el.gladeTitle, shown, 'glade.title', savedParts || gladeParts(state));
        setGladeLine(el.gladeFresh, shown, 'glade.fresh', savedParts ? gladeParts(state, 'Новая поляна') : null);
      }
      updateResources(state, dt);
      updateObjectives(state);
      updateObjCard(state, dt);
      updateControls(state);
      updateSeasons(state);
      updateCards(state, dt, view);

      // events -> floating labels at their place (local) and margin notes (global), summary trigger
      // (notes first: the labels then see the stack they must keep out of)
      notes.process(state, Boolean(view && view.scale > 0));
      labels.process(state, view, tipDenial());
      updateFinds(state);
      updateThreats(state);
      updateRival(state);
      marks.update(state, dt);
      if (phase === 'playing') updateNudge(state, dt);
      notes.tick(dt);
      slips.tick(dt);
      labels.tick(dt);
      guide.update(state, dt, view, phase === 'playing' && !summaryOpen && !helpOpen && !atlasOpen && !yearOpen);
      // a page of observations is full: the summary opens. With chapters the sim turns to the next page afterwards.
      let chapterEv = null;
      let pageDone = false;
      for (const ev of state.events) {
        if (ev.type === 'chapter') chapterEv = ev;
        else if (ev.type === 'all-objectives') pageDone = true;
      }
      const flagDone = Boolean(state.flags && state.flags.allObjectivesDone);
      if (!flagDone) muteDoneFlag = false;
      const chapterNow = chapterOf(state);
      if (!chapterEv && threatsOn(state) && chapterNow > prevChapter) chapterEv = { type: 'chapter', chapter: chapterNow };
      if (phase !== 'title') {
        if (!summaryShown && (pageDone || (flagDone && !muteDoneFlag))) {
          openSummary(state, chapterEv ? Math.max(1, chapterEv.chapter - 1) : prevChapter);
        }
        if (chapterEv) {
          // the next page: its own all-objectives opens the summary again
          summaryShown = false;
          muteDoneFlag = flagDone;
          objReveal = OBJ_REVEAL_START;
        }
      }
      prevChapter = chapterNow;
      // the end of the first (and every later) year: its page waits for the summary page if that is open
      for (const ev of state.events) if (ev.type === 'year-end') pendingYear = ev.year;
      if (pageClosed(state) && !closedOpen && phase !== 'title' && !summaryOpen && !helpOpen && !atlasOpen) {
        if (yearOpen) dismissYear();
        openClosed(state);
      }
      updateSlip(state);
      if (pendingYear !== null && phase !== 'title' && !summaryOpen && !helpOpen && !atlasOpen && !yearOpen) {
        openYear(state, pendingYear);
        pendingYear = null;
      }

      // the pointer tooltip keeps clear of the guide's note; when it cannot, the note steps out of its way
      const box = guide.noteBox();
      const tipSpot = tooltip.update(state, resourceHover(state), box ? [box] : [], cardRects);
      guide.tipOver(Boolean(tipSpot && tipSpot.covers));
    },
  };
}

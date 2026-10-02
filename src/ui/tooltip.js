// Pointer tooltip: what is under the cursor, the cost of the hypha being dragged, and (in fruit mode)
// whether a mushroom can grow here and why not. Sim helpers are read-only and reached through namespaces,
// so a renamed export degrades the text instead of breaking the page.
import * as sim from '../sim/index.js';
import * as mushrooms from '../sim/mushrooms.js';
import * as balance from '../sim/balance.js';
import { describeTrapPick, fruitCostOf, threatsOn, trapCost } from './threats.js';
import { describeTree } from './trees-logic.js';
import { barrierCostOf, barrierTabShown, describeBarrierPick } from './rival.js';
import { describeFeedPick } from './feed.js';
import * as rivalUi from './rival.js'; // describeStump is reached through the namespace: a build without it only loses the stump's text
import { placeTip } from './tip-logic.js';
import { horizonLabel } from '../world/biomes.js';

const MINERAL_NAMES = { phosphorus: 'Фосфор', nitrogen: 'Азот' };

const find = (list, id) => (list ? list.find((item) => item.id === id) : undefined);
const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v || 0)) * 100)} %`;
const num = (v) => String(Math.round(v));
const fmt = (v) => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : String(Math.round(v))).replace('.', ',');

/** Price in sugar; "сахара" is correct (genitive) after any number. */
const sugar = (v) => `${Math.max(1, Math.ceil(v - 1e-6))} сахара`;

/** The tooltip lines of a world target (query.js targetAt), or null when it has none. */
export function describeTarget(state, t) {
  const world = state.world;
  switch (t.kind) {
    case 'water': {
      const w = find(world.water, t.id);
      return w ? { main: `Карман воды · ${num(w.amount)}/${num(w.max)}` } : { main: 'Карман воды' };
    }
    case 'mineral': {
      const m = find(world.minerals, t.id);
      if (!m) return { main: 'Залежь минералов' };
      return { main: `${MINERAL_NAMES[m.kind] || 'Минералы'} · ${num(m.amount)}/${num(m.max)}` };
    }
    case 'tree': {
      const tree = find(world.trees, t.id);
      if (!tree) return { main: 'Дерево' };
      return describeTree(tree, state);
    }
    case 'stump':
      // stumps are drawn only while the rival is in the state (render/rival-logic stumpsOf): an undrawn one says nothing
      if (!state.rival) return null;
      return typeof rivalUi.describeStump === 'function' ? rivalUi.describeStump(state, t) : null;
    case 'rock':
      return { main: 'Камень — нить не пройдёт' };
    case 'mushroom': {
      const m = find(state.mushrooms, t.id);
      if (!m) return { main: 'Гриб' };
      return { main: m.mature ? 'Гриб · зрелый' : `Гриб · растёт ${pct(m.growth)}` };
    }
    case 'horizon': {
      const hz = world.horizons;
      const h = find(hz, t.id) || (typeof t.id === 'number' ? hz[t.id] : undefined);
      if (!h) return null;
      return { main: horizonLabel(state.world, h), sub: `рост нити: ${fmt(h.cost)} сахара за единицу` };
    }
    default:
      return null;
  }
}

function describePreview(state, p) {
  if (!p || !p.points || p.points.length < 2) return null;
  const have = Math.floor(state.res.sugar);
  if (p.blocked) {
    return { main: 'Путь упирается в камень', sub: p.cost > 0 ? `до преграды: ${sugar(p.cost)}` : '', warn: true };
  }
  if (!p.affordable) {
    return { main: 'Не хватает сахара', sub: `нужно ${Math.ceil(p.cost)}, есть ${have}`, warn: true };
  }
  return { main: sugar(p.cost), sub: `длина нити ≈ ${num(p.length)}` };
}

const FRUIT_CLICK_RADIUS = 44; // same reach as input/pointer.js uses for a fruiting click

/** Can a mushroom grow on the node under the pointer? null when no node is within reach. */
function describeFruit(state) {
  const ui = state.ui;
  const p = ui.pointer;
  if (!p) return null;
  let id = ui.hoverNode;
  if ((id === null || id === undefined) && typeof sim.pickFruitNode === 'function') {
    const c = sim.pickFruitNode(state, p.x, p.y, FRUIT_CLICK_RADIUS);
    const n = c === null || c === undefined ? null : state.net.nodes[c];
    if (n && Math.hypot(n.x - p.x, n.y - p.y) <= FRUIT_CLICK_RADIUS && sim.canFruit(state, c)) id = c;
  }
  if (id === null || id === undefined) return null;
  const B = balance.B || {};
  const cost = fruitCostOf(state);
  const reason =
    typeof mushrooms.fruitDenial === 'function'
      ? mushrooms.fruitDenial(state, id)
      : sim.canFruit(state, id)
        ? null
        : 'unknown';
  switch (reason) {
    case null:
      return { main: 'Здесь вырастет гриб', sub: `щёлкни: цена ${cost} сахара` };
    case 'deep':
      return { main: 'Слишком глубоко для гриба', sub: `он растёт не глубже ${Math.round(B.fruitMaxDepth ?? 45)} ед. от земли`, warn: true };
    case 'crowded':
      return { main: 'Тесно: рядом уже гриб', sub: `между грибами не меньше ${Math.round(B.fruitSpacing ?? 60)} ед.`, warn: true };
    case 'sugar':
      return { main: 'Не хватает сахара на гриб', sub: `нужно ${cost}, есть ${Math.floor(state.res.sugar)}`, warn: true };
    default:
      return { main: 'Здесь гриб не вырастет', sub: '', warn: true };
  }
}

export function createTooltip(host) {
  host.innerHTML = '<div class="t-main"></div><div class="t-sub"></div><div class="t-sub t-risk"></div><div class="t-sub t-feed"></div><div class="t-body"></div>';
  const mainEl = host.querySelector('.t-main');
  const subEl = host.querySelector('.t-sub');
  const riskEl = host.querySelector('.t-risk');
  const feedEl = host.querySelector('.t-feed');
  const bodyEl = host.querySelector('.t-body');
  let shown = false;
  let key = '';
  let w = 0;
  let h = 0;
  let lastTransform = '';

  function hide() {
    if (!shown) return;
    shown = false;
    host.classList.remove('show');
  }

  return {
    reset() {
      hide();
      key = '';
    },
    /**
     * `extra`: a tooltip { main, sub, body: string[], warn, at?: {x, y} } for what the HUD itself is hovered over (a resources row).
     * `avoid`: screen rects it keeps clear of when it can (the guide's note). Returns { l, t, r, b, covers } (screen px)
     * for the tooltip on screen, null when none; `covers` is true when it had to sit on an avoided rect.
     * `keepOut`: the HUD cards (an array of screen rects or a function that returns them): a pointer tooltip never sits
     * over them (a resources-row tooltip beside its own row does).
     */
    update(state, extra = null, avoid = [], keepOut = []) {
      const ui = state.ui;
      const p = ui.pointer;
      const live = state.phase === 'playing' || state.phase === 'paused';
      let info = null;
      if (live && p && p.inside !== false) {
        if (ui.drag) info = describePreview(state, ui.preview);
        else if (extra) info = extra;
        else {
          if (ui.tool === 'fruit') info = describeFruit(state);
          else if (ui.tool === 'trap' && threatsOn(state)) info = describeTrapPick(ui.trapPick, trapCost(balance.B), state.res.sugar);
          else if (ui.tool === 'barrier' && barrierTabShown(state)) info = describeBarrierPick(ui.barrierPick, barrierCostOf(state), state.res.sugar);
          else if (ui.tool === 'feed') info = describeFeedPick(state, ui.hoverTarget, describeTree);
          if (!info && ui.hoverTarget) info = describeTarget(state, ui.hoverTarget);
        }
      }
      if (!info) {
        hide();
        return null;
      }
      const body = info.body || null;
      const k = `${info.main}|${info.sub || ''}|${info.sub2 || ''}|${info.feed || ''}|${info.warn ? 1 : 0}|${body ? body.join('/') : ''}`;
      if (k !== key) {
        key = k;
        mainEl.textContent = info.main;
        subEl.textContent = info.sub || '';
        riskEl.textContent = info.sub2 || '';
        feedEl.textContent = info.feed || '';
        bodyEl.replaceChildren(
          ...(body || []).map((line) => {
            const p = document.createElement('p');
            p.textContent = line;
            return p;
          }),
        );
        host.classList.toggle('long', Boolean(body));
        host.classList.toggle('warn', Boolean(info.warn));
        w = host.offsetWidth;
        h = host.offsetHeight;
      }
      if (!shown) {
        shown = true;
        host.classList.add('show');
        w = host.offsetWidth;
        h = host.offsetHeight;
      }
      // a tooltip with an anchor (a resources row) sits beside it; the others follow the pointer
      const at = info.at;
      const cards = at ? [] : typeof keepOut === 'function' ? keepOut() : keepOut;
      const spot = placeTip(at || { x: p.sx, y: p.sy }, { w, h }, { vw: window.innerWidth, vh: window.innerHeight }, avoid, Boolean(at), cards);
      const transform = `translate(${spot.x.toFixed(0)}px, ${spot.y.toFixed(0)}px) rotate(-0.6deg)`;
      if (transform !== lastTransform) {
        lastTransform = transform;
        host.style.transform = transform;
      }
      return { ...spot.rect, covers: spot.covers };
    },
  };
}

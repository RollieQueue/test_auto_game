// Short ink labels that float up from the place where a local event happened (a link, a refusal, a ripe
// mushroom). Global news (objectives, tree stages) stays in the note stack at the top (notes.js).
import { icons } from './icons.js';
import { findNames } from './atlas-logic.js';
import { THREAT_LOCAL, cutCause, threatLabel } from './threats.js';
import { LABEL_LIFE, placeLabelY, sugarDenialSpots, nearAny, findRepeat, denialFamily } from './labels-logic.js';
import { RIVAL_EVENTS, RIVAL_LOCAL, createRivalTexts } from './rival.js';

const LIFE = LABEL_LIFE; // s
const MAX_LABELS = 12;
const ONE_CLICK = 0.1; // s: a repeat this soon after the label belongs to the same action and is not counted
const BITE_GAP = 2.6; // s between two «укус» labels: a worm chews for a while, the label should not nag
const MINERAL_WORDS = { phosphorus: 'фосфор', nitrogen: 'азот' };

const find = (list, id) => (list ? list.find((item) => item.id === id) : undefined);

/** The label of a hypha that grew only as far as the sugar allowed (event insufficient { partial: true, got, want }). */
export const PARTIAL_TEXT = 'Сахара хватило на часть пути';

/** Events a label is made for (notes.js skips the same ones when labels are available). */
export const LOCAL_EVENTS = new Set(['link', 'insufficient', 'fruit-denied', 'deposit-empty', 'mushroom-mature', 'find', ...THREAT_LOCAL, ...RIVAL_LOCAL]);

/** Maps an event to { key, text, tone, icon } or null. `sugarDenied` is true when this frame has a fruit-denied for sugar; `cause`: see cutCause. */
export function describeLabel(state, ev, sugarDenied, cause = 'worm') {
  const world = state.world;
  switch (ev.type) {
    case 'link':
      if (ev.kind === 'water') return { key: 'link:water', text: 'влага!', tone: 'water', icon: 'water' };
      if (ev.kind === 'mineral') {
        const m = find(world && world.minerals, ev.targetId);
        const word = (m && MINERAL_WORDS[m.kind]) || 'минералы';
        return { key: 'link:mineral', text: `${word}!`, tone: m && m.kind === 'nitrogen' ? 'nitro' : 'mineral', icon: 'minerals' };
      }
      if (ev.kind === 'tree') {
        const t = find(world && world.trees, ev.targetId);
        return { key: 'link:tree', text: t ? `союз: ${t.name.toLowerCase()}` : 'союз заключён', tone: 'good', icon: 'thread' };
      }
      return null;
    case 'insufficient':
      if (sugarDenied) return null; // the fruit-denied label says it already
      if (ev.partial) return { key: 'insufficient:partial', text: PARTIAL_TEXT, tone: 'warn', icon: 'sugar' };
      return { key: 'insufficient', text: 'не хватает сахара', tone: 'warn', icon: 'sugar' };
    case 'fruit-denied': {
      const text =
        ev.reason === 'deep'
          ? 'глубоко: гриб тянется к свету'
          : ev.reason === 'crowded'
            ? 'тесно: рядом уже гриб'
            : ev.reason === 'sugar'
              ? 'на гриб не хватает сахара'
              : 'здесь гриб не вырастет';
      return { key: `denied:${ev.reason}`, text, tone: 'warn', icon: ev.reason === 'sugar' ? 'sugar' : 'mushroom' };
    }
    case 'deposit-empty':
      return {
        key: `empty:${ev.kind}`,
        text: ev.kind === 'water' ? 'карман иссяк' : 'залежь пуста',
        tone: 'warn',
        icon: ev.kind === 'water' ? 'water' : 'minerals',
      };
    case 'find': {
      const f = findNames(ev.kind);
      return f ? { key: `find:${ev.kind}`, text: `Находка: ${f.lower}`, tone: 'find', icon: 'find' } : null;
    }
    case 'mushroom-mature':
      return { key: 'mature', text: 'созрел!', tone: 'good', icon: 'spores' };
    default:
      return threatLabel(ev, cause);
  }
}

export function createLabels(host, avoid = () => []) {
  /** @type {{el: HTMLElement, cnt: HTMLElement, key: string, sx: number, sy: number, age: number, count: number}[]} */
  let labels = [];
  let clock = 0; // s of real time, for throttling
  let lastBite = -Infinity;
  const rival = createRivalTexts(); // the honey-fungus labels, rate-limited

  function remove(l) {
    l.el.remove();
    labels = labels.filter((x) => x !== l);
  }

  function restart(el) {
    el.classList.remove('go');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('go');
  }

  function spawn(d, sx, sy, view) {
    // a repeat of the same label near the same place, or a second refusal of one action, only counts up
    const same = findRepeat(labels, d.key, sx, sy);
    if (same) {
      // (reports of one click from several layers, in the same frame, are one refusal: they do not count up)
      if (same.age > ONE_CLICK) {
        same.count += 1;
        same.cnt.textContent = `×${same.count}`;
      }
      same.age = 0;
      restart(same.el);
      return;
    }
    const el = document.createElement('div');
    el.className = `lab ${d.tone || ''}`;
    el.innerHTML = `${icons[d.icon] || ''}<span class="txt"></span><span class="cnt"></span>`;
    el.querySelector('.txt').textContent = d.text;
    host.appendChild(el);

    // keep the label inside the viewport, apart from the labels already there and out of the column of notes
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.min(view.cssW - w / 2 - 8, Math.max(w / 2 + 8, sx));
    // (an older label has floated up by now: placeLabelY compares against where it really is)
    const y = placeLabelY({ x, y: Math.max(h + 8, sy), w, h }, labels, avoid(), { w: view.cssW, h: view.cssH });
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.setProperty('--tilt', `${(((sx * 7 + sy * 13) % 5) - 2) * 0.6}deg`);
    el.classList.add('go');

    const l = { el, cnt: el.querySelector('.cnt'), key: d.key, sx, sy, x, y, w, h, age: 0, count: 1 };
    labels.push(l);
    while (labels.length > MAX_LABELS) remove(labels[0]);
  }

  return {
    reset() {
      host.textContent = '';
      labels = [];
      clock = 0;
      lastBite = -Infinity;
      rival.reset();
    },
    /**
     * Reads this frame's events; returns true when `view` was usable (so the note stack can skip them).
     * `tipFamily`: the refusal the cursor tooltip already says (tooltipDenialFamily): no label repeats it.
     */
    process(state, view, tipFamily = null) {
      if (!view || !(view.scale > 0)) return false;
      const events = state.events;
      // a refusal for sugar (a mushroom, a ring, a barrier) says so with its own text; the plain «не хватает сахара» of the same click stays out
      const denials = sugarDenialSpots(events);
      const cause = cutCause(events);
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (!LOCAL_EVENTS.has(ev.type) || typeof ev.x !== 'number') continue;
        if (ev.type === 'bite') {
          if (clock - lastBite < BITE_GAP) continue;
          lastBite = clock;
        }
        const sugarDenied = ev.type === 'insufficient' && !ev.partial && nearAny(denials, ev);
        const d = RIVAL_EVENTS.has(ev.type) ? rival.label(state, ev) : describeLabel(state, ev, sugarDenied, cause);
        if (d && tipFamily && denialFamily(d.key) === tipFamily) continue;
        if (d) spawn(d, ev.x * view.scale + view.ox, ev.y * view.scale + view.oy - 8, view);
      }
      return true;
    },
    tick(dt) {
      clock += dt;
      for (const l of labels.slice()) {
        l.age += dt;
        if (l.age >= LIFE) remove(l);
      }
    },
  };
}

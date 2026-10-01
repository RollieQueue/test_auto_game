// Short ink labels that float up from the place where a local event happened (a link, a refusal, a ripe
// mushroom). Global news (objectives, tree stages) stays in the note stack at the top (notes.js).
import { icons } from './icons.js';

const LIFE = 2.7; // s
const MAX_LABELS = 12;
const MERGE_RADIUS = 70; // CSS px: a repeat this close restarts the label instead of adding another
const MINERAL_WORDS = { phosphorus: 'фосфор', nitrogen: 'азот' };

const find = (list, id) => (list ? list.find((item) => item.id === id) : undefined);

/** Events a label is made for (notes.js skips the same ones when labels are available). */
export const LOCAL_EVENTS = new Set(['link', 'insufficient', 'fruit-denied', 'deposit-empty', 'mushroom-mature']);

/** Maps an event to { key, text, tone, icon } or null. `sugarDenied` is true when this frame has a fruit-denied for sugar. */
function describe(state, ev, sugarDenied) {
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
    case 'mushroom-mature':
      return { key: 'mature', text: 'созрел!', tone: 'good', icon: 'spores' };
    default:
      return null;
  }
}

export function createLabels(host) {
  /** @type {{el: HTMLElement, cnt: HTMLElement, key: string, sx: number, sy: number, age: number, count: number}[]} */
  let labels = [];

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
    // a repeat of the same label near the same place only counts up
    for (const l of labels) {
      if (l.key === d.key && Math.hypot(l.sx - sx, l.sy - sy) < MERGE_RADIUS) {
        l.count += 1;
        l.age = 0;
        l.cnt.textContent = `×${l.count}`;
        restart(l.el);
        return;
      }
    }
    const el = document.createElement('div');
    el.className = `lab ${d.tone || ''}`;
    el.innerHTML = `${icons[d.icon] || ''}<span class="txt"></span><span class="cnt"></span>`;
    el.querySelector('.txt').textContent = d.text;
    host.appendChild(el);

    // keep the label inside the viewport and apart from the labels already there
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.min(view.cssW - w / 2 - 8, Math.max(w / 2 + 8, sx));
    let y = Math.max(h + 8, sy);
    for (let guard = 0; guard < 6; guard++) {
      // an older label has floated up by now: compare against where it really is
      const clash = labels.some(
        (l) => Math.abs(l.x - x) < (l.w + w) / 2 + 4 && Math.abs(l.y - (l.age / LIFE) * 1.1 * l.h - y) < h + 2,
      );
      if (!clash) break;
      y -= h + 3;
    }
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(Math.max(h + 4, y))}px`;
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
    },
    /** Reads this frame's events; returns true when `view` was usable (so the note stack can skip them). */
    process(state, view) {
      if (!view || !(view.scale > 0)) return false;
      const events = state.events;
      let sugarDenied = false;
      for (let i = 0; i < events.length; i++) {
        if (events[i].type === 'fruit-denied' && events[i].reason === 'sugar') sugarDenied = true;
      }
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (!LOCAL_EVENTS.has(ev.type) || typeof ev.x !== 'number') continue;
        const d = describe(state, ev, sugarDenied);
        if (d) spawn(d, ev.x * view.scale + view.ox, ev.y * view.scale + view.oy - 8, view);
      }
      return true;
    },
    tick(dt) {
      for (const l of labels.slice()) {
        l.age += dt;
        if (l.age >= LIFE) remove(l);
      }
    },
  };
}

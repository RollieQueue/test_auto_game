// Handwritten margin notes for global game events (objectives, tree stages, ...): short, fading, coalescing repeats.
// Local events (links, refusals, ...) are normally drawn by labels.js at their place on the map.
// Unknown event types are ignored.
import { icons } from './icons.js';
import { LOCAL_EVENTS } from './labels.js';
import { findNames } from './atlas-logic.js';
import { THREAT_BOTH, threatNote } from './threats.js';
import { STAGE_WORDS, seasonNote, weatherNote } from './season-logic.js';

const MAX_NOTES = 4;
const LIFE = 5.2; // seconds a note stays fully visible after its last repeat
const SEASON_LIFE = 9; // a new season is worth reading twice
const FADE = 1.15; // seconds of fade-out (matches the CSS transition)

const MINERAL_WORDS = { phosphorus: 'фосфор', nitrogen: 'азот' };

const find = (list, id) => (list ? list.find((item) => item.id === id) : undefined);

/** Maps an event to { key, text, tone, icon, life? } or null when the event has no note. `prevWeather`: kind before this frame. */
function describe(state, ev, prevWeather = 'clear') {
  const world = state.world;
  switch (ev.type) {
    case 'link':
      if (ev.kind === 'water') return { key: 'link:water', text: 'Нить нашла воду', icon: 'water' };
      if (ev.kind === 'mineral') {
        const m = find(world && world.minerals, ev.targetId);
        const word = (m && MINERAL_WORDS[m.kind]) || 'минералы';
        return { key: 'link:mineral', text: `Нить дотянулась до залежи: ${word}`, icon: 'minerals' };
      }
      if (ev.kind === 'tree') {
        const t = find(world && world.trees, ev.targetId);
        return {
          key: 'link:tree',
          text: t ? `Союз заключён: ${t.name.toLowerCase()}` : 'Союз с деревом заключён',
          tone: 'good',
          icon: 'thread',
        };
      }
      return null;
    case 'tree-stage': {
      const t = find(world && world.trees, ev.treeId);
      const word = STAGE_WORDS[ev.stage];
      if (!word || ev.stage < 1) return null;
      const name = t ? t.name : 'Дерево';
      return { key: `stage:${ev.treeId}`, text: `${name} теперь — ${word} дерево`, tone: 'good', icon: 'thread' };
    }
    case 'mushroom-planted':
      return { key: 'mush:planted', text: 'Гриб пошёл в рост', icon: 'mushroom' };
    case 'mushroom-mature':
      return { key: 'mush:mature', text: 'Гриб созрел — пошли споры', tone: 'good', icon: 'spores' };
    case 'insufficient':
      return { key: 'insufficient', text: 'Не хватает сахара', tone: 'warn', icon: 'sugar' };
    case 'deposit-empty':
      return {
        key: `empty:${ev.kind}`,
        text: ev.kind === 'water' ? 'Карман воды иссяк' : 'Залежь исчерпана',
        tone: 'warn',
        icon: ev.kind === 'water' ? 'water' : 'minerals',
      };
    case 'fruit-denied': {
      const text =
        ev.reason === 'deep'
          ? 'Слишком глубоко: гриб тянется к свету'
          : ev.reason === 'crowded'
            ? 'Тесно: отойди от другого гриба'
            : ev.reason === 'sugar'
              ? 'Не хватает сахара на гриб'
              : 'Здесь гриб не вырастет';
      return { key: `denied:${ev.reason}`, text, tone: 'warn', icon: 'mushroom' };
    }
    case 'find': {
      // only rare finds (rarity 3+) get a note on the stack; every find gets its label on the map
      const f = findNames(ev.kind);
      return f && f.rarity >= 3 ? { key: `find:${ev.id}`, text: `В атлас записано: ${f.lower}`, tone: 'good', icon: 'find' } : null;
    }
    case 'season': {
      const n = seasonNote(ev.season);
      return n ? { key: n.key, text: n.text, tone: 'good', icon: ev.season, life: SEASON_LIFE } : null;
    }
    case 'weather':
      return weatherNote(ev.kind, prevWeather);
    case 'objective':
      return { key: `obj:${ev.id}`, text: `Отмечено: ${ev.text ? ev.text.charAt(0).toLowerCase() + ev.text.slice(1) : ''}`, tone: 'good', icon: 'check' };
    default:
      return threatNote(ev);
  }
}

const CHECK_ICON =
  '<svg class="ico" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#26304a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.6 L9.4 18 L20.4 4"/></svg>';

export function createNotes(host) {
  /** @type {Map<string, {el: HTMLElement, cnt: HTMLElement, text: string, life: number, span: number, fade: number, count: number}>} */
  const active = new Map();
  let prevWeather = 'clear'; // the weather before the latest 'weather' event (the «кончился» notes name it)

  function remove(key) {
    const n = active.get(key);
    if (!n) return;
    n.el.remove();
    active.delete(key);
  }

  function startFade(n) {
    if (n.fade > 0) return;
    n.fade = FADE;
    n.el.classList.remove('in');
    n.el.classList.add('out');
  }

  function push(d) {
    const found = active.get(d.key);
    if (found && found.fade <= 0) {
      found.count += 1;
      found.life = found.span;
      found.cnt.textContent = found.count > 1 ? `×${found.count}` : '';
      return;
    }
    if (found) remove(d.key);

    const el = document.createElement('div');
    el.className = `note ${d.tone || ''}`;
    const iconHtml = d.icon === 'check' ? CHECK_ICON : icons[d.icon] || '';
    el.innerHTML = `${iconHtml}<span class="txt"></span><span class="cnt"></span>`;
    el.querySelector('.txt').textContent = d.text;
    host.appendChild(el);
    void el.offsetWidth; // let the start state paint so the transition runs
    el.classList.add('in');
    active.set(d.key, {
      el,
      cnt: el.querySelector('.cnt'),
      text: d.text,
      life: d.life ?? LIFE,
      span: d.life ?? LIFE,
      fade: 0,
      count: 1,
    });

    let visible = 0;
    for (const n of active.values()) if (n.fade <= 0) visible++;
    if (visible > MAX_NOTES) {
      for (const n of active.values()) {
        if (n.fade <= 0) {
          startFade(n);
          break;
        }
      }
    }
  }

  return {
    reset(state) {
      host.textContent = '';
      active.clear();
      prevWeather = (state && state.weather && state.weather.kind) || 'clear';
    },
    /** `skipLocal`: events with a place on the map get floating labels instead (labels.js). */
    process(state, skipLocal = false) {
      const events = state.events;
      for (let i = 0; i < events.length; i++) {
        if (skipLocal && LOCAL_EVENTS.has(events[i].type) && events[i].type !== 'find' && !THREAT_BOTH.has(events[i].type)) continue;
        const ev = events[i];
        const d = describe(state, ev, prevWeather);
        if (ev.type === 'weather') prevWeather = ev.kind;
        if (d) push(d);
      }
    },
    /** A note that does not come from an event: `{ key, text, tone?, icon? }`. */
    say(d) {
      push(d);
    },
    tick(dt) {
      for (const [key, n] of active) {
        if (n.fade > 0) {
          n.fade -= dt;
          if (n.fade <= 0) remove(key);
        } else {
          n.life -= dt;
          if (n.life <= 0) startFade(n);
        }
      }
    },
  };
}

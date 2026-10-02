// The slip of an earned mark: a small paper slip that slides in at the bottom of the glade with the mark's icon, name and
// one line, and goes by itself after a few seconds. It lets every click through (hud.css .slips). Queue: slips-logic.js.
import { icons } from './icons.js';
import { createSlipQueue } from './slips-logic.js';

export function createSlips(host) {
  const queue = createSlipQueue();
  /** @type {Map<string, HTMLElement>} */
  const els = new Map();

  function enter(item) {
    const el = document.createElement('div');
    el.className = 'slip';
    el.innerHTML = `<span class="slip-ico"></span><span class="slip-text"><span class="slip-kicker">Пометка на полях</span><b class="slip-title"></b><span class="slip-line"></span></span>`;
    el.querySelector('.slip-ico').innerHTML = icons[item.icon] || icons.mk_fruit || '';
    el.querySelector('.slip-title').textContent = item.title;
    el.querySelector('.slip-line').textContent = item.line;
    host.appendChild(el);
    void el.offsetWidth; // let the start state paint so the slide runs
    el.classList.add('in');
    els.set(item.id, el);
  }

  return {
    /** `item`: slipOf(mark). */
    show(item) {
      queue.push(item);
    },
    tick(dt) {
      const r = queue.tick(dt);
      for (const item of r.enter) enter(item);
      for (const item of r.leave) {
        const el = els.get(item.id);
        if (el) {
          el.classList.remove('in');
          el.classList.add('out');
        }
      }
      for (const item of r.gone) {
        const el = els.get(item.id);
        if (el) el.remove();
        els.delete(item.id);
      }
    },
    reset() {
      queue.reset();
      host.textContent = '';
      els.clear();
    },
  };
}

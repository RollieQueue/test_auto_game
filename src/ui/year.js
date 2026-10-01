// The year-end notebook page (S2): what the glade looks like after the first full cycle of seasons.
// Inner HTML for the .year-page; the buttons are handled by hud.js (data-act year-continue / restart).
import { flourish } from './icons.js';
import { yearStats, yearTitle } from './season-logic.js';

const nf = new Intl.NumberFormat('ru-RU');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** `year` is the 0-based year that has just ended (the `year-end` event's field). */
export function buildYearPage(state, year) {
  const s = yearStats(state);
  const trees = s.trees.map((t) => `<li><span class="k">${esc(t.name)}</span><span class="v">${esc(t.word)}</span></li>`).join('');
  return `
    <div class="stamp-seal">год<br />прошёл</div>
    <div class="overline">Тетрадь натуралиста · итог года</div>
    <h2>${yearTitle(year)}</h2>
    <div class="sub">весна, лето, осень и зима записаны</div>
    ${flourish}
    <div class="year-cols">
      <div>
        <h3 class="year-sub">Грибница</h3>
        <ul class="stats">
          <li><span class="k">Споры</span><span class="v">${nf.format(s.spores)}</span></li>
          <li><span class="k">Длина нитей</span><span class="v">${nf.format(s.length)} ед.</span></li>
          <li><span class="k">Грибы</span><span class="v">${nf.format(s.mushrooms)}</span></li>
          <li><span class="k">Находки</span><span class="v">${nf.format(s.finds)}</span></li>
        </ul>
      </div>
      <div>
        <h3 class="year-sub">Деревья</h3>
        <ul class="stats">${trees}</ul>
      </div>
    </div>
    <div class="actions">
      <button class="ink-btn" data-act="year-continue" type="button">Продолжить наблюдения</button>
      <button class="ink-btn" data-act="restart" type="button">Новая поляна</button>
    </div>`;
}

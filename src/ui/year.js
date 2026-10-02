// The year-end notebook page (S2): what the glade looks like after the first full cycle of seasons, with the grade of the year
// (sim/stakes.js), and the closed page (the same screen) for a lost glade.
// Inner HTML for the .year-page; the buttons are handled by hud.js (data-act year-continue / restart).
import { flourish } from './icons.js';
import { gladeLabel } from './glade.js';
import { yearStats, yearTitle } from './season-logic.js';
import { rivalOn, rivalStats, rivalSummaryLine } from './rival.js';
import { closedStats, gradeLines, yearGrade } from './year-logic.js';

const nf = new Intl.NumberFormat('ru-RU');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The grade of the year: the verdict, why («за: …») and what would raise it. */
function markBlock(m) {
  return `<div class="year-mark g-${m.grade}">
      <div class="year-mark-line"><span class="k">Отметка года</span> <b>${esc(m.title)}</b> — ${esc(m.verdict)}</div>
      <div class="year-mark-why">${esc(m.reason)}</div>
      <div class="year-mark-next">${esc(m.next)}</div>
    </div>`;
}

/** `year` is the 0-based year that has just ended (the `year-end` event's field); `extra.freed`: trees the honey fungus let go of. */
export function buildYearPage(state, year, extra = {}) {
  const s = yearStats(state);
  const rival = rivalOn(state) ? `<li><span class="k">Опёнок</span><span class="v">${esc(rivalSummaryLine(rivalStats(state, extra.freed)))}</span></li>` : '';
  const world = (state.world && state.world.trees) || [];
  // a tree the honey fungus killed stands as a snag (world.trees keeps the order of yearStats().trees)
  const trees = s.trees.map((t, i) => `<li><span class="k">${esc(t.name)}</span><span class="v">${esc(world[i] && world[i].lost ? 'сухостой' : t.word)}</span></li>`).join('');
  const mark = gradeLines(yearGrade(state, year), state);
  return `
    <div class="stamp-seal g-${mark.grade}">${mark.seal}</div>
    <div class="overline">Тетрадь натуралиста · итог года</div>
    <h2>${yearTitle(year)}</h2>
    <div class="sub">весна, лето, осень и зима записаны</div>
    <div class="glade-line">${esc(gladeLabel(state))}</div>
    ${flourish}
    ${markBlock(mark)}
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
        <ul class="stats">${trees}${rival}</ul>
      </div>
    </div>
    <div class="actions">
      <button class="ink-btn" data-act="year-continue" type="button">Продолжить наблюдения</button>
      <button class="ink-btn" data-act="restart" type="button">Новая поляна</button>
    </div>`;
}

/** The page that closes the notebook (sim/stakes.js: every tree lost, or no ally for too long): the cause, the numbers, the grade. */
export function buildClosedPage(state) {
  const c = closedStats(state);
  const trees = `${c.total - c.lost} из ${c.total}`;
  return `
    <div class="stamp-seal g-poor">страница<br />закрыта</div>
    <div class="overline">Тетрадь натуралиста · страница закрыта</div>
    <h2>Страница закрыта</h2>
    <div class="sub">${esc(c.cause)}</div>
    <div class="glade-line">${esc(gladeLabel(state))}</div>
    ${flourish}
    <div class="year-mark g-${c.grade.grade}">
      <div class="year-mark-line"><span class="k">Год не дописан</span> <b>${esc(c.grade.title)}</b> — ${esc(c.grade.verdict)}</div>
      <div class="year-mark-why">${esc(c.grade.reason)}</div>
      <div class="year-mark-next">${esc(c.advice)}</div>
    </div>
    <ul class="stats closed-stats">
      <li><span class="k">Наблюдали</span><span class="v">${esc(c.time)}</span></li>
      <li><span class="k">Деревьев стоит</span><span class="v">${trees}</span></li>
      <li><span class="k">Споры</span><span class="v">${nf.format(c.spores)}</span></li>
      <li><span class="k">Длина нитей</span><span class="v">${nf.format(c.length)} ед.</span></li>
    </ul>
    <div class="actions">
      <button class="ink-btn" data-act="retry" type="button">Попробовать снова</button>
      <button class="ink-btn" data-act="restart" type="button">Новая поляна</button>
    </div>`;
}

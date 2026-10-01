// The help page: rules and controls written as a page of field notes. Numbers come from the game's own
// data (world horizons, balance) so the page cannot drift from the rules; fallbacks match the GDD.
import { icons, flourish } from './icons.js';
import * as balance from '../sim/balance.js';

const FALLBACK_HORIZONS = [
  { name: 'Лесная подстилка', depth: 0, cost: 0.1 },
  { name: 'Гумус', depth: 26, cost: 0.14 },
  { name: 'Суглинок', depth: 170, cost: 0.22 },
  { name: 'Глина', depth: 390, cost: 0.34 },
  { name: 'Галечник', depth: 620, cost: 0.5 },
];

const ru = (v) => String(v).replace('.', ',');
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function horizonRows(world) {
  const hs = world && world.horizons && world.horizons.length ? world.horizons : FALLBACK_HORIZONS;
  return hs
    .map((h, i) => {
      const next = hs[i + 1];
      const range = next ? `${h.depth}–${next.depth}` : `${h.depth}+`;
      return `<li><span class="k">${esc(h.name)}</span><span class="r">${range}</span><span class="v">${ru(h.cost.toFixed(2))}</span></li>`;
    })
    .join('');
}

const KEYS = [
  ['1', '2', 'нить / гриб'],
  ['Пробел', '', 'пауза'],
  ['F', '', 'скорость ×1 / ×2'],
  ['M', '', 'звук'],
  ['A', '', 'атлас находок'],
  ['H', '', 'эта страница'],
  ['Esc', '', 'отмена, пауза'],
];

/** Inner HTML of the help page for the given state (world may be missing). */
export function buildHelp(state) {
  const B = balance.B || {};
  const fruitDepth = Math.round(B.fruitMaxDepth ?? 45);
  const fruitSpacing = Math.round(B.fruitSpacing ?? 60);
  const fruitCost = Math.round(B.mushroomCost ?? 24);
  const fruitSeconds = Math.round(B.mushroomGrowSeconds ?? 20);
  const goal = Math.round(B.sporesGoal ?? 100);
  const speed = Math.round(B.growSpeed ?? 140);
  const keys = KEYS.map(
    ([a, b, text]) => `<li><span class="kk"><kbd>${a}</kbd>${b ? ` <kbd>${b}</kbd>` : ''}</span><span>${text}</span></li>`,
  ).join('');

  return `
    <div class="overline">Тетрадь натуралиста · памятка на полях</div>
    <h2>Как играть</h2>
    ${flourish}
    <div class="help-cols">
      <div class="help-col">
        <section>
          <h3>Что у тебя есть</h3>
          <ul class="help-res">
            <li>${icons.sugar}<span><b>Сахар</b> — плата за рост нитей и грибов. Его приносят деревья-союзники.</span></li>
            <li>${icons.water}<span><b>Влага</b> — из голубых карманов в земле. Без неё деревья чахнут.</span></li>
            <li>${icons.minerals}<span><b>Минералы</b> — оливковый азот у поверхности, фиолетовые кристаллы фосфора глубже.</span></li>
            <li>${icons.spores}<span><b>Споры</b> — твои очки. Их выпускают зрелые грибы.</span></li>
          </ul>
          <p>Вода и минералы копятся в общем <i>запасе сети</i>; он растёт вместе с длиной нитей.</p>
        </section>
        <section>
          <h3>Нить</h3>
          <p>Зажми кнопку мыши на узле сети и веди; отпусти — нить прорастёт по пути, примерно ${speed} ед. в секунду.
          Сахар тратится по мере роста, цену видно у курсора. Правая кнопка или <kbd>Esc</kbd> отменяют.
          Сама сеть тоже понемногу «ест» сахар.</p>
          <p class="cap">Цена роста в сахаре за единицу длины, по горизонтам почвы:</p>
          <ul class="help-hz">${horizonRows(state && state.world)}</ul>
        </section>
      </div>
      <div class="help-col">
        <section>
          <h3>Деревья</h3>
          <p>Дотянись нитью до кончика корня — так заключается союз. Дерево берёт из запаса воду и минералы и платит сахаром:
          чем оно довольнее, тем щедрее. Довольное дерево растёт — росток, молодое, взрослое, вековое — и открывает новые
          корни, но и просит больше.</p>
        </section>
        <section>
          <h3>Камни</h3>
          <p>Серые камни нить не пройдёт: её нужно провести вокруг.</p>
        </section>
        <section>
          <h3>Грибы</h3>
          <p>Нажми <kbd>2</kbd> и щёлкни по узлу у самой земли — не глубже ${fruitDepth} ед. и не ближе ${fruitSpacing} ед. к другому грибу.
          Гриб стоит ${fruitCost} сахара, растёт около ${fruitSeconds} секунд, а потом выпускает споры. Чем сытнее сеть, тем их больше.
          Собери ${goal} спор.</p>
        </section>
        <section>
          <h3>Находки</h3>
          <p>В земле лежат диковинки. Подведи к ним нить, и они попадут в <i>атлас находок</i> (<kbd>A</kbd>) с пометкой
          натуралиста и небольшой наградой. Редкое лежит глубже.</p>
        </section>
        <section>
          <h3>Клавиши</h3>
          <ul class="help-keys">${keys}</ul>
        </section>
      </div>
    </div>
    <div class="actions"><button class="ink-btn" data-act="help-close" type="button">Закрыть <kbd>H</kbd></button></div>`;
}

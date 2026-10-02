// The help page: rules and controls written as a page of field notes. Numbers come from the game's own
// data (world horizons, balance) so the page cannot drift from the rules; fallbacks match the GDD.
import { icons, flourish } from './icons.js';
import * as balance from '../sim/balance.js';
import { SEASONS, SEASON_NAMES_RU, SEASON_RULES } from './season-logic.js';
import { chapterTotal, fruitCostOf, threatsOn, trapCost } from './threats.js';
import { barrierCostOf, rivalNumbers } from './rival.js';
import { speciesHelp } from './species-logic.js';
import { isUnlocked } from '../sim/unlocks.js';
import { pageOrdinal, unlockHelpItems } from './unlocks.js';

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

/** «Времена года»: shown only when the game has seasons on. */
function seasonsSection(state) {
  if (!(state && state.flags && state.flags.seasons)) return '';
  const rows = SEASONS.map((k) => `<li><b>${SEASON_NAMES_RU[k]}</b> — ${SEASON_RULES[k]}.</li>`).join('');
  return `
        <section>
          <h3>Времена года</h3>
          <p>Круг в углу — календарь: стрелка идёт по четырём временам года, а солнце или луна в центре показывают час.
          Рядом написана погода. Через год страница итогов предложит продолжить или начать новую поляну.</p>
          <ul class="help-seasons">${rows}</ul>
        </section>`;
}

/** The list «Что открывает страница»: what each closed page gave (open ones plain, the rest marked). */
function unlockList(state) {
  const rows = unlockHelpItems(state)
    .map((u) => {
      const ord = pageOrdinal(u.page);
      return `<li>За ${ord} страницу: ${u.html}.${u.open ? '' : ' <i>Ещё закрыто.</i>'}</li>`;
    })
    .join('');
  return `<p>Закрытая страница открывает что-то новое:</p>
          <ul class="help-seasons">${rows}</ul>`;
}

/** «Нематоды и кольца» and «Главы»: shown only when the soil threats are on. */
function threatsSection(state) {
  if (!threatsOn(state)) return '';
  const cost = trapCost(balance.B);
  return `
        <section>
          <h3>Нематоды</h3>
          <p>В почве бродят нематоды — тонкие черви. Червь перекусывает тонкую нить, и всё, что отрезано от споры, отмирает:
          узлы, а с ними и грибы на них. Береги тонкие ответвления и держи у них кольца.</p>
          <p>Нажми <kbd>3</kbd> и щёлкни по нити: на ней вырастет <i>ловчее кольцо</i>. Оно стоит ${cost} сахара.
          Червь, подползший к кольцу, застревает, а грибница забирает его минералы. Каждое кольцо ловит ограниченное число
          червей и истощается; <kbd>Esc</kbd> возвращает к нити.</p>
        </section>
        <section>
          <h3>Главы</h3>
          <p>Закончив страницу наблюдений, переверни её: на новой странице наблюдения труднее. Всего в тетради
          ${chapterTotal(state)} главы. Номер главы написан над списком наблюдений.</p>
          ${unlockList(state)}
        </section>`;
}

const rivalFlag = (state) => threatsOn(state) && Boolean(state.flags.rival);

/** «Опёнок»: shown only when the honey-fungus rival is on (its numbers come from balance.js). */
export function rivalSection(state, B = balance.B) {
  if (!rivalFlag(state)) return '';
  const n = rivalNumbers(B);
  const cost = barrierCostOf(state, B);
  return `
        <section>
          <h3>Опёнок</h3>
          <p>Осенний опёнок (<i>Armillaria</i>) пускает из старого пня чёрные блестящие шнуры — ризоморфы. Они гноят корни,
          а у погибшего дерева осенью высыпают медовые опята.</p>
          <p>Дерево защищает микориза: мантия из твоих нитей на кончиках корней. Чем лучше кормишь дерево, тем она крепче:
          до ${n.protect} % заражения. Толстые нити ризоморфы не пробивают.</p>
          <p>Шнур вцепился? Нажми <kbd>4</kbd> и щёлкни по нити рядом: на ${n.radius} ед. вокруг шнуры растворятся.
          Барьер: ${cost} сахара, держится около ${n.seconds} с, не больше ${n.max} сразу. Внутри кольца нити замирают: не растут и не носят соки,
          а дерево, у которого все корни внутри, не платит.</p>
          <p>${raidLine(state)}</p>
        </section>`;
}

/** The raider's line of the help page: it names feeding (key 5) only once the tool is open (page 1 closed). */
function raidLine(state) {
  return isUnlocked(state, 'feed')
    ? 'Иногда ризоморф идёт не к дереву, а по тонким нитям сети. Подкорми дерево (<kbd>5</kbd>) из полной кладовой — путь к нему станет толстым тяжом, и налётчик не пройдёт; барьер перед ним тоже его растворит.'
    : 'Иногда ризоморф идёт не к дереву, а по тонким нитям сети. Толстый тяж он не пройдёт, а барьер перед ним его растворит.';
}

const KEYS = [
  ['1', '2', 'нить / гриб'],
  ['5', '', 'подкормка: щёлкни по дереву, и лишний сахар пойдёт ему'],
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
  const fruitRoomMin = Math.round(B.fruitSpacingMin ?? B.fruitSpacing ?? 60);
  const fruitRoomMax = Math.round(B.fruitSpacingMax ?? B.fruitSpacing ?? 60);
  const fruitCost = fruitCostOf(state);
  const fruitSeconds = Math.round(B.mushroomGrowSeconds ?? 20);
  const goal = Math.round(B.sporesGoal ?? 100);
  const speed = Math.round(B.growSpeed ?? 140);
  const threats = threatsOn(state);
  const feedOpen = !(state && state.flags) || isUnlocked(state, 'feed'); // key 5 is on the page once page 1 is closed
  const keys = KEYS.filter(([a]) => a !== '5' || feedOpen).map(([a, b, text]) => {
    const toolKeys = a === '1' && threats; // «1 2 3 нить / гриб / кольцо», «1 2 3 4 …/ барьер» with the rival
    const four = toolKeys && rivalFlag(state);
    return `<li><span class="kk"><kbd>${a}</kbd>${b ? ` <kbd>${b}</kbd>` : ''}${toolKeys ? ' <kbd>3</kbd>' : ''}${four ? ' <kbd>4</kbd>' : ''}</span><span>${toolKeys ? (four ? 'нить / гриб / кольцо / барьер' : 'нить / гриб / кольцо') : text}</span></li>`;
  }).join('');

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
            <li>${icons.spores}<span><b>Споры</b> — твои очки. Их выпускают зрелые грибы. Предела у них нет.</span></li>
          </ul>
          <p>У сахара, влаги и минералов есть <i>предел</i>, он стоит рядом с числом: «Влага 71 / 90» — в кладовой 71 доля из 90.
          Полоска под числом краснеет, когда кладовая полна: нити перестают добывать, пока деревья не заберут влагу или
          минералы. Чем длиннее сеть, тем кладовые больше. Наведи курсор на строку — прочтёшь пояснение.</p>
        </section>
        <section>
          <h3>Нить</h3>
          <p>Зажми кнопку мыши на узле сети и веди; отпусти — нить прорастёт по пути, примерно ${speed} ед. в секунду.
          Сахар тратится по мере роста, цену видно у курсора. Правая кнопка или <kbd>Esc</kbd> отменяют.
          Сама сеть тоже понемногу «ест» сахар.</p>
          <p class="cap">Цена роста в сахаре за единицу длины, по горизонтам почвы:</p>
          <ul class="help-hz">${horizonRows(state && state.world)}</ul>
        </section>
${threatsSection(state)}
${rivalSection(state)}
      </div>
      <div class="help-col">
        <section>
          <h3>Деревья</h3>
          <p>Дотянись нитью до кончика корня — так заключается союз. Дерево берёт из кладовых воду и минералы и платит сахаром:
          чем оно довольнее, тем щедрее. Довольное дерево растёт — росток, молодое, взрослое, вековое — и открывает новые
          корни, но и просит больше.</p>
          <p>${esc(speciesHelp(state))}</p>
        </section>
        <section>
          <h3>Камни</h3>
          <p>Серые камни нить не пройдёт: её нужно провести вокруг.</p>
        </section>
        <section>
          <h3>Грибы</h3>
          <p>Нажми <kbd>2</kbd> и щёлкни по узлу у самой земли — не глубже ${fruitDepth} ед. и не ближе ${fruitRoomMin}–${fruitRoomMax} ед. к другому грибу: чем крупнее его шляпка, тем больше места он занимает.
          Гриб стоит ${fruitCost} сахара, растёт около ${fruitSeconds} секунд, а потом выпускает споры. Чем сытнее сеть, тем их больше.
          Собери ${goal} спор.</p>
        </section>
        <section>
          <h3>Находки</h3>
          <p>В земле лежат диковинки. Подведи к ним нить, и они попадут в <i>атлас находок</i> (<kbd>A</kbd>) с пометкой
          натуралиста и небольшой наградой. Редкое лежит глубже.</p>
        </section>
${seasonsSection(state)}
        <section>
          <h3>Клавиши</h3>
          <ul class="help-keys">${keys}</ul>
        </section>
      </div>
    </div>
    <div class="actions"><button class="ink-btn" data-act="help-close" type="button">Закрыть <kbd>H</kbd></button></div>
    <div class="help-more" aria-hidden="true"><span>дальше ↓</span></div>`;
}

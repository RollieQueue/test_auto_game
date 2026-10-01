// What each stock on the resources card is, in the naturalist's voice: shown as a tooltip over its row and echoed on
// the help page. Pure data (docs/ARCHITECTURE.md: water and minerals are each capped at cap.pool, sugar at cap.sugar,
// spores are not capped). `what`: what it is and where it comes from, `use`: what it is for, `limit`: what the cap
// means (null: no cap), `full`: the same when the stock is full.

export const RESOURCE_INFO = {
  sugar: {
    name: 'Сахар',
    what: 'Сладкий сок, который деревья отдают грибнице: плата за воду и минералы. Понемногу его даёт и сама прелая подстилка.',
    use: 'На него растут нити и грибы; им же сеть кормит сама себя.',
    limit: 'Предел — вместимость сети. Она растёт с длиной нитей и с возрастом деревьев-союзников.',
    full: 'Кладовая полна: лишний сахар пропадает. Самое время тянуть нити и растить грибы.',
  },
  water: {
    name: 'Влага',
    what: 'Вода из голубых карманов в земле. Нити, дошедшие до кармана, тянут её в общую кладовую.',
    use: 'Деревья пьют отсюда; без влаги они чахнут и перестают платить сахаром.',
    limit: 'Предел — вместимость кладовой. Длиннее сеть — больше кладовая.',
    full: 'Кладовая полна: нити перестают добывать, пока деревья не заберут влагу. Длиннее сеть — больше кладовая.',
  },
  minerals: {
    name: 'Минералы',
    what: 'Азот и фосфор из залежей в почве: оливковые у поверхности, фиолетовые кристаллы глубже.',
    use: 'Деревьям они нужны для роста; они берут их из кладовой вместе с водой.',
    limit: 'У минералов своя кладовая, отдельная от влаги, такого же размера. Длиннее сеть — больше кладовая.',
    full: 'Кладовая полна: нити перестают добывать, пока деревья не заберут минералы. Длиннее сеть — больше кладовая.',
  },
  spores: {
    name: 'Споры',
    what: 'Их выпускают зрелые грибы, а редкие находки дарят по нескольку штук.',
    use: 'Это твои очки: чем больше спор, тем дальше разнесёт их ветер. Чем сытнее сеть, тем щедрее урожай.',
    limit: null,
    full: null,
  },
};

/** Percent of the cap filled, in words for the second line of the tooltip. */
export function fillWords(frac) {
  if (frac >= 0.985) return 'кладовая полна';
  if (frac <= 0.005) return 'кладовая пуста';
  return `кладовая заполнена на ${Math.round(frac * 100)} %`;
}

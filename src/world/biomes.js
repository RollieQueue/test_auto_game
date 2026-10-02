// Glade biomes and ground shapes: the data that makes one glade differ from another. Pure data and tiny helpers.
// Everything here is chosen from the seed alone (see `glade identity` in generate.js), so a glade keeps its name.

/**
 * Biome knobs.
 *  trees:    species weights, how many trunks (weighted), and the share of the dominant species
 *  depths:   nominal top of each horizon (litter, humus, loam, clay, gravel) in units below the surface
 *  rocks:    count range, size scale, depth band
 *  water:    pocket depth bands (the first is the «starter» pocket near the spore), size scale and regeneration scale
 *  minerals: kinds in order (the first is always nitrogen near the spore), mineralScale: richness per kind
 *  ground:   weights of the ground shapes
 *  decor:    curiosity pools for the shallow and deep soil
 */
export const BIOMES = {
  birch: {
    id: 'birch',
    bases: ['Берёзовая опушка', 'Берёзовая роща', 'Берёзовый перелесок', 'Светлая берёзовая роща', 'Берёзник', 'Берёзовая рощица', 'Белоствольная роща'],
    landmarks: ['у старой берёзы', 'у берёзового пня', 'со сломанной берёзой', 'с берёзовым подлеском', 'с берёзовыми серёжками'],
    trees: {
      weights: { birch: 0.74, oak: 0.1, pine: 0.16 },
      dominant: 'birch',
      counts: [[3, 0.3], [4, 0.4], [5, 0.3]],
    },
    depths: [0, 36, 205, 410, 640],
    waveScale: 1,
    rocks: { count: [3, 6], size: 1, depth: [150, 760] },
    water: {
      plan: [[60, 150], [70, 180], [85, 200], [220, 400], [240, 430], [470, 650]],
      size: 1.08,
      regen: 1.4, // wet soil: pockets refill quickly (regen is not part of a save's world fingerprint)
    },
    minerals: ['nitrogen', 'nitrogen', 'phosphorus', 'phosphorus'],
    mineralScale: { nitrogen: 1, phosphorus: 1 },
    ground: { flat: 0.2, rolling: 0.2, slope: 0.15, hill: 0.1, hollow: 0.25, ravine: 0.1 },
    decor: {
      shallow: ['leaf', 'twig', 'seed', 'snail', 'leaf', 'beetle', 'twig'],
      deep: ['pebble', 'bone', 'shell', 'potsherd', 'pebble'],
    },
  },
  oak: {
    id: 'oak',
    bases: ['Дубрава', 'Дубовая роща', 'Старая дубрава', 'Дубовый лес', 'Дубовая опушка', 'Тихая дубрава', 'Дубовая рощица'],
    landmarks: ['у векового дуба', 'у дуплистого дуба', 'с желудёвым ковром', 'с дубовой порослью', 'с грибными кругами'],
    trees: {
      weights: { birch: 0.2, oak: 0.72, pine: 0.08 },
      dominant: 'oak',
      counts: [[2, 0.2], [3, 0.45], [4, 0.35]],
    },
    depths: [0, 30, 215, 360, 650],
    waveScale: 1.1,
    rocks: { count: [2, 4], size: 1.2, depth: [200, 760] },
    water: {
      plan: [[70, 180], [90, 230], [240, 430], [260, 460], [480, 650]],
      size: 1,
      regen: 1,
    },
    minerals: ['nitrogen', 'nitrogen', 'nitrogen', 'nitrogen', 'phosphorus', 'phosphorus'],
    mineralScale: { nitrogen: 1.3, phosphorus: 1 },
    ground: { flat: 0.15, rolling: 0.3, slope: 0.1, hill: 0.15, hollow: 0.2, ravine: 0.1 },
    decor: {
      shallow: ['acorn', 'acorn', 'leaf', 'beetle', 'snail', 'twig', 'acorn'],
      deep: ['pebble', 'bone', 'shell', 'potsherd', 'pebble'],
    },
  },
  pine: {
    id: 'pine',
    bases: ['Сосновый бор', 'Сосняк', 'Сосновая роща', 'Светлый бор', 'Сухой бор', 'Корабельный бор', 'Сосновый перелесок'],
    landmarks: ['у сухой сосны', 'у смолистой сосны', 'с брусничником', 'с хвойным ковром', 'с вересковой полянкой'],
    trees: {
      weights: { birch: 0.18, oak: 0.06, pine: 0.76 },
      dominant: 'pine',
      counts: [[3, 0.35], [4, 0.4], [5, 0.25]],
    },
    depths: [0, 22, 112, 360, 570],
    waveScale: 0.9,
    rocks: { count: [8, 12], size: 0.78, depth: [70, 720] },
    water: {
      plan: [[80, 170], [250, 430], [420, 620], [480, 680]],
      size: 0.86,
      regen: 0.8,
    },
    minerals: ['nitrogen', 'nitrogen', 'phosphorus', 'phosphorus', 'phosphorus', 'phosphorus'],
    mineralScale: { nitrogen: 0.9, phosphorus: 1.2 },
    ground: { flat: 0.1, rolling: 0.15, slope: 0.2, hill: 0.35, hollow: 0.05, ravine: 0.15 },
    decor: {
      shallow: ['seed', 'twig', 'pebble', 'beetle', 'seed', 'pebble', 'snail'],
      deep: ['pebble', 'bone', 'shell', 'potsherd', 'pebble', 'pebble'],
    },
  },
  mixed: {
    id: 'mixed',
    bases: ['Смешанный лес', 'Смешанная роща', 'Лесная поляна', 'Тенистая поляна', 'Лиственный перелесок', 'Лесная опушка', 'Глухая поляна'],
    landmarks: ['у орешника', 'с лесной малиной', 'у старой осины', 'с одинокой липой', 'с папоротниковым логом'],
    trees: {
      weights: { birch: 1 / 3, oak: 1 / 3, pine: 1 / 3 },
      dominant: null,
      counts: [[2, 0.15], [3, 0.35], [4, 0.35], [5, 0.15]],
    },
    depths: [0, 28, 170, 390, 620],
    waveScale: 1.2,
    rocks: { count: [4, 8], size: 1, depth: [130, 760] },
    water: {
      plan: [[70, 170], [70, 190], [220, 420], [240, 440], [470, 650]],
      size: 1,
      regen: 1,
    },
    minerals: ['nitrogen', 'nitrogen', 'phosphorus', 'phosphorus', 'phosphorus'],
    mineralScale: { nitrogen: 1, phosphorus: 1 },
    ground: { flat: 0.17, rolling: 0.17, slope: 0.17, hill: 0.17, hollow: 0.16, ravine: 0.16 },
    decor: {
      shallow: ['acorn', 'leaf', 'snail', 'beetle', 'seed', 'twig', 'acorn', 'leaf'],
      deep: ['pebble', 'bone', 'shell', 'potsherd', 'pebble'],
    },
  },
};

export const BIOME_IDS = ['birch', 'oak', 'pine', 'mixed'];

/** Ground shapes and the phrases that describe them in a glade's name. */
export const TERRAIN_FEATURES = {
  flat: ['на равнине', 'на ровном месте'],
  rolling: ['среди пологих холмов', 'на пологих буграх'],
  slope: ['на склоне', 'на косогоре', 'на пологом склоне'],
  hill: ['на холме', 'на пригорке', 'на взгорке'],
  hollow: ['в низине', 'в лощине', 'в ложбине'],
  ravine: ['у оврага', 'на краю оврага'],
};

export const TERRAIN_IDS = Object.keys(TERRAIN_FEATURES);

/** Pick a key from an object of weights. */
export function pickWeighted(rng, weights) {
  const entries = Array.isArray(weights) ? weights : Object.entries(weights);
  const total = entries.reduce((s, e) => s + e[1], 0);
  let r = rng.next() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r < 0) return key;
  }
  return entries[entries.length - 1][0];
}

/** Small features any glade may have; a biome adds its own (`biome.landmarks`). */
export const LANDMARKS = [
  'у ручья', 'у родника', 'с муравейником', 'у старой ели', 'у поваленной сосны', 'у замшелого валуна',
  'у лисьей норы', 'с заросшей тропинкой', 'у старого пня', 'у заросшего пруда', 'с папоротником', 'с земляникой',
  'с черничником', 'у лесной тропы', 'у каменной гряды', 'с барсучьими норами', 'у светлого ключа', 'у трухлявой колоды',
  'с кочками мха', 'у зарослей малины', 'с поваленным стволом', 'у мшистой кочки', 'с поляной ландышей',
];

/** The longest a name may grow (the cards and the title page show it on one line). */
export const NAME_MAX = 46;

/**
 * «Сосновый бор у ручья на холме»: a base noun phrase of the biome, usually a landmark, and a phrase for the ground
 * shape (the name always starts with a base and ends with a phrase of the terrain). `rng` is the name's own generator
 * (generate.js), so nothing else about a seed depends on how many draws the name takes.
 */
export function gladeName(rng, biome, terrain) {
  const base = rng.pick(biome.bases);
  const feature = rng.pick(TERRAIN_FEATURES[terrain]);
  // «у … у оврага» reads badly: a landmark with «у» does not go with a terrain phrase with «у»
  const pool = [...LANDMARKS, ...(biome.landmarks || [])].filter((l) => !(l.startsWith('у ') && feature.startsWith('у ')));
  const landmark = rng.next() < 0.88 ? rng.pick(pool) : '';
  const full = landmark ? `${base} ${landmark} ${feature}` : `${base} ${feature}`;
  return full.length > NAME_MAX ? `${base} ${feature}` : full;
}

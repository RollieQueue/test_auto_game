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
 *  look:     how the soil is drawn (render/soil-look.js reads it; nothing in the world or the simulation does):
 *              layers   per horizon id: the colour the band shows on paper, accents for the pigment blooms, and `tones`,
 *                       darker sub-layers as fractions of the band's thickness ({from, to, color, alpha})
 *              grain    multipliers on the generic marks (sand, specks, hatch, pebbles, strata, cracks, fibres, humusFibres)
 *              stones   tones of the generic pebbles
 *              features what a horizon shows: {kind, in: horizon id, density per 10 000 u² | count: [min, max], y: band
 *                       fractions, size: [[rx min, max], [ry min, max]], ...kind options}; see soil-look.js
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
    // wet brown-grey loam over bluish clay: gley mottles, rust spots along old root channels, damp patches
    look: {
      layers: {
        litter: { color: '#a88e62', accents: ['#b49463', '#8b7048', '#9c8458', '#7f6a4a'] },
        humus: { color: '#7c6c5e', accents: ['#5c4e46', '#78685c', '#665a52', '#54483f'], tones: [{ from: 0, to: 0.3, color: '#5a4a3e', alpha: 0.4 }] },
        loam: { color: '#a58f78', accents: ['#7a6a5c', '#98806a', '#6c6258', '#86705a'], tones: [{ from: 0, to: 0.28, color: '#6e5c4e', alpha: 0.45 }] },
        clay: { color: '#9c9588', accents: ['#7c8088', '#9a9488', '#6e747c', '#948672'] },
      },
      grain: { sand: 0.5, specks: 1, hatch: 0.8, pebbles: 0.45, strata: 1.2, cracks: 0.5, fibres: 1.1, humusFibres: 1 },
      stones: ['#8a8478', '#7c7a74', '#9a9080'],
      features: [
        { kind: 'damp', in: 'humus', density: 0.8, y: [0.1, 0.9], size: [[40, 110], [10, 22]], alpha: [0.14, 0.28] },
        { kind: 'damp', in: 'loam', density: 1, y: [0.05, 0.6], size: [[40, 120], [12, 26]], alpha: [0.14, 0.28] },
        { kind: 'gley', in: 'loam', density: 1.2, y: [0.35, 0.95], size: [[16, 44], [5, 13]], alpha: [0.2, 0.36], rust: 0.4 },
        { kind: 'gley', in: 'clay', density: 2.3, y: [0.02, 0.98], size: [[16, 48], [5, 15]], alpha: [0.24, 0.4], rust: 0.4 },
        { kind: 'rust', in: 'loam', density: 1, y: [0.15, 1], size: [[2.5, 7], [2, 5]], alpha: [0.4, 0.7] },
        { kind: 'rust', in: 'clay', density: 1.2, y: [0, 1], size: [[2.5, 7], [2, 5]], alpha: [0.4, 0.7] },
        { kind: 'rootchan', in: 'loam', count: [4, 6], y: [0.05, 0.6], len: [26, 62] },
        { kind: 'rootchan', in: 'clay', count: [3, 5], y: [0.05, 0.6], len: [26, 62] },
      ],
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
    // thick near-black humus, worm casts and channels, krotovinas (old burrows filled with other soil), white carbonate nodules in the loam
    look: {
      layers: {
        litter: { color: '#8a6a42', accents: ['#a07040', '#6e4c2c', '#8a7440', '#7a5632'] },
        humus: { color: '#5a463a', accents: ['#4e3c32', '#665040', '#443630', '#5a4634'], tones: [{ from: 0, to: 0.55, color: '#4a3a30', alpha: 0.7 }, { from: 0, to: 0.16, color: '#3a2c24', alpha: 0.5 }] },
        loam: { color: '#8c6c46', accents: ['#9a7248', '#6a5440', '#8a6a3a', '#7a6048'], tones: [{ from: 0, to: 0.22, color: '#6c5444', alpha: 0.5 }] },
        clay: { color: '#9a6e4a', accents: ['#ae7044', '#7c5c68', '#a06844', '#865c42'] },
      },
      grain: { sand: 0.55, specks: 1.35, hatch: 1.1, pebbles: 0.6, strata: 0.8, cracks: 0.6, fibres: 1, humusFibres: 1.7 },
      stones: ['#8f8068', '#7a6c58', '#9a8a70'],
      features: [
        { kind: 'channel', in: 'humus', count: [9, 13], y: [0.12, 0.7], len: [34, 78] },
        { kind: 'cast', in: 'humus', density: 0.9, y: [0.06, 0.92], size: [[3.5, 7]] },
        { kind: 'krot', in: 'humus', count: [5, 7], y: [0.25, 0.8], size: [[20, 44], [12, 27]], fill: 'light' },
        { kind: 'krot', in: 'loam', count: [3, 4], y: [0.3, 0.75], size: [[18, 38], [11, 24]], fill: 'dark' },
        { kind: 'nodule', in: 'loam', density: 8.5, y: [0.12, 0.96], size: [[1.4, 3.4], [1.1, 2.6]] },
        { kind: 'nodule', in: 'clay', density: 2, y: [0.02, 0.35], size: [[1.4, 3.2], [1.1, 2.4]] },
      ],
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
    // podzol: thin needle litter, a dark thin A1, an ash-grey bleached E, a rusty-orange B with tongues, pale sand under it, flint and quartz
    look: {
      layers: {
        litter: { color: '#aa9060', accents: ['#bc9c62', '#8c7248', '#a48c58', '#7e6840'] },
        humus: { color: '#9a9488', accents: ['#a8a296', '#867f74', '#a09a8c', '#8e8a82'], tones: [{ from: 0, to: 0.2, color: '#6a5a4a', alpha: 0.8 }] },
        loam: { color: '#c28c4a', accents: ['#cc9650', '#a8683a', '#b8804a', '#c4a064'], tones: [{ from: 0, to: 0.42, color: '#a45c2c', alpha: 0.6 }, { from: 0, to: 0.12, color: '#8a4a28', alpha: 0.45 }] },
        clay: { color: '#c2a47a', accents: ['#cdb286', '#aa9068', '#bc9a6c', '#d2bc90'] },
        gravel: { color: '#7c786e', accents: ['#8a867c', '#6c6c70', '#807a6c', '#74787c'] },
      },
      grain: { sand: 2.3, specks: 0.55, hatch: 0.55, pebbles: 0.4, strata: 0.3, cracks: 0, fibres: 0.5, humusFibres: 0.3 },
      stones: ['#9a948a', '#b4aca0', '#8a8c92'],
      features: [
        { kind: 'needle', in: 'litter', density: 110, y: [0.05, 0.95], len: [8, 16] },
        { kind: 'tongue', in: 'loam', count: [14, 20], y: [0, 0.04], len: [18, 52], size: [[4.5, 11]] },
        { kind: 'stone', in: 'humus', density: 0.5, y: [0.3, 0.95], size: [[3.4, 7.5]], tones: ['#f0ead8', '#e4dccb', '#d8d4c8'], angular: 0.9, glint: true },
        { kind: 'stone', in: 'loam', density: 0.5, y: [0.1, 0.95], size: [[3.4, 8]], tones: ['#f0ead8', '#e4dccb'], angular: 0.9, glint: true },
        { kind: 'stone', in: 'loam', density: 0.45, y: [0.1, 0.95], size: [[4, 9]], tones: ['#6c7078', '#5a5e68', '#7a7468'], angular: 0.85 },
        { kind: 'stone', in: 'clay', density: 0.6, y: [0.05, 0.95], size: [[3.4, 8]], tones: ['#f0ead8', '#e4dccb', '#d8d4c8'], angular: 0.9, glint: true },
        { kind: 'stone', in: 'clay', density: 0.7, y: [0.05, 0.95], size: [[4, 10]], tones: ['#6c7078', '#5a5e68', '#7a7468'], angular: 0.85 },
        { kind: 'stone', in: 'gravel', density: 1.3, y: [0.04, 0.96], size: [[3, 9]], tones: ['#f0ead8', '#e4dccb', '#d8d4c8'], angular: 0.9, glint: true },
        { kind: 'stone', in: 'gravel', density: 1.7, y: [0.04, 0.96], size: [[3.5, 10]], tones: ['#5e626c', '#4c505c', '#726c60', '#6c7078'], angular: 0.85 },
      ],
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
    // brown forest soil: warm even browns, thin black charcoal lenses from old fires, a varied mix of pebbles
    look: {
      layers: {
        litter: { color: '#9a7248', accents: ['#b07a46', '#74502e', '#947c42', '#835a36'] },
        humus: { color: '#7a5a40', accents: ['#86603e', '#58412f', '#6c4e32', '#5e4836'] },
        loam: { color: '#8e6a42', accents: ['#a07248', '#6e5642', '#8c6638', '#7a6048'] },
        clay: { color: '#a06c48', accents: ['#b46e42', '#7a5e6c', '#a46642', '#8a5c42'] },
      },
      grain: { sand: 1.1, specks: 0.9, hatch: 1, pebbles: 1.7, strata: 1, cracks: 1.7, fibres: 1, humusFibres: 1 },
      stones: ['#8f8068', '#a8a29a', '#b87a5a', '#6e747e', '#c8c0b0', '#8a5a46', '#9aa090'],
      features: [
        { kind: 'lens', in: 'humus', count: [2, 3], y: [0.6, 0.92], size: [[50, 120], [4, 7]] },
        { kind: 'lens', in: 'loam', count: [5, 7], y: [0.1, 0.92], size: [[60, 150], [4, 8]] },
        { kind: 'lens', in: 'clay', count: [1, 2], y: [0.1, 0.5], size: [[50, 120], [3.5, 7]] },
        { kind: 'stone', in: 'humus', density: 0.5, y: [0.15, 0.95], size: [[3, 7.5]], tones: ['#a8a29a', '#b87a5a', '#8f8068', '#e0dccc', '#c89a88'], angular: 0.4 },
        { kind: 'stone', in: 'loam', density: 1.5, y: [0.08, 0.95], size: [[3, 8.5]], tones: ['#8f8068', '#a8a29a', '#b87a5a', '#6e747e', '#e0dccc', '#8a5a46', '#c89a88'], angular: 0.5 },
        { kind: 'stone', in: 'clay', density: 1.6, y: [0.05, 0.95], size: [[3, 9]], tones: ['#8f8068', '#a8a29a', '#b87a5a', '#6e747e', '#c8c0b0', '#9aa090'], angular: 0.5 },
        { kind: 'stone', in: 'gravel', density: 2.2, y: [0.04, 0.96], size: [[3, 10]], tones: ['#8c8a8e', '#a39a8c', '#78808c', '#b87a5a', '#c8c0b0', '#6e747e'], angular: 0.55 },
      ],
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

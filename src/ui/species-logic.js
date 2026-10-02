// The fungus-species pick on the title page, pure parts: the specimen cards' texts (numbers come from B.fungi), the stored
// last choice, and the choice a new game starts with. The sim side is src/sim/species.js.
import { B } from '../sim/balance.js';
import { FUNGUS_IDS, isFungus, matchingFungus } from '../sim/species.js';

export const STORAGE_KEY = 'roots-threads.species';

const PARTNER_NAME = { birch: 'берёза', oak: 'дуб', pine: 'сосна' };
const PARTNER_GEN = { birch: 'берёзы', oak: 'дуба', pine: 'сосны' };

// what each species is called, and the one-word names of its strength (the numbers are filled in from B.fungi below)
const NAMES = {
  fly_agaric: { name: 'Мухомор', latin: 'Amanita muscaria' },
  porcini: { name: 'Белый гриб', latin: 'Boletus edulis' },
  saffron_milk_cap: { name: 'Рыжик', latin: 'Lactarius deliciosus' },
  chanterelle: { name: 'Лисичка', latin: 'Cantharellus cibarius' },
};

const pct = (k) => Math.round(Math.abs(k - 1) * 100);

/** The line of a species' strength, with the percentage taken from B.fungi. */
function strengthLine(id) {
  const f = B.fungi[id];
  switch (id) {
    case 'fly_agaric':
      return `горькие нити: черви кусают на ${pct(f.grazer)} % реже`;
    case 'porcini':
      return `крупные шляпки: споры +${pct(f.spore)} %`;
    case 'saffron_milk_cap':
      return `тянет минералы: +${pct(f.minerals)} %`;
    case 'chanterelle':
      return `жёсткие нити: опёнок слабее на ${pct(f.rot)} %`;
    default:
      return '';
  }
}

/** The four specimen cards in the order of the title page: { id, name, latin, partner, partnerLine, pay, strength, art, tip }. */
export function speciesCards() {
  return FUNGUS_IDS.map((id) => {
    const f = B.fungi[id];
    const partner = f.partner ? PARTNER_NAME[f.partner] : 'любое дерево';
    const pay = `сахара от ${f.partner ? PARTNER_GEN[f.partner] : 'любого дерева'} на ${pct(f.pay)} % больше`;
    return {
      id,
      ...NAMES[id],
      partner,
      partnerLine: `партнёр: ${partner}`,
      strength: strengthLine(id),
      art: `assets/art/mushroom/${id}.1.webp`,
      pay,
      tip: `${NAMES[id].name}: ${pay}`,
    };
  });
}

/** The card id one step from `id` (±1, wrapping), or the first when `id` is not a species. */
export function stepSpecies(id, dir) {
  const i = FUNGUS_IDS.indexOf(id);
  if (i < 0) return FUNGUS_IDS[0];
  return FUNGUS_IDS[(i + dir + FUNGUS_IDS.length) % FUNGUS_IDS.length];
}

/** The note on the card of the species whose partner dominates this glade, or '' (a mixed glade has none). */
export const gladeNote = (state, id) => (isFungus(id) && matchingFungus(state.world) === id ? 'по этой поляне' : '');

/** A valid species id from a URL value or a stored string, else null. */
export const parseSpecies = (value) => (isFungus(value) ? value : null);

function storageOf(storage) {
  try {
    return storage ?? globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The last choice kept in localStorage (STORAGE_KEY), or null. */
export function loadChoice(storage) {
  try {
    return parseSpecies(storageOf(storage)?.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveChoice(id, storage) {
  if (!isFungus(id)) return false;
  try {
    storageOf(storage)?.setItem(STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/** The species a new glade starts with: the last choice, else the partner of this glade's trees, else the generalist. */
export const startingSpecies = (world, last) => parseSpecies(last) ?? matchingFungus(world) ?? 'chanterelle';

/** The paragraph of the help page about the pick: a general line, and (when the game has a species) what yours does. */
export function speciesHelp(state) {
  const id = parseSpecies(state?.flags?.species);
  const general = 'Вид гриба выбирают на титульной странице: у каждого свой партнёр среди деревьев и своя сильная сторона.';
  const c = id && speciesCards().find((x) => x.id === id);
  return c ? `${general} Сейчас ты — ${c.name.toLowerCase()}: ${c.pay}; ${c.strength}.` : general;
}

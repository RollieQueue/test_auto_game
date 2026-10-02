// The fungus the player is: a partner tree species that pays more sugar, plus one strength (numbers in B.fungi).
// state.flags.species is set before the game starts; without it (an old save) the fungus is 'common' and nothing changes.
import { B } from './balance.js';

/** The pickable species, in the order of the title page. */
export const FUNGUS_IDS = Object.freeze(['fly_agaric', 'porcini', 'saffron_milk_cap', 'chanterelle']);

export const isFungus = (id) => FUNGUS_IDS.includes(id);

/** The id of a species or of a state (state.flags.species): one of FUNGUS_IDS, otherwise 'common'. */
export function fungusId(source) {
  const id = typeof source === 'string' ? source : source?.flags?.species;
  return isFungus(id) ? id : 'common';
}

/** All numbers of a species (or of a state's species), with 1 for what it does not change. */
export function fungusFx(source) {
  return { ...B.fungi.common, ...B.fungi[fungusId(source)] };
}

/** The tree species that pays this fungus more (null for a generalist and for 'common'). */
export const partnerOf = (source) => fungusFx(source).partner;

/** Multiplier of the sugar a tree pays this fungus: the partner bonus on its partner species, the generalist's on every tree. */
export function partnerPay(source, tree) {
  const f = fungusFx(source);
  return f.partner === null || f.partner === tree.species ? f.pay : 1;
}

/** The species whose partner has the most trunks in a glade, as a fungus id; null when two partners tie (a mixed glade). */
export function matchingFungus(world) {
  const count = (id) => world.trees.filter((t) => t.species === B.fungi[id].partner).length;
  const ranked = FUNGUS_IDS.filter((id) => B.fungi[id].partner).sort((a, b) => count(b) - count(a));
  return count(ranked[0]) > count(ranked[1]) ? ranked[0] : null;
}

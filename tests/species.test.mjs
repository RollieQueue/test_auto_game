// The fungus the player is (state.flags.species): partner tree bonus, one strength each, mushrooms that carry the species, saving,
// old saves, the title page's pure parts and a short balance smoke check. Numbers come from B.fungi, never from literals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { addNode } from '../src/sim/network.js';
import { B } from '../src/sim/balance.js';
import { FUNGUS_IDS, fungusFx, fungusId, matchingFungus, partnerOf, partnerPay } from '../src/sim/species.js';
import { stepEconomy } from '../src/sim/economy.js';
import { stepMushrooms } from '../src/sim/mushrooms.js';
import { createRival, stepRival } from '../src/sim/rival.js';
import { spawnWormAt } from '../src/sim/threats.js';
import { groundYAt } from '../src/world/query.js';
import { decodeState, encodeState } from '../src/persist-codec.js';
import { mushroomLook } from '../src/render/sprites.js';
import { buildHelp } from '../src/ui/help.js';
import { STORAGE_KEY, gladeNote, loadChoice, parseSpecies, saveChoice, speciesCards, startingSpecies, stepSpecies } from '../src/ui/species-logic.js';
import { playBot } from './bot.mjs';

const DT = 1 / 60;
const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);
const roundTrip = (s) => decodeState(JSON.parse(JSON.stringify(encodeState(s))));

/** A new game in play; `species` goes into the flag before the first step, as the title page does. */
function fresh(seed = 7, species = null) {
  const s = createState(seed);
  s.phase = 'playing';
  if (species) s.flags.species = species;
  return s;
}

/** The first seed whose glade has a tree of every given species. */
function gladeWith(...kinds) {
  for (let seed = 1; seed < 300; seed++) {
    const s = createState(seed);
    if (kinds.every((k) => s.world.trees.some((t) => t.species === k))) return seed;
  }
  throw new Error(`no glade with ${kinds}`);
}

// ---- 1. the choice becomes a flag -----------------------------------------------------------------------------------------

test('the four species have a partner, one strength each, and nothing else changes', () => {
  assert.deepEqual([...FUNGUS_IDS].sort(), ['chanterelle', 'fly_agaric', 'porcini', 'saffron_milk_cap']);
  assert.deepEqual(FUNGUS_IDS.map(partnerOf), ['birch', 'oak', 'pine', null]);
  const strengths = { fly_agaric: 'grazer', porcini: 'spore', saffron_milk_cap: 'minerals', chanterelle: 'rot' };
  for (const id of FUNGUS_IDS) {
    const f = fungusFx(id);
    const changed = ['grazer', 'spore', 'minerals', 'rot'].filter((k) => f[k] !== 1);
    assert.deepEqual(changed, [strengths[id]], `${id} has exactly one strength`);
    assert.ok(f[strengths[id]] !== 1);
    if (f.partner) assert.ok(f.pay >= 1.25 && f.pay <= 1.35, `${id} partner bonus ${f.pay}`);
  }
  assert.ok(B.fungi.chanterelle.pay > 1 && B.fungi.chanterelle.pay <= 1.15, 'the generalist: a small bonus on every tree');
  // 'common' (no pick) is neutral
  assert.deepEqual(['grazer', 'spore', 'minerals', 'rot', 'pay'].map((k) => fungusFx('common')[k]), [1, 1, 1, 1, 1]);
});

test('flags.species is read as a species or as common', () => {
  assert.equal(fungusId(fresh(7)), 'common');
  for (const id of FUNGUS_IDS) assert.equal(fungusId(fresh(7, id)), id);
  assert.equal(fungusId({ flags: { species: 'honey' } }), 'common', 'the rival is not a species to pick');
  assert.equal(fungusId({ flags: { species: 'nonsense' } }), 'common');
  assert.equal(fungusId({}), 'common');
  assert.equal(fungusId('porcini'), 'porcini');
});

// ---- 2. the player's mushrooms carry the species ---------------------------------------------------------------------------

/** Plants one mushroom on a new node just under the surface. */
function plant(s, dx = 60) {
  const o = s.net.nodes[s.net.originId];
  const x = o.x + dx;
  const node = addNode(s, x, groundYAt(s.world, x) + 20, s.net.originId);
  assert.equal(sim.commandFruit(s, node.id), true);
  return s.mushrooms[s.mushrooms.length - 1];
}

test('mushrooms are planted as the chosen species and wear its picture; no pick plants common', () => {
  for (const id of FUNGUS_IDS) {
    const s = fresh(7, id);
    const m = plant(s);
    assert.equal(m.species, id);
    assert.equal(mushroomLook(m, s.world.trees), id, 'the renderer shows the species, whatever tree stands near');
  }
  const none = plant(fresh(7));
  assert.equal(none.species, 'common');
});

test('the honey-fungus rival keeps its own mushrooms: clusters never wear a player species', () => {
  const s = fresh(7, 'porcini');
  s.flags.rival = 'now';
  const r = (s.rival = createRival(s));
  assert.ok(Array.isArray(r.clusters));
  for (const c of r.clusters) assert.ok(!FUNGUS_IDS.includes(c.species));
  assert.equal(mushroomLook({ species: 'honey', id: 1, x: 100 }, s.world.trees) === 'honey', false);
});

// ---- 3. the partner bonus ---------------------------------------------------------------------------------------------------

/** A glade with a birch, an oak and a pine, all linked and well fed; runs the economy for one second and returns the sugar each paid. */
function paid(species, seed) {
  const s = fresh(seed, species);
  s.res.water = 90;
  s.res.minerals = 90;
  s.cap.pool = 90;
  for (const t of s.world.trees) {
    t.linked = true;
    s.sim.contacts[t.id] = [0, 1, 2]; // three contacts: full factor
  }
  stepEconomy(s, 1);
  return Object.fromEntries(s.world.trees.map((t) => [t.species, s.sim.intake[t.id].sugar]));
}

test('the partner bonus pays only on partner trees; the generalist raises every tree a little', () => {
  const seed = gladeWith('birch', 'oak', 'pine');
  const base = paid(null, seed);
  for (const id of ['fly_agaric', 'porcini', 'saffron_milk_cap']) {
    const got = paid(id, seed);
    for (const tree of ['birch', 'oak', 'pine']) {
      const want = B.fungi[id].partner === tree ? B.fungi[id].pay : 1;
      near(got[tree] / base[tree], want, 1e-9, `${id} on ${tree}`);
    }
  }
  const any = paid('chanterelle', seed);
  for (const tree of ['birch', 'oak', 'pine']) near(any[tree] / base[tree], B.fungi.chanterelle.pay, 1e-9, `chanterelle on ${tree}`);
  // the sim helper agrees
  const w = createState(seed).world;
  const birch = w.trees.find((t) => t.species === 'birch');
  assert.equal(partnerPay('fly_agaric', birch), B.fungi.fly_agaric.pay);
  assert.equal(partnerPay('porcini', birch), 1);
  assert.equal(partnerPay('chanterelle', birch), B.fungi.chanterelle.pay);
  assert.equal(partnerPay('common', birch), 1);
});

test('the matching species of a glade is the one whose partner has the most trunks; a tie has none', () => {
  let oneOfEach = 0;
  for (let seed = 1; seed < 80; seed++) {
    const w = createState(seed).world;
    const n = (k) => w.trees.filter((t) => t.species === k).length;
    const m = matchingFungus(w);
    if (m) {
      const mine = n(B.fungi[m].partner);
      for (const id of FUNGUS_IDS) if (B.fungi[id].partner) assert.ok(n(B.fungi[id].partner) <= mine);
    } else oneOfEach++;
  }
  assert.ok(oneOfEach > 0, 'some glades are mixed and name no match');
  assert.equal(matchingFungus({ trees: [{ species: 'oak' }, { species: 'oak' }, { species: 'pine' }] }), 'porcini');
  assert.equal(matchingFungus({ trees: [{ species: 'oak' }, { species: 'pine' }] }), null);
});

// ---- 4. the strengths ---------------------------------------------------------------------------------------------------------

test('fly agaric: fewer worms graze on the threads', () => {
  const share = (species) => {
    const s = fresh(7, species);
    s.flags.threats = true;
    let n = 0;
    const total = 600;
    for (let i = 0; i < total; i++) if (spawnWormAt(s, 400 + (i % 50), 900).grazer) n++;
    return n / total;
  };
  const common = share(null);
  const fly = share('fly_agaric');
  near(common, B.wormGrazer, 0.06, 'common share');
  near(fly, B.wormGrazer * B.fungi.fly_agaric.grazer, 0.06, 'fly agaric share');
  assert.ok(fly < common - 0.15);
  near(share('porcini'), common, 1e-9, 'other species do not change the worms');
});

test('porcini: its mushrooms release more spores; a mushroom of another species does not', () => {
  const spores = (species) => {
    const s = fresh(7, species);
    const m = plant(s);
    m.growth = 1;
    m.mature = true;
    s.res.water = 40;
    s.res.minerals = 20;
    const before = s.res.spores;
    for (let i = 0; i < 600; i++) stepMushrooms(s, DT);
    return s.res.spores - before;
  };
  const base = spores(null);
  assert.ok(base > 0);
  near(spores('porcini') / base, B.fungi.porcini.spore, 1e-6, 'porcini');
  for (const id of ['fly_agaric', 'saffron_milk_cap', 'chanterelle']) near(spores(id) / base, 1, 1e-6, id);
});

test('saffron milk cap: a linked mineral deposit gives more minerals', () => {
  const got = (species) => {
    const s = fresh(7, species);
    const m = s.world.minerals[0];
    s.sim.mineralLinks[m.id] = [0];
    s.cap.pool = 1e6;
    s.res.minerals = 0;
    const before = m.amount;
    for (let i = 0; i < 120; i++) stepEconomy(s, DT);
    return before - m.amount;
  };
  const base = got(null);
  assert.ok(base > 0);
  near(got('saffron_milk_cap') / base, B.fungi.saffron_milk_cap.minerals, 1e-6, 'saffron milk cap');
  near(got('porcini') / base, 1, 1e-6, 'porcini');
});

test('chanterelle: the honey fungus rots its trees more slowly', () => {
  const rot = (species) => {
    const s = fresh(7, species);
    s.flags.rival = true;
    const r = (s.rival = createRival(s));
    Object.assign(r, { awake: true, age: 1000, spawnT: 1e9 });
    const t = s.world.trees[0];
    r.nodes.push({ id: 0, x: t.x, y: t.baseY + 50, alive: true, born: 0 }, { id: 1, x: t.x, y: t.baseY + 70, alive: true, born: 0 });
    r.ver++;
    r.edges.push({ id: 0, a: 0, b: 1, w: 1.5, alive: true, born: 0, wither: 0 });
    r.grip.push({ treeId: t.id, node: 1, x: t.x, y: t.baseY + 70, since: 0, tip: 0 });
    for (let i = 0; i < 30 * 60; i++) stepRival(s, DT);
    return t.infection;
  };
  const base = rot(null);
  assert.ok(base > 0.05, `the control rots (${base})`);
  near(rot('chanterelle') / base, B.fungi.chanterelle.rot, 1e-6, 'chanterelle');
  near(rot('fly_agaric') / base, 1, 1e-6, 'fly agaric');
});

// ---- 5. saving ---------------------------------------------------------------------------------------------------------------

test('the species and the species of every mushroom survive a save and a load', () => {
  const s = fresh(7, 'porcini');
  plant(s);
  plant(s, -60);
  for (let i = 0; i < 120; i++) sim.updateSim(s, DT);
  const copy = roundTrip(s);
  assert.equal(copy.flags.species, 'porcini');
  assert.deepEqual(copy.mushrooms.map((m) => m.species), ['porcini', 'porcini']);
  assert.equal(mushroomLook(copy.mushrooms[0], copy.world.trees), 'porcini');
  // and it keeps working: the loaded game pays and fruits as its own species
  const m3 = plant(copy, 140);
  assert.equal(m3.species, 'porcini');
});

test('an old save without a species plays as common', () => {
  const s = fresh(7, 'fly_agaric');
  plant(s);
  const old = JSON.parse(JSON.stringify(encodeState(s)));
  // an old file: no species flag, and mushrooms without a species
  const strip = (v) => {
    if (Array.isArray(v)) v.forEach(strip);
    else if (v && typeof v === 'object') {
      delete v.species;
      Object.values(v).forEach(strip);
    }
  };
  assert.ok(JSON.stringify(old.flags).includes('fly_agaric') && JSON.stringify(old.mushrooms).includes('fly_agaric'));
  strip(old.flags);
  strip(old.mushrooms);
  assert.ok(!JSON.stringify(old.flags).includes('species') && !JSON.stringify(old.mushrooms).includes('species'));
  const copy = decodeState(old);
  assert.equal(copy.flags.species, undefined);
  assert.equal(fungusId(copy), 'common');
  assert.equal(partnerPay(copy, copy.world.trees[0]), 1);
  assert.equal(mushroomLook(copy.mushrooms[0], copy.world.trees) !== undefined, true, 'the renderer still picks a look (nearest tree)');
  const m = plant(copy, -80);
  assert.equal(m.species, 'common');
});

// ---- 6. the title page's pure parts --------------------------------------------------------------------------------------------

test('four cards with a name, the Latin name, a partner and a strength, in the pick order', () => {
  const cards = speciesCards();
  assert.deepEqual(cards.map((c) => c.id), [...FUNGUS_IDS]);
  assert.deepEqual(cards.map((c) => c.latin), ['Amanita muscaria', 'Boletus edulis', 'Lactarius deliciosus', 'Cantharellus cibarius']);
  assert.deepEqual(cards.map((c) => c.partnerLine), ['партнёр: берёза', 'партнёр: дуб', 'партнёр: сосна', 'партнёр: любое дерево']);
  for (const c of cards) {
    assert.match(c.name, /[А-Яа-я]/);
    assert.ok(c.strength.length > 10 && c.strength.length < 60, c.strength);
    assert.equal(c.art, `assets/art/mushroom/${c.id}.1.webp`);
  }
  // percentages follow B.fungi
  assert.ok(cards[1].strength.includes(String(Math.round((B.fungi.porcini.spore - 1) * 100))));
});

test('the pictures of the cards exist', async () => {
  const { existsSync } = await import('node:fs');
  for (const c of speciesCards()) assert.ok(existsSync(new URL(`../${c.art}`, import.meta.url)), c.art);
});

test('arrows step through the cards and wrap', () => {
  assert.equal(stepSpecies('fly_agaric', 1), 'porcini');
  assert.equal(stepSpecies('chanterelle', 1), 'fly_agaric');
  assert.equal(stepSpecies('fly_agaric', -1), 'chanterelle');
  assert.equal(stepSpecies(null, 1), 'fly_agaric');
});

test('the glade note marks the matching species only', () => {
  const seed = gladeWith('oak');
  let found = null;
  for (let s = seed; s < 300 && !found; s++) {
    const st = createState(s);
    if (matchingFungus(st.world) === 'porcini') found = st;
  }
  assert.ok(found, 'an oak glade');
  assert.equal(gladeNote(found, 'porcini'), 'по этой поляне');
  assert.equal(gladeNote(found, 'fly_agaric'), '');
  assert.equal(gladeNote(found, 'chanterelle'), '');
});

test('the last choice is stored under roots-threads.species and read back; bad values are ignored', () => {
  const data = new Map();
  const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => void data.set(k, String(v)) };
  assert.equal(STORAGE_KEY, 'roots-threads.species');
  assert.equal(loadChoice(storage), null);
  assert.equal(saveChoice('porcini', storage), true);
  assert.equal(data.get('roots-threads.species'), 'porcini');
  assert.equal(loadChoice(storage), 'porcini');
  assert.equal(saveChoice('honey', storage), false);
  data.set(STORAGE_KEY, 'junk');
  assert.equal(loadChoice(storage), null);
  assert.equal(loadChoice({ getItem: () => { throw new Error('blocked'); } }), null, 'a blocked storage is no error');
  assert.equal(parseSpecies('chanterelle'), 'chanterelle');
  assert.equal(parseSpecies('common'), null);
  assert.equal(parseSpecies(undefined), null);
});

test('a new glade starts with the last choice, else the glade’s own partner, else the generalist', () => {
  const oak = createState(gladeWith('oak'));
  let w = null;
  for (let s = 1; s < 300 && !w; s++) {
    const st = createState(s);
    if (matchingFungus(st.world) === 'porcini') w = st.world;
  }
  assert.equal(startingSpecies(w, 'fly_agaric'), 'fly_agaric', 'the last choice wins');
  assert.equal(startingSpecies(w, null), 'porcini', 'no choice: the glade’s partner');
  assert.equal(startingSpecies(w, 'junk'), 'porcini');
  assert.equal(startingSpecies({ trees: [{ species: 'oak' }, { species: 'pine' }] }, null), 'chanterelle', 'a mixed glade: the generalist');
  assert.ok(oak);
});

test('the help page tells about the pick, and about yours when the game has one', () => {
  const general = buildHelp(fresh(7));
  assert.ok(general.includes('Вид гриба выбирают на титульной странице'));
  assert.ok(!general.includes('Сейчас ты'));
  const mine = buildHelp(fresh(7, 'porcini'));
  assert.ok(mine.includes('Сейчас ты — белый гриб'));
});

// ---- 7. balance smoke check ---------------------------------------------------------------------------------------------------

test('balance smoke: every species finishes the first page in about the same time (a few seeds)', () => {
  // (6 seeds that every species finishes on; over the 11 glades of seeds 2-13 where all of them do, the four are 5.6 % apart)
  const seeds = [3, 6, 8, 10, 11, 12];
  const mean = {};
  for (const id of ['common', ...FUNGUS_IDS]) {
    const times = seeds.map((seed) => playBot(seed, { seasons: true, threats: true, species: id === 'common' ? undefined : id, maxSeconds: 1400 }).completedAt);
    assert.ok(times.every((t) => t !== null), `${id} completes the page on every seed: ${times}`);
    mean[id] = times.reduce((a, b) => a + b, 0) / times.length;
  }
  const four = FUNGUS_IDS.map((id) => mean[id]);
  assert.ok(Math.max(...four) / Math.min(...four) < 1.15, `the four species within 15 %: ${JSON.stringify(mean)}`);
  for (const id of FUNGUS_IDS) assert.ok(mean[id] < mean.common * 1.1, `${id} is no handicap on page one`);
});

test('a bot game with a species is deterministic and keeps the species on its mushrooms', () => {
  const a = playBot(7, { seasons: true, threats: true, species: 'saffron_milk_cap', maxSeconds: 200 });
  const b = playBot(7, { seasons: true, threats: true, species: 'saffron_milk_cap', maxSeconds: 200 });
  assert.equal(a.state.res.sugar, b.state.res.sugar);
  assert.ok(a.state.mushrooms.length > 0);
  assert.ok(a.state.mushrooms.every((m) => m.species === 'saffron_milk_cap'));
});

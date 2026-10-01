// Every tunable gameplay number lives here. Units: world units (u), seconds (s), sugar/water/minerals/spores.
// Verified by the bot playthroughs in tests/sim.test.mjs and tests/seasons.test.mjs (all five objectives in 5-7 game minutes
// at x1 for the scripted bot, a human is expected to need about twice as long; with seasons on, by the end of spring or summer).

/** Economy multipliers of an ordinary game: all 1. */
export const NEUTRAL_HARD = Object.freeze({ upkeep: 1, sprawl: Infinity, treePay: 1, growCost: 1, mushCost: 1, mushCount: 0, mushGrowSugar: 1, mushMatureSugar: 1, sugarCap: 1, treeGrow: 1, sporeRate: 1 });

export const B = {
  // --- Start ---
  startSugar: 100,

  // --- Hypha growth ---
  growSpeed: 140, // u/s the tip advances
  nodeSpacing: 16, // a network node is created every ~16 u of growth
  pathStep: 8, // resampling step of a drag path (cost is integrated over these segments)
  growTickEvery: 40, // grow-tick event every ~40 u grown
  minGrowLength: 6, // shorter commands are rejected
  originRingRadius: 30, // the starting spore has a few short hyphae around it

  // --- Links ---
  tipLinkRadius: 18, // node within this distance of an active root tip -> tree link
  linkEventCooldown: 1.2, // s: repeated `link` events for the same deposit are throttled (links are still made)
  maxLinksPerDeposit: 3, // extraction rate scales with links up to this many per deposit

  // --- Extraction (per link per second) ---
  waterPerLink: 1.4,
  mineralPerLink: 0.7,
  emptyRearm: 0.15, // a regenerating pocket re-arms its `deposit-empty` event after refilling this fraction

  // --- Pool (water and minerals are each capped at cap.pool; sugar has its own cap.sugar) ---
  poolBase: 40,
  poolPerLength: 0.04,
  sugarCapBase: 120,
  sugarCapPerLength: 0.05,
  sugarCapPerTreeStage: 40, // per stage of every linked tree (stage 0 counts 1)

  // --- Sugar upkeep and saprotrophic baseline ---
  upkeepPerLength: 0.0006, // sugar/s per u of hyphae
  upkeepSoftFloor: 8, // below this stock upkeep may not exceed upkeepFloorShare of income (no soft-lock)
  upkeepFloorShare: 0.5,
  sapBase: 0.35, // sugar/s: the spore itself decomposes litter
  sapPerLength: 0.0005, // plus per u of hyphae lying in litter and humus
  sapCap: 0.8,

  // --- Trees, by stage 0..3 (sapling, young, mature, ancient) ---
  treeDemandWater: [0.3, 0.5, 0.8, 1.2], // per s
  treeDemandMinerals: [0.12, 0.22, 0.35, 0.55],
  treePay: [0.7, 1.2, 1.9, 3.0], // sugar/s at full satisfaction and full contact
  treeGrowSeconds: [160, 240, 360], // seconds at full health to reach the next stage
  treeHealthTau: 15, // s, smoothing of health towards satisfaction
  treeSatWater: 0.6, // weight of water in satisfaction (minerals get the rest)
  treeGrowFromHealth: 0.3, // growth starts above this health, full speed at 1
  treeContactFactor: [0.6, 0.8, 1], // share of the sugar payout by number of root-tip contacts (1, 2, 3+)
  // Species of tree (world.trees[].species): grow x growth speed, drinkW / drinkM x water / mineral demand, pay x sugar payout by
  // stage 0..3. Birch races ahead but is thirsty and pays little when old; an oak is slow, yet an ancient one pays a fortune;
  // a pine sips water and wants minerals.
  species: {
    birch: { grow: 1.2, drinkW: 1.2, drinkM: 0.9, pay: [1, 1, 0.95, 0.9] },
    oak: { grow: 0.8, drinkW: 1.05, drinkM: 1.1, pay: [1, 1, 1.1, 1.5] },
    pine: { grow: 1, drinkW: 0.85, drinkM: 0.85, pay: [1, 1, 1.05, 1.1] },
  },
  // Glades (world.biome): worm x spawn rate, wormSpeed x crawl speed, water x extraction per link, minerals x extraction per link.
  // The soil itself differs too (src/world/biomes.js: pockets, rocks, deposits, regeneration).
  biomes: {
    birch: { worm: 1.35, wormSpeed: 1.12, water: 1.2, minerals: 0.9 }, // wet and lively
    oak: { worm: 1, wormSpeed: 1, water: 1, minerals: 1.1 }, // rich, slow
    pine: { worm: 0.8, wormSpeed: 0.95, water: 0.85, minerals: 1.35 }, // dry, stony, mineral
    mixed: { worm: 1, wormSpeed: 1, water: 1, minerals: 1 }, // balanced
  },

  // --- Mushrooms ---
  mushroomCost: 24,
  fruitMaxDepth: 45, // a node deeper than this below the surface cannot fruit
  fruitSpacing: 60, // no other mushroom within this distance
  mushroomGrowSeconds: 20, // when fully fed
  mushroomGrowFloor: 0.4, // growth speed multiplier of an unfed network (fed adds up to 1 - floor)
  mushroomGrowSugar: 0.2, // sugar/s drawn while growing
  mushroomMatureSugar: 0.04, // sugar/s drawn once mature
  sporeRate: 0.07, // spores/s of a mature mushroom at fed = 1 (multiplier 0.5 + 1.5 * fed)
  sporeEventEvery: 2.5, // s between `spores` burst events of one mushroom
  fedWater: 12, // pool stock considered "well fed"
  fedMinerals: 6,
  mushroomHeight: 30, // y offset above the ground where the `spores` event is emitted

  // --- Flows and thickening ---
  flowEvery: 0.4, // s between flow recomputations
  flowMinRate: 0.03,
  maxFlows: 80,
  edgeMaxW: 3,
  edgeLoadScale: 2.5, // w target = 1 + (maxW - 1) * (1 - exp(-load / scale))
  edgeThickenTau: 20, // s

  // --- Finds (world.decor items touched by a hypha node; rewards by rarity 1..4, see src/content/finds.js) ---
  findRadiusBase: 8, // a node within base + perScale * decor.scale of an item discovers it
  findRadiusPerScale: 10,
  findSugar: [4, 8, 14, 24], // one-off sugar (never above the sugar cap)
  findSpores: [0, 0, 1, 3], // one-off spores: rare finds only

  // --- Threats (everything below, up to «Objectives», applies only with state.flags.threats) ---
  // Nematodes: small soil worms that wander, graze on thin hyphae and cut them. A cut leaves the part of the network
  // beyond it dead (nothing reaches it from the spore). Busy cords (edge.w >= biteMaxW) are too tough to bite.
  wormGrace: 140, // s: no worms before this game time ...
  wormMinLength: 350, // ... nor before the network is this long (u of hyphae)
  wormFirst: 30, // worm-seconds until the first spawn (a countdown that runs at spawn rate x (1 + length / wormLenRef))
  wormSpawnEvery: 75, // s between spawns at the start; later spawns wait this x (0.7..1.3)
  wormLenRef: 1500, // spawn rate grows with the network: x (1 + hyphaeLength / wormLenRef)
  wormMax: 6, // most worms alive at once ...
  wormPerLength: 900, // ... 1 + hyphaeLength / this, up to wormMax
  wormSpawnDist: [150, 320], // u from a random hypha node
  wormLife: [85, 150], // s before a worm burrows away on its own
  wormLeaveSeconds: 2.5, // s a leaving worm takes to fade out
  wormEmergeSeconds: 1, // s a new worm takes to fade in
  wormLen: [44, 64], // body length, u
  wormSpeed: [17, 26], // u/s
  wormSense: 150, // u: a worm turns towards the nearest bitable hypha within this distance
  wormAttract: 1.25, // rad/s of turning towards it
  wormWander: 0.9, // rad/s of random turning
  wormTurnEvery: [0.8, 2.2], // s between new random turns
  wormHorizonSpeed: [0.7, 1, 1, 0.5, 0.3], // speed factor in litter, humus, loam, clay, gravel (they like moist humus and loam)
  wormDepthMin: 34, // u below the surface: worms stay in this band (steer back when outside it)
  wormDepthMax: 360,
  wormColdSpeed: 0.5, // speed factor in winter (seasons only)
  wormSeason: { spring: 1.1, summer: 1.6, autumn: 1.0, winter: 0.15 }, // spawn rate by season (seasons only)
  wormGrazer: 0.7, // share of worms that feed on hyphae; the rest only wander (and can still be caught for their nitrogen)
  wormMaxBites: 1, // a worm that has cut this many hyphae is full and leaves
  wormFullSeconds: 9, // s after a bite before the next one
  biteMaxW: 1.6, // edge.w below this is thin enough to bite
  biteReach: 9, // u from the hypha at which a worm bites
  biteSeconds: 2.8, // s of chewing before the hypha is cut (a trap or a thickened hypha stops it): the last chapter's value
  biteSecondsByChapter: [5, 3.4, 2.8], // ... by chapter: the first page chews slowly, so a ring (2.5 s to arm) is in time after the warning
  biteLead: 3, // s: a worm bites no sooner than this after its `worm-sense` (the warning always comes first)
  biteImmuneDist: 52, // u along the network from the spore: the first hyphae around it are never cut
  biteMinAge: 8, // s: hyphae younger than this are not bitten yet
  wormSnareSpeed: 46, // u/s a lured worm is drawn towards the ring
  wormSnareMax: 4, // s: the longest a lured worm takes to reach the ring

  // Traps: «ловчие кольца» of nematophagous fungi (Arthrobotrys): hyphal loops that lure and snare worms, which are
  // then digested for nitrogen.
  trapCost: 16, // sugar
  trapRadius: 60, // u: a worm within this distance of an armed ring is lured in
  trapSpacing: 46, // u: no other ring this close
  trapGrowSeconds: 2.5, // s until the ring is armed
  trapCharges: 3, // worms one ring can digest before it dies
  trapDigestSeconds: 14, // s after a catch during which the ring catches nothing
  trapMinerals: 8, // minerals (nitrogen) per worm, into the pool up to its cap

  // --- Pressure (threats only): the economy tightens so that sugar is a constraint all game long. Multipliers on the
  // numbers above; the saprotrophic floor stays, so a starved network can always recover.
  hard: {
    upkeep: 1, // x upkeepPerLength ...
    sprawl: 5000, // ... and then x (1 + hyphaeLength / sprawl): a big network costs more per u than a small one
    treePay: 0.85, // x treePay
    growCost: 1.15, // x the horizon cost of growing a hypha
    mushCost: 1.4, // x mushroomCost ...
    mushCount: 0.1, // ... and then x (1 + this per mushroom already standing): a crowd of fruit bodies shares one table
    mushGrowSugar: 1.3, // x mushroomGrowSugar
    mushMatureSugar: 2, // x mushroomMatureSugar
    sugarCap: 0.55, // x every sugar cap
    treeGrow: 0.7, // x the growth speed of trees
    sporeRate: 0.7, // x the spore release of mushrooms
  },
  // A network that cannot pay for itself dies back at the tips (unproductive twigs wither), so there is always a way out.
  starveSugar: 12, // sugar stock below this, not growing and barely gaining ...
  starveRate: 0.3, // ... (net sugar per second below this) for starveAfter seconds starts the dieback
  starveAfter: 30, // s
  starveEvery: 10, // s between dieback steps while it goes on

  // --- Chapters (threats only): the notebook turns the page after the five first observations ---
  chapterCount: 3,
  chapter2Finds: 4, // kinds of finds
  chapter2Worms: 5, // nematodes caught
  chapter2Spores: 500,
  chapter3Mushrooms: 8, // grown mushrooms at once
  chapter3Spores: 1500,
  // the glade's own observation on page 2 (see objectives.js): birch wet (a pool kept full), oak slow (every oak grown), pine stony (phosphorus), mixed (a mushroom under every species)
  glade: { birchWater: 55, holdSeconds: 30, pinePhosphorus: 2, mixedReach: 150 },
  winterSugar: 80, // sugar in hand when the winter ends (seasons on)
  reserveSugar: 120, // the same page without seasons: a stock of sugar

  // --- Objectives ---
  sporesGoal: 100,

  // --- Rates ---
  rateTau: 2, // s, smoothing of state.rates

  // --- Time (the clock always runs; the effects below apply only with state.flags.seasons) ---
  daySeconds: 100, // a day (3 per season)
  seasonSeconds: 300, // a year is 4 seasons = 20 game minutes at x1
  startDayFrac: 0.3, // a game starts in spring, shortly after sunrise (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset)
  daylightEdge: 0.45, // daylight = smoothstep over sin(sun) in +-this: dawn and dusk take ~15 s each
  photoFloor: 0.4, // tree sugar payout = x (photoFloor + (1 - photoFloor) * daylight)
  // The first minutes are gentle: the night floor starts at `floor` (a night pays almost like a day), holds for `until` s of game
  // time and then falls linearly to photoFloor over `fade` s, so a new player is not punished for the first dusk (at ~45 s).
  firstLight: { floor: 0.85, until: 240, fade: 120 },
  nightSpores: 0.3, // spore release is up to +30% at night (humid air)
  weatherLead: 20, // s at the start of every season without an episode
  weatherRampIn: 8, // s for an episode to reach its strength
  weatherRampOut: 10,
  droughtRegenCut: 0.9, // pocket regeneration x (1 - cut * intensity) in a drought
  droughtThirst: 0.4, // trees drink water x (1 + this * intensity) in a drought
  // Per season: multipliers and the weather episodes (kind, count per season, duration range in s, peak range).
  // pay: tree sugar; drinkW/drinkM: tree water/mineral demand; regen: water pocket regeneration; rain: extra regeneration
  // at full rain (x (1 + rain * intensity)); treeGrow, mushGrow: growth speed; spore: spore release; mushSugar: sugar
  // drawn by mature mushrooms; upkeep: hypha upkeep.
  seasons: {
    spring: { pay: 1.15, drinkW: 1, drinkM: 1, regen: 1, rain: 6, treeGrow: 1.1, mushGrow: 1, spore: 1, mushSugar: 1, upkeep: 1,
      weather: { kind: 'rain', count: 3, min: 25, max: 40, peakMin: 0.7, peakMax: 1 } },
    summer: { pay: 1.2, drinkW: 1.3, drinkM: 1, regen: 0.6, rain: 0, treeGrow: 1.1, mushGrow: 1, spore: 1, mushSugar: 1, upkeep: 1,
      weather: { kind: 'drought', count: 2, min: 50, max: 80, peakMin: 0.7, peakMax: 1 } },
    autumn: { pay: 0.95, drinkW: 0.9, drinkM: 0.9, regen: 1, rain: 2.5, treeGrow: 0.8, mushGrow: 1.8, spore: 3, mushSugar: 1, upkeep: 1,
      weather: { kind: 'rain', count: 2, min: 20, max: 35, peakMin: 0.5, peakMax: 0.9 } },
    winter: { pay: 0.2, drinkW: 0.3, drinkM: 0.3, regen: 0.5, rain: 0, treeGrow: 0.1, mushGrow: 0, spore: 0, mushSugar: 0.25, upkeep: 0.4,
      weather: { kind: 'snow', count: 3, min: 50, max: 75, peakMin: 0.6, peakMax: 1 } },
  },
};

/** Night floor of tree payout at game time t (see B.firstLight); plain photoFloor without a time. */
export function nightFloor(t) {
  const g = B.firstLight;
  if (t === undefined || t >= g.until + g.fade) return B.photoFloor;
  const k = Math.max(0, (t - g.until) / g.fade);
  return g.floor + (B.photoFloor - g.floor) * k;
}

/** Tree numbers of a species: { grow, drinkW, drinkM, pay } with pay for the tree's current stage. */
export function treeFx(tree) {
  const s = B.species[tree.species] ?? { grow: 1, drinkW: 1, drinkM: 1, pay: [1, 1, 1, 1] };
  return { grow: s.grow, drinkW: s.drinkW, drinkM: s.drinkM, pay: s.pay[tree.stage] };
}

/** The glade's multipliers (B.biomes); all 1 for an unknown biome. */
export const biomeFx = (world) => B.biomes[world.biome] ?? B.biomes.mixed;

/** The economy multipliers in force: B.hard with state.flags.threats, otherwise all 1. */
export const pressure = (state) => (state.flags.threats ? B.hard : NEUTRAL_HARD);

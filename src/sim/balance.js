// Every tunable gameplay number lives here. Units: world units (u), seconds (s), sugar/water/minerals/spores.
// Verified by the bot playthroughs in tests/sim.test.mjs and tests/seasons.test.mjs (all five objectives in 5-7 game minutes
// at x1 for the scripted bot, a human is expected to need about twice as long; with seasons on, by the end of spring or summer).

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

  // --- Objectives ---
  sporesGoal: 100,

  // --- Rates ---
  rateTau: 2, // s, smoothing of state.rates

  // --- Time (the clock always runs; the effects below apply only with state.flags.seasons) ---
  daySeconds: 100, // a day (3 per season)
  seasonSeconds: 300, // a year is 4 seasons = 20 game minutes at x1
  startDayFrac: 0.3, // a game starts in spring, shortly after sunrise (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset)
  daylightEdge: 0.45, // daylight = smoothstep over sin(sun) in +-this: dawn and dusk take ~15 s each
  photoFloor: 0.25, // tree sugar payout = x (photoFloor + (1 - photoFloor) * daylight)
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

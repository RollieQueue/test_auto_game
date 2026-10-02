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
  // The fungus the player is (state.flags.species, picked on the title page; src/sim/species.js): the sugar paid by its partner
  // tree species x `pay` (partner null: every tree), plus exactly ONE strength: grazer x the share of worms that bite (bitter
  // threads), spore x spore release of its mushrooms (big caps), minerals x mineral extraction per link (draws minerals),
  // rot x speed of the honey fungus's rot on its trees (tough threads). 'common' (an old save, no pick) changes nothing.
  fungi: {
    common: { partner: null, pay: 1, grazer: 1, spore: 1, minerals: 1, rot: 1 },
    fly_agaric: { partner: 'birch', pay: 1.3, grazer: 0.6 },
    porcini: { partner: 'oak', pay: 1.3, spore: 1.2 },
    saffron_milk_cap: { partner: 'pine', pay: 1.35, minerals: 1.3 },
    chanterelle: { partner: null, pay: 1.1, rot: 0.65 },
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
  fruitSpacing: 57, // ground a mushroom of cap size 1 keeps clear around it; a cap of size s claims fruitSpacing * s^fruitClaimPow
  fruitClaimPow: 1.6, // a big cap claims much more, a small one lets a neighbour stand close: groups and loners instead of a fence
  fruitSpacingMin: 34, // ... but never less than this
  fruitSpacingMax: 96, // ... or more than this
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

  // --- Feeding a tree («Подкормка», src/sim/feed.js) ---
  // The surplus sugar of a full pantry goes through the network to ONE chosen tree (after the mother trees of Simard). It flows
  // only from what lies above feedFrom x cap.sugar (and what the cap would throw away), at up to feedRate sugar/s.
  feedFrom: 0.8, // share of cap.sugar above which sugar may be given away; the stock is never pushed under it
  feedRate: 2, // sugar/s at most
  feedFlowMin: 0.05, // sugar/s from which the feeding shows on the scene (a golden flow along the network, a mark at the tree's foot)
  feedGrowSeconds: 0.5, // seconds of full-health growth one fed sugar buys (x the tree's own speed): at most 2x faster
  feedMantle: 0.03, // share of the gap to a full mantle one fed sugar closes (honey fungus on)

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

  // --- Rival (state.flags.rival, src/sim/rival.js): the honey fungus (Armillaria). Black rhizomorphs creep from old stumps
  // (later from lost trees) towards the trees most worth having, grip their roots and rot them; a thick cord stops a tip, a
  // barrier (key 4) withers whatever lies inside it. The player's mantle (how well a tree is fed) slows the rot.
  rivalWakeDelay: 45, // s after the notebook opens chapter 2 (?rival=1 wakes it at once), but ...
  rivalWakeBy: 420, // ... no later than this many s of play, whatever chapter the player is in
  rivalLateAutumn: 0.6, // from this share of autumn on (and in winter) the rival does not wake: it sleeps until spring (seasons only)
  rivalSeason: { spring: 1, summer: 0.55, autumn: 1.1, winter: 0 }, // tip speed by season (seasons only)
  rivalInfectSeason: { spring: 1, summer: 0.75, autumn: 1.15, winter: 0.15 }, // rot speed by season (seasons only)
  rivalSpeed: [5, 8], // u/s a tip grows at season 1
  rivalSpacing: [16, 24], // u between rhizomorph nodes (and so the length of a segment)
  rivalBranch: 0.02, // chance of a side branch at every new node (if tips and segments are left)
  rivalMaxSegments: 300, // alive edges
  rivalMaxTotal: 900, // nodes ever made (dead ones stay in the arrays); no growth beyond
  rivalMaxTips: 4,
  rivalStartTips: 2, // tips at the waking, and after a complete cut-back
  rivalTipEvery: 60, // s between new tips from the stumps and lost trees while there is room
  rivalRegrow: 45, // s: a rival cut right back (no tips, no segments) waits this long before it sends tips again
  rivalDepthMin: 10, // u below the surface: a tip never rises above this
  rivalLook: 24, // u: how far ahead a tip looks for rocks, the surface and thick cords
  rivalBlockW: 1.8, // a player edge at least this thick (a busy cord) stops a tip: it turns away or stalls
  rivalStallDie: 14, // s a tip may stand stalled (nowhere to go) before it gives up
  rivalNoProgress: 45, // s without getting nearer to its tree before a tip gives up
  rivalGripRadius: 18, // u: the contact radius to a root tip (the same as the player's tipLinkRadius)
  rivalGripAfter: 60, // s after the waking: no grip is made before ...
  rivalGripJitter: 30, // ... plus 0..this per starting tip (seeded), so the first grips do not come in step
  rivalReach: 250, // u: a grip goes to a linked tree, or to one with a player node this near the grip point (one the player can answer)
  rivalReachWeight: 0.25, // a tree the player cannot answer for yet is this much less wanted by a tip (and is not gripped at all)
  rivalGrace: 25, // s after a barrier that freed a tree has ended: no rhizomorph goes for that tree («ризоморфы отступили»)
  rivalTurnGap: 25, // s between two rival-turn events (a tip turning away from a thick cord)
  rivalEarlyRate: 0.5, // the rot runs at this share of its speed until the tree is 25 % rotted (time to see the grip and answer)
  rivalMaxGrips: 2, // grips on one tree
  rivalInfectSeconds: 290, // s from 0 to 1 for one grip at season 1 and no mantle, were it all at full speed: with the slow first quarter a loss takes 1.25 x this (6 min), two grips in autumn 3.5 min
  rivalExtraGrip: 0.5, // every further grip adds this share of the rate
  rivalHealSeconds: 240, // s from 1 to 0 for a free tree with no mantle
  rivalHealMantle: 2, // ... faster by (1 + this * mantle)
  rivalPayCut: 0.7, // the sugar a tree pays falls by this share at full infection
  rivalLastTree: 0.9, // the last living tree cannot be rotted beyond this (there is always a way on) until the stakes begin (B.stakes.fromChapter)
  rivalFruitInfection: 0.4, // autumn clusters appear at trees rotted this far
  rivalFruitRate: 0.04, // per second per such tree in autumn
  rivalFruit: [3, 7], // mushrooms in a cluster
  rivalOrphanSeconds: 6, // s a rhizomorph cut off from its source takes to wither away
  rivalTwigAge: 150, // s: a dead-end twig (no tip, no grip) this old withers away on its own
  rivalCutFreed: 2, // page 2: trees freed from the rival by barriers ...
  rivalCutGoal: 15, // ... or segments cut by barriers (either completes it)
  mantleTau: 40, // s: the mantle follows how well the tree is fed (and how many roots touch it) with this smoothing
  mantleProtect: 0.75, // rot speed x (1 - this * mantle)
  mantleGoal: 0.5, // page 3: every living tree has at least this much mantle
  barrierCost: 20, // sugar, plus barrierCostStep for every barrier standing
  barrierCostStep: 10,
  barrierRadius: 85, // u around the node it is placed on
  barrierDur: 40, // s
  barrierMax: 3,
  barrierWither: 3, // s a rhizomorph edge inside a barrier takes to wither
  // A barrier is a choice (rival.js barredNodes / treeBarred): inside its ring, while it stands, the player's hyphae do not grow
  // (growth.js), carry no flow and do not thicken (flows.js), and a tree whose EVERY root contact lies inside pays nothing.
  // Raider (rival.js stepRaid; state.rival.over, tip.raid): from the waking, one new tip in B.rivalRaidEvery goes for the player's NETWORK
  // instead of a tree. A black cord creeps to the nearest thin hypha, overgrows it (it blackens and withers for B.rivalRaidWither s,
  // then it is cut like a worm bite) and runs on along thin edges towards the spore; a thick cord (w >= rivalBlockW), a barrier, the
  // hyphae round the spore (biteImmuneDist) or its reach stop it. A barrier kills it and heals what it has overgrown inside.
  rivalRaidEvery: 3, // every this-th new tip (not the starting ones, not side branches) is a raider
  rivalRaidMax: 1, // raiders alive at once
  rivalRaidMinDist: 60, // u: a raider starts only from a source at least this far from the nearest thin hypha, else the tip is a plain one
  rivalRaidLead: 12, // s a new raider stands at its source before it creeps (rival-raid-seek is sent at once): the player is warned
  rivalRaidSpeed: 14, // u/s along the player's hyphae once it has touched them
  rivalRaidReach: 8, // edges one raider overgrows after the first touch
  rivalRaidWither: 8, // s from the touch to the cut of an overgrown edge
  rivalRaidTouch: 14, // u: a raider this near a thin hypha has touched it
  rivalRaidSense: 520, // u: how far from the tip a thin hypha draws it
  rivalRaidWarn: 220, // u: a raider this near its hypha is announced (rival-raid-seek, once per raider)

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

  // --- Stakes (threats only, sim/stakes.js): the year's grade and the fair loss «страница закрыта». A page closes when every tree
  // of the glade is lost, or when the network has had no living ally (a non-lost tree with a root contact) for noAllySeconds
  // while no hypha was growing. Never before chapter `fromChapter`: page 1 is for learning. From that chapter the honey fungus may rot
  // the last tree too (B.rivalLastTree no longer holds). noAllySeconds: a tip crosses the whole glade (1920 u) in ~14 s at growSpeed,
  // so 90 s is time to see the slip, afford a hypha (the saprotrophic floor pays ~0.35 sugar/s) and reach a root; the clock stands while a hypha grows. ---
  stakes: {
    fromChapter: 2,
    noAllySeconds: 90,
    noAllyShow: 3, // s without an ally before the slip with the countdown appears (a link lost and relinked at once shows nothing)
    lastTreeShow: 0.5, // the slip about the last living tree appears at this infection
    // the grade of a year, 0..100 points: the maximum of every part; a part that does not apply (no rival) leaves the sum
    // and the scale out (the score is the share of what could be earned). sporesYear: spores in one year for the full spores points.
    max: { alive: 20, allies: 10, growth: 20, spores: 20, mushrooms: 5, pages: 15, rival: 10 },
    sporesYear: 800,
    growthFull: 0.6, // tree stages gained in the year, per tree, for the full growth points
    mushroomsFull: 6, // grown mushrooms for the full 5 points
    cuts: [40, 62, 82], // score (in %) where «fair», «good» and «great» begin; below the first is «poor»
    lostCap: 'fair', // the best grade of a year in which a tree was lost
  },
  // --- Chapters (threats only): the notebook turns the page after the five first observations ---
  chapterCount: 4, // pages of the notebook: 1 first threads, 2 the alarm, 3 the long look, 4 the harvest of spores (<= 5 observations each)
  chapter2Finds: 4, // kinds of finds
  chapter2Worms: 5, // nematodes caught
  chapter2Spores: 500,
  chapter3Mushrooms: 8, // grown mushrooms at once
  chapter3Spores: 1500,
  // the glade's own observation on page 3 (see objectives.js): birch wet (a pool kept full), oak slow (every oak grown), pine stony (phosphorus), mixed (a mushroom under every species)
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
  startDayFrac: 0.3, // the old start of the day, kept for saves made before the long first morning (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset)
  newGameStart: 0.27, // a new game starts in spring at first light...
  newGameDusk: 80, // ...and its first daytime lasts this many game seconds (the first dusk), then days are daySeconds long; stored in state.flags.firstDusk
  daylightEdge: 0.45, // daylight = smoothstep over sin(sun) in +-this: dawn and dusk take ~15 s each
  photoFloor: 0.4, // tree sugar payout = x (photoFloor + (1 - photoFloor) * daylight)
  // The first minutes are gentle: the night floor starts at `floor` (a night pays almost like a day), holds for `until` s of game
  // time and then falls linearly to photoFloor over `fade` s, so a new player is not punished for the first dusk (at 80 s, B.newGameDusk).
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

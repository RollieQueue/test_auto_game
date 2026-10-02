# Architecture and module contract

Vanilla JavaScript ES modules, Canvas 2D for the scene, DOM for the HUD, WebAudio for sound.
**No dependencies, no build step.** The game is served as static files (`node tools/serve.mjs`,
or `start.bat` on Windows) because browsers refuse ES modules from `file://`.

## Run, test, look

- Run: `node tools/serve.mjs` (opens the browser; `--port N`, `--no-open`). Default port 5173.
- Test: `npm test` (= `node --test tests/*.test.mjs`). Only `src/core`, `src/world`, `src/sim` are
  Node-testable (they must never touch the DOM).
- Build: `npm run build` writes `dist/roots-and-threads.html`, the whole game in one file that runs from
  `file://` (see `tools/build/README.md`). To stay bundleable, code must keep module references as literal
  relative strings ending in `.js`, check `typeof Worker !== 'undefined'` before creating workers (the
  bundle has none and takes the main-thread path), and load assets with `fetch('assets/…')`, `Image.src` or
  `new URL(…, import.meta.url)`.
- URL params: `?seed=123` fixes the world, `?autostart=1` skips the title screen, `?debug=1` for debug overlays.
- `window.__game` exposes `{ state, view, sim, actions, renderer, hud, audio }` for browser automation.
- `actions` (src/main.js, passed to the HUD): `start()`, `togglePause()`, `setSpeed(1|2)`, `setTool('grow'|'fruit'|'trap'|'barrier')`,
  `cancelDrag()`, `restart(seed?)`, `setMuted(bool)`, `isMuted()`, `hasSave()`, `continueSaved()` (loads the saved
  game and plays it; returns false when there is none), `setVolume(0..1)`, `setReducedMotion(bool)`. Keyboard shortcuts live in the UI task.
- Settings of the pause page (src/ui/settings.js; localStorage `roots-threads.settings.volume` / `.reduceMotion`, the
  latter defaulting to `prefers-reduced-motion`) are applied at boot and on change: `audio.setVolume(v)` sets the master
  gain (0.9·v²; `M` still mutes), `render/motion.js` `reducedMotion()` is read by the renderer to stop sway, falling
  leaves, clouds, rain/snow, twinkles, the season wash, sparks and flashes. The sim never reads either.
- Seasons with day/night (`state.flags.seasons`) and soil threats (`state.flags.threats`) are on in the game by
  default; `?seasons=0` / `?threats=0` turn them off. The honey-fungus rival (`state.flags.rival`) rides with the threats;
  `?rival=0` turns it off, `?rival=1` wakes it at once. Tests that build a state with `createState` get both off
  unless they set the flags.
- The player's fungus, `state.flags.species`: `fly_agaric` | `porcini` | `saffron_milk_cap` | `chanterelle`, anything
  else (an old save, a test state) plays as `'common'` and changes nothing. main.js sets it in newState() from
  `?species=`, else the last title pick (localStorage `roots-threads.species`), else the glade's matching species
  (`matchingFungus`, chanterelle on a mixed glade); `actions.setSpecies(id)` changes it only on the title page.
  Numbers in `B.fungi` (partner tree species, partner `pay`, and ONE of `grazer` / `spore` / `minerals` / `rot`);
  src/sim/species.js has `fungusFx`, `partnerPay`, `matchingFungus`. economy.js multiplies partner pay and mineral
  extraction, mushrooms.js the spores (`mushroom.species` is set at planting), threats.js the grazer share of new worms,
  rival.js the rot speed. The title picker is src/ui/species.js (cards built with createElement + `.src`, so the dist
  shim serves the images); its pure parts are in src/ui/species-logic.js.
- Browser checks: `node tools/shot.mjs` drives headless Edge/Chrome over the DevTools protocol with no
  dependencies; it starts its own server for a `/path` URL and runs actions in order, e.g.
  `node tools/shot.mjs --url "/?autostart=1&seed=7" --wait 1000 --drag 717,297,760,380 --wait 2000
  --eval "__game.state.res" --shot .tmp/a.png` (also `--click`, `--key`, `--clip`, `--size`, `--dpr`; see
  its header). Console errors and exceptions are printed and make the exit code 1.
  `--eval-file tools/scenarios/fast-forward.js` lets the balance bot play the seed headless for
  `window.__ffSeconds` game seconds first, to look at mid- and late-game scenes without waiting.
- Screenshots: start the server, then use the Playwright MCP tools if you have them, otherwise
  headless Edge/Chrome, e.g.
  `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu
  --hide-scrollbars --window-size=1600,900 --screenshot=C:\abs\shot.png "http://127.0.0.1:5173/?autostart=1&seed=7"`
  and open the PNG with your image-reading tool. Put scratch screenshots in `.tmp/` (ignored).
  Parallel helpers use distinct ports: 5174 render, 5175 ui/audio, 5176 sim, 5177 art gallery.

## Modules and ownership

| Path | Owner task | Purpose |
|---|---|---|
| `index.html`, `style.css`, `src/main.js`, `src/state.js`, `src/config.js`, `src/core/*` | root | bootstrap, loop, shared utils, contract |
| `src/world/*` | sim | world generation (pure data) and spatial queries |
| `src/sim/*`, `src/input/*` | sim | rules, economy, commands, pointer input |
| `src/render/*` | render | all canvas drawing; owns its caches and particles |
| `src/ui/*` (incl. `hud.css`), `src/audio/*`, `assets/fonts/*` | ui | DOM HUD, menus, keyboard shortcuts, sound |
| `tools/artgen/*`, `assets/art/*` | art | image generation and cutout pipeline, illustrated assets |
| `src/persist.js` | persistence | save/load in localStorage (`hasSave`, `loadSave`, `saveNow`, `clearSave`, `tick`) |
| `src/content/*` | root | shared game texts and data (e.g. naturalist notes on finds), pure data |

Do not edit files owned by another task. If the contract must change, say so in your report:
root integrates it. You may *add* new files inside your own directories freely.

## Frame loop (src/main.js)

```
each animation frame (dtReal ≤ 0.1 s):
  if state.phase === 'playing': run sim.updateSim(state, 1/60) zero or more times
      (accumulator × state.speed, max 8 steps), state.time += 1/60 per step
  persist.tick(state, dtReal)          // while playing: throttled autosave
  renderer.draw(state, view, dtReal)   // may read state.events
  hud.update(state, dtReal, view)      // may read state.events; view maps world to CSS px
  audio.update(state, dtReal)          // may read state.events
  state.events.length = 0              // events live exactly one frame
```

Restart replaces `game.state` with a fresh object: modules must take `state` as an argument
each call (renderer: rebuild caches when `state.world` changes identity).

## Coordinates

World units, 1920 × 1080, y grows downward. The view fits the world into the window
(letterboxed): `screen = (world * view.scale + view.ox, world * view.scale + view.oy)` in CSS px;
the canvas backing store is CSS size × `view.dpr`. `view = { scale, ox, oy, cssW, cssH, dpr }`.

## State schema (created by `src/state.js`, filled by `sim.initSim`)

```js
state = {
  seed, time /* sim seconds */, speed /* 1 | 2 */, phase /* 'title' | 'playing' | 'paused' */,
  world: World, net: Network,
  res:   { sugar, water, minerals, spores },          // current amounts (floats)
  rates: { sugar, water, minerals, spores },          // net change per second, smoothed (for HUD)
  cap:   { pool, sugar },                             // water and minerals are each capped at pool; sugar at sugar
  flows: Flow[],          // what moves through the network now (for visuals and sound)
  mushrooms: Mushroom[],
  objectives: Objective[],
  flags: { allObjectivesDone: false },
  events: GameEvent[],
  ui: {
    tool: 'grow' | 'fruit' | 'trap' | 'barrier',
    pointer: { x, y, sx, sy, inside } | null,   // world + CSS-pixel position of the mouse
    hoverNode: nodeId | null,
    hoverTarget: { kind: 'water'|'mineral'|'tree'|'rock'|'mushroom'|'horizon', id } | null,
    drag: { from: nodeId, points: [{x,y}] } | null,       // raw pointer path while dragging
    preview: Preview | null,                               // sim.estimateGrowth of the drag
  },
  stats: { hyphaeLength, maxDepth },
}
```

### World (`src/world/generate.js`, deterministic from `seed`)

```js
World = {
  seed, width: 1920, height: 1080, step: 16,      // profiles sampled every `step` from x = 0
  ground: number[],                               // surface y per sample
  horizons: [{ id, name, depth, cost, color, top: number[] }],  // top: absolute y per sample; horizons[0].top === ground values
  rocks:    [{ id, x, y, poly: [{x,y}], minX, minY, maxX, maxY }],        // impassable
  water:    [{ id, x, y, rx, ry, amount, max, regen }],                    // ellipse pockets
  minerals: [{ id, x, y, r, amount, max, kind: 'phosphorus' | 'nitrogen' }],
  trees:    [Tree],
  decor:    [{ id, type, x, y, rot, scale }],   // purely visual curiosities (acorn, shell, bone, potsherd, ammonite, pebble, snail, beetle, seed, leaf, twig)
  origin:   { x, y },                            // where the spore germinated
  stumps:   [{ id, x, y, r }],                   // the honey fungus' seats (see Rival)
  gen:      1 | 2,                               // the world generator version the glade was built with (see Glades)
  fallback?: string[],                           // only when no build of generator 2 was fair: the rules it breaks (never on seeds 1..300)
}
Tree = {
  id, species: 'birch' | 'oak' | 'pine', name, x /* trunk base */, baseY,
  stage: 0..3 /* sapling, young, mature, ancient */, growth: 0..1 /* progress to next stage */,
  health: 0..1 /* satisfaction, smoothed */, linked: boolean, crownSeed,
  roots: [{ points: [{x,y}], width, minStage }],   // a root exists once tree.stage >= minStage
  tips:  [{ x, y, minStage }],                     // fine-root contact zones (radius 18)
}
```
Spatial queries live in `src/world/query.js`: `groundYAt`, `horizonIndexAt`, `rockAt`, `costAt`, `isPassable`.

### Network

```js
Network = {
  nodes: [{ id, x, y, born, alive, parent, dist }], // id === index; never spliced, only marked dead.
                                               // parent: next node towards the origin (-1 for the origin),
                                               // dist: length along the network to the origin
  edges: [{ id, a, b, len, born, alive, w }],  // w: thickness factor (1 = fine hypha; busy cords get thicker)
  links: [{ nodeId, kind: 'water'|'mineral'|'tree', targetId, born }],
  growing: [{ id, from, path: [{x,y}], grown, total, lastNode, tip: {x,y} }],  // hyphae growing right now
  originId,
  version,   // incremented whenever nodes, edges, alive flags or w change (renderers cache by it)
}
Flow = { from: nodeId, to: nodeId, kind: 'water' | 'mineral' | 'sugar', rate, path: nodeId[] }
     // path: node ids along the network from `from` to `to` inclusive (walk parents to the common ancestor)
Mushroom = { id, nodeId, x, baseY, species /* 'common' in MVP */, variant /* int, visual variety */,
             age, growth: 0..1, mature, spores }
Objective = { id, text, done }
Preview = { from, points: [{x,y}] /* reachable part */, blocked: {x,y} | null, length, cost, affordable }
```

## Sim API (`src/sim/index.js`)

```js
initSim(state)                       // starting resources, origin node + first hyphae, objectives
updateSim(state, dt)                 // one fixed step: growth, extraction, trees, mushrooms, objectives, events
pickNode(state, x, y, radius = 22)   // nearest alive node id or null
estimateGrowth(state, fromId, points)// Preview
commandGrow(state, fromId, points)   // queue a growing hypha; returns boolean
canFruit(state, nodeId)              // node close enough to the surface and free
commandFruit(state, nodeId)          // plant a mushroom; returns boolean
```

## Events (`state.events`, one frame)

```js
{ type: 'grow-start', x, y } | { type: 'grow-tick', x, y } | { type: 'grow-end', x, y }
{ type: 'link', kind: 'water'|'mineral'|'tree', targetId, x, y }
{ type: 'tree-stage', treeId, stage, x, y }
{ type: 'mushroom-planted', id, x, y } | { type: 'mushroom-mature', id, x, y }
{ type: 'spores', id, amount, x, y }
{ type: 'objective', id, text }
{ type: 'all-objectives' }
{ type: 'insufficient', x, y }        // not enough sugar for even a short hypha
{ type: 'insufficient', x, y, partial: true, got, want }  // the hypha grew only `got` of `want` u (sugar ran out)
{ type: 'deposit-empty', kind, id, x, y }
```

## Time and seasons (the sim keeps the clock always, effects only when `state.flags.seasons`)

```js
state.clock = {
  day,          // whole days since the start (0-based)
  dayFrac,      // 0..1 within the day: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset
  daylight,     // 0..1 smooth light level (renderer tints the scene, sim scales photosynthesis)
  season,       // 'spring' | 'summer' | 'autumn' | 'winter' (a game starts in spring, morning)
  seasonIndex,  // 0..3
  seasonFrac,   // 0..1 progress through the current season
  year,         // 0-based; a year is one full run
}
state.weather = { kind: 'clear' | 'rain' | 'drought' | 'snow', intensity /* 0..1 */ }
// events: { type: 'dawn' } | { type: 'dusk' } | { type: 'season', season } | { type: 'weather', kind }
//         | { type: 'year-end', year }   (then state.flags.yearDone = true; play may continue)
```

The day count (`clockAt(t, firstDusk)` in src/sim/clock.js): a new game records `state.flags.firstDusk = B.newGameDusk`
(80 s), starts at first light (`B.newGameStart`, dayFrac 0.27) and stretches its first morning so the first dusk comes at
80 s; later days last `B.daySeconds`. A save without the flag (made before this) keeps the old clock: dayFrac
`B.startDayFrac + t / B.daySeconds` (decodeState drops the fresh state's flag before applying the saved flags).
Seasons, weather and the night pay floor are keyed to game time `t`, not to the day count.

Season rules (numbers in `src/sim/balance.js`): spring rains refill water pockets, summer drought slows
regeneration and makes trees thirstier, autumn fruiting (mushrooms grow faster, spores ×3), winter dormancy
(trees neither pay nor drink much, mushrooms do not grow, upkeep drops). Photosynthesis follows daylight.

## Finds

A hypha node that comes within `8 + 10 * decor.scale` units of a `world.decor` item discovers it:
`state.finds[decor.id] = { kind: decor.type, at: state.time }` and the event
`{ type: 'find', id: decor.id, kind: decor.type, x, y }`. Names, notes and rarity per kind come from
`src/content/finds.js`; the HUD shows them on an «Атлас находок» page, the renderer marks found items.

## HUD layout rules

- `hud.js` `cardRects()` is the one avoid list of floating labels and the cursor tooltip: `.res-card`, `.obj-card`
  (the size it settles at, not the half-open frame), `.tools`, `.stamps`. `placeTip(..., keepOut)` (tip-logic.js)
  slides the tooltip to the nearest free spot; a resources-row tooltip beside its own row is exempt.
- Margin notes: at a window height ≤ 720 px at most 2 are visible (a newer note cuts older ones to 2.4 s, fades take
  0.5 s); the stack slides sideways through the CSS variable `--notes-dx` to cover fewer crowns and mushrooms and
  re-picks its spot only while empty.
- A sugar refusal for a mushroom, ring or barrier suppresses the plain «не хватает сахара» of the same click
  (within 60 u; `sugarDenialSpots` in labels-logic.js).
- The objectives card folds on `rival-wake` and stays folded 12 s (`OBJ_QUIET_WAKE`), so the stump and the wake label
  show. An open card that would cover the rival's stump (`stumpsUnder`, `openCardRect` in cards-logic.js) folds after
  2 s instead of 8 s; hovering the folded header still opens it.
- Mushroom clumps: the seeded layout of the 1–3 caps is src/world/clump.js (`clusterOf`, `clumpCaps`, `clumpBox`, `clumpHit`;
  render/mushroom-cluster.js re-exports it). query.js `targetAt` finds a mushroom by any of its caps (the nearest stalk wins) and
  cards-logic.js `mushroomBox` covers the whole clump.

## Margin marks (achievements)

«Пометки на полях»: 14 achievements, kept per player across games, shown on the atlas's second tab.
- `src/ui/marks-logic.js` (pure): `MARKS` (id, kind `game` | `life`, icon, title, line, cond) and
  `checkMarks(state, events, tracker, memory, kinds)` → the ids earned this frame. `tracker` (`newTracker()`) is
  per game and resets on a new state; a continued save starts a fresh tracker. `memory` is the store's lifetime
  part; `kinds` are the atlas store's lifetime find counts.
- `src/ui/marks-store.js`: localStorage key `roots-threads.marks.v1` = `{ v: 1, earned: { id: { at, glade } }, species[],
  biomes[] }`; a missing or broken storage falls back to a session-only copy (like `atlas-store.js`).
- `src/ui/marks.js`: `createMarks({ notes, atlasStore })` → `update(state, dt)` (called by hud.js every frame after
  `updateRival`), the earned note «Пометка на полях: «…»» (one per 3.2 s), and the tab HTML for `atlas.js`
  (`createAtlas(page, store, marks)`; tab keys ← → and M while the atlas is open).
- Events the marks read: `mushroom-mature`, `worm-spawn`, `worm-caught`, `severed` (with its cause), `tree-lost`,
  `tree-freed`, `rival-grip`, `season`, `year-end`, `all-objectives`. Renaming one of them silently breaks a mark:
  `tests/marks.test.mjs` covers each.

## Glades (src/world/biomes.js, fairness.js)

`world.biome` is one of `birch | oak | pine | mixed` and `world.name` a generated Russian glade name
(«Дубрава у оврага»). The name is a base, an optional landmark (88 %, e.g. «у ручья») and the ground phrase, drawn
by `gladeName(rng, biome, terrain)` from its own `createRng(hash32(seed, 'name'))`; the identity generator still
burns its 2 old draws, so ground and soil of every seed are unchanged (279 distinct names in seeds 1–300).
`main.js` `restart()` re-rolls a random new glade once when its biome equals the previous one, and
`actions.savedGlade()` gives the title the saved glade's seed and name («Сохранённая поляна: …»). Biomes weight tree species and set horizon depths, rocks, water and minerals; terrain
features vary the ground line. A glade has 2–5 trees (not always three) and the spore starts anywhere across
the width; `fairness.js` guarantees an affordable opening (water, a root tip, nitrogen) for every seed.

**World generator versions** (`world.gen`, `GEN`/`GENERATIONS` in generate.js; `generateWorld(seed, gen = GEN)`,
`createState(seed, gen = GEN)`). Generator 1 is every game before «Старт с задачкой»: a root tip could lie right at the
spore (nearest active tip 59–250 u, median 87) and the first link was a free handshake. Generator 2 (`GEN`, every new
game, «Новая поляна» too) hands nothing over: the nearest active root tip lies **160–250 u** from the spore (stats on
seeds 1–300: min 160.2, median 205, max 248), in a wide clearing (`FAIR_V2.clearHalf` 400: no trunk within 400 u of its
heart), and the opening is judged by real routes (`route.js`: the cheapest hypha around rocks at the horizon prices, times
`B.hard.growCost` 1.15) against the purse of a real game (70 sugar: the pressured economy's sugar cap cuts `startSugar`
100 on the first tick): the first tree costs at most 60 % of it (42), the starter water at most 45 %, both at most 90 %
(`FAIR_V2`, pinned to the balance by tests/world-gen2.test.mjs). Water and nitrogen are nearer than in generator 1. The
first move is a choice: a boulder (`rock.boulder`, one at most, 40–70 % of the glades by biome) lies on the way to the
nearest tip in about a third of them, the spore prefers spots where a second tree is about as near («which tree
first?»), and water costs about as much as the tree («water first or the tree first?»). Stumps stand in sight in every
glade (x ≤ 1450, STUMP.seen): the spore leaves them a seat and a build without one is built again (80 → 160 attempts); if
none of 160 builds is fair the best one plays with `world.fallback` naming the broken rules. Generator 2 keeps the identity
of a seed (biome, terrain, name, ground, soil horizons); trees, rocks, spore, deposits, decor and stumps differ.
**Saves**: `encodeState` writes `gen`; a payload **without** `gen` is a generator-1 save and rebuilds its glade with exactly
the v1 rules (the v1 code path is untouched: same rng draws, same fingerprint `wf`, same trees, stumps and pockets;
tests/fixtures/save-gen1-*.json were written by the code before the version existed); an unknown `gen` is refused
(`save: world generator`). `SAVE_VERSION` stays 1 — the field is optional and an older build that meets a `gen: 2` save
rebuilds the v1 glade of that seed, finds another fingerprint and refuses it. `?gen=1` in the URL builds v1 glades (debug).

Each biome has its own soil (`look` in biomes.js, pure render data): pine a podzol (needle litter, ash-grey E horizon,
rusty B with rust tongues, sand, quartz and flint), oak thick black humus with worm casts, krotovinas and white
carbonate nodules, birch gley mottles with rust rims and damp patches, mixed brown forest soil with charcoal lenses.
`render/soil-look.js` lays the features out with its own rng from the world seed (the generated world is unchanged),
`render/soil-paint.js` and `terrain.js` paint them into the cached world plate (no per-frame cost).

Glades also differ in play: `B.biomes` (src/sim/balance.js) sets worm spawn rate and speed and the water and
mineral draw per link (birch wet and worm-heavy, pine dry and mineral-rich, oak rich, mixed neutral), and
`B.species` sets each tree species' growth, thirst and pay by stage (an ancient oak pays 1.5x). Page 2 of the
notebook gets one observation of the glade's biome (`gladeBirch|gladeOak|gladePine|gladeMixed`,
`createObjectives(chapter, seasons, biome)`; the birch one counts `state.sim.holdT`, a saved field). The first
nights are mild: `B.firstLight` keeps the night pay floor at 0.85 for the first 240 s (then `photoFloor` 0.4).

## Threats and chapters (`state.flags.threats`)

```js
state.fauna = Worm[]   // { id, x, y, a, len, speed, phase, age, mode: 'wander'|'bite'|'snared'|'leave', fade,
                       //   bite: null | { edge, x, y, t, dur }, trapId, ...internal }
state.traps = Trap[]   // «ловчие кольца»: { id, nodeId, x, y, r, grow 0..1, charges, cool, glow, age, prey }
state.ui.tool          // 'grow' | 'fruit' | 'trap'; while 'trap', state.ui.trapPick = null | { nodeId, x, y, ok, reason }
state.chapter          // 1..4 (B.chapterCount); state.objectives is always the current page; flags.pagesDone, flags.bookDone
state.sim.pageBase     // { chapter, freed, cut, caught }: the rival and worm counters when the page opened (objectives.js openPage)
```

Pages (src/sim/objectives.js `pageObjectives`): at most five a page, from quick to slow. Page 1 water, tree, mushroom, treeGrow,
100 spores; page 2 allies, finds, gravel, worms, `rivalCut`; page 3 the glade goal, ancient, 8 mushrooms, winter or reserve,
`rivalGuard`; page 4 «Урожайный год» 500 and 1500 spores. `COUNTS` / `objectiveCount(state, id)` give `[have, need, unit?]`
for the HUD line (trees-logic.js `objectiveProgress`: «· 212/500»); `pageCounts(state)` counts `rivalCut` and `worms` from the
page opening. A save keeps ticks by id; a book closed under the old three pages opens page 4.

Feeding a tree (src/sim/feed.js, tool 5 «Подкормка», `B.feed*`): `state.feed = null | { treeId, rate }` (only `treeId` is saved, as
`payload.feed`). `stepEconomy` hands the stock before the cap clamp to `stepFeed`; only what lies above `B.feedFrom` × cap.sugar
moves, at up to `B.feedRate` sugar/s, into the tree's growth (`B.feedGrowSeconds` per sugar) and, with the rival on, its mantle
(`B.feedMantle`). A tree that needs nothing takes nothing; a frozen tree (under a barrier) waits. API `commandFeed(state, treeId)`
('on' | 'switch' | 'off' | false), `feedDenial`, `canFeedAny`. Events `feed-start`, `feed-stop {reason: 'player'|'lost'|'unlinked'}`,
`feed-denied`. UI: src/ui/feed.js (tab, tooltip line, notes), resources-logic.js (where the surplus goes).

Stakes (src/sim/stakes.js, numbers `B.stakes`; text in src/ui/year-logic.js; all of it in `state.flags`, so a save needs no new
field): at every `year-end` the sim stores `flags.yearGrades` (the grade of the year: parts, score 0..100, grade
`poor|fair|good|great`) and moves `flags.yearSnap` (the counters «this year» is measured from). From chapter 2 on, with threats,
`page-closed { cause }` fires and `flags.pageClosed = { cause: 'grove' | 'allies', time, year, chapter }` is set when every tree is
lost, or when no living tree has had a root contact for `B.stakes.noAllySeconds` of game time with no hypha growing
(`flags.noAlly` counts it). `updateSim` does nothing while `flags.pageClosed` is set; the HUD asks the state (not the event), so a
reloaded closed game shows the closed page again (buttons `retry` = same seed and fungus, `restart` = a new glade). From chapter 2
the honey fungus may rot the last tree through (`B.rivalLastTree` holds only in page 1).

Nematodes spawn as the network grows (more in summer, few in winter) and bite thin hyphae (`edge.w < 1.6`; the
first 52 u around the spore and hyphae younger than 8 s are immune). A cut kills the whole branch beyond it:
nodes and edges get `alive = false`, links, flows, growing tips, mushrooms and rings on it are dropped. A ring
(`commandTrap`, `canTrap`, `trapDenial`, `pickTrapNode`; cost `B.trapCost`) lures worms within `B.trapRadius`
and digests them for minerals, a few times. A starving network sheds unproductive twigs (`severed` with
`cause: 'starved'`). With threats on, sugar is tighter (`B` in balance.js; `sim.mushroomCost(state)` gives the
current mushroom price).

Events: `worm-spawn`, `worm-sense`, `worm-gone`, `bite`, `bite-abort`, `severed {x, y, lost, nodes, links,
mushrooms, cut, edges, cause}`, `worm-caught {x, y, trapId, wormId, minerals}`, `trap-placed`, `trap-ready`,
`trap-spent {lost?}`, `trap-denied {reason: 'sugar'|'crowded'|'dead'}`, `mushroom-wilted`,
`all-objectives {chapter}`, `chapter {chapter}`. Chapter titles: `CHAPTER_TITLES` in src/sim/objectives.js.
A worm bites no sooner than 3 s after its `worm-sense`, and a bite lasts 5 / 3.4 / 2.8 s in chapters 1 / 2 / 3,
so the warning (a red «!» over the worm, a dashed line to its target, a cue and a note) leaves time for a ring.

## Rival: honey fungus (`state.flags.rival`)

Biology: honey fungus (Armillaria) spreads by black rhizomorphs from an old stump, grips the roots of trees and
rots them. Mycorrhiza protects its partners (a mantle around the root tips), and antagonism keeps the rival away.
The flag is on together with threats; `?rival=0` turns it off, `?rival=1` turns it on and wakes it at once (tests,
screenshots): `state.flags.rival` is `false`, `true` (wakes at min(chapter 2 + `B.rivalWakeDelay`, `B.rivalWakeBy` = 420 s of
play); with seasons a wake that falls from `B.rivalLateAutumn` (0.6) of autumn on, or in winter, waits for spring:
`rival.dormant`, one `rival-dormant` event) or `'now'`.
Code: `src/sim/rival.js` (the whole rival, barriers included), `economy.js` (pay cut, mantle), `objectives.js`.

```js
world.stumps = Stump[]  // { id, x, y, r } 1–2 old stumps at the surface, deterministic per seed; fairness: ≥ 260 u
                        // from the spore, ≥ 140 u from any trunk (src/world/fairness.js stumpProblems). They stand
                        // where no HUD card hides them (STUMP.seen: world x 420–700 or 1220–1450; at 1280×720 the
                        // resource card covers x < ~372 and the open objectives card x > ~1479). Generator 1: about a
                        // third of the glades (120 of seeds 1–300) have no such spot and use the whole right band, then
                        // the left (the objectives card folds on the wake). Generator 2: always in sight, x ≤ 1450.
state.rival = null | {  // created by the first step with the flag; null while the flag is off
  awake, dormant,       // the wake rule above; dormant: the wake fell in late autumn or winter, it waits for spring
  nodes:    [{ id, x, y, alive, born }],
  edges:    [{ id, a, b, w, alive, born, wither }],  // a is towards the source; wither 0..1 while a barrier dissolves it;
                                                     // alive=false at 1. Extra: orphan (cut off from its source, withers away),
                                                     // cut (the barrier's doing). w 1.5 on a trunk, 1.2 on a side branch.
  tips:     [{ id, node, x, y, dir, target: { kind: 'tree', id } | null, speed, gripAt }], // speed is the current u/s (0 = waiting/winter)
            // gripAt: rival.age before which the tip does not grip (B.rivalGripAfter + seeded 0..B.rivalGripJitter s)
  grip:     [{ treeId, node, x, y, since, tip }],     // a rhizomorph holding a root tip of a tree (tip = index in tree.tips)
  clusters: [{ id, treeId, x, y, n, age }],           // honey-mushroom clusters at infected trunks (autumn)
  spores,                                             // the rival's score from its clusters
  // bookkeeping, saved too: rs ver wait age nextTip nextCluster nextBarrier spawnT emptyT sweepT tipEvT hot
  //   src [{key, node}] (root node of every stump 's<id>' and lost tree 't<id>'), levels [per tree 0..3],
  //   stats { grips, freed, freedTrees, lost, cut, killed }, freedIds [treeId], grace { treeId: time until which no tip
  //   goes for it }, retreats [{ treeId, at, x, y }] (all default on older saves)
}
tree.infection          // 0..1: grows while gripped (× (1 − B.mantleProtect × tree.mantle), × season), heals when free
tree.mantle             // 0..1: the player's protection, follows how well the player has fed the tree lately
tree.lost               // infection reached 1: the tree stops paying, stands as a snag, its base becomes a new stump
state.barriers = Barrier[]  // { id, nodeId, x, y, r, t, dur } tool 'barrier' (key 4), cost barrierCost(state)
state.ui.tool           // ... | 'barrier'; while 'barrier', state.ui.barrierPick = null | { nodeId, x, y, r, ok, reason, cost }
```

Rules (numbers are `B.rival*`, `B.barrier*`, `B.mantle*` in `src/sim/balance.js`):
- **Wake**: `rival-wake` at the first stump, `B.rivalStartTips` (2) tips. Up to `B.rivalMaxTips` (4) tips and `B.rivalMaxSegments`
  (300 alive edges); a new tip leaves a stump or a lost tree every `B.rivalTipEvery` (60 s of growing time), a side branch starts at
  2 % of the nodes. A rival cut back completely (no tips, no segments) sends tips again after `B.rivalRegrow` (45 s). Dead-end
  twigs older than `B.rivalTwigAge` (150 s) with no tip or grip wither away, so the segment budget never clogs.
- **Growth**: a tip grows 5–8 u/s × the season (`B.rivalSeason`: spring 1, summer 0.55, autumn 1.1, winter 0; 1 without seasons) and
  lays a node every 16–24 u. It looks 24 u ahead, stays in open soil at least 10 u under the surface, goes round rocks (`costAt`) and
  gives up after 14 s boxed in or 45 s without getting nearer (the spawn timer replaces it).
- **Targets**: a tip steers to the tree with the best `worth × (1 − mantleProtect × mantle) / (1 + distance / 450) / (1 + 0.7 × grips)`
  (worth = stage pay × species × 1.5 if linked, 0.7 otherwise). On a tree it goes for a root tip the player has linked (that is where
  the player has a node to put a barrier on), else the nearest; shallow tips preferred. Re-evaluated every 1.5–3 s with hysteresis.
  A tree the player cannot answer for (not linked, and no player node within `B.rivalReach` (250 u) of the grip point) is wanted
  × `B.rivalReachWeight` (0.25) and never gripped: the tip waits at its root. A tree a barrier freed is left alone until
  `B.rivalGrace` (25 s) after that barrier ends (`rival-retreat` when it ends).
- **Blocking**: a tip whose way ahead crosses a live player edge with `w ≥ B.rivalBlockW` (1.8, a busy cord) turns away (it tries
  headings up to 155° off, on the side it last chose) or stands; thin hyphae do not block. A turn away from a thick cord sends
  `rival-turn` (at most every `B.rivalTurnGap`, 25 s); the UI says «Толстая нить не пускает ризоморф…» once.
- **Grip**: a tip within `B.rivalGripRadius` (18 u, like the player's links) of its goal root tip grips it, no sooner than
  `B.rivalGripAfter` (60 s) + the tip's `gripAt` jitter after the waking (an early tip waits at the root); `rival-grip`. At most 2 grips per tree, one per root
  tip. Infection rises 1 / `B.rivalInfectSeconds` (290 s) per second for one grip (× `B.rivalEarlyRate` 0.5 until 25 %), +50 % per further grip, × `(1 − 0.75 × mantle)` ×
  `B.rivalInfectSeason` (spring 1, summer 0.75, autumn 1.15, winter 0.15); `tree-infected` at 0.25 / 0.5 / 0.75; a pay cut up to
  `B.rivalPayCut` (70 %) and slower growth (× (1 − infection)). At 1 the tree is lost (`tree-lost`): no pay, no drinking, a new source.
  The last living tree is never rotted beyond `B.rivalLastTree` (0.9), so there is always a way on. A free tree heals in
  `B.rivalHealSeconds` (240 s), faster by (1 + 2 × mantle); a released grip emits `tree-freed`.
- **Mantle** (economy.js, with the flag on): follows `fed share × root contacts factor` (`B.treeContactFactor`, 0.6 / 0.8 / 1 for 1 / 2 /
  3+ links) with a time constant `B.mantleTau` (40 s); it fades the same way once the tree is unlinked.
- **Barrier**: costs `barrierCost(state)` = `B.barrierCost` (20) + `B.barrierCostStep` (10) per barrier standing; radius `B.barrierRadius`
  (85 u), lasts `B.barrierDur` (40 s), at most `B.barrierMax` (3). Inside it rhizomorph edges wither in `B.barrierWither` (3 s) and die,
  everything beyond a dead edge withers as an orphan (`B.rivalOrphanSeconds`, 6 s), tips die at once, new tips cannot start in it, and
  a grip whose edge died is released. An edge outside any barrier recovers.
- **Clusters**: in autumn each tree with infection ≥ 0.4 grows one cluster (3–7 mushrooms, `rival-fruit`), they add to `rival.spores`
  and are gone with the first cold (winter). None without seasons.
- **Objectives** (only with the flag): page 2 «Освободить 2 дерева от опёнка или перерезать 15 тяжей барьером» (`rivalCut`:
  `stats.freedTrees` ≥ `B.rivalCutFreed` (2) or `stats.cut` ≥ `B.rivalCutGoal` (15)),
  page 3 «Укрепить защиту рощи» (`rivalGuard`: every living tree has mantle ≥ `B.mantleGoal` = 0.5). Both can always be reached: the
  player can grow to a rhizomorph, and a lost tree no longer counts.

API (`src/sim/index.js`): `canBarrier(state, nodeId)`, `commandBarrier(state, nodeId)`, `pickBarrierNode(state, x, y)`,
`barrierDenial(state, nodeId)` → `'sugar'|'crowded'|'dead'|'max'|null` (and `'off'` while the rival sleeps or the flag is off, no
event then), `barrierCost(state)`. Order of denials: off, dead, max, crowded, sugar. Pointer input for the tool lives in
`src/input/pointer.js` (sim); the key `4` and the tool tab in `src/ui`. `src/sim/rival.js` also exports `spawnTipAt(state, x, y, dir,
treeId)` (a hook for tests and scenarios) and `nearestRootTip(state, tree, x, y)`.

Barrier as a choice (run 8): while a ring stands, `estimateGrowth` / `commandGrow` refuse or cut a path at it (`denied: 'barrier'`,
`grow-denied`), a growing tip under a new ring stops, flows.js makes no flow through barred nodes (`barredNodes`) so nothing inside
thickens, and a tree whose every root contact is inside (`treeBarred(state, tree)`) is left out of `stepTrees`: it neither drinks,
pays nor grows, and its mantle holds. `barrierEffects(state, nodeId)` tells the tooltip what a ring would freeze.
Raider (`tip.raid`, from chapter 2): every `B.rivalRaidEvery`-th timer tip (at most `B.rivalRaidMax` alive) goes for the network: it
warns (`rival-raid-seek`) `B.rivalRaidLead` s, touches the nearest thin edge (`rival-raid-touch`), runs towards the spore over thin
edges (up to `B.rivalRaidReach`), and each overgrown edge (`state.rival.over`) is cut with `cause: 'rival'` after
`B.rivalRaidWither` s. Thick cords (`w >= B.rivalBlockW`), the immune stretch round the spore and barriers stop it; a barrier
kills it and heals what it overgrew (`rival-raid-end`). `raiders(state)`, `spawnRaiderAt(state, x, y, dir)` for tests and
scenarios. `node tools/rival-balance.mjs` prints the bot table (barriers, grips, raids, losses, closes, income) in about 30 s.
Raid drawing and texts: src/render/rival.js `drawOver` paints `state.rival.over` live after the cord cache (never in it: a change of
`cover` or `wither` rebuilds nothing), `drawRaiders` draws the head of a running raider and the heading dashes follow `tip.raid.goal`;
a standing barrier gets a frost veil (`frostSprite`, `freezeLook` in rival-logic.js) under its chalk ring. `?mode=raid` in
gallery-rival.js shows them (`&focus=chain|seek|barrier|barrier2|all`). UI (src/ui/rival.js): `describeBarrierPick(pick, cost, sugar,
B, state)` adds the price line `sub2` from `effectsOf`; tooltip.js `describePreview` explains a ring refusal with the seconds left;
the `grow-denied` label has a 5 s gate; one margin note per game on the first `rival-raid-seek`/`rival-raid-touch`; the guide hint
`raidHint` shows once per player (prefs `seen.raid-hint`); threats.js gives `severed {cause: 'rival'}` its own texts.

Events: `rival-wake {x, y, stumpId}`, `rival-tip {x, y}` (at most 1/s), `rival-grip {treeId, x, y}`,
`tree-infected {treeId, level}` (at 0.25 / 0.5 / 0.75; also `x, y` of the trunk base), `tree-freed {treeId, x, y}`,
`tree-lost {treeId, x, y}`, `rival-cut {x, y, edges}`, `rival-fruit {treeId, x, y, n}`, `barrier-placed {id, x, y, nodeId}`,
`barrier-denied {reason, x, y}` (+ `insufficient` for sugar), `barrier-gone {id, x, y}`, `rival-dormant {x, y}`,
`rival-retreat {treeId, x, y}`, `rival-turn {x, y}`.

UI (src/ui/rival.js, guide.js, trees-logic.js): the grip hint says «Поставь барьер 4 на узел рядом» only when a player node is
within `B.barrierRadius` of the grip; otherwise «Протяни нить к этому дереву — барьер ставят на свою нить» with a dotted line
from the nearest node. `describeTree(tree, state)` shows «заражение · защита» only once the rival is awake; a stump tooltip
(`describeStump`, target kind `'stump'` from `src/world/query.js` `targetAt`) foreshadows it in chapter 1 or says it is dormant;
like the drawing, it exists only while `state.rival` does (`?rival=0` has no stump tooltip; `describeTarget` in tooltip.js).

Drawing (src/render/rival.js, rival-logic.js, trees-paint.js, infection-look.js): cords near-black with a pale highlight, one step
thicker than roots, Chaikin-smoothed chains (`chaikin`, `smoothEdges`) after `relaxChains` pulls sharp back-tracking
nodes to their neighbours' midpoint (ends, tips, forks and gripped-root nodes stay; draw-only, the sim is untouched); bulbous dark tips that pulse (still under
`reducedMotion()`); a dashed path from a tip to its target root once it is within 150 u. Infected crowns brown, blotch and thin
by `tree.infection` (`infectionLook(bucket, species, season)`, re-painted only when the infection bucket changes); while gripped,
a rot ring and «N %» at the trunk foot; bare winter crowns show it as rusty twigs and tufts of dead leaves. The snag is a broken bark trunk (`snagSteps`), honey tufts spread around its foot.
`src/render/gallery-rival.html` shows every state at 100 % and 50 % scale.

Pinned details (sim, render and UI were built in parallel against them):
- Trees are `state.world.trees`; `infection`, `mantle`, `lost` live on those objects (missing on old saves = 0 / 0 / false).
- `born` is `state.time` at creation, like the player's network. Every random choice comes from `state.rival.rs`
  (an integer mulberry32 state like `state.sim.threat.rs`), so a seed and its commands replay exactly. `state.rival`,
  `state.barriers` and the tree fields are saved (persist-codec.js: tree rows have 7 numbers, `rival` and `barriers` are
  optional); saves without them still load.
- `state.rival.ver`: an integer the sim bumps whenever rival nodes or edges are added or an edge dies, so the renderer can
  cache the static rhizomorph drawing. `wither` changes do not bump it.
- `world.stumps` never changes after generation and comes from its own derived rng, so trees, deposits and decor of
  existing seeds stay the same. A lost tree becomes a new source of rhizomorphs inside the sim and is drawn as a snag by the
  tree renderer. Stumps and rhizomorphs are drawn in the main pass (`src/render/rival.js`), not in the world worker.
- Barrier `{ id, nodeId, x, y, r, t, dur }`: `t` counts seconds since it was placed, it ends at `t ≥ dur` with
  `barrier-gone`. `state.ui.barrierPick = null | { nodeId, x, y, r, ok, reason, cost }` is set by `src/input/pointer.js`
  while the tool is `'barrier'`.
- Numbers live in `B` (`src/sim/balance.js`): `rivalWakeDelay`, `rivalBlockW`, `mantleProtect`, `barrierCost` (base),
  `barrierRadius`, `barrierDur`, `barrierMax`. `src/ui` reaches the API through namespace imports
  (`import * as sim from '../sim/index.js'`) and falls back to `B.barrierCost` when a function is missing.
- `src/main.js` sets `state.flags.rival` (on together with threats unless `?rival=0`); `?rival=1` wakes the rival at the
  start. The barrier tab and key `4` show once `state.rival && state.rival.awake`.
- Art: manifest ids `decor.stump.1` (group `decor`, type `stump`) and `mushroom.honey.1` / `mushroom.honey.2` (group
  `mushroom`, type `honey`). The player's mushrooms never pick type `honey`; procedural drawing stays the fallback.

Balance (tests/bot.mjs playBot with seasons, threats and the rival on, 1500 s; seeds 7, 13, 23, 42, 2, 5, 9, 26): every seed
wakes at 420 s and grips in year 1 (first grip 503–646 s); the passive bot (no barrier) loses 1–4 trees on 8/8 seeds, the
shortest grip-to-loss 228 s; the bot that puts a barrier on every grip loses none on 8/8. On 20 more seeds 19 grip in year 1
(the 20th: thick player cords shield the whole glade). The bot's sugar is tight (about 10–80 at the first grip), which is why a
barrier starts at 20.

## Illustrated assets (art task)

Generated illustrations are cut out to transparent images in `assets/art/` and listed in
`assets/art/manifest.json`:

```js
{ version: 1, assets: [{ id /* e.g. 'mushroom.common.1', 'decor.acorn.1' */, group /* 'mushroom'|'decor'|'plate'|... */,
    type /* species or decor type */, file /* path from the project root */, w, h,
    anchor: { x, y } /* px in the image: where it touches the world (stipe base, resting point) */,
    worldSize /* suggested height in world units */ }] }
```

The title page frontispiece is `assets/art/frontispiece.webp`. Procedural drawing stays the fallback:
the game must look complete when an asset is missing. `src/render/sprites.js` loads the manifest (also inside
the world worker) and draws mushrooms (look picked by the nearest tree: birch fly agaric, oak porcini, pine saffron
milk cap, else common or chanterelle) and finds (on a light label so the ink reads on dark soil). The atlas uses
`plate` assets whose `type` is a find kind for the full-screen card. The generation toolchain (Python venv, models,
caches) lives in the project's ignored `.tools/` folder, never in system-wide locations.

## Conventions

- ES modules, `const`/`let`, small pure functions; JSDoc where a shape is not obvious.
- Randomness only through `src/core/rng.js` (seeded); world and sim must be deterministic for a seed.
- Canvas drawing never mutates game state; sim never touches the DOM.
- UI text in Russian.

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
- `actions` (src/main.js, passed to the HUD): `start()`, `togglePause()`, `setSpeed(1|2)`, `setTool('grow'|'fruit')`,
  `cancelDrag()`, `restart(seed?)`, `setMuted(bool)`, `isMuted()`, `hasSave()`, `continueSaved()` (loads the saved
  game and plays it; returns false when there is none). Keyboard shortcuts live in the UI task.
- Seasons with day/night (`state.flags.seasons`) and soil threats (`state.flags.threats`) are on in the game by
  default; `?seasons=0` / `?threats=0` turn them off. Tests that build a state with `createState` get both off
  unless they set the flags.
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
    tool: 'grow' | 'fruit',
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
{ type: 'insufficient', x, y }        // not enough sugar
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

Season rules (numbers in `src/sim/balance.js`): spring rains refill water pockets, summer drought slows
regeneration and makes trees thirstier, autumn fruiting (mushrooms grow faster, spores ×3), winter dormancy
(trees neither pay nor drink much, mushrooms do not grow, upkeep drops). Photosynthesis follows daylight.

## Finds

A hypha node that comes within `8 + 10 * decor.scale` units of a `world.decor` item discovers it:
`state.finds[decor.id] = { kind: decor.type, at: state.time }` and the event
`{ type: 'find', id: decor.id, kind: decor.type, x, y }`. Names, notes and rarity per kind come from
`src/content/finds.js`; the HUD shows them on an «Атлас находок» page, the renderer marks found items.

## Glades (src/world/biomes.js, fairness.js)

`world.biome` is one of `birch | oak | pine | mixed` and `world.name` a generated Russian glade name
(«Дубрава у оврага»). Biomes weight tree species and set horizon depths, rocks, water and minerals; terrain
features vary the ground line. A glade has 2–5 trees (not always three) and the spore starts anywhere across
the width; `fairness.js` guarantees an affordable opening (water, a root tip, nitrogen) for every seed.

## Threats and chapters (`state.flags.threats`)

```js
state.fauna = Worm[]   // { id, x, y, a, len, speed, phase, age, mode: 'wander'|'bite'|'snared'|'leave', fade,
                       //   bite: null | { edge, x, y, t, dur }, trapId, ...internal }
state.traps = Trap[]   // «ловчие кольца»: { id, nodeId, x, y, r, grow 0..1, charges, cool, glow, age, prey }
state.ui.tool          // 'grow' | 'fruit' | 'trap'; while 'trap', state.ui.trapPick = null | { nodeId, x, y, ok, reason }
state.chapter          // 1..3; state.objectives is always the current page; flags.pagesDone, flags.bookDone
```

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
the game must look complete when an asset is missing. The generation toolchain (Python venv, models,
caches) lives in the project's ignored `.tools/` folder, never in system-wide locations.

## Conventions

- ES modules, `const`/`let`, small pure functions; JSDoc where a shape is not obvious.
- Randomness only through `src/core/rng.js` (seeded); world and sim must be deterministic for a seed.
- Canvas drawing never mutates game state; sim never touches the DOM.
- UI text in Russian.

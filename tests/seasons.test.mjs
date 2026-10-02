// S2 groundwork: clock, day/night, seasons and weather (src/sim/clock.js and its effects in the economy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import * as sim from '../src/sim/index.js';
import { addNode } from '../src/sim/network.js';
import { findReward } from '../src/sim/finds.js';
import { B, treeFx } from '../src/sim/balance.js';
import { NEUTRAL_FX, clockAt, daylightAt, restoreTime, weatherAt } from '../src/sim/clock.js';
import { groundYAt } from '../src/world/query.js';
import { DT, playBot } from './bot.mjs';

const YEAR = B.seasonSeconds * 4;

/**
 * A playing game. Most tests below were written for the old day clock (a game that starts at dayFrac 0.3 and has plain
 * 100 s days: noon at 20 s, midnight at 70 s of every season), which is exactly what a save made before the long first
 * morning keeps, so by default the new-game flag is dropped. `newClock` keeps what a new game gets (flags.firstDusk).
 */
function fresh(seed = 7, seasons = true, newClock = false) {
  const state = createState(seed);
  state.phase = 'playing';
  state.flags.seasons = seasons;
  if (!newClock) {
    delete state.flags.firstDusk;
    restoreTime(state);
  }
  return state;
}

/** Runs the simulation for `seconds`, returning every event seen with the time it was emitted. */
function run(state, seconds) {
  const seen = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    sim.updateSim(state, DT);
    state.time += DT;
    for (const e of state.events) seen.push({ ...e, t: state.sim.clock });
    state.events.length = 0;
  }
  return seen;
}

/** Puts the game at game time t (no events), as a load would. */
function jump(state, t) {
  state.sim.clock = t;
  restoreTime(state);
}

/** First time (1 s resolution) in [from, to) at which the seeded weather has the given kind at least at `level`. */
function findWeather(state, kind, from, to, level = 0.6) {
  let best = null;
  for (let t = from; t < to; t += 0.5) {
    const w = weatherAt(state, t);
    if (w.kind === kind && w.intensity >= level && (!best || w.intensity > best.w.intensity)) best = { t, w };
  }
  return best;
}

/** A game with one linked tree, full pool and a mature mushroom; `t` seconds into the year. */
function scene(t, { seasons = true, mushroom = false } = {}) {
  const s = fresh(7, seasons);
  const tree = s.world.trees[1];
  addNode(s, tree.tips.find((p) => p.minStage <= tree.stage).x, tree.tips.find((p) => p.minStage <= tree.stage).y, 0);
  s.res.water = s.cap.pool;
  s.res.minerals = s.cap.pool;
  s.res.sugar = 60;
  if (mushroom) {
    const x = s.net.nodes[0].x + 120;
    const n = addNode(s, x, groundYAt(s.world, x) + 20, 0);
    sim.commandFruit(s, n.id);
    s.res.sugar = 60;
  }
  jump(s, t);
  return { s, tree };
}

const treeSugar = (s, tree, dt = 0.3) => {
  sim.updateSim(s, dt);
  return s.sim.intake[tree.id].sugar;
};

test('clock math: start, day, season and year boundaries', () => {
  const c0 = clockAt(0);
  assert.deepEqual(
    { ...c0, daylight: undefined },
    { day: 0, dayFrac: B.startDayFrac, daylight: undefined, season: 'spring', seasonIndex: 0, seasonFrac: 0, year: 0 },
  );
  assert.ok(c0.daylight > 0.9, 'a game starts in the morning light');
  assert.equal(B.seasonSeconds / B.daySeconds, 3, '3 days per season');
  assert.equal(YEAR, 1200, 'a year is 20 game minutes');
  const at = (t) => clockAt(t);
  assert.equal(at(B.seasonSeconds - 0.01).season, 'spring');
  assert.equal(at(B.seasonSeconds).season, 'summer');
  assert.equal(at(2 * B.seasonSeconds).season, 'autumn');
  assert.equal(at(3 * B.seasonSeconds).season, 'winter');
  assert.deepEqual([at(YEAR - 0.01).season, at(YEAR).season, at(YEAR).year, at(YEAR - 0.01).year], ['winter', 'spring', 1, 0]);
  assert.ok(Math.abs(at(150).seasonFrac - 0.5) < 1e-12);
  // the day number rolls over at midnight: dayFrac 0.3 at the start, so after 70 s
  assert.equal(at(69.9).day, 0);
  assert.equal(at(70).day, 1);
  assert.ok(Math.abs(at(70).dayFrac) < 1e-9);
  assert.equal(at(0.7 * B.daySeconds * 3).day, 2);
  for (let t = 0; t < YEAR * 2; t += 1.7) {
    const c = at(t);
    assert.ok(c.dayFrac >= 0 && c.dayFrac < 1 && c.seasonFrac >= 0 && c.seasonFrac <= 1);
    assert.equal(c.seasonIndex, Math.floor(((t % YEAR) / B.seasonSeconds) % 4));
  }
});

test('daylight is a smooth 0..1 curve: night, dawn ramp, day, dusk ramp', () => {
  assert.equal(daylightAt(0), 0);
  assert.equal(daylightAt(0.5), 1);
  assert.ok(Math.abs(daylightAt(0.25) - 0.5) < 1e-9 && Math.abs(daylightAt(0.75) - 0.5) < 1e-9);
  assert.ok(Math.abs(daylightAt(0.5 - 0.1) - daylightAt(0.5 + 0.1)) < 1e-9, 'symmetric around noon');
  let prev = daylightAt(0);
  let maxStep = 0;
  let dim = 0;
  for (let i = 1; i <= 10000; i++) {
    const d = daylightAt(i / 10000);
    assert.ok(d >= 0 && d <= 1);
    maxStep = Math.max(maxStep, Math.abs(d - prev));
    if (d > 0.05 && d < 0.95) dim++;
    prev = d;
  }
  // 1/10000 of a day is 10 ms: no steps, and the dawn/dusk transitions take a real stretch of the day
  assert.ok(maxStep < 0.002, `max step ${maxStep}`);
  const rampSeconds = (dim / 10000) * B.daySeconds;
  assert.ok(rampSeconds > 15 && rampSeconds < 40, `ramps take ${rampSeconds} s of the day`);
});

test('the clock always advances; without the flag nothing else changes (no events, no effects, clear weather)', () => {
  const s = fresh(7, false, true);
  const seen = run(s, 1300);
  assert.equal(seen.filter((e) => ['dawn', 'dusk', 'season', 'weather', 'year-end'].includes(e.type)).length, 0);
  assert.deepEqual(s.clock, clockAt(s.sim.clock, s.flags.firstDusk));
  assert.equal(s.clock.year, 1);
  assert.equal(s.clock.season, 'spring');
  assert.deepEqual(s.weather, { kind: 'clear', intensity: 0 });
  assert.equal(s.sim.fx, NEUTRAL_FX);
  assert.equal(s.flags.yearDone, false);
  // effects are exactly neutral: a lone tree income equals the base table
  const { s: s2, tree } = scene(20, { seasons: false });
  const pay = treeSugar(s2, tree);
  assert.ok(Math.abs(pay - B.treePay[tree.stage] * treeFx(tree).pay * B.treeContactFactor[0] * 0.3) < 1e-9);
});

test('a full year: event order, times and counts; the year ends once and play continues', () => {
  const s = fresh(7, true, true);
  const seen = run(s, YEAR + 1.5 * B.daySeconds);
  const of = (type) => seen.filter((e) => e.type === type);
  // a new game: dusk is first (at B.newGameDusk = 80 s), then dawn 50 s later, alternating every 50 s
  const lightEvents = seen.filter((e) => e.type === 'dawn' || e.type === 'dusk');
  assert.equal(lightEvents[0].type, 'dusk');
  assert.ok(Math.abs(lightEvents[0].t - B.newGameDusk) < 0.1 && Math.abs(lightEvents[1].t - (B.newGameDusk + 50)) < 0.1);
  lightEvents.forEach((e, i) => assert.equal(e.type, i % 2 === 0 ? 'dusk' : 'dawn'));
  assert.equal(of('dawn').length, 13); // 130, 230 ... 1330
  assert.equal(of('dusk').length, 13); // 80, 180 ... 1280
  // seasons, in order, at the right moments; the year ends right before spring returns
  assert.deepEqual(of('season').map((e) => e.season), ['summer', 'autumn', 'winter', 'spring']);
  of('season').forEach((e, i) => assert.ok(Math.abs(e.t - (i + 1) * B.seasonSeconds) < 0.05));
  assert.equal(of('year-end').length, 1);
  assert.equal(of('year-end')[0].year, 0);
  const ye = seen.findIndex((e) => e.type === 'year-end');
  assert.equal(seen[ye + 1].type, 'season');
  assert.equal(seen[ye + 1].season, 'spring');
  assert.equal(seen[ye].t, seen[ye + 1].t, 'same frame');
  assert.equal(s.flags.yearDone, true);
  assert.equal(s.clock.year, 1);
  // weather: an episode is a change of kind and back; kinds follow the season
  const kinds = { spring: 'rain', summer: 'drought', autumn: 'rain', winter: 'snow' };
  const weather = of('weather');
  assert.ok(weather.length >= 16, `${weather.length} weather changes in a year`);
  for (const e of weather) {
    if (e.kind === 'clear') continue;
    assert.equal(e.kind, kinds[clockAt(e.t, s.flags.firstDusk).season], `weather ${e.kind} at ${e.t}`);
  }
  for (let i = 1; i < weather.length; i++) assert.notEqual(weather[i].kind, weather[i - 1].kind, 'only changes are reported');
  assert.ok(of('weather').some((e) => e.kind === 'rain') && of('weather').some((e) => e.kind === 'drought') && of('weather').some((e) => e.kind === 'snow'));
  // a second year-end after another full year, yearDone stays set
  const more = run(s, YEAR);
  assert.deepEqual(more.filter((e) => e.type === 'year-end').map((e) => e.year), [1]);
});

test('weather is seeded, smooth and bounded', () => {
  const a = fresh(7);
  const b = fresh(7);
  const c = fresh(8);
  let differs = false;
  let prev = 0;
  let maxJump = 0;
  for (let t = 0; t < YEAR * 2; t += 0.25) {
    const wa = weatherAt(a, t);
    assert.deepEqual(wa, weatherAt(b, t));
    if (JSON.stringify(wa) !== JSON.stringify(weatherAt(c, t))) differs = true;
    assert.ok(wa.intensity >= 0 && wa.intensity <= 1);
    assert.ok((wa.kind === 'clear') === (wa.intensity === 0), 'clear has no intensity');
    maxJump = Math.max(maxJump, Math.abs(wa.intensity - prev));
    prev = wa.intensity;
  }
  assert.ok(differs, 'another seed has other weather');
  assert.ok(maxJump < 0.06, `intensity jumps by ${maxJump} in 0.25 s`);
  assert.equal(weatherAt(a, 0).kind, 'clear', 'a game opens in clear weather');
  assert.equal(weatherAt(a, B.weatherLead - 1).kind, 'clear');
  // another year has different episodes
  const y0 = Array.from({ length: 300 }, (_, i) => weatherAt(a, i).intensity);
  const y1 = Array.from({ length: 300 }, (_, i) => weatherAt(a, YEAR + i).intensity);
  assert.notDeepEqual(y0, y1);
});

test('restoring the clock reproduces the live clock, weather and effects (what a save relies on)', () => {
  const s = fresh(42);
  for (let k = 0; k < 40; k++) {
    run(s, 29.3);
    const live = { clock: structuredClone(s.clock), weather: structuredClone(s.weather), fx: { ...s.sim.fx }, marks: { ...s.sim.marks } };
    const r = fresh(42);
    r.sim.clock = s.sim.clock;
    restoreTime(r);
    assert.deepEqual(r.clock, live.clock);
    assert.deepEqual(r.weather, live.weather);
    assert.deepEqual(r.sim.fx, live.fx);
    assert.deepEqual(r.sim.marks, live.marks);
    assert.equal(r.events.length, 0);
  }
});

test('photosynthesis: tree sugar follows daylight (noon 1/photoFloor x midnight), smoothly through dusk', () => {
  const Y = YEAR; // the second spring: the gentle first minutes (B.firstLight) are over
  const noon = scene(Y + 20);
  const midnight = scene(Y + 70);
  const dayPay = treeSugar(noon.s, noon.tree);
  const nightPay = treeSugar(midnight.s, midnight.tree);
  assert.ok(Math.abs(dayPay / nightPay - 1 / B.photoFloor) < 1e-9, `noon/midnight ${dayPay / nightPay}`);
  assert.ok(Math.abs(dayPay - B.seasons.spring.pay * B.treePay[noon.tree.stage] * treeFx(noon.tree).pay * B.treeContactFactor[0] * 0.3) < 1e-9);
  // through the evening the income falls without steps
  const samples = [];
  for (let t = 35; t <= 60; t += 0.5) {
    const { s, tree } = scene(Y + t);
    samples.push(treeSugar(s, tree));
  }
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] <= samples[i - 1] + 1e-12 && samples[i - 1] - samples[i] < 0.5 * samples[0] * 0.2);
  assert.ok(samples[0] > samples.at(-1) * 2);
  // dawn and dusk matter equally: same daylight at the same distance from noon
  assert.ok(Math.abs(treeSugar(scene(Y + 5).s, scene(Y + 5).tree) - treeSugar(scene(Y + 35).s, scene(Y + 35).tree)) < 0.02);
});

test('spring rain refills water pockets much faster than clear weather', () => {
  const s = fresh(7);
  const rain = findWeather(s, 'rain', 0, B.seasonSeconds);
  assert.ok(rain, 'there is a rain episode in spring');
  const clear = findWeather(s, 'clear', 0, B.seasonSeconds, 0);
  const regenOver = (t) => {
    const g = fresh(7);
    const w = g.world.water[0];
    w.amount = 0;
    jump(g, t);
    sim.updateSim(g, 0.5);
    return w.amount / 0.5 / w.regen;
  };
  const base = regenOver(clear.t);
  assert.ok(Math.abs(base - B.seasons.spring.regen) < 1e-9);
  assert.ok(regenOver(rain.t) > base * 4.5, `rain ${regenOver(rain.t)} vs ${base}`);
  // never above the pocket's capacity
  const g = fresh(7);
  g.world.water[0].amount = g.world.water[0].max - 0.01;
  jump(g, rain.t);
  sim.updateSim(g, 1);
  assert.equal(g.world.water[0].amount, g.world.water[0].max);
});

test('summer drought slows regeneration and trees get thirstier', () => {
  const s = fresh(7);
  const drought = findWeather(s, 'drought', B.seasonSeconds, 2 * B.seasonSeconds);
  assert.ok(drought, 'there is a drought in summer');
  assert.equal(drought.w.kind, 'drought');
  const regenAt = (t) => {
    const g = fresh(7);
    const w = g.world.water[0];
    w.amount = 0;
    jump(g, t);
    sim.updateSim(g, 0.5);
    return w.amount / 0.5 / w.regen;
  };
  const summerClear = findWeather(s, 'clear', B.seasonSeconds, 2 * B.seasonSeconds, 0);
  const springClear = findWeather(s, 'clear', 0, B.seasonSeconds, 0);
  assert.ok(regenAt(summerClear.t) < regenAt(springClear.t), 'summer is drier than spring');
  assert.ok(regenAt(drought.t) < regenAt(summerClear.t) * 0.3, `drought ${regenAt(drought.t)}`);
  // water drunk by a tree in one step: spring < summer < drought
  const water = (t) => {
    const { s: g, tree } = scene(t);
    sim.updateSim(g, 0.3); // shorter than the flow interval: the intake is read before it is reset
    return g.sim.intake[tree.id].water;
  };
  const dry = water(drought.t);
  const clearWater = water(summerClear.t);
  const spring = water(springClear.t);
  assert.ok(clearWater > spring * 1.2 && dry > clearWater * 1.2, `spring ${spring} summer ${clearWater} drought ${dry}`);
});

test('autumn fruiting: mushrooms grow faster and release three times the spores', () => {
  const growth = (t) => {
    const { s } = scene(t, { mushroom: true });
    s.res.water = s.cap.pool;
    s.res.minerals = s.cap.pool;
    sim.updateSim(s, 4);
    return s.mushrooms[0].growth;
  };
  const spores = (t) => {
    const { s } = scene(t, { mushroom: true });
    s.mushrooms[0].mature = true;
    s.mushrooms[0].growth = 1;
    s.res.water = s.cap.pool;
    s.res.minerals = s.cap.pool;
    const before = s.res.spores;
    sim.updateSim(s, 4);
    return s.res.spores - before;
  };
  const spring = 20;
  const autumn = 2 * B.seasonSeconds + 20; // the same hour of the day
  assert.ok(Math.abs(growth(autumn) / growth(spring) - B.seasons.autumn.mushGrow) < 1e-6);
  assert.ok(Math.abs(spores(autumn) / spores(spring) - 3) < 1e-6);
  assert.ok(Math.abs(spores(B.seasonSeconds + 20) / spores(spring) - 1) < 1e-6, 'summer is like spring');
});

test('winter dormancy: trees drink and pay little, mushrooms stop, upkeep drops, snow falls', () => {
  const winter = 3 * B.seasonSeconds + 20;
  const spring = 20;
  const w = scene(winter);
  const sp = scene(spring);
  const paidW = treeSugar(w.s, w.tree);
  const paidS = treeSugar(sp.s, sp.tree);
  assert.ok(paidW < paidS * 0.2, `winter pay ${paidW} vs ${paidS}`);
  assert.ok(w.s.sim.intake[w.tree.id].water < sp.s.sim.intake[sp.tree.id].water * 0.35, 'trees drink little');
  // growing mushrooms do not grow and draw no sugar; mature ones release nothing
  const m = scene(winter, { mushroom: true });
  const sugar = m.s.res.sugar;
  m.s.sim.income = 0;
  const young = m.s.mushrooms[0];
  const seen = run(m.s, 20);
  assert.equal(young.growth, 0);
  assert.equal(young.mature, false);
  assert.equal(seen.filter((e) => e.type === 'mushroom-mature').length, 0);
  assert.ok(m.s.res.sugar >= sugar - 1, 'no sugar goes into growing in winter');
  young.mature = true;
  young.growth = 1;
  const spores = m.s.res.spores;
  const seen2 = run(m.s, 20);
  assert.equal(m.s.res.spores, spores);
  assert.equal(seen2.filter((e) => e.type === 'spores').length, 0, 'no empty spore bursts');
  // hypha upkeep drops (a big network, no income from trees)
  const upkeep = (t) => {
    const g = fresh(7);
    g.stats.hyphaeLength = 8000;
    g.res.sugar = 100;
    jump(g, t);
    sim.updateSim(g, 1);
    return 100 - g.res.sugar;
  };
  const dW = upkeep(winter);
  const dS = upkeep(spring);
  assert.ok(dW < dS, 'winter upkeep is lower');
  assert.ok(Math.abs(B.upkeepPerLength * 8000 * (1 - B.seasons.winter.upkeep) - (dS - dW)) < 0.05, `drop ${dS - dW}`);
  // snow in winter, none in other seasons
  const snow = findWeather(fresh(7), 'snow', 3 * B.seasonSeconds, YEAR);
  assert.ok(snow);
  for (const t of [0, 150, 450, 700]) assert.notEqual(weatherAt(fresh(7), t).kind, 'snow');
  // winter trees grow (almost) not at all
  const wt = scene(winter);
  wt.tree.health = 1;
  wt.tree.growth = 0;
  run(wt.s, 30);
  const st = scene(spring);
  st.tree.health = 1;
  st.tree.growth = 0;
  run(st.s, 30);
  assert.ok(wt.tree.growth < st.tree.growth * 0.2);
});

test('nights are better for spores (humidity)', () => {
  const spores = (t) => {
    const { s } = scene(t, { mushroom: true });
    s.mushrooms[0].mature = true;
    s.mushrooms[0].growth = 1;
    s.res.water = s.cap.pool;
    s.res.minerals = s.cap.pool;
    const before = s.res.spores;
    sim.updateSim(s, 2);
    return s.res.spores - before;
  };
  const ratio = spores(70) / spores(20); // midnight / noon
  assert.ok(Math.abs(ratio - (1 + B.nightSpores)) < 1e-6, `night/day ${ratio}`);
});

test('determinism with seasons on: same seed and commands give identical games', () => {
  for (const seed of [1, 7, 42]) {
    const a = playBot(seed, { seasons: true, runOn: true, maxSeconds: 700 });
    const b = playBot(seed, { seasons: true, runOn: true, maxSeconds: 700 });
    assert.deepEqual(a.state.res, b.state.res);
    assert.deepEqual(a.state.clock, b.state.clock);
    assert.deepEqual(a.state.weather, b.state.weather);
    assert.deepEqual(a.state.net.nodes, b.state.net.nodes);
    assert.deepEqual(a.state.mushrooms, b.state.mushrooms);
    assert.deepEqual(a.stats, b.stats);
    assert.equal(a.state.sim.rng.getState(), b.state.sim.rng.getState());
  }
});

for (const seed of [1, 7, 42]) {
  test(`bot playthrough with seasons, seed ${seed}: a game year is fun-paced, winter is survivable`, () => {
    let winterFinds = 0; // a thread that touches a find in winter still pays its few spores: they are not a mushroom's
    const { state, completedAt, stats } = playBot(seed, {
      seasons: true,
      runOn: true,
      maxSeconds: YEAR + 10,
      onEvent: (ev, s) => {
        if (ev.type === 'find' && s.clock.season === 'winter') winterFinds += findReward(ev.kind).spores;
      },
    });
    const done = Object.entries(stats.doneAt).map(([k, v]) => `${k}@${v.toFixed(0)}s`).join(' ');
    const seasonLine = Object.entries(stats.bySeason)
      .map(([k, v]) => `${k} sugar min ${v.min.toFixed(0)} avg ${(v.sum / v.n).toFixed(0)}, spores +${(v.spores1 - v.spores0).toFixed(0)}`)
      .join('; ');
    console.log(`# seed ${seed} (seasons on): all objectives at ${completedAt?.toFixed(0)} s; ${done}; max zero-sugar streak ${stats.maxZeroStreak.toFixed(1)} s`);
    console.log(`#   ${seasonLine}`);
    assert.notEqual(completedAt, null, 'all objectives completed');
    assert.ok(completedAt <= 3 * B.seasonSeconds, `finished at ${completedAt} s: after autumn`);
    assert.ok(completedAt >= 200, 'not trivial');
    assert.ok(stats.maxZeroStreak < 5, `sugar stuck at zero for ${stats.maxZeroStreak} s`);
    assert.equal(stats.rejected, 0);
    assert.ok(stats.yearEnd, 'the year ended');
    assert.ok(state.flags.yearDone);
    assert.equal(state.clock.year, 1);
    // no season runs dry: a sugar floor in every full season of the first year
    for (const name of ['summer0', 'autumn0', 'winter0']) assert.ok(stats.bySeason[name].min > 1, `${name}: sugar min ${stats.bySeason[name].min}`);
    assert.ok(stats.bySeason.autumn0.spores1 - stats.bySeason.autumn0.spores0 > 100, 'autumn is the fruiting season');
    assert.ok(Math.abs(stats.bySeason.winter0.spores1 - stats.bySeason.winter0.spores0 - winterFinds) < 1e-6, 'no mushroom spores in winter');
  });
}

test('winter is survivable even with a big network and an empty purse', () => {
  // a mature game at the end of autumn, then the player lets the sugar run down to nothing and does nothing
  const { state: s } = playBot(7, { seasons: true, runOn: true, maxSeconds: 3 * B.seasonSeconds - 5 });
  assert.equal(s.clock.season, 'autumn');
  s.res.sugar = 2;
  s.stats.hyphaeLength *= 2.5; // a sprawling network
  let zero = 0;
  let maxZero = 0;
  let minSugar = Infinity;
  const steps = Math.round((B.seasonSeconds - 10) / DT);
  for (let i = 0; i < steps; i++) {
    sim.updateSim(s, DT);
    s.time += DT;
    s.events.length = 0;
    minSugar = Math.min(minSugar, s.res.sugar);
    zero = s.res.sugar < 0.5 ? zero + DT : 0;
    maxZero = Math.max(maxZero, zero);
  }
  assert.equal(s.clock.season, 'winter');
  assert.ok(maxZero < 15, `sugar stuck at zero for ${maxZero} s`);
  assert.ok(s.res.sugar > 5, `winter ends with sugar ${s.res.sugar}`);
  assert.ok(minSugar >= 0);
});

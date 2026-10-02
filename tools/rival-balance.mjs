#!/usr/bin/env node
// The rival's balance table: the balance bot (tests/bot.mjs) plays the honey fungus for 1500 s on several seeds in these modes
// (passive: no barriers; grip: a barrier on every grip; near: also when a tip closes in on its tree; feed: no barriers, the best tree
// fed one by one until their paths are cords («Подкормка»; the bot banks sugar for it); feedtop: the same with the sugar simply there,
// which measures the cord and not whether a player can afford to feed) and the numbers are printed per mode: barriers used, grips
// seen (deep: those of the deep tip that comes from under the gravel), raids (touches), edges overgrown / cut by raiders, raids the
// thick cord stopped, trees lost, page closes, the mean feeding rate (sugar/s) after the waking, mean sugar income, hyphae length,
// growth refusals at a ring. Seeds run in parallel child processes (about 30 s for 8 seeds x 3 modes).
//
//   node tools/rival-balance.mjs [--root DIR] [--seeds 7,13,23,42,2,5,9,26] [--modes passive,grip,near,feed,feedtop] [--seconds 1500] [--chapter 3] [--gen 2] [--bal '{"rivalRaidEvery":1e9}']
//
// --root points at another checkout (e.g. a `git archive` of an older commit) for before/after tables; --bal overrides B numbers;
// --gen N plays on the worlds of generator version N (none: the newest; 2 is comparable with the older tables);
// --chapter N turns the page to N when the rival wakes (the bot rarely gets to page 3 on its own): the later raids and the deep grip.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const here = fileURLToPath(import.meta.url);
const root = path.resolve(opt('root', path.join(path.dirname(here), '..')));

async function worker() {
  const [seed, mode, seconds] = [Number(opt('seed')), opt('mode'), Number(opt('seconds', 1500))];
  const { playBot } = await import(pathToFileURL(path.join(root, 'tests/bot.mjs')).href);
  const { createObjectives } = await import(pathToFileURL(path.join(root, 'src/sim/objectives.js')).href);
  if (opt('bal', '')) Object.assign((await import(pathToFileURL(path.join(root, 'src/sim/balance.js')).href)).B, JSON.parse(opt('bal')));
  const c = { barriers: 0, grips: 0, deepSent: 0, deep: 0, raids: 0, severedRival: 0, lost: 0, closed: 0, denied: 0 };
  let incSum = 0;
  let incN = 0;
  let last = 0;
  let fedSum = 0;
  let fedN = 0;
  const chapter = Number(opt('chapter', 0));
  const gen = opt('gen', '') ? Number(opt('gen')) : undefined; // the world generator version (none: the newest)
  const { state } = playBot(seed, {
    gen,
    seasons: true,
    threats: true,
    runOn: true,
    rival: true,
    // 'feed': no barriers, the trees fed one by one (the bot banks sugar for it); 'feedtop': the same with the sugar simply there
    barrier: mode === 'passive' || mode === 'feed' || mode === 'feedtop' ? false : mode,
    feed: mode === 'feed' || mode === 'feedtop',
    feedTopUp: mode === 'feedtop',
    maxSeconds: seconds,
    onEvent: (ev, s) => {
      // --chapter N: the page is turned to N when the rival wakes, to see the later pages (the stakes, the late raids, the deep grip)
      if (chapter && ev.type === 'rival-wake' && (s.chapter ?? 1) < chapter) {
        s.chapter = chapter;
        s.objectives = createObjectives(chapter, true, s.world.biome, true);
      }
      if (ev.type === 'rival-deep') c.deepSent++;
      if (ev.type === 'barrier-placed') c.barriers++;
      else if (ev.type === 'rival-grip') {
        c.grips++;
        if (ev.deep) c.deep++;
      } else if (ev.type === 'rival-raid-touch') c.raids++;
      else if (ev.type === 'severed' && ev.cause === 'rival') c.severedRival++;
      else if (ev.type === 'tree-lost') c.lost++;
      else if (ev.type === 'page-closed') c.closed++;
      else if (ev.type === 'grow-denied') c.denied++;
      if (s.rival?.awake && s.time - last >= 5) {
        last = s.time;
        incSum += s.sim.income;
        incN++;
        if (s.feed) {
          fedSum += s.feed.rate;
          fedN++;
        }
      }
    },
  });
  const st = state.rival?.stats ?? {};
  console.log(
    JSON.stringify({
      seed,
      mode,
      ...c,
      overgrown: st.overgrown ?? 0,
      raidCut: st.raidCut ?? 0,
      stopped: st.raidStopped ?? 0,
      fed: fedN ? fedSum / fedN : 0,
      income: incN ? incSum / incN : 0,
      hyphae: state.stats.hyphaeLength,
      spores: state.res.spores,
    }),
  );
}

if (args.includes('--worker')) {
  await worker();
} else {
  const seeds = opt('seeds', '7,13,23,42,2,5,9,26').split(',').map(Number);
  const modes = opt('modes', 'passive,grip,near').split(',');
  const jobs = modes.flatMap((mode) => seeds.map((seed) => ({ seed, mode })));
  const results = [];
  let next = 0;
  const run = () =>
    new Promise((done) => {
      const job = jobs[next++];
      if (!job) return done();
      const passArgs = ['--worker', '--root', root, '--seed', String(job.seed), '--mode', job.mode, '--seconds', opt('seconds', '1500'), '--chapter', opt('chapter', '0'), '--gen', opt('gen', ''), '--bal', opt('bal', '')];
      const p = spawn(process.execPath, [here, ...passArgs], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', () => {
        try {
          results.push(JSON.parse(out.trim().split('\n').pop()));
        } catch {
          console.error(`seed ${job.seed} ${job.mode}: no result`);
        }
        run().then(done);
      });
    });
  await Promise.all(Array.from({ length: Math.min(os.cpus().length, jobs.length) }, run));
  const cols = ['barriers', 'grips', 'deepSent', 'deep', 'raids', 'overgrown', 'raidCut', 'stopped', 'lost', 'closed', 'fed', 'income', 'hyphae', 'spores', 'denied'];
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)).padStart(10);
  for (const mode of modes) {
    const rows = results.filter((r) => r.mode === mode).sort((a, b) => a.seed - b.seed);
    console.log(`\n== ${mode}\nseed ${cols.map((c) => c.padStart(10)).join('')}`);
    for (const r of rows) console.log(`${String(r.seed).padStart(4)} ${cols.map((c) => fmt(r[c])).join('')}`);
    console.log(`mean ${cols.map((c) => fmt(rows.reduce((s, r) => s + r[c], 0) / Math.max(1, rows.length))).join('')}`);
  }
}

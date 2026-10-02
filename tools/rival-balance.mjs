#!/usr/bin/env node
// The rival's balance table: the balance bot (tests/bot.mjs) plays the honey fungus for 1500 s on several seeds in three modes
// (passive: no barriers; grip: a barrier on every grip; near: also when a tip closes in on its tree) and the numbers are printed per
// mode: barriers used, grips seen, raids (touches) and edges overgrown / cut by raiders, trees lost, page closes, mean sugar income
// after the waking, hyphae length, growth refusals at a ring. Seeds run in parallel child processes (about 30 s for 8 seeds x 3 modes).
//
//   node tools/rival-balance.mjs [--root DIR] [--seeds 7,13,23,42,2,5,9,26] [--modes passive,grip,near] [--seconds 1500] [--bal '{"rivalRaidEvery":1e9}']
//
// --root points at another checkout (e.g. a `git archive` of an older commit) for before/after tables; --bal overrides B numbers.
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
  if (opt('bal', '')) Object.assign((await import(pathToFileURL(path.join(root, 'src/sim/balance.js')).href)).B, JSON.parse(opt('bal')));
  const c = { barriers: 0, grips: 0, raids: 0, severedRival: 0, lost: 0, closed: 0, denied: 0 };
  let incSum = 0;
  let incN = 0;
  let last = 0;
  const { state } = playBot(seed, {
    seasons: true,
    threats: true,
    runOn: true,
    rival: true,
    barrier: mode === 'passive' ? false : mode,
    maxSeconds: seconds,
    onEvent: (ev, s) => {
      if (ev.type === 'barrier-placed') c.barriers++;
      else if (ev.type === 'rival-grip') c.grips++;
      else if (ev.type === 'rival-raid-touch') c.raids++;
      else if (ev.type === 'severed' && ev.cause === 'rival') c.severedRival++;
      else if (ev.type === 'tree-lost') c.lost++;
      else if (ev.type === 'page-closed') c.closed++;
      else if (ev.type === 'grow-denied') c.denied++;
      if (s.rival?.awake && s.time - last >= 5) {
        last = s.time;
        incSum += s.sim.income;
        incN++;
      }
    },
  });
  const st = state.rival?.stats ?? {};
  console.log(JSON.stringify({ seed, mode, ...c, overgrown: st.overgrown ?? 0, raidCut: st.raidCut ?? 0, income: incN ? incSum / incN : 0, hyphae: state.stats.hyphaeLength, spores: state.res.spores }));
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
      const passArgs = ['--worker', '--root', root, '--seed', String(job.seed), '--mode', job.mode, '--seconds', opt('seconds', '1500'), '--bal', opt('bal', '')];
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
  const cols = ['barriers', 'grips', 'raids', 'overgrown', 'raidCut', 'lost', 'closed', 'income', 'hyphae', 'spores', 'denied'];
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)).padStart(10);
  for (const mode of modes) {
    const rows = results.filter((r) => r.mode === mode).sort((a, b) => a.seed - b.seed);
    console.log(`\n== ${mode}\nseed ${cols.map((c) => c.padStart(10)).join('')}`);
    for (const r of rows) console.log(`${String(r.seed).padStart(4)} ${cols.map((c) => fmt(r[c])).join('')}`);
    console.log(`mean ${cols.map((c) => fmt(rows.reduce((s, r) => s + r[c], 0) / Math.max(1, rows.length))).join('')}`);
  }
}

#!/usr/bin/env node
// Zero-dependency stutter probe for «Корни и нити»: headless Edge/Chrome over the DevTools protocol (Node 22+).
// It opens the game (server build or the single-file dist build), starts it through the REAL title button, runs one
// scenario and records, on the page's own clock (ms from the document's timeOrigin or from the capture start):
//   * every busy stretch of the main thread >= 16 ms (CDP Profiler sampling profile: contiguous non-idle samples), with
//     the top self-time and total-time functions (file:line) inside each stretch and overall;
//   * rAF frame gaps (p50/p95/p99/max, counts over 33 / 50 / 100 ms), the long-task and long-animation-frame entries,
//     and a per-frame split of the game's own work (sim+persist / input / renderer.draw / hud.update / audio.update);
//   * a trace (Tracing, devtools.timeline + v8): GC pauses, layout / style / paint time, and with --gpu-trace the GPU
//     process busy time; plus light page-side hooks: getImageData, canvas (re)allocations, JSON, localStorage,
//     createImageBitmap, fetch, fonts, Worker, AudioContext, window.__renderStats changes.
//
//   node tools/perf-probe.mjs startup [--build server|dist] [--title-dwell 3000] [--play 15] [--with-save]
//       A. from navigation, through the title page and the click, to <play> s of play
//   node tools/perf-probe.mjs seasons [--build server|dist] [--boundaries spring-summer,summer-autumn,autumn-winter,winter-spring]
//       B. a mid-game glade (~--nodes 260 nodes, rival awake) is loaded from a generated save through the real
//          «Продолжить наблюдения» button; each boundary is recorded from --pre 5 s before to --post 25 s after it
//   node tools/perf-probe.mjs steady [--build server|dist] [--speed 1|2] [--duration 120] [--nodes 400]
//       C. steady real-time play on a late network (a synthetic player drags new threads every few seconds)
//   node tools/perf-probe.mjs saves     (only generate the glade saves; they are cached in <out>/saves/)
//
// Common flags: --seed 7  --size 1920x1080  --dpr 1  --out .tmp/perf  --tag NAME (suffix of the result files)
//   --dist PATH (default dist/roots-and-threads.html; `npm run build` first; --build dist opens it from file://)
//   --interval 200 (profiler sampling, µs)  --no-profile  --no-trace  --gpu-trace  --no-hooks (no page-side hooks)
//   --throttle N (CPU slowdown factor)  --browser PATH  --chrome-flag FLAG (repeatable)  --keep-profile (.cpuprofile)
//   --settle 14 (s of play before a seasons/steady capture)  --player on|off  --top 20
// Results: <out>/<scenario>-<build>[-tag].json (compact), .txt (summary), .frames.json (frame gaps); for `steady` the
// scenario name is steady-x1 / steady-x2. Exit code 0 on success.
// Mode: --headless=new, the machine's real GPU (the report prints the adapter list and the GPU feature status).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGuard, killByProfile, killTree, sweepStale } from './proc-guard.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const SEASON_SECONDS = 300; // B.seasonSeconds (src/sim/balance.js)
const SAVE_KEY = 'roots-threads.save.v1'; // src/persist.js
const BOUNDARIES = { 'spring-summer': 300, 'summer-autumn': 600, 'autumn-winter': 900, 'winter-spring': 1200 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------------ options

function parseOptions(argv) {
  const o = {
    scenario: argv[0], build: 'server', dist: 'dist/roots-and-threads.html', seed: 7, size: [1920, 1080], dpr: 1, out: '.tmp/perf', tag: '',
    interval: 200, profile: true, trace: true, gpuTrace: false, hooks: true, throttle: 1, browser: null, flags: [], keepProfile: false,
    titleDwell: 3000, play: 15, withSave: false, settle: 14, pre: 5, post: 25, boundaries: Object.keys(BOUNDARIES), duration: 120, speed: 1,
    nodes: null, player: null, top: 20,
  };
  for (let i = 1; i < argv.length; i++) {
    const f = argv[i];
    const v = argv[i + 1];
    const num = () => Number(v);
    switch (f) {
      case '--build': o.build = v; i++; break;
      case '--dist': o.dist = v; i++; break;
      case '--seed': o.seed = num(); i++; break;
      case '--size': o.size = v.split('x').map(Number); i++; break;
      case '--dpr': o.dpr = num(); i++; break;
      case '--out': o.out = v; i++; break;
      case '--tag': o.tag = v; i++; break;
      case '--interval': o.interval = num(); i++; break;
      case '--no-profile': o.profile = false; break;
      case '--no-trace': o.trace = false; break;
      case '--gpu-trace': o.gpuTrace = true; break;
      case '--no-hooks': o.hooks = false; break;
      case '--throttle': o.throttle = num(); i++; break;
      case '--browser': o.browser = v; i++; break;
      case '--chrome-flag': o.flags.push(v); i++; break;
      case '--keep-profile': o.keepProfile = true; break;
      case '--title-dwell': o.titleDwell = num(); i++; break;
      case '--play': o.play = num(); i++; break;
      case '--with-save': o.withSave = true; break;
      case '--settle': o.settle = num(); i++; break;
      case '--pre': o.pre = num(); i++; break;
      case '--post': o.post = num(); i++; break;
      case '--boundaries': o.boundaries = v.split(','); i++; break;
      case '--duration': o.duration = num(); i++; break;
      case '--speed': o.speed = num(); i++; break;
      case '--nodes': o.nodes = num(); i++; break;
      case '--player': o.player = v === 'on'; i++; break;
      case '--top': o.top = num(); i++; break;
      default: throw new Error(`unknown flag ${f}`);
    }
  }
  if (!['startup', 'seasons', 'steady', 'saves'].includes(o.scenario)) {
    throw new Error('usage: node tools/perf-probe.mjs <startup|seasons|steady|saves> [flags]  (see the file header)');
  }
  if (o.nodes === null) o.nodes = o.scenario === 'steady' ? 400 : 260;
  if (o.player === null) o.player = o.scenario === 'steady';
  return o;
}

// ------------------------------------------------------------------------------------------------ browser (from tools/shot.mjs)

function startServer() {
  return new Promise((resolveUrl, reject) => {
    const child = spawn(process.execPath, [join(root, 'tools', 'serve.mjs'), '--port', '0', '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (m) resolveUrl({ child, base: m[0].slice(0, -1) });
    });
    child.on('exit', (code) => reject(new Error(`server exited (${code}): ${out}`)));
  });
}

async function launchBrowser(exe, [w, h], extra) {
  const profile = join(root, '.tmp', `browser-profile-${process.pid}-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const child = spawn(exe, [
    '--headless=new', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--enable-precise-memory-info', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${w},${h}`, ...extra, 'about:blank',
  ], { stdio: 'ignore' });
  child.exited = new Promise((r) => child.once('exit', r));
  const portFile = join(profile, 'DevToolsActivePort');
  let text = null;
  for (let i = 0; i < 300 && text === null; i++) {
    try {
      text = readFileSync(portFile, 'utf8'); // the file may exist but still be locked or half-written for a moment
      if (!/\n.+/.test(text)) text = null;
    } catch {
      text = null;
    }
    if (text === null) await sleep(100);
  }
  if (text === null) {
    // never leave the browser running when it did not come up
    killTree(child.pid);
    child.kill();
    killByProfile(profile);
    throw new Error('browser did not open a DevTools port');
  }
  const [port, path] = text.trim().split(/\r?\n/);
  return { child, profile, wsUrl: `ws://127.0.0.1:${port}${path}` };
}

/** Raise the priority of this run's browser processes a notch: the machine is shared with other agents' test runs. */
function raisePriority(profile) {
  if (process.platform !== 'win32') return Promise.resolve();
  const script = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${profile.replace(/'/g, "''")}*' } | ForEach-Object { try { (Get-Process -Id $_.ProcessId).PriorityClass = 'AboveNormal' } catch {} }`;
  return new Promise((r) => {
    const c = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' });
    c.on('exit', r);
    c.on('error', r);
  });
}

/** System-wide CPU counters (all logical cores) for a busy-% over an interval. */
function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of cpus()) {
    for (const [k, v] of Object.entries(c.times)) {
      total += v;
      if (k === 'idle') idle += v;
    }
  }
  return { idle, total };
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolveMsg, rejectMsg } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rejectMsg(new Error(`${msg.error.message} ${msg.error.data || ''}`));
      else resolveMsg(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolveMsg, rejectMsg) => {
      const id = nextId++;
      pending.set(id, { resolveMsg, rejectMsg });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const opened = new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = () => j(new Error('cannot connect to the browser'));
  });
  return { ws, send, on: (fn) => listeners.push(fn), opened };
}

// ------------------------------------------------------------------------------------------------ page-side recorder
// Injected before any page script (Page.addScriptToEvaluateOnNewDocument), so it also sees the dist bootstrap's work.
// Everything is cheap: a few timestamps per frame, wrappers only around rare calls (never around drawImage & co).
function pageRecorder(cfg) {
  if (window.__probe) return;
  const now = () => performance.now();
  const P = (window.__probe = {
    syncT: now(), frames: [], fr: [], tasks: [], loaf: [], marks: [], stats: [], samples: [], seasons: [], phases: [], imgs: [], fetches: [],
    gi: { n: 0, ms: 0, max: 0, slow: [] }, canv: [], canvN: 0, json: [], store: [], audio: [], hooksOn: cfg.hooks,
  });
  performance.mark('probe:sync');
  P.mark = (name, extra) => P.marks.push(Object.assign({ t: now(), name }, extra));
  P.reset = () => {
    for (const k of ['frames', 'fr', 'tasks', 'loaf', 'marks', 'stats', 'samples', 'seasons', 'phases', 'imgs', 'fetches', 'canv', 'json', 'store', 'audio']) P[k].length = 0;
    P.gi.n = 0; P.gi.ms = 0; P.gi.max = 0; P.gi.slow.length = 0; P.canvN = 0; P.resetT = now();
  };
  const stack = () => String(new Error().stack).split('\n').slice(3, 7).map((l) => l.replace(/^\s*at\s+/, '').replace(/https?:\/\/[^/]+\//, '').replace(/^rnt\//, '')).join(' < ');

  // frames: our callback is registered first, so it runs first in every frame; the game's own callback follows it
  let cur = null;
  let hooked = null;
  let lastSeason = null;
  let lastPhase = null;
  let lastStats = null;
  let nextSample = 0;
  const hook = () => {
    const g = window.__game;
    if (!g || hooked === g) return;
    if (!hooked) P.mark('game-created');
    hooked = g;
    if (!g.renderer || !g.hud || !g.audio || !g.input) return;
    const wrap = (obj, key, slot) => {
      const f = obj[key];
      if (typeof f !== 'function' || f.__probed) return;
      const w = function () {
        const t = now();
        if (cur && cur.sim < 0) cur.sim = t - cur.start; // sim steps + autosave, everything the game does before input.refresh
        try { return f.apply(this, arguments); } finally { if (cur) cur[slot] += now() - t; }
      };
      w.__probed = true;
      obj[key] = w;
    };
    wrap(g.input, 'refresh', 'refresh');
    wrap(g.renderer, 'draw', 'draw');
    wrap(g.hud, 'update', 'hud');
    wrap(g.audio, 'update', 'audio');
  };
  const tick = (ts) => {
    const start = now();
    if (cur) P.fr.push([cur.ts, cur.start, cur.sim, cur.refresh, cur.draw, cur.hud, cur.audio]);
    cur = { ts, start, sim: -1, refresh: 0, draw: 0, hud: 0, audio: 0 };
    P.frames.push(ts);
    hook();
    const g = window.__game;
    const s = g && g.state;
    if (s) {
      const season = s.clock && s.clock.season;
      if (season !== lastSeason) { P.seasons.push({ t: start, season, time: s.time }); lastSeason = season; }
      if (s.phase !== lastPhase) { P.phases.push({ t: start, phase: s.phase, time: s.time }); lastPhase = s.phase; }
    }
    const rs = window.__renderStats;
    if (rs && rs !== lastStats) { lastStats = rs; P.stats.push(Object.assign({ t: start }, JSON.parse(JSON.stringify(rs)))); }
    if (start >= nextSample) {
      nextSample = start + 1000;
      const m = performance.memory;
      P.samples.push({
        t: start, phase: s && s.phase, time: s && s.time, season: s && s.clock && s.clock.season, speed: s && s.speed,
        nodes: s && s.net && s.net.nodes.length, mush: s && s.mushrooms && s.mushrooms.length,
        rivalEdges: s && s.rival && s.rival.edges ? s.rival.edges.length : undefined, heap: m ? m.usedJSHeapSize : 0,
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.tasks.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true });
  } catch (err) { /* no long task API */ }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        P.loaf.push({
          t: e.startTime, d: e.duration, blocking: e.blockingDuration, renderStart: e.renderStart, styleStart: e.styleAndLayoutStart,
          scripts: (e.scripts || []).map((s) => ({ inv: s.invoker, type: s.invokerType, fn: s.sourceFunctionName, url: s.sourceURL, ch: s.sourceCharPosition, d: s.duration, start: s.startTime, exec: s.executionStart, forced: s.forcedStyleAndLayoutDuration, pause: s.pauseDuration })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (err) { /* no LoAF */ }
  if (!cfg.hooks) return;

  // canvas readback: a synchronous GPU->CPU copy stalls the calling thread until the GPU has caught up
  try {
    const proto = CanvasRenderingContext2D.prototype;
    const gid = proto.getImageData;
    proto.getImageData = function () {
      const t = now();
      const r = gid.apply(this, arguments);
      const d = now() - t;
      P.gi.n++; P.gi.ms += d; if (d > P.gi.max) P.gi.max = d;
      if (d >= 3 && P.gi.slow.length < 60) P.gi.slow.push({ t, d, w: arguments[2], h: arguments[3], at: stack() });
      return r;
    };
  } catch (err) { /* ignore */ }
  // canvas (re)allocations: width/height setters and OffscreenCanvas
  try {
    const log = (kind, w, h) => {
      P.canvN++;
      if (w * h < 200000 || P.canv.length >= 4000) return;
      P.canv.push({ t: now(), kind, w, h, at: w * h >= 1000000 ? stack() : '' });
    };
    for (const dim of ['width', 'height']) {
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dim);
      Object.defineProperty(HTMLCanvasElement.prototype, dim, {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set(v) { d.set.call(this, v); if (v > 0) log(`set ${dim}`, this.width, this.height); },
      });
    }
    if (window.OffscreenCanvas) {
      const OC = window.OffscreenCanvas;
      window.OffscreenCanvas = class extends OC { constructor(w, h) { super(w, h); log('new Offscreen', w, h); } };
    }
  } catch (err) { /* ignore */ }
  try {
    for (const op of ['stringify', 'parse']) {
      const f = JSON[op];
      JSON[op] = function () {
        const t = now();
        const r = f.apply(this, arguments);
        const d = now() - t;
        if (d >= 1 && P.json.length < 400) P.json.push({ t, op, ms: d, len: op === 'parse' ? String(arguments[0]).length : r && r.length, at: d >= 5 ? stack() : '' });
        return r;
      };
    }
    const si = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      const t = now();
      const r = si.apply(this, arguments);
      P.store.push({ t, key: k, len: String(v).length, ms: now() - t });
      return r;
    };
  } catch (err) { /* ignore */ }
  try {
    const cib = window.createImageBitmap;
    window.createImageBitmap = function (src) {
      const t0 = now();
      const p = cib.apply(this, arguments);
      p.then((b) => P.imgs.push({ t0, t1: now(), w: b.width, h: b.height }), () => {});
      return p;
    };
    const f = window.fetch;
    window.fetch = function (input) {
      const t0 = now();
      const url = typeof input === 'string' ? input : input && (input.url || String(input));
      const p = f.apply(this, arguments);
      p.then((r) => P.fetches.push({ t0, t1: now(), url: String(url).replace(/https?:\/\/[^/]+\//, ''), status: r.status }), () => {});
      return p;
    };
    if (window.Worker) {
      const W = window.Worker;
      window.Worker = class extends W {
        constructor(u, o) {
          super(u, o);
          P.mark('worker-new', { url: String(u).replace(/https?:\/\/[^/]+\//, '') });
          this.addEventListener('message', (e) => P.mark('worker-msg', { id: e.data && e.data.id, ms: e.data && e.data.ms, err: e.data && e.data.error ? String(e.data.error) : undefined }));
          this.addEventListener('error', (e) => P.mark('worker-error', { msg: e.message }));
        }
        postMessage(m, t) { P.mark('worker-post', { id: m && m.id, w: m && m.w, h: m && m.h, season: m && m.season }); return super.postMessage(m, t); }
      };
    }
    const AC = window.AudioContext;
    if (AC) {
      window.AudioContext = class extends AC {
        constructor(...a) {
          super(...a);
          P.mark('audio-new', { state: this.state, rate: this.sampleRate });
          this.addEventListener('statechange', () => P.mark('audio-' + this.state));
        }
      };
      const cb = BaseAudioContext.prototype.createBuffer;
      BaseAudioContext.prototype.createBuffer = function (ch, len, rate) {
        const t = now();
        const r = cb.apply(this, arguments);
        P.audio.push({ t, ch, len, rate, ms: now() - t });
        return r;
      };
    }
    document.fonts.addEventListener('loading', () => P.mark('fonts-loading'));
    document.fonts.addEventListener('loadingdone', (e) => P.mark('fonts-loaded', { n: e.fontfaces.length }));
    document.addEventListener('DOMContentLoaded', () => P.mark('dom-content-loaded'));
    window.addEventListener('load', () => P.mark('window-load'));
  } catch (err) { /* ignore */ }
}

// ------------------------------------------------------------------------------------------------ saves for mid-game scenarios

const mulberry = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * A glade played by the balance bot (threats, seasons and the rival on) until game second `until`, then a synthetic
 * player widens the network to about `nodes` nodes over the last seconds. Cached as JSON in <out>/saves/.
 */
async function makeSave(o, until, nodes) {
  const dir = resolve(root, o.out, 'saves');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `seed${o.seed}-t${until}-n${nodes}.json`);
  const infoFile = file.replace(/\.json$/, '.info.json');
  if (existsSync(file) && existsSync(infoFile)) return { file, raw: readFileSync(file, 'utf8'), info: JSON.parse(readFileSync(infoFile, 'utf8')) };
  const url = (p) => pathToFileURL(join(root, p)).href;
  const { playBot } = await import(url('tests/bot.mjs'));
  const { encodeState } = await import(url('src/persist-codec.js'));
  const sim = await import(url('src/sim/index.js'));
  const grow = Math.min(120, Math.max(0, until - 60));
  const base = until - grow;
  const t0 = Date.now();
  const state = playBot(o.seed, { maxSeconds: base, threats: true, seasons: true, runOn: true, rival: true, barrier: 'near' }).state;
  state.phase = 'playing';
  const rng = mulberry(o.seed * 7919 + until);
  const DT = 1 / 60;
  for (let i = 0; i < Math.round(grow / DT); i++) {
    if (i % 24 === 0 && state.net.nodes.length < nodes) {
      state.res.sugar = Math.max(state.res.sugar, state.cap.sugar * 0.95);
      const alive = state.net.nodes.filter((n) => n.alive);
      const from = alive[Math.floor(rng() * alive.length)];
      const a = Math.PI * (0.05 + 0.9 * rng());
      const len = 90 + 120 * rng();
      const pts = [];
      for (let d = 12; d <= len; d += 12) pts.push({ x: from.x + Math.cos(a) * d + Math.sin(d / 20) * 6, y: from.y + Math.sin(a) * d });
      sim.commandGrow(state, from.id, pts);
    }
    sim.updateSim(state, DT);
    state.time += DT;
  }
  state.events.length = 0;
  const raw = JSON.stringify(encodeState(state));
  const info = {
    seed: o.seed, time: Math.round(state.time * 10) / 10, season: state.clock && state.clock.season, nodes: state.net.nodes.length, mushrooms: state.mushrooms.length,
    trees: state.world.trees.length, rival: state.rival && { awake: state.rival.awake, tips: state.rival.tips.length, edges: state.rival.edges.filter((e) => e.alive).length },
    saveKB: Math.round(raw.length / 1024), genMs: Date.now() - t0,
  };
  writeFileSync(file, raw);
  writeFileSync(infoFile, JSON.stringify(info));
  console.log(`[save] ${file}: ${JSON.stringify(info)}`);
  return { file, raw, info };
}

// ------------------------------------------------------------------------------------------------ a browser session

const TRACE_CATS = ['devtools.timeline', 'v8', 'blink.user_timing'];

class Session {
  constructor(o) {
    this.o = o;
    this.server = null;
    this.events = [];
    this.problems = [];
  }

  async open({ save } = {}) {
    const o = this.o;
    const exe = o.browser || BROWSERS.find((p) => existsSync(p));
    if (!exe) throw new Error('no Edge/Chrome found; pass --browser PATH');
    this.exe = exe;
    if (o.build === 'dist') {
      const dist = resolve(root, o.dist);
      if (!existsSync(dist)) throw new Error(`${dist} not found: run npm run build first`);
      this.url = pathToFileURL(dist).href;
    } else {
      this.server = await startServer();
      guard.set({ server: this.server.child });
      this.url = `${this.server.base}/`;
    }
    this.browser = await launchBrowser(exe, o.size, o.flags);
    guard.set({ browser: this.browser.child, profile: this.browser.profile });
    this.cdp = connect(this.browser.wsUrl);
    await this.cdp.opened;
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
    this.cdp.on((msg) => this.onMessage(msg));
    const s = (m, p) => this.s(m, p);
    await s('Page.enable');
    await s('Runtime.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: o.size[0], height: o.size[1], deviceScaleFactor: o.dpr, mobile: false });
    if (o.throttle > 1) await s('Emulation.setCPUThrottlingRate', { rate: o.throttle });
    await s('Page.addScriptToEvaluateOnNewDocument', { source: `(${pageRecorder})(${JSON.stringify({ hooks: o.hooks })});` });
    if (save) {
      await s('Page.addScriptToEvaluateOnNewDocument', {
        source: `try{localStorage.setItem(${JSON.stringify(SAVE_KEY)},${JSON.stringify(save.raw)});}catch(e){}`,
      });
    }
    this.sys = await this.cdp.send('SystemInfo.getInfo').catch(() => ({}));
    this.version = await this.cdp.send('Browser.getVersion').catch(() => ({}));
    await this.boost();
  }

  /** Priority of every browser process of this run (the renderer is a new process after the first navigation). */
  boost() {
    return raisePriority(this.browser.profile);
  }

  /** Cumulative CPU seconds per browser process type (browser / renderer / gpu / utility) plus the system-wide counters. */
  async cpuSample() {
    const r = await this.cdp.send('SystemInfo.getProcessInfo').catch(() => ({ processInfo: [] }));
    const by = {};
    for (const p of r.processInfo) by[p.type] = (by[p.type] || 0) + p.cpuTime;
    return { by, sys: cpuTimes(), at: Date.now() };
  }

  s(method, params) {
    return this.cdp.send(method, params, this.sessionId);
  }

  onMessage(msg) {
    if (msg.method === 'Tracing.dataCollected') {
      for (const e of msg.params.value) if (this.keepEvent(e)) this.events.push(e);
    } else if (msg.method === 'Tracing.tracingComplete') {
      this.traceDone?.();
    } else if (msg.sessionId === this.sessionId) {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.problems.push(`exception: ${d.exception?.description || d.text}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
      }
    }
  }

  // keep the trace small: metadata, our marks, and anything long enough to matter
  keepEvent(e) {
    if (e.ph === 'M') return true;
    if (e.name === 'probe:sync' || e.name === 'probe:sync2') return true;
    if (e.name === 'MinorGC' || e.name === 'MajorGC') return true;
    return e.ph === 'X' && e.dur >= 300;
  }

  async eval(expr) {
    const r = await this.s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }

  async waitFor(expr, timeoutMs, pollMs = 100) {
    const t0 = Date.now();
    for (;;) {
      const v = await this.eval(expr);
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${expr.slice(0, 120)}`);
      await sleep(pollMs);
    }
  }

  async click(x, y) {
    await this.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  async key(k) {
    const key = k === 'Space' ? ' ' : k;
    const code = k === 'Space' ? 'Space' : /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^\d$/.test(k) ? `Digit${k}` : k;
    await this.s('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key.length === 1 ? key : undefined });
    await this.s('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
  }

  /** Centre of a visible, clickable button (the title page fades in; until it is shown it ignores the pointer). */
  buttonCentre(sel) {
    return `(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b||b.hidden)return null;const sc=b.closest('.screen');
      if(sc&&getComputedStyle(sc).pointerEvents==='none')return null;const r=b.getBoundingClientRect();
      return r.width>0&&r.height>0?[r.x+r.width/2,r.y+r.height/2]:null;})()`;
  }

  async startCapture({ fromNavigation = false } = {}) {
    const o = this.o;
    this.events = [];
    this.cpu0 = await this.cpuSample();
    if (o.trace) {
      const cats = [...TRACE_CATS, ...(o.gpuTrace ? ['gpu'] : [])];
      this.traceDone = null;
      await this.cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: cats } });
    }
    if (o.profile) {
      await this.s('Profiler.enable');
      await this.s('Profiler.setSamplingInterval', { interval: o.interval });
      await this.s('Profiler.start');
    }
    if (!fromNavigation) {
      // align the trace clock with the page clock; drop what the page recorded before this moment
      this.syncPage = await this.eval(`(()=>{window.__probe.reset();const t=performance.now();performance.mark('probe:sync2');return t;})()`);
    }
    this.fromNavigation = fromNavigation;
  }

  async stopCapture() {
    const o = this.o;
    const out = { profile: null, events: [], page: null };
    if (o.profile) out.profile = (await this.s('Profiler.stop')).profile;
    if (o.trace) {
      const done = new Promise((r) => (this.traceDone = r));
      await this.cdp.send('Tracing.end');
      await Promise.race([done, sleep(60000)]);
      out.events = this.events;
    }
    out.page = JSON.parse(await this.eval('JSON.stringify(window.__probe)'));
    out.nav = await this.eval(`(()=>{const n=performance.getEntriesByType('navigation')[0]||{};const pa=Object.fromEntries(performance.getEntriesByType('paint').map(p=>[p.name,p.startTime]));
      const res=performance.getEntriesByType('resource').map(r=>({n:r.name.replace(/https?:\\/\\/[^/]+\\//,''),s:r.startTime,e:r.responseEnd,sz:r.transferSize}));
      return {domInteractive:n.domInteractive,dcl:n.domContentLoadedEventEnd,load:n.loadEventEnd,responseEnd:n.responseEnd,paint:pa,resources:res,fonts:[...document.fonts].map(f=>f.family+' '+f.style+' '+f.status),
        bundle:window.__bundle?{assets:window.__bundle.assets.length,missing:window.__bundle.missing}:null,renderStats:window.__renderStats||null,canvas:{w:document.getElementById('scene').width,h:document.getElementById('scene').height},ua:navigator.userAgent};})()`);
    const c1 = await this.cpuSample();
    const secs = (c1.at - this.cpu0.at) / 1000;
    out.cpu = {
      seconds: Math.round(secs * 10) / 10,
      systemBusyPct: Math.round((1 - (c1.sys.idle - this.cpu0.sys.idle) / (c1.sys.total - this.cpu0.sys.total)) * 1000) / 10,
      // CPU seconds used per second of wall time by each browser process type (1.0 = one core fully busy)
      browserProcessCores: Object.fromEntries(Object.keys(c1.by).map((k) => [k, Math.round(((c1.by[k] - (this.cpu0.by[k] || 0)) / secs) * 100) / 100])),
    };
    out.syncPage = this.fromNavigation ? out.page.syncT : this.syncPage;
    out.syncName = this.fromNavigation ? 'probe:sync' : 'probe:sync2';
    return out;
  }

  async close() {
    try {
      // no graceful Browser.close: the whole tree goes at once (taskkill /T needs the main process alive), then any orphans
      killTree(this.browser?.child.pid);
      this.browser?.child.kill();
      killByProfile(this.browser?.profile);
    } catch { /* already gone */ }
    killTree(this.server?.child.pid);
    this.server?.child.kill();
    try {
      rmSync(this.browser.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      console.log(`[note] could not remove ${this.browser.profile} (still locked); it is inside the ignored .tmp/`);
    }
  }
}

// ------------------------------------------------------------------------------------------------ analysis

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

function frameStats(frames, window) {
  const ts = window ? frames.filter((t) => t >= window[0] && t <= window[1]) : frames;
  const gaps = [];
  for (let i = 1; i < ts.length; i++) gaps.push({ t: ts[i], gap: ts[i] - ts[i - 1] });
  const sorted = gaps.map((g) => g.gap).sort((a, b) => a - b);
  const span = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
  let lost = 0;
  const period = pct(sorted, 50) || 1000 / 60; // the display's period (the headless browser follows the monitor's refresh rate)
  for (const g of sorted) if (g > period * 1.5) lost += Math.max(0, Math.round(g / period) - 1);
  return {
    frames: ts.length, spanS: r1(span / 1000), fps: span ? r1(((ts.length - 1) / span) * 1000) : 0, p50: r1(pct(sorted, 50)), p95: r1(pct(sorted, 95)), p99: r1(pct(sorted, 99)),
    max: r1(sorted[sorted.length - 1] || 0), over33: sorted.filter((g) => g > 33.4).length, over50: sorted.filter((g) => g > 50).length, over100: sorted.filter((g) => g > 100).length,
    droppedFrames: lost, worst: gaps.slice().sort((a, b) => b.gap - a.gap).slice(0, 12).map((g) => ({ t: r1(g.t), gap: r1(g.gap) })), gaps,
  };
}

function shortUrl(u) {
  if (!u) return '';
  return u.replace(/^https?:\/\/[^/]+\//, '').replace(/^file:\/\/\/.*\/(?=[^/]*$)/, 'page:').replace(/^rnt:\/\/app\//, '').replace(/^rnt\//, '');
}

/** Sample list of a CPU profile on the page clock: { t (ms), w (ms), id, key, kind }. */
function profileSamples(profile, offsetMs) {
  const nodes = new Map();
  const parent = new Map();
  for (const n of profile.nodes) {
    nodes.set(n.id, n);
    for (const c of n.children || []) parent.set(c, n.id);
  }
  const info = new Map();
  const infoOf = (id) => {
    let i = info.get(id);
    if (i) return i;
    const n = nodes.get(id);
    const cf = n.callFrame;
    const name = cf.functionName || '(anonymous)';
    const special = name.startsWith('(') && name !== '(anonymous)';
    const key = special ? name : `${name} ${shortUrl(cf.url)}:${cf.lineNumber + 1}`;
    const chain = [];
    const seen = new Set();
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const c = nodes.get(cur).callFrame;
      const nm = c.functionName || '(anonymous)';
      if (nm.startsWith('(') && nm !== '(anonymous)') continue;
      const k = `${nm} ${shortUrl(c.url)}:${c.lineNumber + 1}`;
      if (!seen.has(k)) { seen.add(k); chain.push(k); }
    }
    i = { key, file: special ? name : shortUrl(cf.url) || '(native)', idle: name === '(idle)', special, chain };
    info.set(id, i);
    return i;
  };
  const n = profile.samples.length;
  const t = new Float64Array(n);
  const w = new Float64Array(n);
  let cum = profile.startTime;
  for (let i = 0; i < n; i++) {
    cum += profile.timeDeltas[i];
    t[i] = cum / 1000 - offsetMs;
  }
  for (let i = 0; i < n; i++) w[i] = Math.min(10, (i + 1 < n ? t[i + 1] - t[i] : 0.2));
  return { n, t, w, ids: profile.samples, infoOf, deltas: profile.timeDeltas };
}

function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Self / total / per-file time (ms) of the samples in the ranges [[i0, i1), ...]; idle samples are skipped. */
function aggregate(ps, ranges, top) {
  const self = new Map();
  const total = new Map();
  const files = new Map();
  let idle = 0;
  let busy = 0;
  let gc = 0;
  let program = 0;
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const [i0, i1] of ranges) {
    for (let i = i0; i < i1; i++) {
      const inf = ps.infoOf(ps.ids[i]);
      const w = ps.w[i];
      if (inf.idle) { idle += w; continue; }
      busy += w;
      if (inf.key === '(garbage collector)') gc += w;
      if (inf.key === '(program)') program += w;
      add(self, inf.key, w);
      add(files, inf.file, w);
      if (inf.special) add(total, inf.key, w);
      for (const k of inf.chain) add(total, k, w);
    }
  }
  const rank = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ fn: k, ms: r1(v) }));
  return { busy: r1(busy), idle: r1(idle), gc: r1(gc), program: r1(program), self: rank(self, top), total: rank(total, top), files: rank(files, Math.max(8, top >> 1)).map((x) => ({ file: x.fn, ms: x.ms })) };
}

/**
 * Busy stretches of the main thread on the page clock: the union of the trace's main-thread events (>= 0.3 ms each:
 * rAF callbacks, timers, script, layout, paint, GC...) and the Long Tasks API entries, merged across gaps < gapMs.
 * (The profiler's own (idle) marker is not usable for this: an idle main thread shows up as (program).)
 */
function busyRuns(tr, longtasks, minMs, gapMs = 1) {
  const iv = longtasks.map((x) => [x.t, x.t + x.d]);
  if (tr.ok) for (const e of tr.main) iv.push([e.t0, e.t0 + e.dur]);
  iv.sort((a, b) => a[0] - b[0]);
  const runs = [];
  for (const [a, b] of iv) {
    const last = runs[runs.length - 1];
    if (last && a - last.t1 < gapMs) last.t1 = Math.max(last.t1, b);
    else runs.push({ t0: a, t1: b });
  }
  return runs.map((r) => ({ ...r, dur: r.t1 - r.t0 })).filter((r) => r.dur >= minMs);
}

function traceSummary(events, syncName, syncPage, winFilter) {
  const sync = events.find((e) => e.name === syncName);
  if (!sync) return { ok: false, reason: `no ${syncName} mark in the trace (${events.length} events kept)` };
  const offsetMs = sync.ts / 1000 - syncPage;
  const names = new Map();
  const procNames = new Map();
  for (const e of events) {
    if (e.ph !== 'M') continue;
    if (e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
    if (e.name === 'process_name') procNames.set(e.pid, e.args.name);
  }
  const mainKey = `${sync.pid}:${sync.tid}`;
  const main = events.filter((e) => e.ph === 'X' && `${e.pid}:${e.tid}` === mainKey).map((e) => ({ name: e.name, t0: e.ts / 1000 - offsetMs, dur: e.dur / 1000 }));
  const gpu = events.filter((e) => e.ph === 'X' && procNames.get(e.pid) === 'GPU Process' && names.get(`${e.pid}:${e.tid}`) === 'CrGpuMain').map((e) => ({ name: e.name, t0: e.ts / 1000 - offsetMs, dur: e.dur / 1000 }));
  return { ok: true, offsetMs, main, gpu, mainThread: names.get(mainKey), pid: sync.pid };
}

const LAYOUTISH = new Set(['Layout', 'UpdateLayoutTree', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'HitTest', 'UpdateLayer', 'CompositeLayers', 'ParseHTML']);

function traceBreakdown(tr, t0, t1) {
  if (!tr.ok) return null;
  const by = {};
  for (const e of tr.main) {
    if (e.t0 + e.dur < t0 || e.t0 > t1) continue;
    const ov = Math.min(t1, e.t0 + e.dur) - Math.max(t0, e.t0);
    if (e.name === 'MinorGC' || e.name === 'MajorGC') by[e.name] = (by[e.name] || 0) + ov;
    else if (LAYOUTISH.has(e.name) || /^v8\.(compile|evaluateModule)|EvaluateScript|TimerFire|FireAnimationFrame|HandlePostMessage|ImageDecode|MessageEvent|EventDispatch/.test(e.name)) by[e.name] = (by[e.name] || 0) + ov;
  }
  return Object.fromEntries(Object.entries(by).filter(([, v]) => v >= 0.5).map(([k, v]) => [k, r1(v)]).sort((a, b) => b[1] - a[1]));
}

function analyze(cap, o, label, window) {
  const out = { label };
  const page = cap.page;
  const tr = cap.events.length ? traceSummary(cap.events, cap.syncName, cap.syncPage) : { ok: false, reason: 'trace off' };
  out.trace = { ok: tr.ok, reason: tr.reason };
  const inWin = (t) => !window || (t >= window[0] && t <= window[1]);
  out.frames = frameStats(page.frames, window);
  // the game's own per-frame work
  const fr = page.fr.filter((f) => inWin(f[1]));
  const col = (i) => fr.map((f) => f[i]).sort((a, b) => a - b);
  const stat = (arr) => ({ p50: r2(pct(arr, 50)), p95: r2(pct(arr, 95)), p99: r2(pct(arr, 99)), max: r1(arr[arr.length - 1] || 0), mean: r2(arr.reduce((s, v) => s + v, 0) / (arr.length || 1)) });
  const total = fr.map((f) => Math.max(0, f[2]) + f[3] + f[4] + f[5] + f[6]).sort((a, b) => a - b);
  out.frameWork = { frames: fr.length, sim: stat(col(2).map((v) => Math.max(0, v))), draw: stat(col(4)), hud: stat(col(5)), audio: stat(col(6)), total: stat(total) };
  out.frameWorkWorst = fr
    .map((f) => ({ t: r1(f[1]), total: r1(Math.max(0, f[2]) + f[3] + f[4] + f[5] + f[6]), sim: r1(Math.max(0, f[2])), draw: r1(f[4]), hud: r1(f[5]), audio: r1(f[6]), refresh: r1(f[3]) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
  out.longtasksApi = page.tasks.filter((x) => inWin(x.t)).map((x) => ({ t: r1(x.t), d: r1(x.d) }));
  out.loaf = page.loaf.filter((x) => inWin(x.t)).map((x) => ({
    t: r1(x.t), d: r1(x.d), blocking: r1(x.blocking || 0), render: r1(x.renderStart ? x.renderStart - x.t : 0), style: r1(x.styleStart ? x.styleStart - x.t : 0),
    scripts: x.scripts.slice(0, 4).map((s) => ({ d: r1(s.d), inv: s.inv, fn: s.fn, url: shortUrl(s.url), forced: r1(s.forced || 0) })),
  }));
  out.page = {
    seasons: page.seasons.filter((s) => inWin(s.t)).map((s) => ({ t: r1(s.t), season: s.season, time: r1(s.time) })), phases: page.phases.map((s) => ({ t: r1(s.t), phase: s.phase, time: r1(s.time) })),
    stats: page.stats.filter((s) => inWin(s.t)).map((s) => ({ ...s, t: r1(s.t) })),
    samples: page.samples.filter((s) => inWin(s.t)).map((s) => ({ ...s, t: r1(s.t), heapMB: r1((s.heap || 0) / 1048576), heap: undefined })),
    marks: page.marks.filter((m) => inWin(m.t)).map((m) => ({ ...m, t: r1(m.t) })),
  };
  out.hooks = {
    getImageData: { n: page.gi.n, totalMs: r1(page.gi.ms), maxMs: r1(page.gi.max), slow: page.gi.slow.filter((x) => inWin(x.t)).map((x) => ({ t: r1(x.t), ms: r1(x.d), size: `${x.w}x${x.h}`, at: x.at })) },
    canvasAllocs: { total: page.canvN, big: page.canv.filter((c) => inWin(c.t)).map((c) => ({ t: r1(c.t), kind: c.kind, size: `${c.w}x${c.h}`, mpx: r2((c.w * c.h) / 1e6), at: c.at })) },
    json: page.json.filter((x) => inWin(x.t)).map((x) => ({ t: r1(x.t), op: x.op, ms: r1(x.ms), len: x.len, at: x.at })),
    localStorage: page.store.filter((x) => inWin(x.t)).map((x) => ({ t: r1(x.t), key: x.key, len: x.len, ms: r1(x.ms) })),
    audioBuffers: { n: page.audio.filter((x) => inWin(x.t)).length, ms: r1(page.audio.filter((x) => inWin(x.t)).reduce((s, x) => s + x.ms, 0)), samples: page.audio.filter((x) => inWin(x.t)).reduce((s, x) => s + x.len * x.ch, 0) },
    images: { n: page.imgs.filter((x) => inWin(x.t1)).length, first: r1(Math.min(...page.imgs.map((x) => x.t0), Infinity)), last: r1(Math.max(...page.imgs.map((x) => x.t1), -Infinity)), maxDecodeMs: r1(Math.max(0, ...page.imgs.map((x) => x.t1 - x.t0))) },
    fetches: { n: page.fetches.length, first: r1(Math.min(...page.fetches.map((x) => x.t0), Infinity)), last: r1(Math.max(...page.fetches.map((x) => x.t1), -Infinity)) },
  };
  if (tr.ok) {
    const main = tr.main.filter((e) => inWin(e.t0));
    const sum = (f) => r1(main.filter(f).reduce((s, e) => s + e.dur, 0));
    const gcs = main.filter((e) => e.name === 'MinorGC' || e.name === 'MajorGC');
    out.gc = {
      minor: { n: gcs.filter((e) => e.name === 'MinorGC').length, ms: r1(gcs.filter((e) => e.name === 'MinorGC').reduce((s, e) => s + e.dur, 0)), max: r1(Math.max(0, ...gcs.filter((e) => e.name === 'MinorGC').map((e) => e.dur))) },
      major: { n: gcs.filter((e) => e.name === 'MajorGC').length, ms: r1(gcs.filter((e) => e.name === 'MajorGC').reduce((s, e) => s + e.dur, 0)), max: r1(Math.max(0, ...gcs.filter((e) => e.name === 'MajorGC').map((e) => e.dur))) },
      worst: gcs.slice().sort((a, b) => b.dur - a.dur).slice(0, 6).map((e) => ({ t: r1(e.t0), kind: e.name, ms: r1(e.dur) })),
    };
    out.mainThread = {
      thread: tr.mainThread,
      layout: sum((e) => e.name === 'Layout'), styleRecalc: sum((e) => e.name === 'UpdateLayoutTree'), prePaint: sum((e) => e.name === 'PrePaint'), paint: sum((e) => e.name === 'Paint'),
      layerize: sum((e) => e.name === 'Layerize'), animationFrames: sum((e) => e.name === 'FireAnimationFrame'), timers: sum((e) => e.name === 'TimerFire'), compile: sum((e) => /^v8\.compile/.test(e.name)), evalModule: sum((e) => /^v8\.evaluateModule|EvaluateScript/.test(e.name)),
      longEvents: main.filter((e) => e.dur >= 16).sort((a, b) => b.dur - a.dur).slice(0, 15).map((e) => ({ t: r1(e.t0), name: e.name, ms: r1(e.dur) })),
    };
    if (tr.gpu.length) {
      const g = tr.gpu.filter((e) => inWin(e.t0));
      const gt = g.filter((e) => e.name === 'GPUTask');
      const span = window ? window[1] - window[0] : (page.frames[page.frames.length - 1] || 0) - (page.frames[0] || 0);
      out.gpu = {
        busyMs: r1(gt.reduce((s, e) => s + e.dur, 0)), busyPctOfSpan: span ? r1((gt.reduce((s, e) => s + e.dur, 0) / span) * 100) : 0, tasksOver16: gt.filter((e) => e.dur >= 16).length,
        worst: gt.slice().sort((a, b) => b.dur - a.dur).slice(0, 8).map((e) => ({ t: r1(e.t0), ms: r1(e.dur) })),
        endRasterMs: r1(g.filter((e) => /DoEndRaster/.test(e.name) && !/Flush/.test(e.name)).reduce((s, e) => s + e.dur, 0)),
      };
    }
  }
  const runsAll = busyRuns(tr, page.tasks, 0).filter((r) => inWin(r.t0));
  const runs = runsAll.filter((r) => r.dur >= 16);
  out.runs = {
    n: runs.length, totalMs: r1(runs.reduce((s2, r) => s2 + r.dur, 0)), over32: runs.filter((r) => r.dur >= 32).length, over50: runs.filter((r) => r.dur >= 50).length, over100: runs.filter((r) => r.dur >= 100).length,
    busyMs: r1(runsAll.reduce((s2, r) => s2 + r.dur, 0)), list: runs.map((r) => [r1(r.t0), r1(r.dur)]),
  };
  if (cap.profile) {
    if (!tr.ok) {
      out.profile = { ok: false, reason: 'no clock sync (trace off or mark missing)' };
    } else {
      const ps = profileSamples(cap.profile, tr.offsetMs);
      const range = (r) => [lowerBound(ps.t, r.t0), lowerBound(ps.t, r.t1)];
      const sortedDeltas = Array.from(ps.deltas).sort((a, b) => a - b);
      const all = aggregate(ps, runsAll.map(range), o.top);
      out.profile = {
        ok: true, samples: ps.n, deltaUs: { p50: pct(sortedDeltas, 50), p95: pct(sortedDeltas, 95), max: sortedDeltas[sortedDeltas.length - 1] }, overall: all,
        runs: runs
          .slice()
          .sort((a, b) => b.dur - a.dur)
          .slice(0, 24)
          .map((r) => {
            const a = aggregate(ps, [range(r)], 6);
            return { t: r1(r.t0), dur: r1(r.dur), gc: a.gc, program: a.program, self: a.self, total: a.total.slice(0, 5), files: a.files.slice(0, 4), trace: traceBreakdown(tr, r.t0, r.t1) };
          }),
      };
      // the same, restricted to the long runs only: what the stutter is made of
      const lr = aggregate(ps, runs.map(range), 400);
      const cut = (x) => x.slice(0, o.top);
      out.profile.inLongRuns = { busy: lr.busy, self: cut(lr.self), total: cut(lr.total), files: lr.files };
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ text report

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
const padl = (s, n) => String(s).padStart(n);

function header(sess, o, extra) {
  const gpu = (sess.sys.gpu?.devices || []).map((d) => d.deviceString).join(' | ');
  const feat = sess.sys.gpu?.featureStatus || {};
  return [
    `# ${o.scenario} / ${o.build}${o.tag ? ` / ${o.tag}` : ''}  (${new Date().toISOString()})`,
    `browser: ${sess.version.product} headless=new, ${o.size.join('x')} dpr ${o.dpr}${o.throttle > 1 ? `, CPU throttle x${o.throttle}` : ''}; profiler ${o.profile ? `${o.interval} us` : 'off'}, trace ${o.trace ? 'on' : 'off'}${o.gpuTrace ? '+gpu' : ''}, page hooks ${o.hooks ? 'on' : 'off'}`,
    `gpu adapters: ${gpu || '?'}; 2d_canvas=${feat['2d_canvas']} gpu_compositing=${feat.gpu_compositing} rasterization=${feat.rasterization}`,
    `url: ${sess.url}`,
    `system CPU busy before the run: ${o.preLoadPct}%`,
    ...(extra || []),
  ];
}

function framesLine(f) {
  return `frames: ${f.frames} over ${f.spanS} s (${f.fps} fps)  gap p50 ${f.p50}  p95 ${f.p95}  p99 ${f.p99}  max ${f.max} ms  | >33ms: ${f.over33}  >50ms: ${f.over50}  >100ms: ${f.over100}  | est. dropped frames: ${f.droppedFrames}`;
}

function describeRun(r) {
  const top = r.self.slice(0, 3).map((x) => `${x.fn} ${x.ms}`).join('; ');
  const tr = r.trace && Object.keys(r.trace).length ? ` [trace: ${Object.entries(r.trace).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')}]` : '';
  return `${padl(r.t, 8)}  ${padl(r.dur, 7)}  gc ${padl(r.gc, 5)}  ${top}${tr}`;
}

function renderText(a, n) {
  const L = [];
  L.push(`## ${a.label}`);
  L.push(framesLine(a.frames));
  if (a.frames.worst.length) L.push(`worst gaps (t ms: gap ms): ${a.frames.worst.slice(0, 8).map((g) => `${g.t}:${g.gap}`).join('  ')}`);
  const fw = a.frameWork;
  L.push(`game work per frame (ms, from wrapped main-loop calls) p50/p95/p99/max: sim+persist ${fw.sim.p50}/${fw.sim.p95}/${fw.sim.p99}/${fw.sim.max}  draw ${fw.draw.p50}/${fw.draw.p95}/${fw.draw.p99}/${fw.draw.max}  hud ${fw.hud.p50}/${fw.hud.p95}/${fw.hud.p99}/${fw.hud.max}  audio ${fw.audio.p50}/${fw.audio.p95}/${fw.audio.p99}/${fw.audio.max}  total mean ${fw.total.mean}`);
  if (a.frameWorkWorst.length) L.push(`worst frames by game work (t: total = sim/draw/hud/audio): ${a.frameWorkWorst.slice(0, 6).map((f) => `${f.t}: ${f.total}=${f.sim}/${f.draw}/${f.hud}/${f.audio}`).join('  ')}`);
  L.push(`long tasks API (>=50ms): ${a.longtasksApi.length}${a.longtasksApi.length ? ` e.g. ${a.longtasksApi.slice(0, 8).map((x) => `${x.t}:${x.d}`).join(' ')}` : ''}; long-animation-frames: ${a.loaf.length}`);
  if (a.gc) L.push(`GC (main thread): minor ${a.gc.minor.n}x ${a.gc.minor.ms} ms (max ${a.gc.minor.max}); major ${a.gc.major.n}x ${a.gc.major.ms} ms (max ${a.gc.major.max})${a.gc.worst.length ? `; worst ${a.gc.worst.map((g) => `${g.kind} ${g.ms}@${g.t}`).join(', ')}` : ''}`);
  if (a.mainThread) L.push(`main thread (trace): layout ${a.mainThread.layout} ms, style ${a.mainThread.styleRecalc}, prepaint ${a.mainThread.prePaint}, paint ${a.mainThread.paint}, layerize ${a.mainThread.layerize}, rAF callbacks ${a.mainThread.animationFrames}, timers ${a.mainThread.timers}, compile ${a.mainThread.compile}, module eval ${a.mainThread.evalModule}`);
  if (a.gpu) L.push(`GPU process (CrGpuMain): busy ${a.gpu.busyMs} ms = ${a.gpu.busyPctOfSpan}% of the span; GPUTasks >=16ms: ${a.gpu.tasksOver16}; DoEndRaster ${a.gpu.endRasterMs} ms; worst ${a.gpu.worst.slice(0, 5).map((g) => `${g.ms}@${g.t}`).join(' ')}`);
  const h = a.hooks;
  L.push(`getImageData: ${h.getImageData.n} calls, ${h.getImageData.totalMs} ms total (max ${h.getImageData.maxMs}); canvas width/height sets/ctors: ${h.canvasAllocs.total} (>=0.2 Mpx listed: ${h.canvasAllocs.big.length}); createBuffer (audio): ${h.audioBuffers.n} buffers ${h.audioBuffers.ms} ms ${h.audioBuffers.samples} samples; JSON >=1ms: ${h.json.length}; localStorage.setItem: ${h.localStorage.length}${h.localStorage.length ? ` (${h.localStorage.map((x) => `${x.ms}ms/${Math.round(x.len / 1024)}KB`).slice(0, 4).join(', ')})` : ''}`);
  L.push(`main-thread busy stretches (trace events + long tasks, gaps < 1 ms merged): total busy ${a.runs.busyMs} ms; stretches >=16 ms: ${a.runs.n} (sum ${a.runs.totalMs} ms; >=32: ${a.runs.over32}, >=50: ${a.runs.over50}, >=100: ${a.runs.over100})`);
  if (a.cpu) L.push(`cpu: system ${a.cpu.systemBusyPct}% busy over ${a.cpu.seconds} s; browser process cores in use: ${JSON.stringify(a.cpu.browserProcessCores)}`);
  if (a.profile?.ok) {
    const p = a.profile;
    L.push(`profile: ${p.samples} samples (delta us p50 ${p.deltaUs.p50} p95 ${p.deltaUs.p95}); inside main-thread busy stretches: ${p.overall.busy} ms (gc ${p.overall.gc}, native/program ${p.overall.program})`);
    L.push('longest busy stretches (start ms, dur ms, gc, top self fns):');
    for (const r of p.runs.slice(0, n)) L.push(`  ${describeRun(r)}`);
    L.push(`top SELF time overall (ms):`);
    for (const x of p.overall.self.slice(0, n)) L.push(`  ${padl(x.ms, 8)}  ${x.fn}`);
    L.push(`top TOTAL time overall (ms):`);
    for (const x of p.overall.total.slice(0, n)) L.push(`  ${padl(x.ms, 8)}  ${x.fn}`);
    L.push('by file (self ms):  ' + p.overall.files.map((f) => `${f.file} ${f.ms}`).join('  |  '));
    if (p.inLongRuns) {
      L.push(`inside the long runs only, top SELF (ms):`);
      for (const x of p.inLongRuns.self.slice(0, Math.min(n, 12))) L.push(`  ${padl(x.ms, 8)}  ${x.fn}`);
      L.push(`inside the long runs only, top TOTAL (ms):`);
      for (const x of p.inLongRuns.total.slice(0, Math.min(n, 12))) L.push(`  ${padl(x.ms, 8)}  ${x.fn}`);
    }
  } else if (a.profile) {
    L.push(`profile: ${a.profile.reason}`);
  }
  if (h.getImageData.slow.length) L.push(`slow getImageData (>=3ms): ${h.getImageData.slow.slice(0, 5).map((x) => `${x.ms}ms ${x.size} @${x.t} ${x.at}`).join(' || ')}`);
  if (h.canvasAllocs.big.length) L.push(`big canvas allocations: ${h.canvasAllocs.big.slice(0, 10).map((c) => `${c.mpx}Mpx ${c.size} ${c.kind} @${c.t}${c.at ? ' ' + c.at.slice(0, 160) : ''}`).join(' || ')}`);
  if (h.json.length) L.push(`JSON >=1ms: ${h.json.slice(0, 6).map((x) => `${x.op} ${x.ms}ms ${Math.round((x.len || 0) / 1024)}KB @${x.t}${x.at ? ' ' + x.at.slice(0, 120) : ''}`).join(' || ')}`);
  return L;
}

function writeResult(o, name, result, text, frames, rawProfile) {
  const dir = resolve(root, o.out);
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${name}-${o.build}${o.tag ? `-${o.tag}` : ''}`);
  // keep the files compact: the per-gap list goes into its own file
  writeFileSync(`${base}.json`, JSON.stringify(result, (k, v) => (k === 'gaps' ? undefined : v)));
  writeFileSync(`${base}.txt`, text.join('\n') + '\n');
  if (frames) writeFileSync(`${base}.frames.json`, JSON.stringify(frames));
  if (rawProfile && o.keepProfile) writeFileSync(`${base}.cpuprofile`, JSON.stringify(rawProfile));
  console.log(`[result] ${base}.txt  ${base}.json`);
}

// ------------------------------------------------------------------------------------------------ scenarios

async function startGame(sess, sel, o) {
  const pt = await sess.waitFor(sess.buttonCentre(sel), 60000, 100);
  sess.titleVisibleAt = await sess.eval('performance.now()');
  await sess.eval(`window.__probe.mark('title-visible')`);
  if (o.titleDwell > 0) await sleep(o.titleDwell);
  const pt2 = (await sess.eval(sess.buttonCentre(sel))) || pt;
  await sess.eval(`window.__probe.mark('click')`);
  await sess.click(pt2[0], pt2[1]);
  for (let tries = 0; tries < 5; tries++) {
    await sleep(500);
    if ((await sess.eval(`window.__game.state.phase`)) === 'playing') return true;
    const p = await sess.eval(sess.buttonCentre(sel));
    if (p) await sess.click(p[0], p[1]);
  }
  return false;
}

async function scenarioStartup(o) {
  const sess = new Session(o);
  let save = null;
  if (o.withSave) save = await makeSave(o, 610, o.nodes);
  await sess.open({ save });
  const text = header(sess, o, [`start: ${o.withSave ? 'saved glade (continue)' : 'fresh game'}, title dwell ${o.titleDwell} ms, play ${o.play} s`]);
  try {
    await sess.startCapture({ fromNavigation: true });
    const loaded = new Promise((r) => {
      sess.cdp.on((m) => m.method === 'Page.loadEventFired' && m.sessionId === sess.sessionId && r());
    });
    await sess.s('Page.navigate', { url: sess.url });
    sess.boost(); // the page's renderer is a new process
    await Promise.race([loaded, sleep(30000)]);
    const sel = o.withSave ? 'button[data-act="continue-save"]' : 'button[data-act="start"]';
    const started = await startGame(sess, sel, o);
    const clickedAt = await sess.eval('performance.now()');
    await sleep(o.play * 1000);
    const cap = await sess.stopCapture();
    const a = analyze(cap, o, `startup (navigation .. play started at ${r1(clickedAt / 1000)} s, +${o.play} s of play)`, null);
    a.started = started;
    a.nav = cap.nav;
    a.problems = sess.problems;
    // what loads when
    const marks = [];
    const add = (t, what) => t !== undefined && Number.isFinite(t) && marks.push({ t: r1(t), what });
    add(cap.nav.dcl, 'DOMContentLoaded end');
    add(cap.nav.load, 'window load end');
    add(cap.nav.paint['first-paint'], 'first paint');
    add(cap.nav.paint['first-contentful-paint'], 'first contentful paint');
    for (const m of a.page.marks) add(m.t, `${m.name}${m.ms !== undefined ? ` (${r1(m.ms)} ms)` : ''}${m.id !== undefined && m.name.startsWith('worker') ? ` #${m.id}` : ''}${m.season ? ` ${m.season}` : ''}${m.url ? ` ${m.url}` : ''}`);
    add(a.hooks.fetches.first, 'first fetch() issued');
    add(a.hooks.images.first, 'first createImageBitmap');
    add(a.hooks.images.last, `last createImageBitmap done (${a.hooks.images.n} images, slowest ${a.hooks.images.maxDecodeMs} ms)`);
    for (const s of a.page.stats) add(s.t, `renderStats: ${JSON.stringify({ ...s, t: undefined })}`);
    for (const s of a.page.phases) add(s.t, `phase -> ${s.phase}`);
    const firstHeavy = cap.page.fr.filter((f) => f[2] + f[3] + f[4] + f[5] + f[6] > 30).slice(0, 12);
    for (const f of firstHeavy) add(f[1], `frame with ${r1(f[2] + f[3] + f[4] + f[5] + f[6])} ms of game work (sim ${r1(f[2])} draw ${r1(f[4])} hud ${r1(f[5])} audio ${r1(f[6])})`);
    marks.sort((x, y) => x.t - y.t);
    a.timeline = marks;
    text.push(...renderText(a, o.top));
    text.push('timeline (page ms from navigation start):');
    for (const m of marks) text.push(`  ${padl(m.t, 8)}  ${m.what}`);
    if (cap.nav.bundle) text.push(`bundle: ${cap.nav.bundle.assets} embedded assets, missing: ${JSON.stringify(cap.nav.bundle.missing)}`);
    text.push(`fonts: ${cap.nav.fonts.join('; ')}`);
    const res = cap.nav.resources.filter((r) => r.e - r.s > 20 || /manifest|\.js$|\.css$/.test(r.n)).slice(0, 14);
    if (res.length) text.push(`resources: ${res.map((r) => `${r.n.slice(-40)} ${r1(r.s)}..${r1(r.e)}`).join(' | ')}`);
    if (sess.problems.length) text.push(`page problems: ${sess.problems.slice(0, 5).join(' | ')}`);
    writeResult(o, 'startup', { options: o, a }, text, a.frames.gaps.map((g) => [r1(g.t), r1(g.gap)]), cap.profile);
    console.log(text.slice(0, 40).join('\n'));
  } finally {
    await sess.close();
  }
}

/** A synthetic player: every few seconds a real mouse drag from a random node in a random downward direction. */
async function playerLoop(sess, stopRef) {
  let rng = mulberry(12345);
  while (!stopRef.stop) {
    await sleep(2500 + rng() * 2500);
    if (stopRef.stop) break;
    try {
      const nodes = await sess.eval(`(()=>{const g=window.__game,s=g.state;if(s.phase!=='playing')return null;const v=g.view;const al=s.net.nodes.filter(n=>n.alive);if(!al.length)return null;
        return al.slice(-60).concat(al.slice(0,20)).map(n=>[n.x*v.scale+v.ox,n.y*v.scale+v.oy]);})()`);
      if (!nodes) continue;
      const [x0, y0] = nodes[Math.floor(rng() * nodes.length)];
      const a = Math.PI * (0.1 + 0.8 * rng());
      const len = 90 + 110 * rng();
      await sess.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
      await sess.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
      const steps = Math.ceil(len / 8);
      for (let i = 1; i <= steps; i++) {
        await sess.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + Math.cos(a) * len * (i / steps), y: y0 + Math.sin(a) * len * (i / steps), buttons: 1 });
        await sleep(12);
      }
      await sess.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + Math.cos(a) * len, y: y0 + Math.sin(a) * len, button: 'left', buttons: 0, clickCount: 1 });
    } catch (err) {
      /* the page may be busy or gone; the next round tries again */
    }
  }
}

async function loadSaved(sess) {
  const ok = await sess.waitFor(sess.buttonCentre('button[data-act="continue-save"]'), 60000, 100);
  await sleep(500);
  const pt = (await sess.eval(sess.buttonCentre('button[data-act="continue-save"]'))) || ok;
  await sess.click(pt[0], pt[1]);
  for (let tries = 0; tries < 6; tries++) {
    await sleep(500);
    if ((await sess.eval(`window.__game.state.phase`)) === 'playing') return;
    // a first-encounter card (the first nematode on screen, the honey fungus waking) pauses the glade: read it, go on
    const ok = await sess.eval(sess.buttonCentre('button[data-act="callout-ok"]'));
    if (ok) {
      await sess.click(ok[0], ok[1]);
      continue;
    }
    const p = await sess.eval(sess.buttonCentre('button[data-act="continue-save"]'));
    if (p) await sess.click(p[0], p[1]);
  }
  throw new Error('the saved glade did not start');
}

/** A page of the notebook (chapter summary, year page) pauses the game; the player reads it and goes on: click its button, else Space. */
async function dismissPage(sess) {
  const pt = await sess.eval(sess.buttonCentre('.screen.open button[data-act="continue"]'));
  if (pt) await sess.click(pt[0], pt[1]);
  else await sess.key('Space');
}

async function scenarioSeasons(o) {
  const all = {};
  const text = [];
  for (const name of o.boundaries) {
    const B = BOUNDARIES[name];
    if (!B) throw new Error(`unknown boundary ${name}`);
    const save = await makeSave(o, B - o.pre - o.settle, o.nodes);
    const sess = new Session(o);
    await sess.open({ save });
    try {
      if (text.length === 0) text.push(...header(sess, o, [`glade: ${JSON.stringify(save.info)}`]));
      await sess.s('Page.navigate', { url: sess.url });
      await sess.boost();
      await loadSaved(sess);
      // let the loaded glade settle (plate, warm-up, sprites), then record from `pre` s before the boundary
      const waitStart = Date.now();
      for (;;) {
        const st = await sess.eval('({time:window.__game.state.time,phase:window.__game.state.phase})');
        if (st.time >= B - o.pre - 0.2 && st.phase === 'playing') break;
        if (st.phase === 'paused') {
          await sleep(1500);
          await dismissPage(sess);
        }
        if (Date.now() - waitStart > (o.settle + o.pre + 90) * 1000) throw new Error(`timeout waiting for game second ${B - o.pre}: ${JSON.stringify(st)}`);
        await sleep(150);
      }
      await sess.startCapture();
      const settled = await sess.eval(`JSON.stringify(window.__renderStats||{})`);
      let pausedAt = null;
      const deadline = Date.now() + (o.pre + o.post + 120) * 1000;
      const bounds = await new Promise((resolve) => {
        const iv = setInterval(async () => {
          try {
            const st = JSON.parse(await sess.eval(`JSON.stringify({time:window.__game.state.time,phase:window.__game.state.phase,year:!!document.querySelector('.screen.open [data-act="continue"]')})`));
            if (st.phase === 'paused') {
              pausedAt ??= Date.now(); // a page is open: it is read for a few seconds, then dismissed
              if (Date.now() - pausedAt > 4000) {
                pausedAt = null;
                await dismissPage(sess);
              }
            } else pausedAt = null;
            if ((st.phase === 'playing' && st.time >= B + o.post) || Date.now() > deadline) {
              clearInterval(iv);
              resolve(st);
            }
          } catch { /* retry */ }
        }, 500);
      });
      const cap = await sess.stopCapture();
      const change = cap.page.seasons.find((s) => s.time >= B - 1 && s.time <= B + 3) || cap.page.seasons[cap.page.seasons.length - 1];
      const tB = change ? change.t : null;
      const a = analyze(cap, o, `season end ${name} (boundary at page t=${tB === null ? '?' : r1(tB)} ms, game second ${B}; recorded ${o.pre} s before .. ${o.post} s after)`, null);
      a.boundaryT = tB;
      a.settledStats = JSON.parse(settled);
      a.problems = sess.problems;
      a.save = save.info;
      // max frame gap per second relative to the boundary
      if (tB !== null) {
        const bins = [];
        for (let s = -o.pre; s < o.post; s++) {
          const lo = tB + s * 1000;
          const g = a.frames.gaps.filter((x) => x.t >= lo && x.t < lo + 1000).map((x) => x.gap);
          const busy = a.runs.list.filter((r) => r[0] >= lo && r[0] < lo + 1000);
          bins.push({ s, maxGap: r1(Math.max(0, ...g)), over33: g.filter((x) => x > 33.4).length, busyRunMax: r1(Math.max(0, ...busy.map((r) => r[1]))) });
        }
        a.bins = bins;
      }
      all[name] = a;
      const t = renderText(a, o.top);
      text.push('', ...t);
      if (a.bins) {
        text.push('per second relative to the boundary (s: max frame gap ms / frames >33ms / longest busy run ms):');
        text.push('  ' + a.bins.map((b) => `${b.s}:${b.maxGap}/${b.over33}/${b.busyRunMax}`).join('  '));
      }
      text.push(`stats at capture start: ${settled}`);
      text.push(`render stats changes in the window: ${a.page.stats.map((s) => `${s.t}:${JSON.stringify({ ...s, t: undefined })}`).join(' ')}`);
      text.push(`marks: ${a.page.marks.map((m) => `${m.t} ${m.name}${m.ms !== undefined ? ' ' + r1(m.ms) + 'ms' : ''}${m.season ? ' ' + m.season : ''}`).join(' | ')}`);
      if (sess.problems.length) text.push(`page problems: ${sess.problems.slice(0, 5).join(' | ')}`);
      console.log(`[seasons] ${name}: ${framesLine(a.frames)}`);
      void bounds;
    } finally {
      await sess.close();
    }
  }
  writeResult(o, 'seasons', { options: o, runs: all }, text, Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.frames.gaps.map((g) => [r1(g.t), r1(g.gap)])])), null);
}

async function scenarioSteady(o) {
  // late summer glade: 610 s keeps 120 s of x1 or 240 game seconds of x2 inside one season (600..900)
  const startAt = 612;
  const save = await makeSave(o, startAt, o.nodes);
  const sess = new Session(o);
  await sess.open({ save });
  const text = header(sess, o, [`glade: ${JSON.stringify(save.info)}`, `speed x${o.speed}, ${o.duration} s, synthetic player ${o.player ? 'on' : 'off'}`]);
  try {
    await sess.s('Page.navigate', { url: sess.url });
    await sess.boost();
    await loadSaved(sess);
    await sleep(o.settle * 1000);
    if (o.speed !== 1) await sess.eval(`window.__game.actions.setSpeed(${o.speed})`);
    await sess.startCapture();
    const stop = { stop: false };
    const player = o.player ? playerLoop(sess, stop) : Promise.resolve();
    await sleep(o.duration * 1000);
    stop.stop = true;
    await player;
    const cap = await sess.stopCapture();
    const a = analyze(cap, o, `steady play x${o.speed}, ${o.duration} s`, null);
    a.problems = sess.problems;
    a.save = save.info;
    // periodicity: busy runs >= 16 ms listed with their gaps
    const runs = a.runs.list;
    a.periodicity = runs.map((r, i) => [r[0], r[1], i ? r1(r[0] - runs[i - 1][0]) : null]);
    text.push(...renderText(a, o.top));
    text.push('busy runs >=16 ms in time order (t ms, dur ms, since previous ms):');
    text.push('  ' + a.periodicity.slice(0, 150).map((r) => `${r[0]}/${r[1]}${r[2] === null ? '' : '/' + r[2]}`).join('  '));
    const last = a.page.samples[a.page.samples.length - 1];
    const first = a.page.samples[0];
    if (first && last) text.push(`state: nodes ${first.nodes} -> ${last.nodes}, mushrooms ${first.mush} -> ${last.mush}, heap ${first.heapMB} -> ${last.heapMB} MB, game time ${first.time} -> ${last.time}`);
    text.push(`heap samples (MB, 1/s): ${a.page.samples.map((s) => s.heapMB).join(' ')}`);
    if (sess.problems.length) text.push(`page problems: ${sess.problems.slice(0, 5).join(' | ')}`);
    writeResult(o, `steady-x${o.speed}`, { options: o, a }, text, a.frames.gaps.map((g) => [r1(g.t), r1(g.gap)]), cap.profile);
    console.log(text.slice(0, 30).join('\n'));
  } finally {
    await sess.close();
  }
}

/** System-wide CPU busy % over `ms` (other agents' test runs share this machine; a noisy start is reported with the results). */
async function systemBusy(ms = 1500) {
  const a = cpuTimes();
  await sleep(ms);
  const b = cpuTimes();
  return Math.round((1 - (b.idle - a.idle) / (b.total - a.total)) * 1000) / 10;
}

const guard = createGuard(); // kills the browser and the server on every exit path (see tools/proc-guard.mjs)

async function main() {
  const o = parseOptions(process.argv.slice(2));
  const swept = sweepStale(root);
  if (swept) console.log(`[sweep] ${swept}`);
  if (o.scenario !== 'saves') {
    o.preLoadPct = await systemBusy();
    console.log(`[probe] system CPU busy before the run: ${o.preLoadPct}%${o.preLoadPct > 25 ? ' (noisy machine: other processes are working; compare runs with care)' : ''}`);
  }
  if (o.scenario === 'saves') {
    for (const B of Object.values(BOUNDARIES)) await makeSave(o, B - o.pre - o.settle, o.nodes);
    await makeSave(o, 612, 400);
    return;
  }
  if (o.scenario === 'startup') await scenarioStartup(o);
  else if (o.scenario === 'seasons') await scenarioSeasons(o);
  else await scenarioSteady(o);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.stack || err.message);
    process.exit(2);
  },
);
void SEASON_SECONDS;

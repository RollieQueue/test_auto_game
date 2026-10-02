#!/usr/bin/env node
// Zero-dependency browser driver for checks and screenshots: headless Edge/Chrome over the
// DevTools protocol (Node 22+ global WebSocket). Actions run in the order given:
//
//   node tools/shot.mjs --url "/?autostart=1&seed=7" --size 1600x900 \
//     --wait 1500 --shot .tmp/a.png \
//     --drag 800,330,860,420 --wait 3000 --eval "__game.state.res.sugar" --shot .tmp/b.png
//
// --url URL|/path   a path starts tools/serve.mjs on a free port (system-picked) and stops it at the end
// --size WxH        viewport in CSS px (default 1600x900); --dpr N device pixel ratio (default 1)
// --wait MS         sleep;  --eval JS  evaluate (awaits promises, prints the JSON result)
// --eval-file F     evaluate a file's contents;  --shot PATH  save a PNG screenshot
// --clip X,Y,W,H    clip (CSS px) for the next --shot;  --key KEY  press a key (e.g. Space, 1, Escape)
// --click X,Y       left click (CSS px);  --drag X1,Y1,X2,Y2[,...]  press, move through points, release
// --browser PATH    browser executable (default: Edge, then Chrome)
// Console errors and uncaught exceptions are printed; the exit code is 1 if any occurred.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const opts = { url: '/?autostart=1&seed=7', size: [1600, 900], dpr: 1, browser: null, actions: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    const nums = () => val.split(',').map(Number);
    switch (flag) {
      case '--url': opts.url = val; i++; break;
      case '--size': opts.size = val.split('x').map(Number); i++; break;
      case '--dpr': opts.dpr = Number(val); i++; break;
      case '--browser': opts.browser = val; i++; break;
      case '--wait': opts.actions.push({ type: 'wait', ms: Number(val) }); i++; break;
      case '--eval': opts.actions.push({ type: 'eval', js: val }); i++; break;
      case '--eval-file': opts.actions.push({ type: 'eval', js: readFileSync(val, 'utf8') }); i++; break;
      case '--shot': opts.actions.push({ type: 'shot', path: val }); i++; break;
      case '--clip': opts.actions.push({ type: 'clip', rect: nums() }); i++; break;
      case '--key': opts.actions.push({ type: 'key', key: val }); i++; break;
      case '--click': opts.actions.push({ type: 'click', pt: nums() }); i++; break;
      case '--drag': opts.actions.push({ type: 'drag', pts: nums() }); i++; break;
      default: throw new Error(`unknown flag ${flag}`);
    }
  }
  return opts;
}

function startServer() {
  return new Promise((resolveUrl, reject) => {
    // Port 0: a free port picked by the system. A fixed port could be shared on Windows with another
    // agent's server (SO_REUSEADDR), and requests would then reach the wrong copy of the game.
    const child = spawn(process.execPath, [join(root, 'tools', 'serve.mjs'), '--port', '0', '--no-open'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (m) resolveUrl({ child, base: m[0].slice(0, -1) });
    });
    child.on('exit', (code) => reject(new Error(`server exited (${code}): ${out}`)));
  });
}

async function launchBrowser(exe, [w, h]) {
  // The throwaway browser profile stays inside the project's ignored .tmp/ folder.
  const profile = join(root, '.tmp', `browser-profile-${process.pid}-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const child = spawn(exe, [
    '--headless=new', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${w},${h}`,
    'about:blank',
  ], { stdio: 'ignore' });
  child.exited = new Promise((r) => child.once('exit', r));
  const portFile = join(profile, 'DevToolsActivePort');
  // up to 30 s: a loaded machine starts Edge slowly. If no port ever appears, the browser must not be left running.
  for (let i = 0; i < 300 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) {
    killTree(child.pid);
    child.kill();
    killByProfile(profile);
    throw new Error('browser did not open a DevTools port');
  }
  const [port, path] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
  return { child, profile, wsUrl: `ws://127.0.0.1:${port}${path}` };
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const swept = sweepStale(root); // browsers and servers that earlier runs left behind
  if (swept) console.log(`[sweep] ${swept}`);
  const guard = createGuard(); // kills browser and server on every exit path, incl. a kill from outside (watchdog)
  const exe = opts.browser || BROWSERS.find((p) => existsSync(p));
  if (!exe) throw new Error('no Edge/Chrome found; pass --browser PATH');
  let server = null;
  let url = opts.url;
  if (url.startsWith('/')) {
    server = await startServer();
    guard.set({ server: server.child });
    url = server.base + url;
  }
  const browser = await launchBrowser(exe, opts.size);
  guard.set({ browser: browser.child, profile: browser.profile });
  const cdp = connect(browser.wsUrl);
  let problems = 0;
  try {
    await cdp.opened;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => cdp.send(method, params, sessionId);
    let loaded = null;
    cdp.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Page.loadEventFired' && loaded) loaded();
      if (msg.method === 'Runtime.exceptionThrown') {
        problems++;
        const d = msg.params.exceptionDetails;
        console.log(`[exception] ${d.exception?.description || d.text}`);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        if (msg.params.type === 'error') problems++;
        const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
        console.log(`[console.${msg.params.type}] ${text}`);
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon\.ico$/.test(msg.params.entry.url || '')) {
        problems++;
        console.log(`[log.error] ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
      }
    });
    await s('Page.enable');
    await s('Runtime.enable');
    await s('Log.enable');
    const [w, h] = opts.size;
    await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: opts.dpr, mobile: false });
    const loadedP = new Promise((r) => (loaded = r));
    await s('Page.navigate', { url });
    await Promise.race([loadedP, sleep(15000)]);
    await sleep(300);

    const mouse = (type, x, y) =>
      s('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    let clip = null;
    for (const a of opts.actions) {
      if (a.type === 'wait') await sleep(a.ms);
      else if (a.type === 'clip') clip = a.rect;
      else if (a.type === 'eval') {
        const r = await s('Runtime.evaluate', { expression: a.js, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) {
          problems++;
          console.log(`[eval error] ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
        } else if (r.result.value !== undefined) {
          console.log(`[eval] ${JSON.stringify(r.result.value)}`);
        }
      } else if (a.type === 'shot') {
        const params = { format: 'png', captureBeyondViewport: false };
        if (clip) params.clip = { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale: 1 };
        const { data } = await s('Page.captureScreenshot', params);
        const out = resolve(a.path);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, Buffer.from(data, 'base64'));
        console.log(`[shot] ${out}`);
        clip = null;
      } else if (a.type === 'key') {
        const key = a.key === 'Space' ? ' ' : a.key;
        const code = a.key === 'Space' ? 'Space' : /^\d$/.test(a.key) ? `Digit${a.key}` : /^[a-z]$/i.test(a.key) ? `Key${a.key.toUpperCase()}` : a.key;
        await s('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key.length === 1 ? key : undefined });
        await s('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
      } else if (a.type === 'click') {
        await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.pt[0], y: a.pt[1] });
        await mouse('mousePressed', a.pt[0], a.pt[1]);
        await mouse('mouseReleased', a.pt[0], a.pt[1]);
      } else if (a.type === 'drag') {
        const pts = [];
        for (let i = 0; i + 1 < a.pts.length; i += 2) pts.push([a.pts[i], a.pts[i + 1]]);
        await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0][0], y: pts[0][1] });
        await mouse('mousePressed', pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) {
          const [x0, y0] = pts[k - 1];
          const [x1, y1] = pts[k];
          const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
          for (let j = 1; j <= n; j++) {
            await mouse('mouseMoved', x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n);
            await sleep(4);
          }
        }
        const last = pts[pts.length - 1];
        await mouse('mouseReleased', last[0], last[1]);
      }
    }
  } finally {
    await Promise.race([cdp.send('Browser.close').catch(() => {}), sleep(1500)]);
    // the whole tree goes while the main process is still alive (taskkill /T cannot find orphans), then any stragglers
    killTree(browser.child.pid);
    browser.child.kill();
    killByProfile(browser.profile);
    if (server) {
      killTree(server.child.pid);
      server.child.kill();
    }
    try {
      rmSync(browser.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      console.log(`[note] could not remove ${browser.profile} (still locked); it is inside the ignored .tmp/`);
    }
  }
  if (problems) console.log(`${problems} problem(s) reported by the page`);
  return problems ? 1 : 0;
}

// Exit explicitly: an open DevTools socket would otherwise keep Node alive for a minute.
main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.message);
    process.exit(2);
  },
);

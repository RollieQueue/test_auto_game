// Process hygiene for the browser tools (tools/shot.mjs, tools/perf-probe.mjs): never leave a headless browser or a
// static server behind.
//   createGuard() -> { set({ browser, server, profile }), cleanup() }  kills both trees on every exit path of this node
//     process (normal exit, uncaught error, SIGINT / SIGTERM / SIGHUP) and, with every set(), starts the detached watchdog
//     tools/proc-watchdog.mjs for the one path no handler can see: this process being killed from outside (a tool timeout,
//     taskkill /F). The watchdog kills the browser and server trees and removes the throwaway profile folder.
//   killTree(pid), killByProfile(profileDir)  tree kill; and every browser process that still names the profile folder (once
//     a browser's main process is gone its renderer and GPU processes are orphans taskkill /T cannot reach from the pid).
//   sweepStale(root)  at startup: kills the browsers of .tmp/browser-profile-<pid>-* whose owner pid no longer exists (and
//     removes the folder), and servers started by these tools (serve.mjs --port 0) whose parent is gone.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIN = process.platform === 'win32';
const WATCHDOG = fileURLToPath(new URL('./proc-watchdog.mjs', import.meta.url));

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Kills a process and everything it started. Safe to call twice and for a dead pid. */
export function killTree(pid) {
  if (!pid) return;
  try {
    if (WIN) spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    else process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

function powershell(script) {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  return r.stdout || '';
}

/** Ids of the browser processes whose command line names the profile folder (by its last path segment). */
function browserPidsOf(profile) {
  const name = profile.split(/[\\/]/).pop();
  return powershell(
    `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${name}*' } | ForEach-Object { $_.ProcessId }`,
  )
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
}

export function killByProfile(profile) {
  if (!WIN || !profile) return 0;
  const ids = browserPidsOf(profile);
  for (const id of ids) killTree(id);
  return ids.length;
}

/**
 * Installs the exit handlers; tell it about each child as soon as it exists (each set() also starts a watchdog that
 * knows the pids so far).
 */
export function createGuard() {
  const t = { browserPid: 0, serverPid: 0, profile: '' };
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    killTree(t.browserPid);
    killTree(t.serverPid);
    killByProfile(t.profile);
  };
  process.once('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    try {
      process.once(sig, () => {
        cleanup();
        process.exit(130);
      });
    } catch {
      /* signal not supported on this platform */
    }
  }
  process.once('uncaughtException', (err) => {
    console.error(err.stack || err.message);
    cleanup();
    process.exit(2);
  });
  const set = ({ browser, server, profile }) => {
    if (browser) t.browserPid = browser.pid;
    if (server) t.serverPid = server.pid;
    if (profile) t.profile = profile;
    try {
      spawn(process.execPath, [WATCHDOG, String(process.pid), String(t.browserPid), String(t.serverPid), t.profile], { stdio: 'ignore', windowsHide: true }).unref();
    } catch {
      /* no watchdog: the handlers above still run */
    }
  };
  return { set, cleanup };
}

/** Kills what earlier runs left behind (see the header). Returns a short description for the log. */
export function sweepStale(root) {
  const notes = [];
  const tmp = join(root, '.tmp');
  if (existsSync(tmp)) {
    for (const name of readdirSync(tmp)) {
      const m = /^browser-profile-(\d+)-\d+$/.exec(name);
      if (!m || pidAlive(Number(m[1]))) continue;
      const n = killByProfile(name);
      if (n) notes.push(`killed ${n} browser process(es) of ${name}`);
      try {
        rmSync(join(tmp, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      } catch {
        /* still locked: the next sweep tries again */
      }
    }
  }
  if (WIN) {
    // servers of these tools: `node ...\tools\serve.mjs --port 0 --no-open` (a player's start.bat runs without --port 0)
    const rows = powershell(
      `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'serve\\.mjs' -and $_.CommandLine -match '--port 0' } | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }`,
    )
      .split(/\r?\n/)
      .map((l) => l.trim().split(' ').map(Number))
      .filter((p) => p.length === 2 && p[0]);
    for (const [pid, ppid] of rows) {
      if (pidAlive(ppid)) continue;
      killTree(pid);
      notes.push(`killed stale server ${pid}`);
    }
  }
  return notes.join('; ');
}

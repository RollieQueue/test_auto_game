// Watchdog of tools/proc-guard.mjs: node tools/proc-watchdog.mjs <parentPid> <browserPid> <serverPid> <profileDir>
// Started by createGuard(). Called like that it only re-launches itself detached (so it is no descendant of the tool and a
// `taskkill /T` of the tool's tree does not take it down) and exits. The detached copy polls the parent pid; once the parent
// is gone (killed from outside: a tool timeout, taskkill /F) it kills the browser and server trees, every browser process
// that still names the profile folder, and removes the folder.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [, , parent, browser, server, profile, mode] = process.argv;
const WIN = process.platform === 'win32';

if (mode !== '--detached') {
  spawn(process.execPath, [fileURLToPath(import.meta.url), parent, browser, server, profile, '--detached'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
  process.exit(0);
}

const alive = (pid) => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};
const kill = (pid) => {
  if (!Number(pid)) return;
  if (WIN) spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
  else {
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch {
      /* gone */
    }
  }
};

const timer = setInterval(() => {
  if (alive(parent)) return;
  clearInterval(timer);
  kill(browser);
  kill(server);
  if (WIN && profile) {
    const name = profile.split(/[\\/]/).pop();
    const script = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${name}*' } | ForEach-Object { $_.ProcessId }`;
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
    for (const id of (r.stdout || '').split(/\s+/).filter(Boolean)) kill(id);
  }
  setTimeout(() => {
    try {
      if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      /* the next sweepStale removes it */
    }
    process.exit(0);
  }, 1500);
}, 1000);

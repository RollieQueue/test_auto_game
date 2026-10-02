// The single-file build folds a worker's module graph into ONE classic script (tools/build/worker-bundle.mjs) and the
// page shim starts it from a blob: URL (tools/build/bootstrap.js). These tests check the folding on small inputs, then on
// the real world-layer worker: its export names match the real modules and, run in a sandbox like a worker, it draws
// exactly what the modules draw.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, collectModules } from '../tools/build.mjs';
import { bundleWorker, findWorkerEntries, workerAssetFiles, workerGraph } from '../tools/build/worker-bundle.mjs';
import { generateWorld } from '../src/world/generate.js';
import { paintWorldLayer } from '../src/render/world-layer.js';
import { fakeCtx, fakeOffscreenCanvas } from './fake-canvas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mods = (obj) => new Map(Object.entries(obj).map(([rel, code]) => [rel, { code }]));

function run(script, extra = {}) {
  const self = { postMessage() {} };
  const sandbox = { self, console, URL, ...extra };
  vm.createContext(sandbox);
  new vm.Script(script).runInContext(sandbox); // a classic script: no import / export may be left in it
  return { self, sandbox };
}

test('a folded worker runs: named, aliased and namespace imports, a class, a function declared late, a side-effect import', () => {
  const m = mods({
    'w/main.js': [
      "import { add, TWO as two, K, late } from '@rnt/w/lib.js';",
      "import * as ns from '@rnt/w/ns.js';",
      "import '@rnt/w/side.js';",
      'self.result = { sum: add(1, two), ns: ns.name, side: globalThis.sideRan, k: new K() instanceof K, late: late() };',
    ].join('\n'),
    'w/lib.js': [
      "import { base } from '@rnt/w/base.js';",
      'export function add(a, b) { return a + b + base; }',
      'export const TWO = 2;',
      'export class K {}',
      'export { later as late };',
      'function later() { return TWO * 21; }',
    ].join('\n'),
    'w/base.js': 'export const base = 100;',
    'w/ns.js': "const name = 'ns';\nexport { name };",
    'w/side.js': 'globalThis.sideRan = true;',
  });
  const { order } = workerGraph(m, 'w/main.js');
  assert.deepEqual(order, ['w/base.js', 'w/lib.js', 'w/ns.js', 'w/side.js', 'w/main.js'], 'dependencies first');
  const { self } = run(bundleWorker(m, 'w/main.js'));
  assert.equal(self.result.sum, 103);
  assert.equal(self.result.ns, 'ns');
  assert.equal(self.result.side, true);
  assert.equal(self.result.k, true);
  assert.equal(self.result.late, 42);
});

test('syntax the folding cannot keep, cycles and missing modules fail the build', () => {
  const one = (code) => mods({ 'w/main.js': code, 'w/x.js': 'export const x = 1;' });
  assert.throws(() => bundleWorker(one('export default 1;'), 'w/main.js'), /does not handle/);
  assert.throws(() => bundleWorker(one('export let n = 0;'), 'w/main.js'), /export let is not supported/);
  assert.throws(() => bundleWorker(one("export * from '@rnt/w/x.js';"), 'w/main.js'), /does not handle/);
  assert.throws(() => bundleWorker(one("import d from '@rnt/w/x.js';"), 'w/main.js'), /default imports/);
  assert.throws(() => bundleWorker(one("const m = await import('@rnt/w/x.js');"), 'w/main.js'), /does not handle/);
  assert.throws(() => bundleWorker(one("import { y } from '@rnt/w/missing.js';"), 'w/main.js'), /was not collected/);
  const cyc = mods({ 'w/a.js': "import { b } from '@rnt/w/b.js';\nexport const a = 1;", 'w/b.js': "import { a } from '@rnt/w/a.js';\nexport const b = 2;" });
  assert.throws(() => bundleWorker(cyc, 'w/a.js'), /cycle/);
  assert.throws(() => bundleWorker(one(''), 'w/nope.js'), /not in the module set/);
});

test('worker entries and the files a worker reads by URL are found in the rewritten code', () => {
  const m = mods({
    'src/render/index.js': 'worker = new Worker(new URL("./world-worker.js", "rnt://app/src/render/index.js"), { type: \'module\' });',
    'src/render/world-worker.js': "const u = new URL('../../assets/fonts/F.woff2', \"rnt://app/src/render/world-worker.js\");\nconst v = new URL('./other.js', \"rnt://app/src/render/world-worker.js\");",
  });
  assert.deepEqual([...findWorkerEntries(m)], ['src/render/world-worker.js']);
  assert.deepEqual([...workerAssetFiles(m)], ['assets/fonts/F.woff2'], 'a script URL is not a data file');
});

test('the real world worker: exports match the real modules, and the sandboxed worker draws what the modules draw', async () => {
  const entry = 'src/render/world-worker.js';
  const modules = collectModules(ROOT, path.join(ROOT, entry));
  const { order, converted } = workerGraph(modules, entry);
  assert.ok(order.length >= 10 && order.at(-1) === entry);
  for (const rel of order) {
    if (rel === entry) continue; // it only sets self.onmessage
    const real = await import(pathToFileURL(path.join(ROOT, rel)).href);
    assert.deepEqual([...converted.get(rel).exports].sort(), Object.keys(real).sort(), `${rel}: exported names`);
  }

  const script = bundleWorker(modules, entry);
  assert.ok(!/^[ \t]*(import|export)\b/m.test(script), 'no module syntax is left');

  const view = { scale: 1, ox: 0, oy: 0, cssW: 1200, cssH: 700, dpr: 1 };
  const world = generateWorld(7);
  // the worker: painting goes to the fake OffscreenCanvas it creates first, then the plate is cut into bands
  const made = [];
  const posted = [];
  const { self } = run(script, {
    OffscreenCanvas: fakeOffscreenCanvas(made),
    createImageBitmap: async (src, x, y, w, h) => ({ width: w, height: h, y, close() {} }),
    performance,
    setTimeout: (f, ms) => setTimeout(f, ms).unref(),
    URL,
    Promise,
  });
  self.postMessage = (msg, transfer) => posted.push({ msg, transfer });
  await self.onmessage({ data: { id: 5, w: 1200, h: 700, world, view, season: 'autumn' } });
  assert.equal(posted.length, 1);
  const { msg, transfer } = posted[0];
  assert.equal(msg.id, 5);
  assert.ok(!msg.error, msg.error);
  assert.equal(msg.bands.length, 8);
  assert.equal(msg.bands.reduce((s, b) => s + b.bitmap.height, 0), 700, 'the bands cover the plate');
  assert.deepEqual(msg.bands.map((b) => b.y), [0, 88, 176, 264, 352, 440, 528, 616]);
  assert.equal(transfer.length, 8, 'every band is transferred');

  // the same painting by the real modules
  const had = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  globalThis.OffscreenCanvas = fakeOffscreenCanvas();
  try {
    const real = fakeCtx(1200, 700);
    paintWorldLayer(real.ctx, 1200, 700, world, view, 'autumn');
    assert.ok(real.log.length > 2000);
    assert.deepEqual(made[0].fake.log, real.log, 'the worker bundle draws exactly what the modules draw');
  } finally {
    if (had) Object.defineProperty(globalThis, 'OffscreenCanvas', had);
    else delete globalThis.OffscreenCanvas;
  }
});

test('a small project with a worker: entry folded, its font kept in the asset map, a page-only font not duplicated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnt-wb-'));
  try {
    const put = (rel, content) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    };
    put('index.html', '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><script type="module" src="src/main.js"></script></body></html>');
    put('style.css', '@font-face{font-family:F;src:url("assets/fonts/f.woff2") format("woff2")}\n@font-face{font-family:G;src:url("assets/fonts/g.woff2") format("woff2")}\n');
    put('assets/fonts/f.woff2', 'wOF2fake-f');
    put('assets/fonts/g.woff2', 'wOF2fake-g');
    put('src/main.js', "export const w = new Worker(new URL('./w/job.js', import.meta.url), { type: 'module' });\n");
    put('src/w/job.js', "import { f } from './dep.js';\nconst font = new URL('../../assets/fonts/f.woff2', import.meta.url);\nself.answer = [f(2), font.href];\n");
    put('src/w/dep.js', 'export const f = (x) => x * 2;\n');
    const out = path.join(dir, 'dist', 'o.html');
    const stats = build({ root: dir, out, warn: (m) => assert.fail(m) });
    assert.deepEqual(stats.workers, ['src/w/job.js']);
    const html = fs.readFileSync(out, 'utf8');
    const workers = JSON.parse(/<script type="application\/json" id="rnt-workers">([\s\S]*?)<\/script>/.exec(html)[1]);
    const assets = JSON.parse(/<script type="application\/json" id="rnt-assets">([\s\S]*?)<\/script>/.exec(html)[1]);
    const { self } = run(workers['src/w/job.js']);
    assert.deepEqual([...self.answer], [4, 'rnt://app/assets/fonts/f.woff2']);
    assert.ok('assets/fonts/f.woff2' in assets, 'the font the worker loads is embedded');
    assert.ok(!('assets/fonts/g.woff2' in assets), 'a font only the page uses stays a single CSS copy');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

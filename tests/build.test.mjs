// Single-file build (tools/build.mjs): the bundle must contain every reachable module under a bare specifier, keep no
// relative specifier, inline CSS and assets, and the runtime shim must resolve embedded files. The real browser run
// from file:// is checked by hand (see tools/build/README.md).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/build.mjs';
import { transformJs } from '../tools/build/scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rnt-build-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function readBundle(file) {
  const html = fs.readFileSync(file, 'utf8');
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
  const decode = (url) => Buffer.from(url.slice(url.indexOf('base64,') + 7), 'base64').toString('utf8');
  const sources = Object.fromEntries(Object.entries(map).map(([name, url]) => [name, decode(url)]));
  const assets = JSON.parse(/<script type="application\/json" id="rnt-assets">([\s\S]*?)<\/script>/.exec(html)[1]);
  return { html, map, sources, assets };
}

/** Independent of the build: every './x.js' literal in the source files reachable from main.js, comments ignored. */
function reachableFromMain() {
  const found = new Set();
  const queue = ['src/main.js'];
  while (queue.length) {
    const rel = queue.shift();
    if (found.has(rel)) continue;
    found.add(rel);
    const code = fs
      .readFileSync(path.join(ROOT, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/(?:from|import\s*\(?|optional\()\s*(['"])(\.{1,2}\/[^'"]+\.js)\1/g)) {
      const target = path.posix.join(path.posix.dirname(rel), m[2]);
      if (fs.existsSync(path.join(ROOT, target))) queue.push(target);
    }
  }
  return found;
}

test('the real project builds into one file covering every reachable module', () => {
  const out = path.join(tmp, 'real', 'bundle.html');
  const stats = build({ root: ROOT, out, warn: (m) => assert.fail(`unexpected build warning: ${m}`) });
  assert.ok(stats.bytes < 20 * 1024 * 1024);
  const { html, map, sources } = readBundle(out);

  for (const rel of reachableFromMain()) assert.ok(`@rnt/${rel}` in map, `${rel} missing from the import map`);
  for (const [name, code] of Object.entries(sources)) {
    const withoutUrls = code.replace(/new URL\(\s*(['"])[^'"]*\1/g, 'new URL(0'); // a file URL for the (disabled) worker is not a module
    assert.ok(!/(['"`])\.{1,2}\/[^'"`\s]*\.m?js\1/.test(withoutUrls), `${name} still has a relative module specifier`);
    assert.ok(!/import\.meta\.url/.test(code), `${name} still reads import.meta.url`);
    for (const m of code.matchAll(/(?:from|import\s*\(?)\s*(['"])(@rnt\/[^'"]+)\1/g)) {
      assert.ok(m[2] in map, `${name} imports ${m[2]}, which is not in the import map`);
    }
  }
  assert.ok(!('@rnt/src/render/lab.js' in map) && !Object.keys(map).some((k) => /gallery/.test(k)), 'dev pages leaked in');

  assert.ok(!/<link\b[^>]*stylesheet/i.test(html), 'a stylesheet link is left');
  assert.ok(!/id="file-warning"/.test(html.replace(/#file-warning\{display:none!important\}/, '')), 'file:// warning still in the page');
  assert.ok(!/url\(\s*['"]?\.{0,2}\/?(assets|\.\.)\//.test(html), 'CSS still points at a project file');
  assert.match(html, /font\/woff2;base64,/);
  assert.match(html, /<script type="module">import "@rnt\/src\/main\.js";<\/script>/);
  assert.match(html, /<title>Корни и нити<\/title>/);
});

test('scanner: only code-level strings are rewritten, comments and regexes are respected', () => {
  const seen = [];
  const src = [
    "import a from './a.js'; // './comment.js'",
    "/* './block.js' */ const re = /['\"]\\.\\/x\\.js/; const s = './s.js'; const t = `./t.js ${opt('./u.js')}`;",
    "const d = a / 2; const e = i++ / 3; load('../b/c.js'); import('./dyn.js'); new URL('./w.js', import.meta.url);",
    "const msg = 'don\\'t ./esc.js';",
  ].join('\n');
  const out = transformJs(src, {
    stripComments: true,
    importMetaUrl: 'rnt://app/x.js',
    rewriteString(value, info) {
      if (!/^\.{1,2}\//.test(value)) return undefined;
      seen.push([value, info.isStatic, info.callee]);
      return `@${value}`;
    },
  });
  assert.deepEqual(seen, [
    ['./a.js', true, ''],
    ['./s.js', false, ''],
    ['./u.js', false, 'opt'],
    ['../b/c.js', false, 'load'],
    ['./dyn.js', false, 'import'],
    ['./w.js', false, 'URL'],
  ]);
  assert.ok(!out.includes('comment.js') && !out.includes('block.js'));
  assert.ok(out.includes("/['\"]\\.\\/x\\.js/"), 'regex literal intact');
  assert.ok(out.includes('`./t.js ${opt(\'@./u.js\')}`'), 'template text intact, expression rewritten');
  assert.ok(out.includes('"rnt://app/x.js"') && !out.includes('import.meta'));
  assert.ok(out.includes("'don\\'t ./esc.js'"), 'escaped strings untouched');
  assert.ok(out.includes('a / 2') && out.includes('i++ / 3'));
});

function makeProject() {
  const dir = path.join(tmp, 'mini');
  fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'art'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'fonts'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><html><head><title>T</title><link rel="stylesheet" href="style.css"></head><body>' +
      '<img src="assets/art/pic.png"><div id="file-warning" hidden><p>x</p></div>' +
      '<script>if (location.protocol === "file:") document.getElementById("file-warning").hidden = false;</script>' +
      '<script type="module" src="src/main.js"></script></body></html>',
  );
  fs.writeFileSync(path.join(dir, 'style.css'), '@font-face{font-family:F;src:url("assets/fonts/f.woff2") format("woff2")}\nbody{background:url(assets/art/pic.png)}\n');
  fs.writeFileSync(path.join(dir, 'src', 'main.js'), "import { x } from './deep/x.js';\nconst opt = (p) => import(p);\nawait opt('./deep/lazy.js');\nawait opt('./missing.js');\nexport { x };\n");
  fs.writeFileSync(path.join(dir, 'src', 'deep', 'x.js'), "import '../main.js';\nexport const x = new URL('../../assets/art/manifest.json', import.meta.url).href;\n");
  fs.writeFileSync(path.join(dir, 'src', 'deep', 'lazy.js'), 'export default 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'deep', 'lab.js'), 'export default "not reachable";\n');
  fs.writeFileSync(path.join(dir, 'assets', 'art', 'manifest.json'), '{"a":1}');
  fs.writeFileSync(path.join(dir, 'assets', 'art', 'pic.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  fs.writeFileSync(path.join(dir, 'assets', 'art', 'notes.txt'), 'not a runtime asset');
  fs.writeFileSync(path.join(dir, 'assets', 'fonts', 'f.woff2'), Buffer.from('wOF2fake'));
  fs.writeFileSync(path.join(dir, 'assets', 'fonts', 'F-OFL.txt'), 'SIL OFL -- test licence');
  return dir;
}

test('a small project: modules, optional imports, CSS urls, embedded assets, licences', () => {
  const dir = makeProject();
  const out = path.join(tmp, 'mini', 'dist', 'o.html');
  const warnings = [];
  build({ root: dir, out, warn: (m) => warnings.push(m) });
  const { html, map, sources, assets } = readBundle(out);

  assert.deepEqual(Object.keys(map), ['@rnt/src/deep/lazy.js', '@rnt/src/deep/x.js', '@rnt/src/main.js']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /missing\.js/);
  assert.ok(sources['@rnt/src/main.js'].includes("'@rnt/src/deep/lazy.js'"));
  assert.ok(sources['@rnt/src/deep/x.js'].includes("import '@rnt/src/main.js'"));
  assert.ok(sources['@rnt/src/deep/x.js'].includes('"rnt://app/src/deep/x.js"'));

  assert.deepEqual(Object.keys(assets), ['assets/art/manifest.json', 'assets/art/pic.png']); // no font (inlined in CSS), no .txt
  assert.equal(assets['assets/art/manifest.json'][0], 'application/json');
  assert.match(html, /<img src="data:image\/png;base64,/);
  assert.match(html, /url\("data:font\/woff2;base64,/);
  assert.match(html, /body\{background:url\("data:image\/png;base64,/);
  assert.match(html, /SIL OFL - - test licence/);
  assert.ok(!/<div id="file-warning"/.test(html));
});

test('runtime shim: embedded files resolve, other assets fail quietly, Worker is hidden', async () => {
  const dir = makeProject();
  const out = path.join(tmp, 'mini', 'dist', 'shim.html');
  build({ root: dir, out, warn: () => {} });
  const html = fs.readFileSync(out, 'utf8');
  const json = /<script type="application\/json" id="rnt-assets">([\s\S]*?)<\/script>/.exec(html)[1];
  const shim = /<script>\n([\s\S]*?)<\/script>/.exec(html.slice(html.indexOf('id="rnt-assets"')))[1];

  const realFetchCalls = [];
  class Img {
    set src(v) {
      this._src = v;
    }
    get src() {
      return this._src;
    }
  }
  const window = {
    fetch: async (u) => {
      realFetchCalls.push(String(u));
      return new Response('net');
    },
    Worker: class {},
  };
  const context = vm.createContext({
    window,
    Response,
    URL,
    atob,
    console,
    HTMLImageElement: Img,
    Element: class {
      setAttribute() {}
    },
    document: { baseURI: 'file:///C:/game/dist/o.html?seed=3', getElementById: () => ({ textContent: json }) },
  });
  vm.runInContext(shim, context);

  const res = await window.fetch('assets/art/manifest.json');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { a: 1 });
  assert.equal((await window.fetch('rnt://app/assets/art/manifest.json?v=1')).status, 200);
  assert.equal((await window.fetch(new URL('assets/art/manifest.json', 'file:///C:/game/dist/o.html'))).status, 200);
  assert.equal((await window.fetch('assets/art/nope.webp')).status, 404);
  assert.equal(await (await window.fetch('https://example.org/x')).text(), 'net');
  assert.deepEqual(realFetchCalls, ['https://example.org/x']);

  const img = new Img();
  img.src = 'assets/art/pic.png';
  assert.match(img.src, /^data:image\/png;base64,/);
  img.src = 'assets/art/nope.webp';
  assert.equal(img.src, 'data:,');
  img.src = 'https://example.org/p.png';
  assert.equal(img.src, 'https://example.org/p.png');
  assert.equal(window.Worker, undefined);
  assert.deepEqual([...window.__bundle.missing], ['assets/art/nope.webp']);
});

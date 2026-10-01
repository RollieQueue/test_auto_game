// Single-file build: node tools/build.mjs [--out dist/roots-and-threads.html] [--root .] [--keep-comments]
// Writes ONE self-contained HTML file that runs the whole game from file:// (no server, no network). See
// tools/build/README.md for the contract. In short:
//   * every module reachable from the entry script of index.html (static imports, `export … from`, dynamic import(),
//     and every other './x.js' string literal such as src/render/index.js's optional('./trees.js')) gets a bare
//     specifier "@rnt/<path from the project root>" and an <script type="importmap"> entry holding it as a base64
//     data: URL; relative specifiers inside the modules are rewritten to those names;
//   * `import.meta.url` becomes "rnt://app/<module path>", a virtual base the runtime shim understands;
//   * style.css and the stylesheets linked from index.html are inlined, url(...) -> data: URLs;
//   * files under assets/ (art, ...) go into an embedded map served by tools/build/bootstrap.js (fetch / <img src>),
//     except those already inlined into CSS (fonts); font licences are kept as an HTML comment;
//   * the file:// warning of index.html is dropped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformJs, RELATIVE_MODULE } from './build/scan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');
const MIME = {
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.ico': 'image/x-icon',
};
const VIRTUAL_BASE = 'rnt://app/';
const posix = (p) => p.split(path.sep).join('/');
const b64 = (buf) => Buffer.from(buf).toString('base64');
const dataUri = (file) => `data:${MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'};base64,${b64(fs.readFileSync(file))}`;

/** Every module reachable from `entry` (absolute path), as { rel -> { abs, code, deps } }, code already rewritten. */
export function collectModules(root, entry, { stripComments = true, warn = () => {} } = {}) {
  const modules = new Map(); // rel -> { rel, abs, code }
  const queue = [path.relative(root, entry)];
  const seen = new Set(queue.map(posix));
  while (queue.length) {
    const rel = posix(queue.shift());
    const abs = path.join(root, rel);
    const source = fs.readFileSync(abs, 'utf8');
    const dir = path.posix.dirname(rel);
    const code = transformJs(source, {
      stripComments,
      importMetaUrl: VIRTUAL_BASE + rel,
      rewriteString(value, info) {
        if (!RELATIVE_MODULE.test(value)) return undefined;
        if (info.callee === 'URL') return undefined; // new URL('./x.js', import.meta.url) names a file, not a module
        const target = path.posix.normalize(path.posix.join(dir, value));
        if (target.startsWith('../')) throw new Error(`${rel}: "${value}" leaves the project`);
        if (!fs.existsSync(path.join(root, target))) {
          if (info.isStatic) throw new Error(`${rel}: imported file "${value}" does not exist`);
          warn(`${rel}: "${value}" does not exist (left unresolved, an optional import then fails as it would unbundled)`);
        } else if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
        return `@rnt/${target}`;
      },
    });
    modules.set(rel, { rel, abs, code });
  }
  return modules;
}

/** Inlines url(...) of a stylesheet; returns { css, used: Set of absolute files inlined }. */
export function inlineCssUrls(css, cssFile, { warn = () => {} } = {}) {
  const used = new Set();
  const out = css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/g, (whole, a, b, c) => {
    const ref = a ?? b ?? c ?? '';
    if (!ref || ref.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(ref)) return whole; // data:, http:, fragments
    const file = path.resolve(path.dirname(cssFile), ref.replace(/[?#].*$/, ''));
    if (!fs.existsSync(file)) {
      warn(`${path.basename(cssFile)}: url(${ref}) does not exist, left as is`);
      return whole;
    }
    used.add(file);
    return `url("${dataUri(file)}")`;
  });
  return { css: out, used };
}

function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full));
    else if (!e.name.startsWith('.')) out.push(full);
  }
  return out;
}

const escapeCommentText = (text) => text.replace(/--+/g, (m) => m.split('').join(' ')).replace(/\r/g, '');

export function build({ root = DEFAULT_ROOT, out = path.join(root, 'dist', 'roots-and-threads.html'), stripComments = true, log = () => {}, warn = (m) => console.warn(`[build] ${m}`) } = {}) {
  root = path.resolve(root);
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  // ---- literal asset paths in the page itself (before anything is inlined into it)
  html = html.replace(/\b(src|href)=(["'])([^"']+)\2/gi, (whole, attr, q, ref) => {
    if (/^[a-z][a-z0-9+.-]*:|^[#/]/i.test(ref)) return whole;
    const file = path.resolve(root, ref.replace(/[?#].*$/, ''));
    if (!MIME[path.extname(file).toLowerCase()] || !fs.existsSync(file)) return whole;
    return `${attr}=${q}${dataUri(file)}${q}`;
  });

  // ---- stylesheets ------------------------------------------------------
  const inlinedByCss = new Set();
  html = html.replace(/[ \t]*<link\b[^>]*\brel=["']stylesheet["'][^>]*>[ \t]*\r?\n?/gi, (tag) => {
    const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return tag;
    const file = path.resolve(root, href.replace(/[?#].*$/, ''));
    if (!fs.existsSync(file)) throw new Error(`stylesheet ${href} does not exist`);
    const { css, used } = inlineCssUrls(fs.readFileSync(file, 'utf8'), file, { warn });
    used.forEach((f) => inlinedByCss.add(f));
    return `    <style data-src="${href}">\n${css.replace(/<\/style/gi, '<\\/style')}\n    </style>\n`;
  });

  // ---- the file:// warning has no place in the bundle -----------------------
  html = html.replace(/[ \t]*<div id="file-warning"[\s\S]*?<\/div>[ \t]*\r?\n?/i, '');
  html = html.replace(/[ \t]*<script>(?:(?!<\/script>)[\s\S])*file-warning(?:(?!<\/script>)[\s\S])*<\/script>[ \t]*\r?\n?/i, '');
  html = html.replace('</head>', '    <style>#file-warning{display:none!important}</style>\n  </head>');

  // ---- the entry module and everything it reaches ----------------------------
  const entryTag = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/i.exec(html);
  if (!entryTag) throw new Error('index.html has no <script type="module" src="…">');
  const entryAbs = path.resolve(root, entryTag[1]);
  const modules = collectModules(root, entryAbs, { stripComments, warn });
  const entryName = `@rnt/${posix(path.relative(root, entryAbs))}`;
  const imports = {};
  for (const m of [...modules.values()].sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
    imports[`@rnt/${m.rel}`] = `data:text/javascript;base64,${b64(`${m.code}\n//# sourceURL=rnt/${m.rel}\n`)}`;
  }

  // ---- runtime assets ---------------------------------------------------------
  const assets = {};
  for (const file of listFiles(path.join(root, 'assets'))) {
    const ext = path.extname(file).toLowerCase();
    if (!MIME[ext]) continue;
    if (inlinedByCss.has(file) && MIME[ext].startsWith('font/')) continue; // used only by @font-face: one copy is enough
    assets[posix(path.relative(root, file))] = [MIME[ext], b64(fs.readFileSync(file))];
  }
  // ---- licences travel with the fonts -------------------------------------------
  const licences = listFiles(path.join(root, 'assets')).filter((f) => /\.txt$/i.test(f) && /OFL|LICEN[CS]E/i.test(path.basename(f)));
  const licenceBlock = licences.length
    ? `<!--\nThird-party font licences (embedded below as @font-face data):\n\n${licences
        .map((f) => `=== ${posix(path.relative(root, f))} ===\n${escapeCommentText(fs.readFileSync(f, 'utf8').trim())}`)
        .join('\n\n')}\n-->\n`
    : '';

  // ---- put it together -----------------------------------------------------------
  const bootstrap = fs.readFileSync(path.join(HERE, 'build', 'bootstrap.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const scripts = [
    `<script type="application/json" id="rnt-assets">${JSON.stringify(assets)}</script>`,
    `<script>\n${bootstrap}</script>`,
    `<script type="importmap">\n${JSON.stringify({ imports }, null, 0).replace(/","/g, '",\n"')}\n</script>`,
    `<script type="module">import ${JSON.stringify(entryName)};</script>`,
  ].join('\n    ');
  html = html.replace(entryTag[0], () => scripts);
  html = html.replace(/<!doctype html>\s*/i, (m) => `${m.trim()}\n${licenceBlock}`);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  const stats = {
    out,
    bytes: Buffer.byteLength(html),
    modules: modules.size,
    moduleBytes: Object.values(imports).reduce((s, v) => s + v.length, 0),
    assets: Object.keys(assets),
    assetBytes: JSON.stringify(assets).length,
    cssInlinedFiles: [...inlinedByCss].map((f) => posix(path.relative(root, f))),
  };
  log(stats);
  return stats;
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = arg('--root') ? path.resolve(arg('--root')) : DEFAULT_ROOT;
  const out = arg('--out') ? path.resolve(arg('--out')) : path.join(root, 'dist', 'roots-and-threads.html');
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  try {
    const s = build({ root, out, stripComments: !argv.includes('--keep-comments') });
    console.log(`wrote ${s.out}`);
    console.log(`  total ${kb(s.bytes)}: ${s.modules} modules ${kb(s.moduleBytes)} (base64), ${s.assets.length} embedded assets ${kb(s.assetBytes)}, CSS-inlined ${s.cssInlinedFiles.length} files`);
  } catch (err) {
    console.error(`build failed: ${err.message}`);
    process.exit(1);
  }
}

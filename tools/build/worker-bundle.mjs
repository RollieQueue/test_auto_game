// Worker bundling for the single-file build. A module worker cannot load the bundle's modules from file:// (a worker
// gets no import map, and Chrome refuses module workers from blob: URLs on a file:// page), but a CLASSIC worker from a
// blob: URL starts fine. So the module graph of a worker entry is folded into ONE classic script: every module becomes a
// factory function, `import`/`export` statements become calls into a tiny registry, and the entry is run last.
//
//   findWorkerEntries(modules)           -> Set of module paths started with `new Worker(new URL('./x.js', import.meta.url))`
//   workerAssetFiles(modules)            -> Set of project files the modules name with `new URL('../a/b', import.meta.url)`
//   bundleWorker(modules, entryRel)      -> classic script text
//
// `modules` is the Map from collectModules: { rel -> { code } } with relative specifiers already turned into "@rnt/<path>"
// and import.meta.url into a "rnt://app/<path>" literal. Only the module syntax the code base uses is supported:
//   import { a, b as c } from '@rnt/x'; import * as ns from '@rnt/x'; import '@rnt/x';
//   export function|async function|class|const NAME …; export { a, b as c };   (importers get the value, not a live binding)
// Anything else (default imports and exports, export *, destructured exports, dynamic import(), cycles) is a build error.
import path from 'node:path';

const SPEC = String.raw`(?<q>["'])@rnt\/(?<target>[^"']+)\k<q>`;
const IMPORT_FROM = new RegExp(String.raw`^import\s+(?<lead>[\w$]+\s*,\s*)?(?<clause>\*\s+as\s+[\w$]+|[\w$]+|\{[^}]*\})\s*from\s*${SPEC}[ \t]*;?`, 'gm');
const IMPORT_BARE = new RegExp(String.raw`^import\s*${SPEC}[ \t]*;?`, 'gm');
const EXPORT_DECL = /^export\s+(?<decl>(?:async\s+)?function\s*\*?\s*(?<fn>[\w$]+)|class\s+(?<cls>[\w$]+)|(?:const|let|var)\s+(?<vr>[\w$]+))/gm;
const EXPORT_LIST = /^export\s*\{(?<list>[^}]*)\}[ \t]*;?/gm;
const WORKER_NEW = /new\s+Worker\(\s*new\s+URL\(\s*(["'])(\.{1,2}\/[^"']+)\1\s*,\s*["']rnt:\/\/app\/([^"']+)["']/g;
const URL_FILE = /new\s+URL\(\s*(["'])(\.{1,2}\/[^"']+)\1\s*,\s*["']rnt:\/\/app\/([^"']+)["']\s*\)/g;

const resolveFrom = (modulePath, relative) => path.posix.normalize(path.posix.join(path.posix.dirname(modulePath), relative));

/** Module paths named by `new Worker(new URL('./entry.js', import.meta.url), …)` in `modules`. */
export function findWorkerEntries(modules) {
  const entries = new Set();
  for (const { code } of modules.values()) {
    for (const m of code.matchAll(WORKER_NEW)) entries.add(resolveFrom(m[3], m[2]));
  }
  return entries;
}

/** Project files that modules read by URL (`new URL('../../assets/fonts/f.woff2', import.meta.url)`): a worker fetches them. */
export function workerAssetFiles(modules) {
  const files = new Set();
  for (const { code } of modules.values()) {
    for (const m of code.matchAll(URL_FILE)) {
      if (!/\.m?js$/.test(m[2])) files.add(resolveFrom(m[3], m[2]));
    }
  }
  return files;
}

/** One module in registry form: { body, deps } where deps are module paths in import order. */
function convert(rel, code) {
  const imports = [];
  const deps = [];
  const names = [];
  const dep = (target) => {
    if (!deps.includes(target)) deps.push(target);
    return `__rnt_require(${JSON.stringify(target)})`;
  };
  let body = code
    .replace(IMPORT_FROM, (...args) => {
      const { lead, clause, target } = args[args.length - 1];
      if (lead || !/^[{*]/.test(clause)) throw new Error(`${rel}: default imports are not supported by the worker bundler (import from '@rnt/${target}')`);
      const call = dep(target);
      if (clause.startsWith('{')) imports.push(`const ${clause.replace(/([\w$]+)\s+as\s+([\w$]+)/g, '$1: $2')} = ${call};`);
      else imports.push(`const ${clause.replace(/^\*\s+as\s+/, '')} = ${call};`);
      return '';
    })
    .replace(IMPORT_BARE, (...args) => {
      imports.push(`${dep(args[args.length - 1].target)};`);
      return '';
    })
    .replace(EXPORT_LIST, (...args) => {
      for (const part of args[args.length - 1].list.split(',')) {
        const m = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
        if (m) names.push([m[2] || m[1], m[1]]);
        else if (part.trim()) throw new Error(`${rel}: unsupported export clause "${part.trim()}"`);
      }
      return '';
    })
    .replace(EXPORT_DECL, (...args) => {
      const { decl, fn, cls, vr } = args[args.length - 1];
      if (/^(let|var)/.test(decl)) throw new Error(`${rel}: export ${decl.split(' ')[0]} is not supported (an importer gets a copy of the value, not a live binding)`);
      const name = fn || cls || vr;
      names.push([name, name]);
      return decl;
    });
  const left = /^[ \t]*(?:export\b|import\s*[("'{*\w])|(?<![.\w$])import\s*\(/m.exec(body);
  if (left) throw new Error(`${rel}: module syntax the worker bundler does not handle near "${body.slice(left.index, left.index + 50).replace(/\s+/g, ' ')}"`);
  // an export reads its variable when asked (a function declared later in the module is already there)
  const getters = names
    .map(([exported, local]) => `Object.defineProperty(__rnt_exports, ${JSON.stringify(exported)}, { enumerable: true, get: function () { return ${local}; } });`)
    .join('\n');
  body = `"use strict";\n${imports.join('\n')}\n${getters}\n${body}`;
  return { body, deps, exports: names.map(([exported]) => exported) };
}

/** The graph of `entryRel` in dependency order: { order: [rel…] (dependencies first), converted: Map rel -> { body, deps, exports } }. */
export function workerGraph(modules, entryRel) {
  if (!modules.has(entryRel)) throw new Error(`worker entry ${entryRel} is not in the module set`);
  const converted = new Map();
  const order = [];
  const state = new Map(); // rel -> 'visiting' | 'done'
  const visit = (rel, from) => {
    if (state.get(rel) === 'done') return;
    if (state.get(rel) === 'visiting') throw new Error(`worker modules import each other in a cycle: ${rel} (from ${from})`);
    const mod = modules.get(rel);
    if (!mod) throw new Error(`${from}: worker module ${rel} was not collected`);
    state.set(rel, 'visiting');
    const c = convert(rel, mod.code);
    converted.set(rel, c);
    for (const d of c.deps) visit(d, rel);
    state.set(rel, 'done');
    order.push(rel);
  };
  visit(entryRel, '(entry)');
  return { order, converted };
}

/** Folds the module graph of `entryRel` (a key of `modules`) into one classic script. */
export function bundleWorker(modules, entryRel) {
  const { order, converted } = workerGraph(modules, entryRel);
  const factories = order.map((rel) => `__rnt_define(${JSON.stringify(rel)}, function (__rnt_exports, __rnt_require) {\n${converted.get(rel).body}\n});`);
  return [
    '(function () {',
    '"use strict";',
    'var defs = Object.create(null), cache = Object.create(null);',
    'function __rnt_define(name, factory) { defs[name] = factory; }',
    'function __rnt_require(name) {',
    '  var hit = cache[name];',
    '  if (hit) return hit.exports;',
    '  if (!defs[name]) throw new Error("worker bundle: no module " + name);',
    '  hit = cache[name] = { exports: {} };',
    '  defs[name](hit.exports, __rnt_require);',
    '  return hit.exports;',
    '}',
    ...factories,
    `__rnt_require(${JSON.stringify(entryRel)});`,
    '})();',
    `//# sourceURL=rnt/${path.posix.basename(entryRel)}`,
    '',
  ].join('\n');
}

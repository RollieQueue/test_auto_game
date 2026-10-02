# Single-file build

`npm run build` (= `node tools/build.mjs`) writes `dist/roots-and-threads.html`: one file that runs the whole game when
opened by double-click from `file://` (Edge/Chrome; no server, no network). Options: `--out FILE`, `--root DIR`,
`--keep-comments` (comments are stripped from the embedded modules by default).

## How it works

- **Modules.** Everything reachable from the entry `<script type="module" src>` of `index.html` is collected by following
  *every* relative `'./x.js'` / `'../y/z.js'` string literal in code (static imports, `export … from`, `import()`,
  and helpers such as `optional('./trees.js')` in `src/render/index.js`). Each module is named
  `@rnt/<path from the project root>`, the specifiers inside are rewritten to those names, and an
  `<script type="importmap">` maps each name to a `data:text/javascript;base64,…` URL. The entry runs as an inline
  module `import "@rnt/src/main.js"`. Files that are not reachable (`lab*`, `gallery*`, `fixture.js`) are left out.
  A string right after `new URL(` is a file URL, not a module, and is kept.
- **`import.meta.url`** is replaced by `"rnt://app/<module path>"`, a virtual base: `new URL('../../assets/x', import.meta.url)`
  keeps working and resolves to an embedded file.
- **CSS.** `<link rel="stylesheet">` files become `<style>`; `url(...)` becomes `data:` (fonts, images).
- **Assets.** Every file under `assets/` of a runtime type (webp/png/jpg/gif/avif/svg/json/audio/fonts) is embedded in
  `<script type="application/json" id="rnt-assets">`, except fonts already inlined into CSS. A small classic script
  (`tools/build/bootstrap.js`) serves them: `fetch()`, the `<img>` `src` setter and `setAttribute('src', …)` map
  document-relative paths (`assets/art/x.webp`) and `rnt://app/…` URLs to the embedded bytes; a project path under
  `assets/` that is not embedded gets a synthetic 404 / an empty image (no console error); anything else passes
  through. `window.__bundle = { assets, missing }` is there for debugging.
- **Workers.** A worker cannot see the import map, and Chrome refuses a module worker from a `blob:` URL on a `file://`
  page. So every `new Worker(new URL('./x.js', import.meta.url), …)` entry is folded, with the modules it imports, into
  ONE classic script (`tools/build/worker-bundle.mjs`; only plain `import { a } from` / `export function|const` syntax,
  no cycles, no `export let`: anything else is a build error) and embedded in
  `<script type="application/json" id="rnt-workers">`. `window.Worker` becomes a wrapper: for such a URL it starts a classic
  worker from a `blob:` URL, with a prelude that gives it a `fetch()` over the same asset map (sprites, the italic font:
  files a worker names with `new URL('…', import.meta.url)` stay embedded even when the CSS inlines them); for any other URL
  it throws, so the caller (the renderer) falls back to the main thread.
- **Page.** The `file://` warning (div + script) is removed; query parameters (`?seed=`, `?seasons=1`, `?autostart=1`)
  work as served. OFL font licences are kept in an HTML comment at the top.

## Contract for `src/`

- Reference modules by relative string literals ending in `.js`; do not build module paths dynamically.
- Load project files with `fetch('assets/…')`, `new Image().src = 'assets/…'`, `new URL('…', import.meta.url)`; other
  loaders (CSS `background` set from JS, `<audio src>`, `FontFace(url)`, `new Worker(url)`) are not intercepted.
- Create workers as `new Worker(new URL('./x.js', import.meta.url), { type: 'module' })` inside `try`, keep the main-thread
  fallback, and have a worker load files with `fetch(new URL('…', import.meta.url))` (not `FontFace(url)` or `importScripts`).
- Use `//` and `/* */` comments freely (they are stripped), but regex literals after `)` / `}` ambiguities are decided
  by a small scanner (`tools/build/scan.mjs`); `tests/build.test.mjs` and a browser run catch a misread.

## Limits

Verified in headless Edge from `file://`; Firefox and Safari not run. Fonts and art dominate the size (base64 adds 33 %).

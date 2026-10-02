// The single-file build's runtime shim (tools/build/bootstrap.js) in a minimal fake DOM: embedded assets must
// reach <img> however the element gets its src, including HTML strings (the atlas cards use innerHTML).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function boot(assets, { workers = null, globals = {} } = {}) {
  class Element {
    setAttribute(name, value) {
      this[`@${name}`] = value;
    }
    insertAdjacentHTML(position, html) {
      this.inserted = html;
    }
  }
  for (const prop of ['innerHTML', 'outerHTML']) {
    Object.defineProperty(Element.prototype, prop, {
      configurable: true,
      get() {
        return this[`_${prop}`];
      },
      set(value) {
        this[`_${prop}`] = value;
      },
    });
  }
  class HTMLImageElement extends Element {}
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() {
      return this._src;
    },
    set(value) {
      this._src = value;
    },
  });
  const document = {
    baseURI: 'file:///C:/game/dist/roots-and-threads.html',
    getElementById: (id) => (id === 'rnt-assets' ? { textContent: JSON.stringify(assets) } : id === 'rnt-workers' && workers ? { textContent: JSON.stringify(workers) } : null),
  };
  const ctx = { document, Element, HTMLImageElement, URL, atob, Response, Promise, console, fetch: async () => null, ...globals };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../tools/build/bootstrap.js', import.meta.url), 'utf8'), ctx);
  return ctx;
}

test('bootstrap maps embedded images in setters, setAttribute and HTML strings', () => {
  const ctx = boot({ 'assets/art/x.webp': ['image/webp', 'AAAA'] });
  const img = new ctx.HTMLImageElement();
  img.src = 'assets/art/x.webp';
  assert.equal(img._src, 'data:image/webp;base64,AAAA');
  img.setAttribute('src', 'assets/art/x.webp');
  assert.equal(img['@src'], 'data:image/webp;base64,AAAA');

  const el = new ctx.Element();
  el.innerHTML = `<p><img class="a" src="assets/art/x.webp" alt=""><img src='https://example.com/y.png'></p>`;
  assert.match(el._innerHTML, /<img class="a" src="data:image\/webp;base64,AAAA" alt="">/);
  assert.match(el._innerHTML, /src='https:\/\/example\.com\/y\.png'/);
  el.insertAdjacentHTML('beforeend', '<IMG SRC="assets/art/x.webp">');
  assert.match(el.inserted, /SRC="data:image\/webp;base64,AAAA"/);
  el.outerHTML = '<div><img src="assets/art/x.webp"></div>';
  assert.match(el._outerHTML, /data:image\/webp/);
  el.innerHTML = '<p>no pictures here</p>';
  assert.equal(el._innerHTML, '<p>no pictures here</p>');
});

test('bootstrap: a project image that is not embedded fails quietly and is reported', () => {
  const ctx = boot({});
  const el = new ctx.Element();
  el.innerHTML = '<img src="assets/art/missing.webp">';
  assert.equal(el._innerHTML, '<img src="data:,">');
  assert.deepEqual([...ctx.__bundle.missing], ['assets/art/missing.webp']);
});

test('bootstrap: new Worker(url) of an embedded worker script starts a classic blob worker whose fetch serves the assets', async () => {
  const started = [];
  class FakeWorker {
    constructor(url, options) {
      started.push({ url, options });
    }
  }
  const blobs = [];
  class FakeBlob {
    constructor(parts, options) {
      this.text = parts.join('');
      this.type = options.type;
      blobs.push(this);
    }
  }
  const FakeURL = class extends URL {
    static createObjectURL(blob) {
      return `blob:null/${blobs.indexOf(blob)}`;
    }
  };
  const SCRIPT = 'self.ran = true;';
  const assets = { 'assets/art/manifest.json': ['application/json', Buffer.from('{"a":1}').toString('base64')] };
  const ctx = boot(assets, {
    workers: { 'src/render/world-worker.js': SCRIPT },
    globals: { Worker: FakeWorker, Blob: FakeBlob, URL: FakeURL },
  });
  const url = new FakeURL('./world-worker.js', 'rnt://app/src/render/index.js');
  const w = new ctx.Worker(url, { type: 'module' });
  assert.ok(w instanceof FakeWorker);
  assert.equal(started.length, 1);
  assert.equal(started[0].url, 'blob:null/0');
  assert.equal(started[0].options, undefined, 'a classic worker: no type: "module"');
  assert.ok(blobs[0].text.endsWith(SCRIPT), 'the folded script follows the prelude');
  new ctx.Worker(url);
  assert.equal(blobs.length, 1, 'the blob is made once');
  assert.equal(started[1].url, 'blob:null/0');
  assert.throws(() => new ctx.Worker('rnt://app/src/other.js'), /no worker/);

  // the prelude runs first inside the worker: fetch() of an embedded file is served from the asset map
  const prelude = blobs[0].text.slice(0, blobs[0].text.length - SCRIPT.length);
  const calls = [];
  const self = { fetch: async (u) => (calls.push(String(u)), new Response('net')) };
  vm.runInNewContext(prelude, { self, Response, atob, Promise, Uint8Array, decodeURIComponent });
  const ok = await self.fetch(new FakeURL('assets/art/manifest.json', 'rnt://app/'));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { a: 1 });
  assert.equal((await self.fetch('rnt://app/assets/art/nope.webp?v=1')).status, 404);
  assert.equal(await (await self.fetch('https://example.org/x')).text(), 'net');
  assert.deepEqual(calls, ['https://example.org/x']);
});

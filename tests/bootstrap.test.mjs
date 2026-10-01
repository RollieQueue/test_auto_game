// The single-file build's runtime shim (tools/build/bootstrap.js) in a minimal fake DOM: embedded assets must
// reach <img> however the element gets its src, including HTML strings (the atlas cards use innerHTML).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function boot(assets) {
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
    getElementById: (id) => (id === 'rnt-assets' ? { textContent: JSON.stringify(assets) } : null),
  };
  const ctx = { document, Element, HTMLImageElement, URL, atob, Response, Promise, console, fetch: async () => null };
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

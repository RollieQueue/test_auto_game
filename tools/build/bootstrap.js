// Runtime shim of the single-file build (a classic inline script that runs before any module).
// 1. Project files that were embedded at build time (<script type="application/json" id="rnt-assets">:
//    { "assets/art/x.webp": ["image/webp", "<base64>"], ... }) are served from memory: fetch(), the <img> src
//    setter / setAttribute and <img src> inside HTML strings (innerHTML, outerHTML, insertAdjacentHTML) resolve
//    them, whether given as a document-relative path ("assets/art/x.webp") or as a module-relative URL
//    (import.meta.url is rewritten at build time to "rnt://app/<module path>").
//    A project path under assets/ that is not embedded fails quietly (synthetic 404 / empty image) instead of
//    asking the file:// scheme, which browsers refuse with console errors.
// 2. Module workers cannot load the bundle's modules (workers get no import map, and blob: module workers are
//    refused on file://). The build folds each worker's module graph into ONE classic script (<script
//    type="application/json" id="rnt-workers">: { "src/render/world-worker.js": "<script text>" }); `new Worker(url)`
//    for such a URL starts it from a blob: URL, with a fetch() that serves the embedded assets. Any other Worker URL
//    throws, so the caller falls back to the main thread as before.
(function () {
  'use strict';
  var VIRTUAL = 'rnt://app/';
  var ASSETS = {};
  var ASSETS_TEXT = '{}'; // the same JSON, handed to a worker as is (a JSON text is also a JS expression)
  try {
    var node = document.getElementById('rnt-assets');
    if (node) {
      ASSETS_TEXT = node.textContent || '{}';
      ASSETS = JSON.parse(ASSETS_TEXT);
    }
  } catch (err) {
    console.warn('[bundle] cannot read the embedded assets', err);
  }
  var missing = [];
  var dataUrls = {};
  var dir = String(document.baseURI).replace(/[?#].*$/, '').replace(/[^/]*$/, '');

  function keyOf(input) {
    var s;
    if (typeof input === 'string') s = input;
    else if (input && typeof input.href === 'string') s = input.href; // URL, <a>
    else if (input && typeof input.url === 'string') s = input.url; // Request
    else return null;
    var path;
    if (s.indexOf(VIRTUAL) === 0) {
      path = s.slice(VIRTUAL.length);
    } else {
      if (/^(data|blob|javascript|about):/i.test(s)) return null;
      var abs;
      try {
        abs = new URL(s, document.baseURI).href;
      } catch (err) {
        return null;
      }
      if (abs.indexOf(dir) !== 0) return null;
      path = abs.slice(dir.length);
    }
    path = path.replace(/[?#].*$/, '');
    try {
      path = decodeURIComponent(path);
    } catch (err) {
      /* keep as is */
    }
    return path;
  }

  function isProjectAsset(key) {
    return key !== null && key.indexOf('assets/') === 0;
  }

  function bytesOf(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function dataUrl(key) {
    var hit = dataUrls[key];
    if (!hit) hit = dataUrls[key] = 'data:' + ASSETS[key][0] + ';base64,' + ASSETS[key][1];
    return hit;
  }

  function lookup(key) {
    return key !== null && Object.prototype.hasOwnProperty.call(ASSETS, key);
  }

  function miss(key) {
    if (missing.indexOf(key) < 0) missing.push(key);
  }

  // fetch -------------------------------------------------------------------
  var realFetch = window.fetch;
  if (typeof realFetch === 'function') {
    window.fetch = function (input, init) {
      var key = keyOf(input);
      if (lookup(key)) {
        return Promise.resolve(new Response(bytesOf(ASSETS[key][1]), { status: 200, headers: { 'content-type': ASSETS[key][0] } }));
      }
      if (isProjectAsset(key)) {
        miss(key);
        return Promise.resolve(new Response(null, { status: 404, statusText: 'not embedded in this bundle' }));
      }
      return realFetch.apply(this, arguments);
    };
  }

  // images ------------------------------------------------------------------
  function mapImage(value) {
    var key = keyOf(value);
    if (lookup(key)) return dataUrl(key);
    if (isProjectAsset(key)) {
      miss(key);
      return 'data:,'; // an image that fails to decode: fires "error" like a 404 would, without a console error
    }
    return value;
  }

  var desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (desc && desc.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (value) {
        desc.set.call(this, mapImage(value));
      },
    });
  }
  var realSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'src') value = mapImage(value);
    return realSetAttribute.call(this, name, value);
  };

  // HTML strings (innerHTML, outerHTML, insertAdjacentHTML): the parser sets <img src> without the hooks above,
  // so the atlas cards («<img src="assets/art/...">» in a template) would ask file:// and fail.
  var IMG_SRC = /(<img\b[^>]*?\ssrc\s*=\s*)(["'])([^"']*)\2/gi;
  function mapHtml(html) {
    if (typeof html !== 'string' || !/<img\b/i.test(html)) return html;
    return html.replace(IMG_SRC, function (all, head, q, url) {
      var plain = url.replace(/&amp;/g, '&');
      var mapped = mapImage(plain);
      return mapped === plain ? all : head + q + mapped + q;
    });
  }
  ['innerHTML', 'outerHTML'].forEach(function (prop) {
    var d = Object.getOwnPropertyDescriptor(Element.prototype, prop);
    if (!d || !d.set) return;
    Object.defineProperty(Element.prototype, prop, {
      configurable: true,
      enumerable: d.enumerable,
      get: d.get,
      set: function (value) {
        d.set.call(this, mapHtml(value));
      },
    });
  });
  var realInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  if (typeof realInsertAdjacentHTML === 'function') {
    Element.prototype.insertAdjacentHTML = function (position, html) {
      return realInsertAdjacentHTML.call(this, position, mapHtml(html));
    };
  }

  // workers -----------------------------------------------------------------
  // Runs inside the worker, before the bundled script: the worker has no page shim, so its fetch() of an embedded
  // file (sprites, fonts) is answered from the same asset map. Self-contained: it travels as source text.
  function workerPrelude(ASSETS) {
    var VIRTUAL = 'rnt://app/';
    var realFetch = self.fetch;
    self.fetch = function (input) {
      var s = typeof input === 'string' ? input : input && (input.href || input.url);
      if (typeof s !== 'string' || s.indexOf(VIRTUAL) !== 0) return realFetch.apply(self, arguments);
      var key = s.slice(VIRTUAL.length).replace(/[?#].*$/, '');
      try {
        key = decodeURIComponent(key);
      } catch (err) {
        /* keep as is */
      }
      if (!Object.prototype.hasOwnProperty.call(ASSETS, key)) {
        return Promise.resolve(new Response(null, { status: 404, statusText: 'not embedded in this bundle' }));
      }
      var bin = atob(ASSETS[key][1]);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return Promise.resolve(new Response(bytes, { status: 200, headers: { 'content-type': ASSETS[key][0] } }));
    };
  }

  var RealWorker = window.Worker;
  var workerScripts = null;
  var workerBlobs = {};
  function embeddedWorker(key) {
    if (workerScripts === null) {
      workerScripts = {};
      try {
        var tag = document.getElementById('rnt-workers');
        if (tag) workerScripts = JSON.parse(tag.textContent || '{}');
      } catch (err) {
        console.warn('[bundle] cannot read the embedded workers', err);
      }
    }
    return key !== null && Object.prototype.hasOwnProperty.call(workerScripts, key) ? workerScripts[key] : null;
  }

  function BundledWorker(url, options) {
    var script = embeddedWorker(keyOf(url));
    if (typeof RealWorker !== 'function' || script === null) throw new Error('this bundle has no worker for ' + url);
    var key = keyOf(url);
    var blobUrl = workerBlobs[key];
    if (!blobUrl) {
      var prelude = '(' + workerPrelude.toString() + ')(' + ASSETS_TEXT + ');\n';
      blobUrl = workerBlobs[key] = URL.createObjectURL(new Blob([prelude, script], { type: 'text/javascript' }));
    }
    // a classic worker: the folded script has no import/export
    return new RealWorker(blobUrl, options && options.name ? { name: options.name } : undefined);
  }
  if (typeof RealWorker === 'function') {
    BundledWorker.prototype = RealWorker.prototype;
    try {
      Object.defineProperty(window, 'Worker', { value: BundledWorker, configurable: true, writable: true });
    } catch (err) {
      window.Worker = BundledWorker;
    }
  }

  window.__bundle = { assets: Object.keys(ASSETS), missing: missing };
})();

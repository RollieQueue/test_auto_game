// A 2D context that only remembers (shared by the plate painter tests): every drawing call is logged with its numbers
// rounded, so two ways of painting the same plate can be compared call for call.

/** { ctx, log }: `ctx` is a Proxy standing in for a CanvasRenderingContext2D of a w × h canvas. */
export function fakeCtx(w = 400, h = 400) {
  const log = [];
  const st = { globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px serif', textAlign: 'start', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter' };
  const stack = [];
  const num = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : typeof v === 'string' ? v : typeof v);
  const handler = {
    get(_, name) {
      if (name in st) return st[name];
      if (name === 'canvas') return { width: w, height: h };
      if (name === 'save') return () => (stack.push({ ...st }), log.push('save'));
      if (name === 'restore') return () => (Object.assign(st, stack.pop() || {}), log.push('restore'));
      if (name === 'createRadialGradient' || name === 'createLinearGradient') return (...a) => (log.push(`${name}(${a.map(num)})`), { addColorStop: (o, c) => log.push(`stop(${o},${c})`) });
      if (name === 'createPattern') return () => ({});
      if (name === 'createImageData') return (cw, ch) => ({ data: new Uint8ClampedArray(cw * ch * 4) });
      if (name === 'getImageData') return (x, y, cw, ch) => ({ data: new Uint8ClampedArray(cw * ch * 4) });
      if (name === 'measureText') return (t) => ({ width: String(t).length * 6 });
      if (name === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (name === 'putImageData' || name === 'drawImage') return () => {};
      return (...args) => {
        log.push(`${String(name)}(${args.map(num).join(',')})`);
      };
    },
    set(_, name, value) {
      st[name] = value;
      if (name === 'globalCompositeOperation' || name === 'font') log.push(`${name}=${value}`);
      return true;
    },
  };
  return { ctx: new Proxy({}, handler), log };
}

/** An OffscreenCanvas stand-in whose context is a fakeCtx; `made` collects the canvases (the painters build grain tiles). */
export function fakeOffscreenCanvas(made = []) {
  return class FakeOffscreenCanvas {
    constructor(w, h) {
      this.width = w;
      this.height = h;
      this.fake = fakeCtx(w, h);
      made.push(this);
    }
    getContext() {
      return this.fake.ctx;
    }
  };
}

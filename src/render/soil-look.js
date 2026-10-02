// What a glade's soil shows besides its colours: the list of small features (needles, pebbles, worm casts and channels,
// krotovinas, carbonate nodules, gley mottles, rust spots, charcoal lenses, ...) laid out from the biome's `look` data
// (world/biomes.js). Pure and DOM-free (unit-tested). The layout has its own generator, derived from the world seed and
// the feature's index, so it never draws from the world's generation stream and the same seed always gives the same
// soil; the painter (soil-paint.js) only draws what this returns.
import { createRng, hash32 } from '../core/rng.js';
import { sampleProfile } from '../world/query.js';
import { BIOMES } from '../world/biomes.js';

/** Kinds a biome's `features` may name. */
export const FEATURE_KINDS = ['needle', 'stone', 'cast', 'channel', 'krot', 'nodule', 'gley', 'rust', 'damp', 'rootchan', 'lens', 'tongue'];

/** The look data of a world's biome (an unknown biome falls back to the mixed forest's). */
export const soilLookOf = (world) => (BIOMES[world && world.biome] || BIOMES.mixed).look;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The features of a world's soil, in drawing order. ext: { x0, x1 } the span to fill (default: the whole width).
 * Every item has kind, band (index into world.horizons), x, y (inside that band at x) and the numbers its kind needs.
 */
export function soilFeatures(world, ext) {
  const look = soilLookOf(world);
  if (!look || !look.features) return [];
  const hs = world.horizons;
  const step = world.step;
  const x0 = ext ? ext.x0 : 0;
  const x1 = ext ? ext.x1 : world.width;
  const topY = (i, x) => sampleProfile(hs[i].top, step, x);
  const botY = (i, x) => (i + 1 < hs.length ? topY(i + 1, x) : world.height);
  const out = [];

  look.features.forEach((spec, fi) => {
    const bi = hs.findIndex((h) => h.id === spec.in);
    if (bi < 0 || !FEATURE_KINDS.includes(spec.kind)) return;
    const rng = createRng(hash32(world.seed, 'soil-look', fi, spec.kind));
    const r = rng.next;
    let count;
    if (spec.count) count = rng.int(spec.count[0], spec.count[1]);
    else {
      let thick = 0;
      let n = 0;
      for (let x = x0; x <= x1; x += 160, n++) thick += Math.max(0, botY(bi, x) - topY(bi, x));
      const expect = ((thick / Math.max(1, n)) * (x1 - x0) * spec.density) / 1e4;
      count = Math.floor(expect) + (r() < expect % 1 ? 1 : 0);
    }
    const [f0, f1] = spec.y || [0.1, 0.9];
    const sz = (k, fallback) => (spec.size && spec.size[k] ? lerp(spec.size[k][0], spec.size[k][1], r()) : fallback);
    for (let k = 0; k < count; k++) {
      const x = lerp(x0, x1, r());
      const ty = topY(bi, x);
      const by = botY(bi, x);
      const bh = by - ty;
      if (bh < 6) continue;
      const fy = lerp(f0, f1, r());
      const rx = sz(0, 0);
      const ryWanted = sz(1, rx * lerp(0.6, 0.9, r()));
      const seed = Math.floor(r() * 1e9);
      const ry = Math.max(0.5, Math.min(ryWanted, (bh - 2) * 0.45));
      const rot = (r() - 0.5) * 0.5;
      const fit = (y, h) => clamp(y, ty + h + 1, by - h - 1);
      const base = { kind: spec.kind, band: bi };
      switch (spec.kind) {
        case 'needle': {
          const len = lerp(spec.len[0], spec.len[1], r());
          out.push({ ...base, x, y: fit(ty + bh * fy, 1.5), len, a: (r() - 0.5) * 1.5, pair: r() < 0.55, tone: Math.floor(r() * 3) });
          break;
        }
        case 'stone': {
          out.push({
            ...base,
            x,
            y: fit(ty + bh * fy, ry),
            rx,
            ry,
            rot: r() * Math.PI,
            tone: spec.tones[Math.floor(r() * spec.tones.length)],
            angular: r() < (spec.angular ?? 0.5),
            glint: !!spec.glint && r() < 0.7,
            seed,
          });
          break;
        }
        case 'cast': {
          out.push({ ...base, x, y: fit(ty + bh * fy, rx), r: rx, n: 5 + Math.floor(r() * 5), seed });
          break;
        }
        case 'channel':
        case 'rootchan': {
          const len = lerp(spec.len[0], spec.len[1], r());
          const a = Math.PI / 2 + (r() - 0.5) * (spec.kind === 'channel' ? 1.1 : 0.5);
          const sway = (r() - 0.5) * len * 0.35;
          const y0 = ty + bh * fy;
          const pts = [];
          for (let s = 0; s <= 5; s++) {
            const t = s / 5;
            pts.push({ x: x + Math.cos(a) * len * t + Math.sin(t * 3.1 + sway) * 0.15 * len * (1 - t * 0.4) + sway * t, y: clamp(y0 + Math.sin(a) * len * t, ty + 2, by - 2) });
          }
          out.push({ ...base, x, y: clamp(y0, ty + 2, by - 2), pts, w: spec.kind === 'channel' ? lerp(1.3, 2.4, r()) : lerp(1, 1.6, r()), seed });
          break;
        }
        case 'krot': {
          // a thin band squeezes the height; keep it a round or oval cross-section, not a streak
          out.push({ ...base, x, y: fit(ty + bh * fy, ry * 1.1), rx: Math.min(rx, ry * 2.4), ry, rot: (r() - 0.5) * 1.2, fill: spec.fill, seed });
          break;
        }
        case 'nodule': {
          out.push({ ...base, x, y: fit(ty + bh * fy, ry), rx, ry, rot: r() * Math.PI });
          break;
        }
        case 'gley':
        case 'damp':
        case 'rust': {
          const alpha = lerp(spec.alpha[0], spec.alpha[1], r());
          const y = fit(ty + bh * fy, ry);
          out.push({ ...base, x, y, rx, ry, rot, alpha, seed });
          if (spec.kind === 'gley' && spec.rust && r() < spec.rust) {
            // rust gathers along the rim of a gley patch
            const rims = 1 + Math.floor(r() * 3);
            for (let m = 0; m < rims; m++) {
              const a = r() * Math.PI * 2;
              const rr = lerp(2.5, 6, r());
              const rxp = clamp(x + Math.cos(a) * rx * 0.95, x0, x1);
              const lo = topY(bi, rxp) + rr + 1;
              const hi = botY(bi, rxp) - rr - 1;
              out.push({ kind: 'rust', band: bi, x: rxp, y: hi >= lo ? clamp(y + Math.sin(a) * ry * 0.95, lo, hi) : (lo + hi) / 2, rx: rr, ry: rr * lerp(0.6, 0.9, r()), rot: r() * 3, alpha: lerp(0.5, 0.8, r()), seed: Math.floor(r() * 1e9) });
            }
          }
          break;
        }
        case 'lens': {
          // size: [[width], [thickness]]
          const w = rx;
          const h = ryWanted;
          const y = fit(ty + bh * fy, h + 2);
          const chips = [];
          const nChips = 3 + Math.floor(r() * 5);
          for (let c = 0; c < nChips; c++) chips.push({ dx: (r() - 0.5) * w * 1.15, dy: (r() - 0.5) * h * 3.4, r: lerp(0.7, 1.8, r()) });
          out.push({ ...base, x, y, w, h, rot: (r() - 0.5) * 0.16, chips, seed });
          break;
        }
        case 'tongue': {
          const len = Math.min(lerp(spec.len[0], spec.len[1], r()), bh * 0.8);
          out.push({ ...base, x, y: ty + 1, len, w: rx, seed });
          break;
        }
        default:
          break;
      }
    }
  });
  return out;
}

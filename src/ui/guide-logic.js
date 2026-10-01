// First-session guide, the pure part: which hint fits the state and what it points at. No DOM.
// Steps advance with the game, never with clicks:
//   spore -> water -> tree -> fruit -> mineral -> wait -> (quiet)
import { groundYAt, rockAt } from '../world/query.js';
import * as balance from '../sim/balance.js';
import { fruitCostOf, wormHint } from './threats.js';
import { rivalHint } from './rival.js';

const FRUIT_DEPTH = () => balance.B?.fruitMaxDepth ?? 45;

const MINERAL_WORDS = { phosphorus: 'фосфора', nitrogen: 'азота' };

/** Distance from (x, y) to the nearest alive node: { d, node } (node null for an empty net). */
function nearestAlive(nodes, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return { d: bestD, node: best };
}

/** True when a straight line between two points crosses a rock (sampled). */
function crossesRock(world, a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(2, Math.ceil(len / 14));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (rockAt(world, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return true;
  }
  return false;
}

/**
 * Picks the closest candidate to the network. `reach` is the radius to subtract (the deposit itself is
 * already a target), a rock on the straight way adds a penalty. The previous choice stays unless a
 * clearly better one appears (the hint must not jump while the network grows).
 */
function nearest(state, nodes, cands, prevKey) {
  let best = null;
  let keep = null;
  for (const c of cands) {
    const { d, node } = nearestAlive(nodes, c.x, c.y);
    if (!node) continue;
    const score = Math.max(0, d - (c.reach || 0)) + (crossesRock(state.world, node, c) ? 260 : 0);
    const entry = { c, score };
    if (!best || score < best.score) best = entry;
    if (c.key === prevKey) keep = entry;
  }
  if (keep && best && keep.score <= best.score * 1.35 + 40) return keep.c;
  return best ? best.c : null;
}

const FRESH_LINK = 4; // s: a mineral link younger than this has not delivered anything yet

/** The mineral stock is empty and nothing flows in (and no link is brand new): waiting will not help. */
export function mineralsDry(state) {
  const have = (state.res && state.res.minerals) || 0;
  const rate = (state.rates && state.rates.minerals) || 0;
  if (have >= 1 || rate > 0.005) return false;
  return !(state.net.links || []).some((l) => l.kind === 'mineral' && state.time - (l.born || 0) < FRESH_LINK);
}

/** Score of a candidate as nearest() sees it: distance to the network beyond its reach, plus a rock penalty. */
function scoreOf(state, nodes, c) {
  const { d, node } = nearestAlive(nodes, c.x, c.y);
  if (!node) return Infinity;
  return Math.max(0, d - (c.reach || 0)) + (crossesRock(state.world, node, c) ? 260 : 0);
}

/** A tip of the youngest tree is worth a detour of this many px over the nearest tip of an older one. */
const YOUNG_DETOUR = 500;

/**
 * The root tips the «Кончик корня» hint may point at: the youngest tree that can still grow (a sapling grows in
 * 160 s, a mature tree in 360 s, so the first objective «помочь дереву подрасти» comes soonest), unless its tips are
 * far beyond the network's reach while another tree stands close.
 */
function treeTipCandidates(state, nodes) {
  const all = [];
  for (const t of state.world.trees) {
    t.tips.forEach((tip, i) => {
      if (tip.minStage <= t.stage) all.push({ x: tip.x, y: tip.y, tree: t, key: `tip:${t.id}:${i}` });
    });
  }
  const growing = all.filter((c) => c.tree.stage < 3);
  if (!growing.length) return { cands: all, young: false };
  const stage = Math.min(...growing.map((c) => c.tree.stage));
  const young = growing.filter((c) => c.tree.stage === stage);
  if (young.length === all.length) return { cands: all, young: false };
  const best = (list) => Math.min(...list.map((c) => scoreOf(state, nodes, c)));
  if (best(young) > best(all) + YOUNG_DETOUR) return { cands: all, young: false };
  return { cands: young, young: true };
}

const hint = (id, title, text, extra = {}) => ({ id, title, text, ring: null, ...extra });

/**
 * The hint for the current state, or null when the guide has nothing more to say.
 * `prevKey` is the key of the target chosen last time (for stickiness).
 * `extras.wormHint`: the one-time arrow at the first worm ever may interrupt the normal steps.
 * `extras.rivalHint`: the same for the first grip of the honey fungus (it goes before the worm's arrow).
 * Returns { id, title, text, ring: {x, y, rx, ry} | null, key, duration? }.
 */
export function pickHint(state, prevKey = null, tool = state.ui && state.ui.tool, extras = {}) {
  const { net, world } = state;
  const links = net.links || [];
  const has = (kind) => links.some((l) => l.kind === kind);
  const nodes = net.nodes.filter((n) => n.alive);

  // a) nothing grown yet: point at the spore
  const started = (net.growing && net.growing.length > 0) || net.nodes.some((n) => n.born > 0.05);
  if (started && extras.rivalHint) {
    const rh = rivalHint(state);
    if (rh) return rh;
  }
  if (started && extras.wormHint) {
    const wh = wormHint(state);
    if (wh) return wh;
  }
  if (!started) {
    const o = net.nodes[net.originId] || nodes[0];
    if (!o) return null;
    return hint(
      'spore',
      'Это спора',
      'Зажми на ней кнопку мыши и веди в сторону: так прорастает нить. Рост стоит сахара.',
      { ring: { x: o.x, y: o.y, rx: 25, ry: 25 }, key: 'spore' },
    );
  }

  // b) no water yet: the nearest pocket
  if (!has('water')) {
    const cands = world.water
      .filter((w) => w.amount > 0)
      .map((w) => ({ x: w.x, y: w.y, rx: w.rx * 1.12 + 8, ry: w.ry * 1.12 + 8, reach: (w.rx + w.ry) / 2, key: `water:${w.id}` }));
    const c = nearest(state, nodes, cands, prevKey);
    if (c) {
      return hint(
        'water',
        'Влага',
        'Влага рядом — протяни нить сюда. Зажми мышь на любом узле сети и веди к голубому пятну.',
        { ring: { x: c.x, y: c.y, rx: c.rx, ry: c.ry }, key: c.key },
      );
    }
    return null;
  }

  // c) water linked, no tree: the nearest active root tip
  if (!has('tree')) {
    const { cands, young } = treeTipCandidates(state, nodes);
    const c = nearest(state, nodes, cands, prevKey);
    if (c) {
      const text = young
        ? 'Дотяни нить до кончика корня самого молодого дерева: оно подрастёт быстрее других. Союзник платит сахаром за влагу и минералы.'
        : `Дотяни нить до кончика корня. ${c.tree.name} станет союзником и начнёт платить сахаром за влагу и минералы.`;
      return hint(
        'tree',
        'Кончик корня',
        text,
        { ring: { x: c.x, y: c.y, rx: 28, ry: 28 }, key: c.key },
      );
    }
    return null;
  }

  // d) a tree is linked, no mushroom: a node near the surface
  if (state.mushrooms.length === 0) {
    const maxDepth = FRUIT_DEPTH();
    let best = null;
    let keep = null;
    for (const n of nodes) {
      const depth = n.y - groundYAt(world, n.x);
      const entry = { n, depth };
      if (!best || depth < best.depth) best = entry;
      if (`node:${n.id}` === prevKey) keep = entry;
    }
    if (best) {
      const pick = keep && keep.depth <= maxDepth && keep.depth <= best.depth + 30 ? keep : best;
      const ring = { x: pick.n.x, y: pick.n.y, rx: 24, ry: 24 };
      const key = `node:${pick.n.id}`;
      const cost = fruitCostOf(state);
      if (pick.depth > maxDepth) {
        return hint('fruit-deep', 'Гриб', 'Гриб растёт только у самой земли. Протяни нить повыше, к поверхности.', { ring, key });
      }
      if (state.res.sugar < cost) {
        return hint('fruit-sugar', 'Гриб', `Гриб стоит ${Math.round(cost)} сахара. Пусть союзник накопит, и щёлкни по узлу у земли.`, { ring, key });
      }
      const text =
        tool === 'fruit'
          ? 'Щёлкни по этому узлу: вырастет гриб. Созрев, он выпустит споры, а споры — это очки.'
          : 'Нить дошла до земли. Нажми {2} и щёлкни по узлу: вырастет гриб. Созрев, он выпустит споры.';
      return hint('fruit', 'Гриб', text, { ring, key });
    }
    return null;
  }

  // e) no minerals yet, or the stock is empty and nothing flows in (the deposit is spent): a deposit that still has some
  const dry = mineralsDry(state);
  if (!has('mineral') || dry) {
    const linked = new Set(links.filter((l) => l.kind === 'mineral').map((l) => l.targetId));
    const cands = world.minerals
      .filter((m) => m.amount > 0 && !(dry && linked.has(m.id)))
      .map((m) => ({ x: m.x, y: m.y, r: m.r + 14, reach: m.r, kind: m.kind, key: `mineral:${m.id}` }));
    const c = nearest(state, nodes, cands, prevKey);
    if (c) {
      const spent = has('mineral'); // a hypha reaches a deposit already, but it has run dry
      return hint(
        spent ? 'mineral-dry' : 'mineral',
        `Залежь ${MINERAL_WORDS[c.kind] || 'минералов'}`,
        spent
          ? 'Минералы кончились: залежь, до которой дотянулась нить, иссякла. Протяни нить к новой, пока дерево не захирело.'
          : 'Деревьям нужны и минералы. Протяни нить к залежи: довольное дерево быстрее растёт и щедрее платит.',
        { ring: { x: c.x, y: c.y, rx: c.r, ry: c.r }, key: c.key },
      );
    }
    if (dry) return null; // nothing left to point at: «жди, пока полоски не пусты» would be a lie
  }

  // f) all in place: wait
  return hint(
    'wait',
    'Теперь жди…',
    'Деревья растут неспешно, а гриб зреет около двадцати секунд. Следи за полосками под влагой и минералами: пока они не пусты, лес доволен.',
    { key: 'wait', duration: 18 },
  );
}

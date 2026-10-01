// First-session guide, the pure part: which hint fits the state and what it points at. No DOM.
// Steps advance with the game, never with clicks:
//   spore -> water -> tree -> fruit -> mineral -> wait -> (quiet)
import { groundYAt, rockAt } from '../world/query.js';
import * as balance from '../sim/balance.js';

const FRUIT_DEPTH = () => balance.B?.fruitMaxDepth ?? 45;
const FRUIT_COST = () => balance.B?.mushroomCost ?? 24;

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

const hint = (id, title, text, extra = {}) => ({ id, title, text, ring: null, ...extra });

/**
 * The hint for the current state, or null when the guide has nothing more to say.
 * `prevKey` is the key of the target chosen last time (for stickiness).
 * Returns { id, title, text, ring: {x, y, rx, ry} | null, key, duration? }.
 */
export function pickHint(state, prevKey = null, tool = state.ui && state.ui.tool) {
  const { net, world } = state;
  const links = net.links || [];
  const has = (kind) => links.some((l) => l.kind === kind);
  const nodes = net.nodes.filter((n) => n.alive);

  // a) nothing grown yet: point at the spore
  const started = (net.growing && net.growing.length > 0) || net.nodes.some((n) => n.born > 0.05);
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
    const cands = [];
    for (const t of world.trees) {
      t.tips.forEach((tip, i) => {
        if (tip.minStage <= t.stage) cands.push({ x: tip.x, y: tip.y, tree: t, key: `tip:${t.id}:${i}` });
      });
    }
    const c = nearest(state, nodes, cands, prevKey);
    if (c) {
      return hint(
        'tree',
        'Кончик корня',
        `Дотяни нить до кончика корня. ${c.tree.name} станет союзником и начнёт платить сахаром за влагу и минералы.`,
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
      const cost = FRUIT_COST();
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

  // e) no minerals yet: the nearest deposit
  if (!has('mineral')) {
    const cands = world.minerals
      .filter((m) => m.amount > 0)
      .map((m) => ({ x: m.x, y: m.y, r: m.r + 14, reach: m.r, kind: m.kind, key: `mineral:${m.id}` }));
    const c = nearest(state, nodes, cands, prevKey);
    if (c) {
      return hint(
        'mineral',
        `Залежь ${MINERAL_WORDS[c.kind] || 'минералов'}`,
        'Деревьям нужны и минералы. Протяни нить к залежи: довольное дерево быстрее растёт и щедрее платит.',
        { ring: { x: c.x, y: c.y, rx: c.r, ry: c.r }, key: c.key },
      );
    }
  }

  // f) all in place: wait
  return hint(
    'wait',
    'Теперь жди…',
    'Деревья растут неспешно, а гриб зреет около двадцати секунд. Следи за шкалой «Запас сети»: пока в ней есть влага и минералы, лес доволен.',
    { key: 'wait', duration: 18 },
  );
}

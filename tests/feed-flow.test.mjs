// Feeding made visible («Подкормка видна в сети»): the golden 'feed' flow from the spore to the fed tree's contact node
// (src/sim/flows.js recomputeFlows) and the mark at the tree's foot (src/render/feed-mark.js). Numbers come from B.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { B } from '../src/sim/balance.js';
import { addNode } from '../src/sim/network.js';
import { recomputeFlows } from '../src/sim/flows.js';
import { commandFeed } from '../src/sim/feed.js';
import { commandBarrier, createRival } from '../src/sim/rival.js';
import { decodeState, encodeState } from '../src/persist-codec.js';
import { createFeedMark, feedMarkOf, markGap } from '../src/render/feed-mark.js';

const DT = 0.1;
const feedFlows = (s) => s.flows.filter((f) => f.kind === 'feed');

/** Seed 13: a straight hypha of `n` nodes from the spore; tree 0 touches its last node. */
function scene(n = 20) {
  const s = createState(13);
  s.phase = 'playing';
  const o = s.net.nodes[s.net.originId];
  const ids = [s.net.originId];
  for (let k = 1; k <= n; k++) ids.push(addNode(s, o.x + k * 16, o.y, ids[k - 1]).id);
  const tree = s.world.trees[0];
  tree.linked = true;
  for (const t of s.world.trees) s.sim.contacts[t.id] = t === tree ? [ids[n]] : [];
  return { s, ids, tree };
}

test('flows: a fed tree gets exactly one golden flow from the spore to its contact node', () => {
  const { s, ids, tree } = scene();
  assert.equal(commandFeed(s, tree.id), 'on');
  s.feed.rate = 1.2;
  recomputeFlows(s, DT);
  const flows = feedFlows(s);
  assert.equal(flows.length, 1);
  assert.equal(flows[0].from, s.net.originId);
  assert.equal(flows[0].to, ids[ids.length - 1]);
  assert.equal(flows[0].rate, 1.2);
  assert.deepEqual(flows[0].path, ids, 'along the hypha, spore first');
});

test('flows: no feed flow at a rate below B.feedFlowMin, at rate 0, with no fed tree, or for a tree without contacts', () => {
  const { s, tree } = scene();
  recomputeFlows(s, DT);
  assert.equal(feedFlows(s).length, 0, 'no fed tree');
  commandFeed(s, tree.id);
  for (const rate of [0, B.feedFlowMin / 2, B.feedFlowMin]) {
    s.feed.rate = rate;
    recomputeFlows(s, DT);
    assert.equal(feedFlows(s).length, 0, `rate ${rate}`);
  }
  s.feed.rate = B.feedFlowMin * 2;
  recomputeFlows(s, DT);
  assert.equal(feedFlows(s).length, 1, 'just above the line it shows');
  s.sim.contacts[tree.id] = [];
  recomputeFlows(s, DT);
  assert.equal(feedFlows(s).length, 0, 'no contact node, no path');
  s.sim.contacts[tree.id] = [s.net.originId];
  recomputeFlows(s, DT);
  assert.equal(feedFlows(s).length, 0, 'a contact on the spore itself has no path');
});

test('flows: the feed flow goes to the nearest contact of several, and stops when feeding is switched off', () => {
  const { s, ids, tree } = scene();
  s.sim.contacts[tree.id] = [ids[20], ids[8], ids[14]];
  commandFeed(s, tree.id);
  s.feed.rate = 1;
  recomputeFlows(s, DT);
  assert.equal(feedFlows(s)[0].to, ids[8], 'the contact nearest the spore along the network');
  commandFeed(s, tree.id); // the same tree again: off
  assert.equal(s.feed, null);
  recomputeFlows(s, DT);
  assert.equal(feedFlows(s).length, 0);
});

test('flows: none through a barrier ring, and the feed flow does not crowd out others, and thickens its path', () => {
  const { s, ids, tree } = scene();
  s.flags.rival = true;
  const r = (s.rival ??= createRival(s));
  Object.assign(r, { awake: true, age: 1000, spawnT: 1e9 });
  s.res.sugar = 200;
  commandFeed(s, tree.id);
  s.feed.rate = 1;
  recomputeFlows(s, DT);
  assert.equal(feedFlows(s).length, 1, 'open path: it flows');
  assert.equal(commandBarrier(s, ids[10]), true);
  recomputeFlows(s, DT);
  assert.equal(feedFlows(s).length, 0, 'the ring holds: nothing crosses it');
  for (const f of s.flows) assert.ok(!f.path.some((id) => ids.slice(7, 14).includes(id)), 'no flow of any kind inside the ring');

  // a feed flow thickens its path (towards B.feedThickW, never beyond) and moves no sugar of its own
  const t = scene();
  commandFeed(t.s, t.tree.id);
  t.s.feed.rate = B.feedRate;
  for (let i = 0; i < 2000; i++) recomputeFlows(t.s, DT);
  assert.equal(feedFlows(t.s).length, 1);
  const w = t.ids.slice(1).map((id) => t.s.net.edges[t.s.sim.parentEdge[id]].w);
  assert.ok(Math.min(...w) >= B.feedThickW - 0.1 && Math.max(...w) <= B.feedThickW + 0.05, `every edge of the path is a cord: ${w.slice(0, 3)}`);
});

test('persist: a saved game with a feed flow loads back (kind «feed» is valid)', () => {
  const { s, tree } = scene();
  commandFeed(s, tree.id);
  s.feed.rate = 1;
  recomputeFlows(s, DT);
  assert.equal(feedFlows(s).length, 1);
  const back = decodeState(JSON.parse(JSON.stringify(encodeState(s))));
  assert.ok(back, 'the payload is accepted');
  assert.equal(back.feed.treeId, tree.id);
});

// ---- the mark at the trunk foot ---------------------------------------------------------------------------------------

test('mark: shown for the fed tree while the rate tells, hidden otherwise', () => {
  const { s, tree } = scene();
  assert.equal(feedMarkOf(s), null, 'nothing fed');
  commandFeed(s, tree.id);
  assert.equal(feedMarkOf(s), null, 'fed, but nothing flows yet (rate 0)');
  s.feed.rate = 1.24;
  const m = feedMarkOf(s);
  assert.equal(m.treeId, tree.id);
  assert.equal(m.x, tree.x);
  assert.equal(m.y, tree.baseY, 'at the trunk foot');
  assert.equal(m.text, '+1,2/с');
  s.feed.rate = 12.4;
  assert.equal(feedMarkOf(s).text, '+12/с');
  s.feed.rate = B.feedFlowMin / 2;
  assert.equal(feedMarkOf(s), null, 'a trickle shows nothing');
  s.feed.rate = 1;
  tree.lost = true;
  assert.equal(feedMarkOf(s), null, 'a lost tree is not fed');
  tree.lost = false;
  commandFeed(s, tree.id);
  assert.equal(feedMarkOf(s), null, 'switched off');
});

test('mark: stands clear of the rot ring of a gripped trunk (half-width 17 + 7 per stage) and of its infection mark', () => {
  for (let stage = 0; stage <= 3; stage++) assert.ok(markGap(stage) > 17 + 7 * stage + 4, `stage ${stage}`);
  assert.ok(markGap(3) > markGap(0));
  assert.equal(markGap(NaN), markGap(0));
});

/** A canvas context that records the texts and the alpha they were drawn with. */
function recorder() {
  const texts = [];
  const ctx = new Proxy(
    { texts, globalAlpha: 1, measureText: (t) => ({ width: t.length * 7 }), createLinearGradient: () => ({ addColorStop() {} }) },
    {
      get: (o, k) => (k in o ? o[k] : () => {}),
      set: (o, k, v) => ((o[k] = v), true),
    },
  );
  ctx.fillText = (text, x, y) => texts.push({ text, x, y, a: ctx.globalAlpha });
  return { ctx, texts };
}

test('mark: the renderer draws it while feeding and lets it fade away after the feeding stops', () => {
  const { s, tree } = scene();
  const mark = createFeedMark();
  const { ctx, texts } = recorder();
  commandFeed(s, tree.id);
  s.feed.rate = 1.5;
  for (let i = 0; i < 20; i++) mark.draw(ctx, s, i * 0.1, 0.1);
  const last = texts[texts.length - 1];
  assert.equal(last.text, '+1,5/с');
  assert.ok(last.x > tree.x + markGap(tree.stage), 'right of the foot, past the rot ring');
  assert.ok(last.y < tree.baseY && last.y > tree.baseY - 30, 'on the grass just above the ground line, clear of the ring and its infection mark below');
  assert.ok(last.a > 0.99, 'fully there after a moment');
  commandFeed(s, tree.id); // stop
  texts.length = 0;
  mark.draw(ctx, s, 2, 0.1);
  assert.equal(texts.length, 1, 'still fading out');
  assert.ok(texts[0].a < 1);
  for (let i = 0; i < 20; i++) mark.draw(ctx, s, 3 + i * 0.1, 0.1);
  texts.length = 0;
  mark.draw(ctx, s, 6, 0.1);
  assert.equal(texts.length, 0, 'gone');
});

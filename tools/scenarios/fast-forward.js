// Page-side scenario for tools/shot.mjs (--eval-file): the balance bot from tests/bot.mjs plays the current
// seed headless for window.__ffSeconds game seconds (default 300), then the live game continues from there.
// Use it to look at mid- and late-game scenes without waiting:
//   node tools/shot.mjs --url "/?autostart=1&seed=7" --wait 500 --eval "window.__ffSeconds = 420" \
//     --eval-file tools/scenarios/fast-forward.js --wait 3000 --shot .tmp/late.png
(async () => {
  const { playBot } = await import('/tests/bot.mjs');
  const game = window.__game;
  const seconds = window.__ffSeconds ?? 300;
  const result = playBot(game.state.seed, { maxSeconds: seconds });
  const state = result.state;
  state.flags.seasons = game.state.flags.seasons;
  state.phase = 'playing';
  state.events.length = 0;
  game.state = state;
  return {
    seed: state.seed,
    time: Math.round(state.time),
    nodes: state.net.nodes.length,
    mushrooms: state.mushrooms.length,
    done: state.objectives.filter((o) => o.done).map((o) => o.id),
    res: Object.fromEntries(Object.entries(state.res).map(([k, v]) => [k, Math.round(v)])),
  };
})();

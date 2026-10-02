// Page-side scenario for tools/shot.mjs (--eval-file): the balance bot from tests/bot.mjs plays the current
// seed headless for window.__ffSeconds game seconds (default 300), then the live game continues from there.
// window.__ffThreats = true plays with nematodes, rings and chapters on (state.flags.threats), the bot guarding with rings;
// seasons follow the live game (window.__ffSeasons overrides).
// window.__ffRival = true (or 'now': awake from the first second) adds the honey fungus; window.__ffBarrier picks how the bot
// answers it: 'near' (default: a barrier when a grip appears or a tip comes within 120 u of its tree), 'grip', or false (passive).
// Use it to look at mid- and late-game scenes without waiting:
//   node tools/shot.mjs --url "/?autostart=1&seed=7" --wait 500 --eval "window.__ffSeconds = 420" \
//     --eval-file tools/scenarios/fast-forward.js --wait 3000 --shot .tmp/late.png
(async () => {
  const { playBot } = await import('/tests/bot.mjs');
  const game = window.__game;
  const seconds = window.__ffSeconds ?? 300;
  const threats = Boolean(window.__ffThreats);
  // The bot plays under the live game's seasons flag, so fast-forwarded scenes match a real game.
  const seasons = window.__ffSeasons ?? Boolean(game.state.flags.seasons);
  const rival = window.__ffRival ?? false;
  const result = playBot(game.state.seed, { maxSeconds: seconds, threats, seasons, runOn: threats, rival, species: game.state.flags.species, barrier: window.__ffBarrier ?? 'near' });
  const state = result.state;
  state.flags.seasons = seasons;
  state.flags.threats = threats;
  state.flags.rival = rival;
  state.flags.species = game.state.flags.species; // the fungus picked on the title page
  state.phase = 'playing';
  state.events.length = 0;
  game.state = state;
  return {
    seed: state.seed,
    time: Math.round(state.time),
    nodes: state.net.nodes.length,
    mushrooms: state.mushrooms.length,
    rival: state.rival && { awake: state.rival.awake, tips: state.rival.tips.length, grips: state.rival.grip.length, segments: state.rival.edges.filter((e) => e.alive).length },
    done: state.objectives.filter((o) => o.done).map((o) => o.id),
    res: Object.fromEntries(Object.entries(state.res).map(([k, v]) => [k, Math.round(v)])),
  };
})();

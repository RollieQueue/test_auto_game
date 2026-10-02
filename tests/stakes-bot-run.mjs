// Shared by tests/stakes-bot-*.test.mjs: the balance bot plays with the honey fungus on and reports whether the page closed.
import { playBot } from './bot.mjs';

export function playStakes(seed, barrier, maxSeconds = 1500) {
  const closed = [];
  const { state } = playBot(seed, {
    seasons: true,
    threats: true,
    runOn: true,
    rival: true,
    barrier,
    maxSeconds,
    onEvent: (ev, s) => {
      if (ev.type === 'page-closed') closed.push({ cause: ev.cause, at: Math.round(s.time) });
    },
  });
  return { state, closed, lost: state.world.trees.filter((t) => t.lost).length };
}

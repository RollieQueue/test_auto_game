// The five «Наблюдения» of the MVP.
import { B } from './balance.js';

export const OBJECTIVES = [
  { id: 'water', text: 'Дотянуться до воды' },
  { id: 'tree', text: 'Заключить союз с деревом' },
  { id: 'mushroom', text: 'Вырастить первый гриб' },
  { id: 'treeGrow', text: 'Помочь дереву подрасти' },
  { id: 'spores', text: 'Собрать 100 спор' },
];

export function createObjectives() {
  return OBJECTIVES.map((o) => ({ ...o, done: false }));
}

const CHECKS = {
  water: (state) => state.net.links.some((l) => l.kind === 'water'),
  tree: (state) => state.net.links.some((l) => l.kind === 'tree'),
  mushroom: (state) => state.mushrooms.some((m) => m.mature),
  treeGrow: (state) => state.sim.treeStageUps > 0,
  spores: (state) => state.res.spores >= B.sporesGoal,
};

export function stepObjectives(state) {
  if (state.flags.allObjectivesDone) return;
  let all = true;
  for (const o of state.objectives) {
    if (!o.done && CHECKS[o.id](state)) {
      o.done = true;
      state.events.push({ type: 'objective', id: o.id, text: o.text });
    }
    all = all && o.done;
  }
  if (all) {
    state.flags.allObjectivesDone = true;
    state.events.push({ type: 'all-objectives' });
  }
}

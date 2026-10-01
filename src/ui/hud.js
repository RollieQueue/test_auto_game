// STUB HUD: title button and plain resource counters. The UI task replaces this module
// (same exported API: createHud(root, actions) -> { update(state, dt) }).

export function createHud(root, actions) {
  root.innerHTML = `
    <div class="stub-res" style="position:absolute;left:16px;top:12px;color:#2f2418;font:16px Georgia,serif"></div>
    <div class="stub-title" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:auto;background:rgba(239,228,204,.6)">
      <h1 style="font:56px Georgia,serif;color:#2f2418;margin:0 0 24px">Корни и нити</h1>
      <button style="font:22px Georgia,serif;padding:8px 28px">Начать</button>
    </div>`;
  const res = root.querySelector('.stub-res');
  const title = root.querySelector('.stub-title');
  title.querySelector('button').addEventListener('click', () => actions.start());

  return {
    update(state) {
      title.style.display = state.phase === 'title' ? 'flex' : 'none';
      const r = state.res;
      res.textContent = `Сахар ${r.sugar.toFixed(0)} · Влага ${r.water.toFixed(0)} · Минералы ${r.minerals.toFixed(0)} · Споры ${r.spores.toFixed(0)}`;
    },
  };
}

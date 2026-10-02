// «Меньше движения»: one flag the renderer modules read each frame (set from ui/settings.js through main.js).
// When it is on, what only decorates the page stops: tree and mushroom sway, falling leaves, drifting clouds, rain and
// snow, the heat haze, twinkling stars, the wash sweep of a new season and the tremor of a hypha about to be bitten.
// What carries information stays (flows, glows, effects of events, the worms): the simulation never reads this.
let reduced = false;

export function setReducedMotion(on) {
  reduced = Boolean(on);
}

export function reducedMotion() {
  return reduced;
}

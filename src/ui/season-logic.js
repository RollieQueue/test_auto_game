// Seasons in the HUD, without the DOM: the calendar numbers, the texts of the margin notes and the year-end page.
// Pure data in, pure data out (tested in tests/hud-seasons.test.mjs). The rules named in the texts are the ones in
// src/sim/balance.js (B.seasons); the tests keep the two from drifting apart.

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_NAMES_RU = { spring: 'Весна', summer: 'Лето', autumn: 'Осень', winter: 'Зима' };
export const WEATHER_WORDS = { clear: 'ясно', rain: 'дождь', drought: 'засуха', snow: 'снег' };
export const STAGE_WORDS = ['росток', 'молодое', 'взрослое', 'вековое'];

/** What a season changes, in one short clause: the margin note, the calendar's tooltip and the help page. */
export const SEASON_RULES = {
  spring: 'дожди пополняют карманы воды, деревья растут быстрее',
  summer: 'воды меньше, деревья пьют больше, зато платят щедрее',
  autumn: 'грибы растут быстрее, спор втрое больше',
  winter: 'лес спит: грибы не растут и спор нет, сети нужно меньше сахара',
};

// Margin notes are shorter than the rules above: two lines at most.
const SEASON_NOTES = {
  spring: 'Пришла весна: дожди пополняют воду, деревья растут быстрее',
  summer: 'Пришло лето: воды меньше, деревья пьют больше',
  autumn: 'Пришла осень: грибы растут быстрее, спор втрое больше',
  winter: 'Пришла зима: лес спит, грибы не растут и спор нет',
};

/** Words for the hours of the day by clock.dayFrac (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset). */
export function dayWord(dayFrac) {
  const f = ((dayFrac % 1) + 1) % 1;
  if (f < 0.18 || f >= 0.82) return 'ночь';
  if (f < 0.38) return 'утро';
  if (f < 0.62) return 'день';
  return 'вечер';
}

/** Margin note on a new season: { key, text } (the text is short: it must fit a note of two lines). */
export function seasonNote(season) {
  const text = SEASON_NOTES[season];
  return text ? { key: `season:${season}`, text, season } : null;
}

/** Margin note on a weather change; `prev` is the kind that was there before (for «кончился» texts). */
export function weatherNote(kind, prev = 'clear') {
  switch (kind) {
    case 'rain':
      return { key: 'weather:rain', text: 'Пошёл дождь: карманы с водой пополняются', icon: 'rain' };
    case 'drought':
      return { key: 'weather:drought', text: 'Засуха: вода копится медленнее, деревья пьют больше', icon: 'drought', tone: 'warn' };
    case 'snow':
      return { key: 'weather:snow', text: 'Пошёл снег: лес спит под белым покровом', icon: 'snow' };
    case 'clear': {
      const text =
        prev === 'rain'
          ? 'Дождь кончился'
          : prev === 'drought'
            ? 'Засуха отступила: вода снова копится'
            : prev === 'snow'
              ? 'Снег перестал'
              : 'Небо прояснилось';
      return { key: 'weather:clear', text, icon: 'clear' };
    }
    default:
      return null;
  }
}

/** Numbers for the calendar widget from state.clock and state.weather, or null while seasons are off. */
export function calendarModel(state) {
  const c = state && state.clock;
  if (!state || !state.flags || !state.flags.seasons || !c) return null;
  const index = Math.max(0, Math.min(3, c.seasonIndex | 0));
  const season = SEASONS[index];
  const frac = Math.max(0, Math.min(1, c.seasonFrac || 0));
  const w = state.weather || { kind: 'clear', intensity: 0 };
  const kind = WEATHER_WORDS[w.kind] ? w.kind : 'clear';
  return {
    season,
    seasonIndex: index,
    name: SEASON_NAMES_RU[season],
    // the pointer: clockwise from the top (0° = the start of spring), four quarters of 90°, in half-degree steps
    angle: Math.round((index + frac) * 90 * 2) / 2,
    day: (c.day | 0) + 1,
    word: dayWord(c.dayFrac),
    glyph: (c.daylight ?? 1) >= 0.5 ? 'sun' : 'moon',
    weather: kind,
    weatherWord: WEATHER_WORDS[kind],
    intensity: Math.max(0, Math.min(1, w.intensity || 0)),
    title: `${SEASON_NAMES_RU[season]}: ${SEASON_RULES[season]}`,
  };
}

const ORDINALS = ['Первый', 'Второй', 'Третий', 'Четвёртый', 'Пятый'];

/** «Первый год позади»; `year` is the 0-based year that just ended. */
export function yearTitle(year) {
  const n = Math.max(0, year | 0);
  return n < ORDINALS.length ? `${ORDINALS[n]} год позади` : `Год ${n + 1} позади`;
}

/** What the year-end page lists: spores, hyphae length, finds and the stage of every tree. */
export function yearStats(state) {
  const trees = ((state.world && state.world.trees) || []).map((t) => ({
    name: t.name,
    stage: t.stage,
    word: STAGE_WORDS[t.stage] || STAGE_WORDS[0],
  }));
  return {
    spores: Math.floor((state.res && state.res.spores) || 0),
    length: Math.round((state.stats && state.stats.hyphaeLength) || 0),
    finds: Object.keys(state.finds || {}).length,
    mushrooms: (state.mushrooms || []).length,
    trees,
  };
}

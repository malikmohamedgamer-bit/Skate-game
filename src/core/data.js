// Loads every JSON data file the game needs. In the browser this uses fetch();
// Node scripts/tests pass their own `readJson` (see tests/helpers.js).

import { normalizeMap } from '../world/map.js';

export const DATA_FILES = {
  physics: 'data/physics.json',
  vehicles: 'data/vehicles.json',
  tricks: 'data/tricks.json',
  levels: 'data/levels.json',
  quests: 'data/quests.json',
  catalog: 'data/catalog.json',
};

export async function loadGameData(readJson) {
  const out = {};
  const entries = Object.entries(DATA_FILES);
  const values = await Promise.all(entries.map(([, p]) => readJson(p)));
  entries.forEach(([k], i) => (out[k] = values[i]));
  out.levels = out.levels.levels;
  out.questsPerDay = out.quests.dailyPerDay ?? 3;
  out.quests = out.quests.quests;
  const index = await readJson('world/maps/index.json');
  const maps = await Promise.all(index.maps.map((id) => readJson(`world/maps/${id}.json`)));
  out.maps = {};
  out.mapOrder = [];
  for (const raw of maps) {
    const m = normalizeMap(raw);
    out.maps[m.id] = m;
    out.mapOrder.push(m.id);
  }
  out.mapOrder.sort((a, b) => out.maps[a].order - out.maps[b].order);
  return out;
}

/** Browser reader: paths are relative to /src/. */
export function fetchJsonReader(base = new URL('../', import.meta.url).href) {
  return async (path) => {
    const res = await fetch(base + path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${path}: HTTP ${res.status}`);
    return res.json();
  };
}

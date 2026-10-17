// Map loader and validation. Maps are plain JSON files in src/world/maps/ and are
// listed in src/world/maps/index.json. Adding a map is a data-only change.
//
// Map format (see README "Adding a map"):
// {
//   "id": "plaza", "name": "Town Plaza", "theme": {...colors...},
//   "bounds": { "minX": -40, "maxX": 40, "minZ": -40, "maxZ": 40 },
//   "terrain": { "type": "flat" } | { "type": "hills", "features": [...] },
//   "spawns": [ { "id": "main", "x": 0, "z": 0, "rot": 0 } ],
//   "objects": [ { "type": "kicker", "x": 0, "z": 10, "rot": 0, "w": 2, "d": 3, "h": 1 }, ... ],
//   "pickups": [ { "id": "p1", "x": 4, "z": 8, "y": 1 } ],
//   "unlock": { "stars": 0 }
// }

import { DEG } from '../physics/math.js';

export class MapError extends Error {}

function num(v, name, ctx) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new MapError(`${ctx}: "${name}" must be a number`);
  return v;
}

/** Validate and normalize raw map JSON. Throws MapError with a readable message. */
export function normalizeMap(raw) {
  if (!raw || typeof raw !== 'object') throw new MapError('map: not an object');
  const ctx = `map "${raw.id ?? '?'}"`;
  if (typeof raw.id !== 'string' || !raw.id) throw new MapError(`${ctx}: missing id`);
  const b = raw.bounds || {};
  const bounds = {
    minX: num(b.minX, 'bounds.minX', ctx),
    maxX: num(b.maxX, 'bounds.maxX', ctx),
    minZ: num(b.minZ, 'bounds.minZ', ctx),
    maxZ: num(b.maxZ, 'bounds.maxZ', ctx),
  };
  if (bounds.maxX - bounds.minX < 10 || bounds.maxZ - bounds.minZ < 10) throw new MapError(`${ctx}: bounds too small`);
  if (!Array.isArray(raw.spawns) || raw.spawns.length === 0) throw new MapError(`${ctx}: needs at least one spawn`);
  const spawns = raw.spawns.map((s, i) => ({
    id: s.id || `spawn${i}`,
    x: num(s.x, `spawns[${i}].x`, ctx),
    z: num(s.z, `spawns[${i}].z`, ctx),
    yaw: (s.rot || 0) * DEG,
  }));
  for (const s of spawns) {
    if (s.x <= bounds.minX || s.x >= bounds.maxX || s.z <= bounds.minZ || s.z >= bounds.maxZ) {
      throw new MapError(`${ctx}: spawn "${s.id}" is outside the bounds`);
    }
  }
  const objects = (raw.objects || []).map((o, i) => {
    if (!o || typeof o.type !== 'string') throw new MapError(`${ctx}: objects[${i}] needs a type`);
    return { id: o.id || `${o.type}${i}`, ...o };
  });
  const ids = new Set();
  const pickups = (raw.pickups || []).map((p, i) => {
    const id = p.id || `pickup${i}`;
    if (ids.has(id)) throw new MapError(`${ctx}: duplicate pickup id "${id}"`);
    ids.add(id);
    return { id, x: num(p.x, `pickups[${i}].x`, ctx), z: num(p.z, `pickups[${i}].z`, ctx), y: p.y ?? 1.0, tag: p.tag || null, via: p.via || null };
  });
  const checkpoints = (raw.checkpoints || []).map((c, i) => ({
    id: c.id || `cp${i}`,
    x: num(c.x, `checkpoints[${i}].x`, ctx),
    z: num(c.z, `checkpoints[${i}].z`, ctx),
    radius: c.radius || 3,
  }));
  return {
    id: raw.id,
    name: raw.name || raw.id,
    description: raw.description || '',
    theme: { sky: '#9fd3ff', ground: '#8a8f96', fog: '#bfe3ff', accent: '#ffb000', ...(raw.theme || {}) },
    bounds,
    terrain: raw.terrain || { type: 'flat' },
    spawns,
    objects,
    pickups,
    checkpoints,
    unlock: { stars: 0, ...(raw.unlock || {}) },
    order: raw.order ?? 99,
  };
}

export function spawnById(map, id) {
  return map.spawns.find((s) => s.id === id) || map.spawns[0];
}

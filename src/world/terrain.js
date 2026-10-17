// Terrain height functions defined by map JSON.
//   { "type": "flat", "height": 0 }
//   { "type": "hills", "height": 0, "features": [
//       { "type": "hill", "x": 0, "z": 0, "radius": 20, "height": 3 },
//       { "type": "plateau", "x": 0, "z": 0, "w": 20, "d": 10, "rot": 0, "height": 2, "edge": 8 } ] }
// Hills add together (smooth cosine bumps); plateaus (flat raised areas with smooth
// ramps of width `edge` around them) combine with max(). The result is always smooth,
// so the rider can roll over it without collisions.

import { DEG, smoothstep, toLocal } from '../physics/math.js';

export function createTerrain(def = { type: 'flat' }) {
  const base = Number(def.height) || 0;
  const hills = [];
  const plateaus = [];
  if (def.type === 'hills') {
    for (const f of def.features || []) {
      if (f.type === 'hill') hills.push({ x: f.x, z: f.z, r: f.radius, h: f.height });
      else if (f.type === 'plateau')
        plateaus.push({
          x: f.x,
          z: f.z,
          hw: f.w / 2,
          hd: f.d / 2,
          rot: (f.rot || 0) * DEG,
          h: f.height,
          edge: Math.max(0.5, f.edge || 6),
        });
    }
  }
  function heightAt(x, z) {
    let h = base;
    for (let i = 0; i < hills.length; i++) {
      const f = hills[i];
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r) h += f.h * 0.5 * (1 + Math.cos((Math.PI * d) / f.r));
    }
    let p = 0;
    for (let i = 0; i < plateaus.length; i++) {
      const f = plateaus[i];
      const { lx, lz } = toLocal(x, z, f.x, f.z, f.rot);
      const dx = Math.max(Math.abs(lx) - f.hw, 0);
      const dz = Math.max(Math.abs(lz) - f.hd, 0);
      const d = Math.hypot(dx, dz);
      const v = f.h * (1 - smoothstep(0, f.edge, d));
      if (v > p) p = v;
    }
    return h + p;
  }
  const flat = hills.length === 0 && plateaus.length === 0;
  function normalAt(x, z) {
    if (flat) return { x: 0, y: 1, z: 0 };
    const e = 0.1;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    const nx = -dx / (2 * e);
    const nz = -dz / (2 * e);
    const l = Math.hypot(nx, 1, nz);
    return { x: nx / l, y: 1 / l, z: nz / l };
  }
  /** Max slope in degrees (sampled), used by the map checker. */
  function slopeDegAt(x, z) {
    const n = normalAt(x, z);
    return Math.acos(Math.min(1, n.y)) / DEG;
  }
  return { heightAt, normalAt, slopeDegAt, flat };
}

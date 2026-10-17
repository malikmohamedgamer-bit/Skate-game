// Collision with ground, obstacles, ramps, rails and the map bounds.
//
// The world is a smooth terrain plus a list of "primitives" built by
// src/world/objects.js. Every primitive has an oriented rectangular footprint
// (center cx/cz, heading rot, half extents hw/hd) and a surface height function.
//   surface: the top can be ridden on (ramps, benches, stairs, curbs ...)
//   solid:   when the rider's feet are well below the top it acts as a wall
//   carve:   replaces the terrain inside its footprint (bowls dug into the ground)
//   rideable:{maxAngle, stepUp} step-able edge only when approached at the right angle
// Rails are thin solids handled separately (grind.js snaps onto them).

import { DEG, clamp, dirToWorld, toLocal, toWorld } from './math.js';
import { createTerrain } from '../world/terrain.js';

const UP = Object.freeze({ x: 0, y: 1, z: 0 });

/** Build the collision world for a normalized map and its expanded primitives. */
export function buildWorld(map, prims = []) {
  const terrain = createTerrain(map.terrain);
  const solids = [];
  const surfaces = [];
  const carves = [];
  const rails = [];
  for (const p of prims) {
    if (p.type === 'rail') {
      rails.push(p);
      continue;
    }
    if (p.carve) carves.push(p);
    else if (p.surface) surfaces.push(p);
    if (p.solid) solids.push(p);
  }
  return { bounds: map.bounds, terrain, prims, solids, surfaces, carves, rails };
}

function inFootprint(p, lx, lz, pad = 0) {
  return Math.abs(lx) <= p.hw + pad && Math.abs(lz) <= p.hd + pad;
}

function inAabb(p, x, z, pad = 0) {
  const a = p.aabb;
  return x >= a.minX - pad && x <= a.maxX + pad && z >= a.minZ - pad && z <= a.maxZ + pad;
}

/** Base ground: terrain, or a carved bowl surface where one exists. */
export function baseGround(world, x, z) {
  for (const c of world.carves) {
    if (!inAabb(c, x, z)) continue;
    const { lx, lz } = toLocal(x, z, c.cx, c.cz, c.rot);
    if (inFootprint(c, lx, lz)) return { h: c.heightAtLocal(lx, lz), n: c.normalAtLocal(lx, lz), prim: c };
  }
  return { h: world.terrain.heightAt(x, z), n: world.terrain.normalAt(x, z), prim: null };
}

export function terrainHeight(world, x, z) {
  return baseGround(world, x, z).h;
}

/**
 * Highest walkable surface at (x, z) that is not above `maxY`.
 * The base ground is always included so the rider can never fall through it.
 */
export function groundAt(world, x, z, maxY = Infinity) {
  let best = baseGround(world, x, z);
  for (const p of world.surfaces) {
    if (!inAabb(p, x, z)) continue;
    const { lx, lz } = toLocal(x, z, p.cx, p.cz, p.rot);
    if (!inFootprint(p, lx, lz)) continue;
    const h = p.heightAtLocal(lx, lz);
    if (h <= maxY && h > best.h) best = { h, n: p.normalAtLocal(lx, lz), prim: p };
  }
  if (!best.n) best.n = UP;
  return best;
}

/** Highest solid point at (x, z) regardless of the rider's height (camera rays, checks). */
export function topAt(world, x, z) {
  let h = baseGround(world, x, z).h;
  for (const p of world.prims) {
    if (p.type === 'rail' || p.carve || (!p.surface && !p.solid)) continue;
    if (!inAabb(p, x, z)) continue;
    const { lx, lz } = toLocal(x, z, p.cx, p.cz, p.rot);
    if (!inFootprint(p, lx, lz)) continue;
    const t = p.heightAtLocal(lx, lz);
    if (t > h) h = t;
  }
  return h;
}

export function isInsideSolid(world, x, y, z) {
  return y < topAt(world, x, z) - 1e-4;
}

/** Angle (deg) between horizontal travel and a face normal; 0 = head-on. */
export function approachAngleDeg(vel, yaw, faceNormal) {
  let dx = vel.x;
  let dz = vel.z;
  if (Math.hypot(dx, dz) < 0.3) {
    dx = Math.sin(yaw);
    dz = Math.cos(yaw);
  }
  const l = Math.hypot(dx, dz) || 1;
  const c = Math.abs((dx * faceNormal.x + dz * faceNormal.z) / l);
  return Math.acos(clamp(c, 0, 1)) / DEG;
}

function reflect(vel, n, restitution, friction) {
  const vn = vel.x * n.x + vel.z * n.z;
  if (vn >= 0) return 0;
  vel.x -= n.x * vn * (1 + restitution);
  vel.z -= n.z * vn * (1 + restitution);
  // tangential friction
  const tx = vel.x - n.x * (vel.x * n.x + vel.z * n.z);
  const tz = vel.z - n.z * (vel.x * n.x + vel.z * n.z);
  vel.x -= tx * friction;
  vel.z -= tz * friction;
  return -vn;
}

/**
 * Push the rider out of solid primitives and rails it ran into this tick.
 * Mutates pos and vel. Returns null or { impactSpeed, normal, prim, edgeBump }.
 */
export function resolveSolids(world, pos, prevPos, vel, r, stepUp, body = null, opts = {}) {
  const restitution = opts.restitution ?? 0.35;
  const friction = opts.friction ?? 0.12;
  const grounded = body ? body.grounded : false;
  const yaw = body ? body.yaw : 0;
  let result = null;
  const record = (impact, n, p) => {
    if (!result || impact > result.impactSpeed) result = { impactSpeed: impact, normal: n, prim: p, edgeBump: result?.edgeBump || false };
  };

  for (const p of world.solids) {
    if (!inAabb(p, pos.x, pos.z, r)) continue;
    const L = toLocal(pos.x, pos.z, p.cx, p.cz, p.rot);
    if (!inFootprint(p, L.lx, L.lz, r)) continue;
    const top = p.heightAtLocal(clamp(L.lx, -p.hw, p.hw), clamp(L.lz, -p.hd, p.hd));
    const P = toLocal(prevPos.x, prevPos.z, p.cx, p.cz, p.rot);
    const prevInside = inFootprint(p, P.lx, P.lz, r - 1e-4);
    const prevTop = p.heightAtLocal(clamp(P.lx, -p.hw, p.hw), clamp(P.lz, -p.hd, p.hd));

    // Which face would we cross? (needed for angle-limited edges)
    const outX = Math.abs(P.lx) >= p.hw + r - 1e-4;
    const outZ = Math.abs(P.lz) >= p.hd + r - 1e-4;
    const penX = p.hw + r - Math.abs(L.lx);
    const penZ = p.hd + r - Math.abs(L.lz);
    let axis;
    if (outX && !outZ) axis = 'x';
    else if (outZ && !outX) axis = 'z';
    else axis = penX < penZ ? 'x' : 'z';
    const internalStep = p.type === 'stairs' && prevInside && !outX && !outZ;
    if (internalStep) axis = 'z';
    const sign = axis === 'x' ? Math.sign(L.lx || P.lx || 1) : Math.sign(internalStep ? P.lz - L.lz || -1 : L.lz || P.lz || 1);
    const nLocal = axis === 'x' ? { x: sign, z: 0 } : { x: 0, z: sign };
    const nw = dirToWorld(nLocal.x, nLocal.z, p.rot);
    const faceNormal = { x: nw.x, y: 0, z: nw.z };

    let allowance = stepUp;
    if (p.rideable) {
      const ang = approachAngleDeg(vel, yaw, faceNormal);
      allowance = ang <= p.rideable.maxAngle ? p.rideable.stepUp : 0.02;
      // Rolling down a step/curb edge at a bad angle: you get bumped and lose speed.
      if (grounded && prevTop - top > 0.06 && pos.y >= top - 0.02 && ang > p.rideable.maxAngle && Math.abs(prevPos.y - prevTop) < 0.05) {
        const keep = opts.badAngleSpeedKeep ?? 0.75;
        vel.x *= keep;
        vel.z *= keep;
        result = result || { impactSpeed: 0, normal: faceNormal, prim: p, edgeBump: true };
        result.edgeBump = true;
      }
    }
    if (pos.y + allowance >= top) continue; // can ride onto it
    // Coming down onto the top from above is a landing, not a wall hit.
    if (prevInside && prevPos.y + allowance >= prevTop - 1e-3 && !internalStep) continue;

    // Push out through the chosen face.
    let lx = L.lx;
    let lz = L.lz;
    if (internalStep) {
      lz = P.lz;
    } else if (axis === 'x') {
      lx = sign * (p.hw + r + 1e-3);
    } else {
      lz = sign * (p.hd + r + 1e-3);
    }
    const w = toWorld(lx, lz, p.cx, p.cz, p.rot);
    pos.x = w.x;
    pos.z = w.z;
    const impact = reflect(vel, faceNormal, restitution, friction);
    record(impact, faceNormal, p);
  }

  // Rails: thin fences until you are above them.
  for (const rail of world.rails) {
    if (!inAabb(rail, pos.x, pos.z, r + 0.1)) continue;
    const c = closestOnRailXZ(rail, pos.x, pos.z);
    if (c.dist > r + rail.radius) continue;
    const railY = rail.a.y + (rail.b.y - rail.a.y) * c.t;
    if (pos.y >= railY - (opts.railSolidBelow ?? 0.35)) continue;
    if (pos.y + 1.6 < railY - rail.height) continue; // passing underneath (very high rails)
    const cp = closestOnRailXZ(rail, prevPos.x, prevPos.z);
    let nx = prevPos.x - cp.x;
    let nz = prevPos.z - cp.z;
    let l = Math.hypot(nx, nz);
    if (l < 1e-6) {
      nx = pos.x - c.x;
      nz = pos.z - c.z;
      l = Math.hypot(nx, nz) || 1;
    }
    nx /= l;
    nz /= l;
    pos.x = c.x + nx * (r + rail.radius + 1e-3);
    pos.z = c.z + nz * (r + rail.radius + 1e-3);
    const n = { x: nx, y: 0, z: nz };
    const impact = reflect(vel, n, restitution, friction);
    record(impact, n, rail);
  }
  return result;
}

/** Closest point on a rail's XZ projection. Returns { t (0..1), x, z, dist }. */
export function closestOnRailXZ(rail, x, z) {
  const ax = rail.a.x;
  const az = rail.a.z;
  const dx = rail.b.x - ax;
  const dz = rail.b.z - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
  const px = ax + dx * t;
  const pz = az + dz * t;
  return { t, x: px, z: pz, dist: Math.hypot(x - px, z - pz) };
}

/** Keep the rider inside the map bounds box. Mutates pos/vel. */
export function clampToBounds(world, pos, vel, r, restitution = 0.35) {
  const b = world.bounds;
  let hit = null;
  const wall = (n, vn) => {
    const impact = Math.max(0, -vn);
    vel.x -= n.x * vn * (1 + restitution);
    vel.z -= n.z * vn * (1 + restitution);
    if (!hit || impact > hit.impactSpeed) hit = { impactSpeed: impact, normal: n };
  };
  if (pos.x < b.minX + r) {
    pos.x = b.minX + r;
    if (vel.x < 0) wall({ x: 1, y: 0, z: 0 }, vel.x);
  } else if (pos.x > b.maxX - r) {
    pos.x = b.maxX - r;
    if (vel.x > 0) wall({ x: -1, y: 0, z: 0 }, -vel.x);
  }
  if (pos.z < b.minZ + r) {
    pos.z = b.minZ + r;
    if (vel.z < 0) wall({ x: 0, y: 0, z: 1 }, vel.z);
  } else if (pos.z > b.maxZ - r) {
    pos.z = b.maxZ - r;
    if (vel.z > 0) wall({ x: 0, y: 0, z: -1 }, -vel.z);
  }
  return hit;
}

export function insideBounds(world, x, z, margin = 0) {
  const b = world.bounds;
  return x >= b.minX - margin && x <= b.maxX + margin && z >= b.minZ - margin && z <= b.maxZ + margin;
}

/**
 * March a ray through the world (terrain, solids, bounds fence).
 * Returns the distance to the first hit, or maxDist if nothing was hit.
 */
export function raycast(world, origin, dir, maxDist, step = 0.2, fenceHeight = 3) {
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const d = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
  const blocked = (t) => {
    const x = origin.x + d.x * t;
    const y = origin.y + d.y * t;
    const z = origin.z + d.z * t;
    if (!insideBounds(world, x, z)) return y < topAt(world, clamp(x, world.bounds.minX, world.bounds.maxX), clamp(z, world.bounds.minZ, world.bounds.maxZ)) + fenceHeight;
    return y < topAt(world, x, z);
  };
  let prev = 0;
  for (let t = step; t <= maxDist + 1e-9; t += step) {
    if (blocked(t)) {
      // refine
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (blocked(mid)) hi = mid;
        else lo = mid;
      }
      return lo;
    }
    prev = t;
  }
  return maxDist;
}


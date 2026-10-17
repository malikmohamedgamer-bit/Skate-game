// Map reachability analysis (used by scripts/check-reachability.js and tests).
//
// 1. Flood fill a 0.5 m grid from the main spawn using the same rules as the
//    physics: step up at most `stepUp`, any drop is allowed, continuous ramp
//    surfaces can be ridden up, stairs/curbs only at their allowed angle, and
//    flat tops can be reached with an ollie if they are low enough.
// 2. Spawns, ramp approaches, checkpoints and pickups must lie in that set.
// 3. Every ramp is test-launched and every rail is test-grinded with the real
//    simulation (createSession), starting from reachable cells.

import { DEG, toLocal, toWorld } from '../physics/math.js';
import { groundAt, insideBounds } from '../physics/collide.js';
import { jumpHeight, ollieVelocity } from '../physics/body.js';
import { createSession, PICKUP_RADIUS, RIDER_CENTER } from '../game/session.js';
import { emptyFrame } from '../core/input.js';

const RAMPS = new Set(['kicker', 'quarter', 'bowl']);

/** Top walkable surface and the primitive that provides it. */
function topPrimAt(world, x, z) {
  return groundAt(world, x, z, Infinity);
}

export function conservativeOllieHeight(data) {
  const g = data.physics.gravity;
  let h = Infinity;
  for (const v of Object.values(data.vehicles)) {
    if (!v || typeof v !== 'object' || !v.jump) continue;
    h = Math.min(h, jumpHeight(ollieVelocity(v, v.topSpeed * 0.6), g));
  }
  return h * 0.85;
}

export function buildGrid(world, phys, cell = 0.5) {
  const b = world.bounds;
  const nx = Math.floor((b.maxX - b.minX) / cell);
  const nz = Math.floor((b.maxZ - b.minZ) / cell);
  const H = new Float32Array(nx * nz);
  const P = new Array(nx * nz);
  const blocked = new Uint8Array(nx * nz);
  const r = phys.riderRadius;
  const ring = [];
  for (let k = 0; k < 8; k++) ring.push([Math.cos((k * Math.PI) / 4) * r, Math.sin((k * Math.PI) / 4) * r]);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = b.minX + (i + 0.5) * cell;
      const z = b.minZ + (j + 0.5) * cell;
      const idx = i * nz + j;
      const g = topPrimAt(world, x, z);
      H[idx] = g.h;
      P[idx] = g.prim;
      if (!insideBounds(world, x, z, -r)) {
        blocked[idx] = 1;
        continue;
      }
      // Would a rider standing here overlap a wall?
      for (const [dx, dz] of ring) {
        const s = topPrimAt(world, x + dx, z + dz);
        if (s.prim !== g.prim && s.h - g.h > phys.stepUp + 0.05 && !(s.prim && RAMPS.has(s.prim.type) && g.prim === null && s.h - g.h < 0.35)) {
          blocked[idx] = 1;
          break;
        }
      }
      if (!blocked[idx]) {
        for (const rail of world.rails) {
          if (rail.noSolid) continue;
          const a = rail.aabb;
          if (x < a.minX - 0.5 || x > a.maxX + 0.5 || z < a.minZ - 0.5 || z > a.maxZ + 0.5) continue;
          const dx = rail.b.x - rail.a.x;
          const dz = rail.b.z - rail.a.z;
          const t = Math.max(0, Math.min(1, ((x - rail.a.x) * dx + (z - rail.a.z) * dz) / (dx * dx + dz * dz)));
          const px = rail.a.x + dx * t;
          const pz = rail.a.z + dz * t;
          const ry = rail.a.y + (rail.b.y - rail.a.y) * t;
          if (Math.hypot(x - px, z - pz) < r + rail.radius && g.h < ry - 0.35) {
            blocked[idx] = 1;
            break;
          }
        }
      }
    }
  }
  return { nx, nz, cell, H, P, blocked, minX: b.minX, minZ: b.minZ };
}

export function cellOf(grid, x, z) {
  const i = Math.floor((x - grid.minX) / grid.cell);
  const j = Math.floor((z - grid.minZ) / grid.cell);
  if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) return -1;
  return i * grid.nz + j;
}
export function cellCenter(grid, idx) {
  const i = Math.floor(idx / grid.nz);
  const j = idx % grid.nz;
  return { x: grid.minX + (i + 0.5) * grid.cell, z: grid.minZ + (j + 0.5) * grid.cell };
}

function angleOk(prim, dx, dz) {
  // Angle between the move and the primitive's local Z axis (stairs) or nearest face normal (curbs).
  const l = Math.hypot(dx, dz) || 1;
  const ax = Math.sin(prim.rot);
  const az = Math.cos(prim.rot);
  const c = Math.abs((dx * ax + dz * az) / l);
  const angZ = Math.acos(Math.min(1, c)) / DEG;
  if (prim.type === 'stairs') return angZ <= prim.rideable.maxAngle;
  const angX = 90 - angZ;
  return Math.min(angZ, angX) <= prim.rideable.maxAngle;
}

/** Flood fill from (x, z). Returns { reach: Uint8Array, how: Uint8Array (1 ride, 2 needs ollie) }. */
export function floodFill(grid, phys, start, ollieH) {
  const reach = new Uint8Array(grid.H.length);
  const how = new Uint8Array(grid.H.length);
  const s = cellOf(grid, start.x, start.z);
  if (s < 0 || grid.blocked[s]) return { reach, how, startBlocked: true };
  const q = [s];
  reach[s] = 1;
  how[s] = 1;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  while (q.length) {
    const a = q.pop();
    const ai = Math.floor(a / grid.nz);
    const aj = a % grid.nz;
    for (const [di, dj] of dirs) {
      const bi = ai + di;
      const bj = aj + dj;
      if (bi < 0 || bj < 0 || bi >= grid.nx || bj >= grid.nz) continue;
      const b = bi * grid.nz + bj;
      if (reach[b] || grid.blocked[b]) continue;
      const dh = grid.H[b] - grid.H[a];
      const pa = grid.P[a];
      const pb = grid.P[b];
      let ok = 0;
      if (dh <= phys.stepUp) ok = 1;
      else if (pb && RAMPS.has(pb.type) && (pa === pb || (pa === null && grid.H[a] >= pb.baseY - 0.05) || (pa && RAMPS.has(pa.type)))) ok = 1;
      else if (pb && pb.rideable && dh <= pb.rideable.stepUp && angleOk(pb, di, dj)) ok = 1;
      else if (pa && pa.rideable && pa === pb && dh <= pa.rideable.stepUp && angleOk(pa, di, dj)) ok = 1;
      else if (pb && !RAMPS.has(pb.type) && dh <= ollieH) ok = 2;
      if (!ok) continue;
      reach[b] = 1;
      how[b] = ok;
      q.push(b);
    }
  }
  return { reach, how, startBlocked: false };
}

function nearestReachable(grid, reach, x, z, maxDist = 1.0) {
  const c = cellOf(grid, x, z);
  if (c >= 0 && reach[c]) return c;
  const rad = Math.ceil(maxDist / grid.cell);
  const ci = Math.floor((x - grid.minX) / grid.cell);
  const cj = Math.floor((z - grid.minZ) / grid.cell);
  let best = -1;
  let bd = Infinity;
  for (let i = ci - rad; i <= ci + rad; i++)
    for (let j = cj - rad; j <= cj + rad; j++) {
      if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) continue;
      const idx = i * grid.nz + j;
      if (!reach[idx]) continue;
      const cc = cellCenter(grid, idx);
      const d = Math.hypot(cc.x - x, cc.z - z);
      if (d <= maxDist && d < bd) {
        bd = d;
        best = idx;
      }
    }
  return best;
}

// ---------------------------------------------------------------------------
// Simulated checks
// ---------------------------------------------------------------------------
function simSession(data, mapId, vehicle = 'skateboard') {
  return createSession({ data, mapId, vehicle, settings: {} });
}

function placeBody(s, x, z, yaw, speed) {
  s.respawn({ x, z, yaw });
  s.body.vel = { x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed };
}

/**
 * Run a session for up to `seconds`. control(i, s, frame) may set inputs;
 * onEvents(events, s) returns true to stop early. Returns true if stopped early.
 */
function runSim(s, seconds, control, onEvents) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    const f = emptyFrame();
    if (control) control(i, s, f);
    s.step(1 / 60, f);
    if (onEvents(s.drainEvents(), s)) return true;
  }
  return false;
}

/** Straight path from (x,z) along yaw for `dist` m without hitting anything taller than stepUp. */
function clearPath(world, phys, x, z, yaw, dist) {
  const h0 = groundAt(world, x, z, Infinity).h;
  for (let d = 0; d <= dist; d += 0.25) {
    const px = x + Math.sin(yaw) * d;
    const pz = z + Math.cos(yaw) * d;
    if (!insideBounds(world, px, pz, -0.4)) return false;
    if (Math.abs(groundAt(world, px, pz, Infinity).h - h0) > phys.stepUp) return false;
  }
  return true;
}

export function testRampLaunch(data, mapId, prim, grid, reach) {
  const world = simSession(data, mapId).world;
  const phys = data.physics;
  const attempts = [];
  if (prim.type === 'bowl') {
    // From the middle of the bowl floor toward each wall.
    for (const [lx, lz, yawOff] of [
      [0, 0, 90],
      [0, 0, -90],
      [0, 0, 0],
      [0, 0, 180],
    ]) {
      const w = toWorld(lx, lz, prim.cx, prim.cz, prim.rot);
      attempts.push({ x: w.x, z: w.z, yaw: prim.rot + yawOff * DEG, speed: 9 });
    }
  } else {
    for (const back of [8, 6, 4.5, 3.5]) {
      for (const lx of [0, prim.hw * 0.4, -prim.hw * 0.4]) {
        const w = toWorld(lx, -prim.hd - back, prim.cx, prim.cz, prim.rot);
        const c = cellOf(grid, w.x, w.z);
        if (c < 0 || !reach[c]) continue;
        if (!clearPath(world, phys, w.x, w.z, prim.rot, back - 0.3)) continue;
        for (const speed of prim.type === 'quarter' ? [9, 11] : [8, 10]) attempts.push({ x: w.x, z: w.z, yaw: prim.rot, speed });
      }
    }
  }
  for (const a of attempts) {
    const s = simSession(data, mapId);
    placeBody(s, a.x, a.z, a.yaw, a.speed);
    let launched = false;
    let bailed = false;
    runSim(s, 4, null, (evs, ss) => {
      for (const e of evs) {
        if (e.type === 'airborne') launched = true;
        if (e.type === 'bail') bailed = true;
      }
      return bailed || (launched && ss.body.state === 'ride');
    });
    if (launched && !bailed) return { ok: true, attempt: a };
  }
  return { ok: false, attempts: attempts.length };
}

export function testRailGrind(data, mapId, rail, grid, reach) {
  const yaw = rail.yaw;
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  const attempts = [];
  const ends = rail.oneWay ? [1] : [1, -1];
  for (const dir of ends) {
    const end = dir > 0 ? rail.a : rail.b;
    const ay = dir > 0 ? yaw : yaw + Math.PI;
    const ux = Math.sin(ay);
    const uz = Math.cos(ay);
    for (const back of [3.5, 5, 7]) {
      const x = end.x - ux * back;
      const z = end.z - uz * back;
      const c = cellOf(grid, x, z);
      if (c < 0 || !reach[c]) continue;
      for (const speed of [6, 7.5, 9]) for (const lead of [0.9, 1.3, 1.7, 2.2]) attempts.push({ x, z, yaw: ay, speed, ollieAt: back - lead });
    }
    // Side approaches: run alongside, drift in, ollie.
    for (const t of [0.35, 0.5, 0.65]) {
      for (const side of [1, -1]) {
        for (const off of [0.9, 1.4]) {
          const px = rail.a.x + (rail.b.x - rail.a.x) * t;
          const pz = rail.a.z + (rail.b.z - rail.a.z) * t;
          const perpX = dz * side;
          const perpZ = -dx * side;
          const x = px + perpX * off - ux * 3;
          const z = pz + perpZ * off - uz * 3;
          const c = cellOf(grid, x, z);
          if (c < 0 || !reach[c]) continue;
          const toward = Math.atan2(-perpX, -perpZ);
          const angle = ay + Math.atan2(Math.sin(toward - ay), Math.cos(toward - ay)) * 0.25;
          for (const speed of [6.5, 8]) for (const ollieDist of [1.2, 1.8, 2.4]) attempts.push({ x, z, yaw: angle, speed, ollieAt: ollieDist, side: true });
        }
      }
    }
  }
  for (const a of attempts) {
    const s = simSession(data, mapId);
    placeBody(s, a.x, a.z, a.yaw, a.speed);
    const sx = a.x;
    const sz = a.z;
    let ollied = false;
    let hit = false;
    runSim(
      s,
      3,
      (i, ss, f) => {
        const travelled = Math.hypot(ss.body.pos.x - sx, ss.body.pos.z - sz);
        if (!ollied && ss.body.state === 'ride' && travelled >= a.ollieAt) {
          f.pressed.ollie = true;
          ollied = true;
        }
      },
      (evs) => {
        for (const e of evs) if (e.type === 'grindStart' && e.rail === rail.id) hit = true;
        return hit;
      },
    );
    if (hit) return { ok: true, attempt: a };
  }
  return { ok: false, attempts: attempts.length };
}

export function testPickupVia(data, mapId, pickup, rampId) {
  const probe = simSession(data, mapId);
  const prim = probe.world.prims.find((p) => p.id === rampId);
  if (!prim) return { ok: false, reason: `via ramp "${rampId}" not found` };
  for (const back of [8, 6, 4.5]) {
    for (const speed of [7, 8, 9, 10, 11]) {
      for (const ollieLead of [null, 0.2, 0.5]) {
        const s = createSession({ data, mapId, pickupFilter: (p) => p.id === pickup.id });
        const w = toWorld(0, -prim.hd - back, prim.cx, prim.cz, prim.rot);
        placeBody(s, w.x, w.z, prim.rot, speed);
        let got = false;
        let ollied = false;
        runSim(
          s,
          3,
          (i, ss, f) => {
            if (ollieLead !== null && !ollied && ss.body.grounded) {
              const L = toLocal(ss.body.pos.x, ss.body.pos.z, prim.cx, prim.cz, prim.rot);
              if (L.lz >= prim.hd - ollieLead) {
                f.pressed.ollie = true;
                ollied = true;
              }
            }
          },
          (evs) => {
            for (const e of evs) if (e.type === 'pickup' && e.id === pickup.id) got = true;
            return got;
          },
        );
        if (got) return { ok: true, speed, ollie: ollieLead !== null };
      }
    }
  }
  return { ok: false, reason: 'no launch from the ramp passes through the pickup' };
}

/** Full analysis of one map. */
export function analyzeMap(data, mapId, { cell = 0.5, simulate = true } = {}) {
  const map = data.maps[mapId];
  const phys = data.physics;
  const probe = simSession(data, mapId);
  const world = probe.world;
  const grid = buildGrid(world, phys, cell);
  const ollieH = conservativeOllieHeight(data);
  const main = map.spawns[0];
  const { reach, how, startBlocked } = floodFill(grid, phys, main, ollieH);
  const issues = [];
  // "Rideable" cells: not blocked, and either reached or no higher above the terrain than an
  // ollie (taller tops are obstacles like rooftops, cars and hedges, reported separately).
  let open = 0;
  let reached = 0;
  let obstacleTops = 0;
  for (let k = 0; k < reach.length; k++) {
    if (grid.blocked[k]) continue;
    if (reach[k]) {
      open++;
      reached++;
      continue;
    }
    const c = cellCenter(grid, k);
    if (grid.H[k] - world.terrain.heightAt(c.x, c.z) > ollieH) obstacleTops++;
    else open++;
  }
  if (startBlocked) issues.push(`main spawn "${main.id}" is blocked`);

  // Spawns: reachable from the main spawn and not inside anything.
  const spawns = map.spawns.map((sp) => {
    const c = cellOf(grid, sp.x, sp.z);
    const inReach = c >= 0 && !!reach[c];
    const s = createSession({ data, mapId, spawnId: sp.id });
    const before = { ...s.body.pos };
    let moved = false;
    for (let i = 0; i < 10; i++) {
      s.step(1 / 60, emptyFrame());
      for (const e of s.drainEvents()) if (e.type === 'wallHit' || e.type === 'airborne') moved = true;
    }
    const drift = Math.hypot(s.body.pos.x - before.x, s.body.pos.z - before.z);
    const ok = inReach && !moved && drift < 0.01;
    if (!ok) issues.push(`spawn "${sp.id}" ${inReach ? '' : 'unreachable '}${moved || drift >= 0.01 ? 'not standing clear' : ''}`.trim());
    return { id: sp.id, ok, reachable: inReach };
  });

  // Ramps.
  const ramps = world.prims
    .filter((p) => RAMPS.has(p.type))
    .map((p) => {
      let approach;
      if (p.type === 'bowl') {
        approach = false;
        for (let k = 0; k < reach.length && !approach; k++) {
          if (!reach[k] || grid.P[k] !== p) continue;
          approach = true;
        }
      } else {
        approach = false;
        for (const lx of [-0.6, -0.3, 0, 0.3, 0.6]) {
          const w = toWorld(lx * p.hw, -p.hd - 0.75, p.cx, p.cz, p.rot);
          const c = cellOf(grid, w.x, w.z);
          if (c >= 0 && reach[c]) approach = true;
        }
      }
      const launch = simulate && approach ? testRampLaunch(data, mapId, p, grid, reach) : { ok: false, attempts: 0 };
      const ok = approach && (!simulate || launch.ok);
      if (!ok) issues.push(`ramp "${p.id}" ${approach ? 'did not launch in simulation' : 'approach unreachable'}`);
      return { id: p.id, type: p.type, ok, approach, launch: launch.ok };
    });

  // Rails.
  const rails = world.rails.map((r) => {
    const res = simulate ? testRailGrind(data, mapId, r, grid, reach) : { ok: true };
    if (!res.ok) issues.push(`rail "${r.id}" could not be grinded from any reachable approach`);
    return { id: r.id, kind: r.kind, len: +r.len.toFixed(2), ok: res.ok };
  });

  // Pickups.
  const maxReachY = RIDER_CENTER + ollieH + PICKUP_RADIUS - 0.05;
  const pickups = map.pickups.map((pk) => {
    const c = nearestReachable(grid, reach, pk.x, pk.z, 1.0);
    const reachable = c >= 0;
    let ok = reachable;
    let method = 'ride';
    if (reachable) {
      const groundH = groundAt(world, pk.x, pk.z, Infinity).h;
      const cellH = grid.H[c];
      const need = groundH + pk.y - cellH; // height above the reachable surface
      if (need > RIDER_CENTER + PICKUP_RADIUS - 0.05) method = 'ollie';
      if (need > maxReachY) {
        if (pk.via && simulate) {
          const v = testPickupVia(data, mapId, pk, pk.via);
          ok = v.ok;
          method = `via ${pk.via}`;
        } else ok = false;
      }
    }
    if (!ok) issues.push(`pickup "${pk.id}" unreachable`);
    return { id: pk.id, ok, method };
  });

  const checkpoints = map.checkpoints.map((cp) => {
    const c = nearestReachable(grid, reach, cp.x, cp.z, cp.radius);
    const ok = c >= 0;
    if (!ok) issues.push(`checkpoint "${cp.id}" unreachable`);
    return { id: cp.id, ok };
  });

  let needsOllie = 0;
  for (let k = 0; k < how.length; k++) if (how[k] === 2) needsOllie++;
  return {
    mapId,
    name: map.name,
    cells: { open, reached, needsOllie, obstacleTops, percent: open ? +((reached / open) * 100).toFixed(1) : 0 },
    spawns,
    ramps,
    rails,
    pickups,
    checkpoints,
    issues,
    ok: issues.length === 0,
  };
}

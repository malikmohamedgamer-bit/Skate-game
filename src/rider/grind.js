// Rail grinding. Pure simulation.
//
// Entry: while airborne, if the rider's feet come down within the height window
// of a rail (windowBelow .. windowAbove around the rail top), close enough
// horizontally (snapRadius) and moving along it fast enough (minSpeed), the rider
// locks onto the rail. Rails have a direction (a -> b) and a length; "forward"
// rails can only be ground from a to b.
// While grinding: slope gravity + friction act along the rail, a balance meter
// drifts and must be corrected with Left/Right. Exit at either end of the rail
// or by ollieing off. Losing balance or stalling drops you off the rail.

import { DEG, clamp, wrapAngle } from '../physics/math.js';
import { closestOnRailXZ } from '../physics/collide.js';
import { headingErrorMod180, ollieVelocity } from '../physics/body.js';

/** Find a rail the airborne body can snap onto this tick, or null. */
export function findGrindRail(world, body, phys, prevPos = null) {
  if (body.state !== 'air') return null;
  const g = phys.grind;
  let best = null;
  for (const rail of world.rails) {
    const a = rail.aabb;
    const pad = g.snapRadius + 0.2;
    if (body.pos.x < a.minX - pad || body.pos.x > a.maxX + pad || body.pos.z < a.minZ - pad || body.pos.z > a.maxZ + pad) continue;
    const c = closestOnRailXZ(rail, body.pos.x, body.pos.z);
    if (c.dist > g.snapRadius) continue;
    if (c.t <= 0.001 || c.t >= 0.999) {
      // Allow snapping at the very ends only if the rider is clearly moving onto the rail.
      const into = (c.t <= 0.001 ? 1 : -1) * (body.vel.x * rail.dir.x + body.vel.z * rail.dir.z);
      if (into <= 0) continue;
    }
    const railY = rail.a.y + (rail.b.y - rail.a.y) * c.t;
    const dy = body.pos.y - railY;
    if (dy < -g.windowBelow || dy > g.windowAbove) continue;
    // Must be coming down onto it (or barely rising), not shooting up past it.
    if (body.vel.y > g.maxRiseSpeed) continue;
    // If we were already well below the rail last tick we hit it from the side.
    if (prevPos && prevPos.y < railY - g.windowBelow - 0.05) continue;
    const along = body.vel.x * rail.dir.x + body.vel.y * rail.dir.y + body.vel.z * rail.dir.z;
    if (Math.abs(along) < g.minSpeed) continue;
    if (rail.oneWay && along < 0) continue;
    const score = c.dist + Math.abs(dy) * 0.5;
    if (!best || score < best.score) best = { rail, t: c.t, along, score };
  }
  return best;
}

/** Lock the body onto a rail. Returns the grind state. */
export function startGrind(body, hit, trickData, vehicle, rng = Math.random) {
  const { rail, t, along } = hit;
  const dir = along >= 0 ? 1 : -1;
  const travelYaw = wrapAngle(rail.yaw + (dir < 0 ? Math.PI : 0));
  const err = headingErrorMod180(body.airYaw, travelYaw) / DEG; // -90..90
  const cat = Math.abs(err) <= trickData.grindAngles.aligned ? 'aligned' : Math.abs(err) <= trickData.grindAngles.angled ? 'angled' : 'perpendicular';
  const ledge = rail.kind === 'ledge';
  const table = ledge ? trickData[vehicle].ledgeGrinds : trickData[vehicle].grinds;
  // Board yaw: keep the entry angle snapped to the category look.
  const snap = cat === 'aligned' ? 0 : cat === 'angled' ? 35 * Math.sign(err || 1) : 90 * Math.sign(err || 1);
  const g = {
    rail,
    t,
    dir,
    speed: Math.abs(along),
    time: 0,
    distance: 0,
    balance: (rng() - 0.5) * 0.2,
    category: cat,
    name: table[cat].name,
    perSecond: table[cat].perSecond,
    travelYaw,
    boardYaw: wrapAngle(travelYaw + snap * DEG),
    fakie: Math.abs(wrapAngle(body.airYaw - travelYaw)) > Math.PI / 2,
    ledge,
  };
  placeOnRail(body, g);
  body.state = 'grind';
  body.grounded = false;
  body.events.push({ type: 'grindStart', name: g.name, category: cat, rail: rail.id });
  return g;
}

function placeOnRail(body, g) {
  const r = g.rail;
  body.pos = {
    x: r.a.x + (r.b.x - r.a.x) * g.t,
    y: r.a.y + (r.b.y - r.a.y) * g.t,
    z: r.a.z + (r.b.z - r.a.z) * g.t,
  };
  body.vel = { x: r.dir.x * g.dir * g.speed, y: r.dir.y * g.dir * g.speed, z: r.dir.z * g.dir * g.speed };
  body.yaw = g.travelYaw;
  body.airYaw = g.travelYaw;
}

/** Points for grinding `dt` seconds at `speed` (m/s). Scales with speed, clamped. */
export function grindPointsFor(perSecond, dt, speed, refSpeed = 7) {
  return perSecond * dt * clamp(speed / refSpeed, 0.5, 2);
}

/**
 * Advance a grind by one tick.
 * input: { steer, pressed: { ollie } }
 * Returns 'grinding' | 'end' | 'ollie' | 'stall' | 'bail'.
 */
export function stepGrind(g, body, input, phys, vstats, dt, { rng = Math.random, forgiving = false, assist = false } = {}) {
  const cfg = phys.grind;
  const r = g.rail;
  const gAlong = -phys.gravity * r.dir.y * g.dir;
  g.speed += gAlong * dt;
  g.speed = Math.max(0, g.speed - cfg.friction * dt);
  if (g.speed < 0.6) return finishGrind(g, body, 'stall', phys, vstats);

  // Balance: drifts away from center and grows; steer the other way to correct.
  const drift = cfg.balanceDrift * (forgiving ? 0.5 : 1) * (assist ? 0 : 1);
  g.balance += (g.balance * cfg.balanceGrowth * (forgiving ? 0.6 : 1) + (rng() - 0.5) * 2 * drift) * dt;
  g.balance += (input.steer || 0) * cfg.balanceCorrection * dt;
  g.balance = clamp(g.balance, -1.2, 1.2);
  if (Math.abs(g.balance) >= 1) return finishGrind(g, body, 'bail', phys, vstats);

  const dtT = (g.dir * g.speed * dt) / r.len;
  g.t += dtT;
  g.time += dt;
  g.distance += g.speed * dt;
  if (input.pressed && input.pressed.ollie) {
    placeOnRail(body, { ...g, t: clamp(g.t, 0, 1) });
    return finishGrind(g, body, 'ollie', phys, vstats);
  }
  if (g.t >= 1 || g.t <= 0) {
    g.t = clamp(g.t, 0, 1);
    placeOnRail(body, g);
    return finishGrind(g, body, 'end', phys, vstats);
  }
  placeOnRail(body, g);
  return 'grinding';
}

function finishGrind(g, body, how, phys, vstats) {
  const cfg = phys.grind;
  const r = g.rail;
  const v = { x: r.dir.x * g.dir * g.speed, y: r.dir.y * g.dir * g.speed, z: r.dir.z * g.dir * g.speed };
  if (how === 'ollie') v.y = Math.max(v.y, 0) + ollieVelocity(vstats, g.speed);
  else v.y = Math.max(v.y, 0) + cfg.exitPop;
  if (how === 'bail' || how === 'stall') {
    // Fall off to the side the balance tipped toward.
    const side = Math.sign(g.balance || 1);
    const rx = Math.cos(g.travelYaw);
    const rz = -Math.sin(g.travelYaw);
    v.x += rx * side * 1.2;
    v.z += rz * side * 1.2;
    v.y = 0.5;
    body.pos.x += rx * side * 0.35;
    body.pos.z += rz * side * 0.35;
  }
  body.vel = v;
  body.grounded = false;
  body.state = 'air';
  body.airTime = 0;
  body.ollied = how === 'ollie';
  body.yaw = g.travelYaw;
  body.airYaw = g.travelYaw;
  body.takeoffYaw = g.travelYaw;
  body.takeoffY = body.pos.y;
  body.maxAirY = body.pos.y;
  body.vertAir = false;
  body.autoTurnDone = 0;
  body.autoTurnRate = 0;
  // Leaving a grind is never fakie relative to travel: the board turns back in line.
  body.events.push({ type: 'grindEnd', how, name: g.name, time: g.time, distance: g.distance });
  return how;
}

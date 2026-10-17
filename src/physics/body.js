// Rider physics: speed, steering, friction, gravity, jumps, landing.
// Pure simulation: no DOM, no Three.js. The world/collision queries live in collide.js.
//
// Conventions:
//   body.yaw    travel heading while grounded (velocity ~ forward(yaw) * speed)
//   body.stance +1 riding regular, -1 riding fakie (backwards relative to the board nose)
//   body.airYaw visual facing while airborne (set by the trick system)

import {
  DEG,
  add,
  addScaled,
  clamp,
  dot,
  forwardXZ,
  len,
  lenXZ,
  norm,
  projectOnPlane,
  scale,
  sub,
  wrapAngle,
  yawOf,
} from './math.js';
import { clampToBounds, groundAt, resolveSolids, terrainHeight } from './collide.js';

/** Turn rate (rad/s) for a given speed: fast to carve at low speed, wider arcs at speed. */
export function turnRateAt(stats, speed) {
  const t = clamp(speed / stats.topSpeed, 0, 1);
  const speedFactor = 1 - 0.55 * t; // 1.0 standing still -> 0.45 at top speed
  const pivot = speed < 0.5 ? 0.7 : 1; // slower kick-turn pivot when nearly stopped
  return stats.turnRate * speedFactor * pivot;
}

/** Vertical take-off speed of an ollie: scales with the jump stat and current speed. */
export function ollieVelocity(stats, speed) {
  return stats.jump * (0.72 + 0.28 * clamp(speed / stats.topSpeed, 0, 1));
}

/** Apex height of a vertical launch speed under gravity g. */
export function jumpHeight(vUp, g) {
  return vUp > 0 ? (vUp * vUp) / (2 * g) : 0;
}

/** Speed gained by one push (diminishes near top speed, never exceeds it). */
export function pushGain(stats, forwardSpeed) {
  if (forwardSpeed >= stats.topSpeed) return 0;
  const headroom = (stats.topSpeed - forwardSpeed) / (0.3 * stats.topSpeed);
  return Math.min(stats.accel * clamp(headroom, 0, 1), stats.topSpeed - forwardSpeed);
}

/** Brake deceleration: holding the brake longer slows you faster. */
export function brakeDecel(stats, heldSeconds) {
  return stats.brakeDecel * (0.5 + 0.5 * clamp(heldSeconds / 0.6, 0, 1));
}

export function createBody(world, { x = 0, z = 0, yaw = 0 } = {}) {
  const g = groundAt(world, x, z, Infinity);
  return {
    pos: { x, y: g.h, z },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    airYaw: yaw,
    stance: 1,
    normal: g.n,
    prim: g.prim,
    grounded: true,
    state: 'ride', // 'ride' | 'air' | 'grind' | 'bail'
    pushTimer: 0,
    pushCooldown: 0,
    pushGainLeft: 0,
    brakeHeld: 0,
    airTime: 0,
    ollied: false,
    takeoffYaw: yaw,
    takeoffY: g.h,
    maxAirY: g.h,
    vertAir: false,
    autoTurnDone: 0,
    autoTurnRate: 0,
    autoTurnDir: 1,
    bailTimer: 0,
    safetyResets: 0,
    events: [],
  };
}

export function speedOf(b) {
  return len(b.vel);
}

/** Forward (along board heading) speed component on the current surface. */
function surfaceForward(b) {
  return norm(projectOnPlane(forwardXZ(b.yaw), b.normal), forwardXZ(b.yaw));
}

export function respawn(b, world, { x, z, yaw }) {
  const g = groundAt(world, x, z, Infinity);
  b.pos = { x, y: g.h, z };
  b.vel = { x: 0, y: 0, z: 0 };
  b.yaw = yaw;
  b.airYaw = yaw;
  b.stance = 1;
  b.normal = g.n;
  b.prim = g.prim;
  b.grounded = true;
  b.state = 'ride';
  b.pushTimer = 0;
  b.pushCooldown = 0;
  b.bailTimer = 0;
  b.airTime = 0;
  b.vertAir = false;
}

/** Start a bail: lose most speed and control for a moment. */
export function bail(b, phys, reason = 'bail') {
  b.state = 'bail';
  b.bailTimer = phys.bail.duration;
  b.vel = scale(b.vel, phys.bail.speedKeep);
  b.vertAir = false;
  b.events.push({ type: 'bail', reason });
}

/** Perform an ollie from the ground (or from a grind, see grind.js). */
export function ollie(b, stats, phys) {
  const speed = len(b.vel);
  const vUp = ollieVelocity(stats, speed);
  b.vel = addScaled(b.vel, b.normal, vUp);
  goAirborne(b, true, phys);
  b.events.push({ type: 'ollie', vUp });
}

function goAirborne(b, ollied, phys) {
  b.grounded = false;
  b.state = 'air';
  b.airTime = 0;
  b.ollied = ollied;
  b.takeoffYaw = b.yaw;
  b.airYaw = b.yaw;
  b.takeoffY = b.pos.y;
  b.maxAirY = b.pos.y;
  b.autoTurnDone = 0;
  b.autoTurnRate = 0;
  b.vertAir = false;
  // Leaving a near-vertical transition (quarter pipe / bowl coping): go straight up
  // and come back down onto the ramp, with an automatic 180 so you land facing down it.
  if (phys && b.normal.y < Math.cos(phys.vertAngle * DEG)) {
    const nH = norm({ x: b.normal.x, y: 0, z: b.normal.z });
    const vh = b.vel.x * nH.x + b.vel.z * nH.z;
    const target = phys.vertReturnSpeed;
    b.vel.x += nH.x * (target - vh);
    b.vel.z += nH.z * (target - vh);
    const vUp = Math.max(b.vel.y, 1);
    const flight = (2 * vUp) / phys.gravity;
    b.vertAir = true;
    b.autoTurnRate = Math.PI / Math.max(0.35, flight * 0.85);
    // Turn toward the side we are carving, default to the left.
    const lateral = b.vel.x * Math.cos(b.yaw) - b.vel.z * Math.sin(b.yaw);
    b.autoTurnDir = lateral < 0 ? -1 : 1;
  }
  b.events.push({ type: 'airborne', ollied, vert: b.vertAir });
}

/**
 * Advance one fixed tick.
 * input: { steer (-1..1, +1 = right), push (bool), brake (bool), ollie (edge bool) }
 */
export function stepBody(b, world, stats, phys, input, dt) {
  if (b.state === 'grind') return; // grind.js owns the body while grinding
  const prevPos = { ...b.pos };
  if (b.state === 'bail') {
    stepBail(b, phys, dt);
  } else if (b.grounded) {
    stepGroundedControls(b, stats, phys, input, dt);
  } else {
    stepAirForces(b, stats, phys, dt);
  }
  // Integrate.
  b.pos = addScaled(b.pos, b.vel, dt);
  // Solid obstacles and map bounds (horizontal collisions).
  const hit = resolveSolids(world, b.pos, prevPos, b.vel, phys.riderRadius, phys.stepUp, b, {
    restitution: phys.wallRestitution / stats.weight,
    friction: phys.wallFriction,
    badAngleSpeedKeep: phys.edges.badAngleSpeedKeep,
    railSolidBelow: phys.grind.solidBelow,
  });
  const bounds = clampToBounds(world, b.pos, b.vel, phys.riderRadius, phys.wallRestitution / stats.weight);
  const impact = Math.max(hit ? hit.impactSpeed : 0, bounds ? bounds.impactSpeed : 0);
  if (hit || bounds) {
    b.events.push({ type: 'wallHit', impactSpeed: impact, prim: hit && hit.prim ? hit.prim.id : 'bounds' });
    if (impact > phys.slamSpeed && b.state !== 'bail') bail(b, phys, 'slam');
  }
  if (hit && hit.edgeBump) b.events.push({ type: 'edgeBump' });
  // Glancing wall hits deflect the board so it rolls along the wall instead of grinding into it.
  if ((hit || bounds) && b.grounded && b.state === 'ride' && lenXZ(b.vel) > 0.3) {
    const f = forwardXZ(b.yaw);
    const vy = yawOf(b.vel);
    b.yaw = b.vel.x * f.x + b.vel.z * f.z >= 0 ? vy : wrapAngle(vy + Math.PI);
  }
  // Ground contact.
  if (b.grounded) {
    groundContact(b, world, phys, dt);
  } else {
    airContact(b, world, phys, prevPos);
  }
  // Safety net: never fall through the world.
  const floor = terrainHeight(world, b.pos.x, b.pos.z);
  if (b.pos.y < floor - phys.fallReset || !Number.isFinite(b.pos.y)) {
    const g = groundAt(world, b.pos.x, b.pos.z, Infinity);
    b.pos.y = g.h;
    b.vel = { x: 0, y: 0, z: 0 };
    b.grounded = true;
    b.state = 'ride';
    b.safetyResets++;
    b.events.push({ type: 'safetyReset' });
  }
}

function stepBail(b, phys, dt) {
  b.bailTimer -= dt;
  const sp = len(b.vel);
  if (sp > 0) {
    const ns = Math.max(0, sp - 6 * dt);
    b.vel = scale(b.vel, ns / sp);
  }
  if (!b.grounded) b.vel.y -= phys.gravity * dt;
  if (b.bailTimer <= 0) {
    b.state = b.grounded ? 'ride' : 'air';
    b.stance = 1;
    if (lenXZ(b.vel) > 0.3) b.yaw = yawOf(b.vel);
    b.airYaw = b.yaw;
    b.events.push({ type: 'recover' });
  }
}

function stepGroundedControls(b, stats, phys, input, dt) {
  const n = b.normal;
  let f = surfaceForward(b);
  let vf = dot(b.vel, f);
  // Rolling backwards (e.g. after stalling on a ramp) means you are now riding fakie.
  if (vf < -0.05) {
    b.yaw = wrapAngle(b.yaw + Math.PI);
    b.stance = -b.stance;
    f = surfaceForward(b);
    vf = -vf;
    b.events.push({ type: 'fakieFlip' });
  }
  const vLatOld = sub(projectOnPlane(b.vel, n), scale(f, vf));
  const speed = len(b.vel);

  // Steering (right = clockwise from above = negative yaw).
  if (input.steer) {
    b.yaw = wrapAngle(b.yaw - input.steer * turnRateAt(stats, speed) * dt);
    f = surfaceForward(b);
  }

  // Gravity along the slope.
  const gT = projectOnPlane({ x: 0, y: -phys.gravity, z: 0 }, n);
  vf += dot(gT, f) * dt;
  let vLat = add(vLatOld, scale(sub(gT, scale(f, dot(gT, f))), dt));

  // Push (skateboard: long stroke then coast; scooter: short sharp kick, longer cooldown).
  if (b.pushTimer > 0) {
    const step = Math.min(dt, b.pushTimer);
    const gainRate = b.pushGainLeft / b.pushTimer;
    vf += gainRate * step;
    b.pushGainLeft -= gainRate * step;
    b.pushTimer -= dt;
    if (b.pushTimer <= 0) {
      b.pushTimer = 0;
      b.pushCooldown = stats.pushCooldown;
    }
  } else if (b.pushCooldown > 0) {
    b.pushCooldown = Math.max(0, b.pushCooldown - dt);
  } else if (input.push && !input.brake) {
    const gain = pushGain(stats, vf);
    if (gain > 0.01) {
      b.pushTimer = stats.pushDuration;
      b.pushGainLeft = gain;
      b.events.push({ type: 'push', style: stats.pushStyle });
    }
  }

  // Braking.
  if (input.brake) {
    b.brakeHeld += dt;
    vf = Math.max(0, vf - brakeDecel(stats, b.brakeHeld) * dt);
  } else {
    b.brakeHeld = 0;
  }

  // Rolling resistance.
  vf = vf > 0 ? Math.max(0, vf - stats.rollingFriction * dt) : vf;
  // Wheels resist sliding sideways.
  vLat = scale(vLat, Math.exp(-stats.grip * dt));

  b.vel = add(scale(f, vf), vLat);
  const cap = stats.topSpeed * phys.maxSpeedFactor;
  const sp = len(b.vel);
  if (sp > cap) b.vel = scale(b.vel, cap / sp);

  if (input.ollie) ollie(b, stats, phys);
}

function stepAirForces(b, stats, phys, dt) {
  b.vel.y -= phys.gravity * dt;
  const drag = clamp(1 - (phys.airDrag / stats.weight) * dt, 0, 1);
  b.vel.x *= drag;
  b.vel.z *= drag;
  b.airTime += dt;
  if (b.vertAir && b.autoTurnDone < Math.PI) {
    b.autoTurnDone = Math.min(Math.PI, b.autoTurnDone + b.autoTurnRate * dt);
  }
}

/**
 * Convex-crest launch test: leaving a hill top when the required centripetal
 * acceleration (v^2 * curvature) exceeds what gravity can provide.
 */
export function crestLaunch(oldN, newN, vel, dt, gravity) {
  const sp = len(vel);
  if (sp < 1) return false;
  const vd = { x: vel.x / sp, y: vel.y / sp, z: vel.z / sp };
  const bend = dot(newN, vd) - dot(oldN, vd); // > 0: the ground falls away ahead (convex)
  if (bend <= 1e-6) return false;
  const kappa = bend / (sp * dt);
  return sp * sp * kappa > gravity * newN.y;
}

function groundContact(b, world, phys, dt) {
  const g = groundAt(world, b.pos.x, b.pos.z, b.pos.y + phys.stepUp);
  const gap = b.pos.y - g.h;
  const vRel = dot(b.vel, g.n);
  if (
    b.state !== 'bail' &&
    (gap > phys.snapDown || (vRel > phys.launchNormalSpeed && gap > -0.02) || (gap > -0.05 && crestLaunch(b.normal, g.n, b.vel, dt, phys.gravity)))
  ) {
    goAirborne(b, false, phys);
    return;
  }
  if (b.state === 'bail' && gap > phys.snapDown) {
    b.grounded = false;
    return;
  }
  // Snap to the surface and redirect velocity along it.
  const oldN = b.normal;
  b.pos.y = g.h;
  const cosA = dot(oldN, g.n);
  const sp = len(b.vel);
  let v = projectOnPlane(b.vel, g.n);
  if (cosA > Math.cos(phys.keepSpeedMaxAngle * DEG)) {
    const l = len(v);
    if (l > 1e-6) v = scale(v, sp / l);
  }
  b.vel = v;
  b.normal = g.n;
  b.prim = g.prim;
  b.grounded = true;
}

function airContact(b, world, phys, prevPos) {
  if (b.pos.y > b.maxAirY) b.maxAirY = b.pos.y;
  const maxY = Math.max(prevPos.y, b.pos.y) + 0.05;
  const g = groundAt(world, b.pos.x, b.pos.z, maxY);
  if (b.pos.y > g.h) return;
  // Landing.
  const impactSpeed = Math.max(0, -dot(b.vel, g.n));
  b.pos.y = g.h;
  b.vel = projectOnPlane(b.vel, g.n);
  b.normal = g.n;
  b.prim = g.prim;
  b.grounded = true;
  const wasBail = b.state === 'bail';
  if (!wasBail) b.state = 'ride';
  const velYaw = lenXZ(b.vel) > 0.5 ? yawOf(b.vel) : b.airYaw;
  b.events.push({
    type: 'land',
    impactSpeed,
    airTime: b.airTime,
    height: b.maxAirY - Math.min(b.takeoffY, g.h),
    velYaw,
    normal: g.n,
    duringBail: wasBail,
  });
}

/**
 * After a clean landing the trick system calls this to align the travel heading
 * with the velocity and (for odd 180s) switch stance.
 */
export function settleLanding(b, { fakie }) {
  const horiz = lenXZ(b.vel);
  if (horiz > 0.3) b.yaw = yawOf(b.vel);
  else if (b.vertAir) b.yaw = b.airYaw;
  else b.yaw = wrapAngle(b.airYaw + (fakie ? Math.PI : 0));
  if (fakie) b.stance = -b.stance;
  b.airYaw = b.yaw;
  b.vertAir = false;
}

/** Signed angle (radians) between board facing in the air and a heading, folded into [-PI/2, PI/2]. */
export function headingErrorMod180(airYaw, velYaw) {
  let d = wrapAngle(airYaw - velYaw);
  if (d > Math.PI / 2) d -= Math.PI;
  if (d < -Math.PI / 2) d += Math.PI;
  return d;
}

/** True when the board faces roughly opposite to travel (lands fakie). */
export function facesBackward(airYaw, velYaw) {
  return Math.abs(wrapAngle(airYaw - velYaw)) > Math.PI / 2;
}

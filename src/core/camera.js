// Third-person follow camera with smoothing, wall-avoidance raycast, and
// alternative "close" (over the shoulder), "first" (first-person) and "top" (top-down) modes.

import { raycast } from '../physics/collide.js';
import { wrapAngle } from '../physics/math.js';

export const CAMERA_MODES = ['follow', 'close', 'first', 'top'];

/**
 * Per-frame interpolation factor for exponential smoothing.
 * smoothing = 0 disables smoothing (factor 1 = snap). 1 = heaviest smoothing.
 */
export function smoothingAlpha(smoothing, dt) {
  const s = Math.max(0, Math.min(1, smoothing));
  if (s <= 0.001) return 1;
  const tau = s * 0.45; // seconds
  return 1 - Math.exp(-dt / tau);
}

/**
 * Where the camera wants to be, before collision. Pure; unit tested.
 * Returns { eye: {x,y,z}, look: {x,y,z} }.
 */
export function desiredCamera(mode, target, yaw) {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const p = target;
  if (mode === 'close') {
    return {
      eye: { x: p.x - fx * 0.9, y: p.y + 1.75, z: p.z - fz * 0.9 },
      look: { x: p.x + fx * 6, y: p.y + 1.2, z: p.z + fz * 6 },
    };
  }
  if (mode === 'first') {
    // Eyes at head height, just ahead of the rider's centre, looking down the line.
    return {
      eye: { x: p.x + fx * 0.15, y: p.y + 1.55, z: p.z + fz * 0.15 },
      look: { x: p.x + fx * 8, y: p.y + 0.6, z: p.z + fz * 8 },
    };
  }
  if (mode === 'top') {
    return {
      eye: { x: p.x, y: p.y + 17, z: p.z - 7 },
      look: { x: p.x, y: p.y, z: p.z + 0.5 },
    };
  }
  return {
    eye: { x: p.x - fx * 4.4, y: p.y + 2.0, z: p.z - fz * 4.4 },
    look: { x: p.x + fx * 1.5, y: p.y + 1.0, z: p.z + fz * 1.5 },
  };
}

/**
 * Pull the eye toward the pivot if world geometry blocks the line of sight.
 * Returns the corrected eye position.
 */
export function avoidWalls(world, pivot, eye, minDist = 0.8, margin = 0.3) {
  const dx = eye.x - pivot.x;
  const dy = eye.y - pivot.y;
  const dz = eye.z - pivot.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return { ...eye, blocked: false };
  const hit = raycast(world, pivot, { x: dx, y: dy, z: dz }, dist, 0.15);
  if (hit >= dist - 1e-6) return { ...eye, blocked: false };
  const d = Math.max(minDist, hit - margin);
  const k = d / dist;
  return { x: pivot.x + dx * k, y: pivot.y + dy * k, z: pivot.z + dz * k, blocked: true };
}

export function createCameraRig(camera) {
  const eye = { x: 0, y: 3, z: -5 };
  const look = { x: 0, y: 1, z: 0 };
  let yaw = 0;
  let initialized = false;
  let shake = 0;
  let lastBlocked = false;
  let mode = 'follow';
  return {
    get mode() {
      return mode;
    },
    set mode(m) {
      mode = CAMERA_MODES.includes(m) ? m : 'follow';
      initialized = false;
    },
    get blocked() {
      return lastBlocked;
    },
    snap() {
      initialized = false;
    },
    addShake(amount) {
      shake = Math.min(1, shake + amount);
    },
    /**
     * target: { pos, travelYaw, speed }
     * settings: { smoothing (0..1), reducedMotion, shake (bool) }
     */
    update(dt, world, target, settings) {
      const smooth = settings.smoothing ?? 0.6;
      const aYaw = initialized ? smoothingAlpha(smooth * 0.9, dt) : 1;
      yaw = wrapAngle(yaw + wrapAngle(target.travelYaw - yaw) * aYaw);
      const want = desiredCamera(mode, target.pos, yaw);
      const pivot = { x: target.pos.x, y: target.pos.y + 1.3, z: target.pos.z };
      // Top-down looks over walls; first-person eyes are inside the rider's own clearance.
      const safe = mode === 'top' || mode === 'first' ? want.eye : avoidWalls(world, pivot, want.eye);
      lastBlocked = !!safe.blocked;
      // When the view is blocked, move in quickly so we never look through a wall.
      // First-person eyes stay on the head (smoothing then only applies to turning).
      const a = !initialized || mode === 'first' ? 1 : safe.blocked ? Math.max(0.5, smoothingAlpha(smooth * 0.3, dt)) : smoothingAlpha(smooth, dt);
      eye.x += (safe.x - eye.x) * a;
      eye.y += (safe.y - eye.y) * a;
      eye.z += (safe.z - eye.z) * a;
      const al = !initialized ? 1 : smoothingAlpha(smooth * 0.5, dt);
      look.x += (want.look.x - look.x) * al;
      look.y += (want.look.y - look.y) * al;
      look.z += (want.look.z - look.z) * al;
      initialized = true;

      let sx = 0;
      let sy = 0;
      if (shake > 0) {
        if (!settings.reducedMotion && settings.shake !== false) {
          sx = (Math.random() - 0.5) * shake * 0.25;
          sy = (Math.random() - 0.5) * shake * 0.25;
        }
        shake = Math.max(0, shake - dt * 3);
      }
      camera.position.set(eye.x + sx, eye.y + sy, eye.z);
      camera.lookAt(look.x, look.y, look.z);
      // Speed FOV kick, disabled under reduced motion (no rapid zoom).
      const baseFov = mode === 'close' || mode === 'first' ? 75 : 62;
      const targetFov = settings.reducedMotion ? baseFov : baseFov + Math.min(10, (target.speed || 0) * 0.7);
      const nf = camera.fov + (targetFov - camera.fov) * (settings.reducedMotion ? 1 : Math.min(1, dt * 3));
      if (Math.abs(nf - camera.fov) > 0.01) {
        camera.fov = nf;
        camera.updateProjectionMatrix();
      }
    },
    get state() {
      return { eye: { ...eye }, look: { ...look }, yaw, mode };
    },
  };
}

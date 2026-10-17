// Small, allocation-light vector helpers shared by the simulation.
// Coordinate system matches Three.js: +Y is up. A heading (yaw) of 0 faces +Z,
// and positive yaw turns toward +X (which is the rider's left when facing +Z).

export const DEG = Math.PI / 180;

export function v3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}
export function copy(a) {
  return { x: a.x, y: a.y, z: a.z };
}
export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function addScaled(a, b, s) {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}
export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function len(a) {
  return Math.hypot(a.x, a.y, a.z);
}
export function lenXZ(a) {
  return Math.hypot(a.x, a.z);
}
export function norm(a, fallback = { x: 0, y: 1, z: 0 }) {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : copy(fallback);
}
export function projectOnPlane(v, n) {
  const d = dot(v, n);
  return { x: v.x - n.x * d, y: v.y - n.y * d, z: v.z - n.z * d };
}
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Wrap an angle in radians into [-PI, PI). */
export function wrapAngle(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}
/** Forward unit vector on the XZ plane for a heading. */
export function forwardXZ(yaw) {
  return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
}
/** Heading of a vector's XZ projection. */
export function yawOf(v) {
  return Math.atan2(v.x, v.z);
}
/** Move a value toward zero by `amount` without crossing zero. */
export function approachZero(v, amount) {
  if (v > 0) return Math.max(0, v - amount);
  if (v < 0) return Math.min(0, v + amount);
  return 0;
}
/** Deterministic PRNG (mulberry32). Returns a function producing [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Convert world XZ to an object's local frame (center cx/cz, heading rot). */
export function toLocal(x, z, cx, cz, rot) {
  const dx = x - cx;
  const dz = z - cz;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}
/** Convert an object's local XZ to world XZ. */
export function toWorld(lx, lz, cx, cz, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}
/** Rotate a local direction vector (x/z components) into world space. */
export function dirToWorld(lx, lz, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

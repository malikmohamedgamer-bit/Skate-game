import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_MODES, avoidWalls, createCameraRig, desiredCamera, smoothingAlpha } from '../src/core/camera.js';
import { buildWorld } from '../src/physics/collide.js';
import { normalizeMap } from '../src/world/map.js';

test('smoothing 0 disables camera smoothing (snap)', () => {
  assert.equal(smoothingAlpha(0, 1 / 60), 1);
});

test('more smoothing = slower follow', () => {
  assert.ok(smoothingAlpha(0.2, 1 / 60) > smoothingAlpha(0.9, 1 / 60));
  assert.ok(smoothingAlpha(1, 1 / 60) > 0);
});

test('follow camera sits behind and above the rider', () => {
  const c = desiredCamera('follow', { x: 0, y: 0, z: 0 }, 0);
  assert.ok(c.eye.z < -3, 'behind (rider faces +Z)');
  assert.ok(c.eye.y > 1);
  assert.ok(c.look.z > 0);
});

test('top-down and close modes exist', () => {
  assert.ok(desiredCamera('top', { x: 0, y: 0, z: 0 }, 0).eye.y > 10);
  assert.ok(desiredCamera('close', { x: 0, y: 0, z: 0 }, 0).eye.y > 1.5);
});

test('first-person: eyes at head height right over the rider, looking ahead along the heading', () => {
  assert.ok(CAMERA_MODES.includes('first'));
  for (const yaw of [0, Math.PI / 2, -2.5]) {
    const p = { x: 3, y: 1, z: -4 };
    const c = desiredCamera('first', p, yaw);
    assert.ok(Math.abs(c.eye.y - (p.y + 1.55)) < 1e-9, 'head height');
    assert.ok(Math.hypot(c.eye.x - p.x, c.eye.z - p.z) < 0.3, 'not behind or beside the rider');
    const fwd = (c.look.x - c.eye.x) * Math.sin(yaw) + (c.look.z - c.eye.z) * Math.cos(yaw);
    assert.ok(fwd > 5, 'looks forward');
    assert.ok(c.look.y < c.eye.y, 'slightly down at the line ahead');
  }
});

test('first-person eyes are not pulled around by wall avoidance and do not lag behind the rider', () => {
  const map = normalizeMap({ id: 't', bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, spawns: [{ x: 0, z: 0 }] });
  const world = buildWorld(map, []);
  const cam = { position: { set() {} }, lookAt() {}, fov: 75, updateProjectionMatrix() {} };
  const rig = createCameraRig(cam);
  rig.mode = 'first';
  rig.update(1 / 60, world, { pos: { x: 0, y: 0, z: 0 }, travelYaw: 0, speed: 0 }, { smoothing: 1 });
  rig.update(1 / 60, world, { pos: { x: 0, y: 0, z: 2 }, travelYaw: 0, speed: 8 }, { smoothing: 1 });
  assert.ok(Math.abs(rig.state.eye.z - 2.15) < 1e-6, `eye follows the head exactly (${rig.state.eye.z})`);
});

test('no wall: camera keeps its distance', () => {
  const map = normalizeMap({ id: 't', bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, spawns: [{ x: 0, z: 0 }] });
  const world = buildWorld(map, []);
  const eye = avoidWalls(world, { x: 0, y: 1.3, z: 0 }, { x: 0, y: 2, z: -4.4 });
  assert.equal(eye.blocked, false);
  assert.equal(eye.z, -4.4);
});

test('bounds fence pulls the camera in when the rider backs up against it', () => {
  const map = normalizeMap({ id: 't', bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, spawns: [{ x: 0, z: 0 }] });
  const world = buildWorld(map, []);
  const eye = avoidWalls(world, { x: 0, y: 1.3, z: -48 }, { x: 0, y: 2, z: -52.4 });
  assert.equal(eye.blocked, true);
  assert.ok(eye.z > -50, `eye.z ${eye.z}`);
});

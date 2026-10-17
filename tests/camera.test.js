import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avoidWalls, desiredCamera, smoothingAlpha } from '../src/core/camera.js';
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

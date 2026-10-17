import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brakeDecel, jumpHeight, ollieVelocity, pushGain, turnRateAt, speedOf } from '../src/physics/body.js';
import { createSession } from '../src/game/session.js';
import { loadData, run } from './helpers.js';

const data = await loadData();
const sk = data.vehicles.skateboard;
const sc = data.vehicles.scooter;

test('vehicle handling comes from data with all required stats', () => {
  for (const v of [sk, sc]) {
    for (const k of ['accel', 'topSpeed', 'turnRate', 'grip', 'jump', 'weight', 'trickBonus']) {
      assert.equal(typeof v[k], 'number', `${v.name}.${k}`);
    }
  }
  assert.equal(sk.pushStyle, 'coast');
  assert.equal(sc.pushStyle, 'kick');
});

test('turn rate depends on speed: tighter at low speed, wider at high speed', () => {
  const slow = turnRateAt(sk, 2);
  const fast = turnRateAt(sk, sk.topSpeed);
  assert.ok(slow > fast, `${slow} > ${fast}`);
  assert.ok(fast > 0);
  assert.ok(turnRateAt(sk, 0) < turnRateAt(sk, 1), 'pivot when stopped is slower than carving');
});

test('push gain never takes you past top speed', () => {
  assert.equal(pushGain(sk, sk.topSpeed), 0);
  assert.ok(pushGain(sk, 0) <= sk.accel + 1e-9);
  for (let v = 0; v < sk.topSpeed; v += 0.5) assert.ok(v + pushGain(sk, v) <= sk.topSpeed + 1e-9);
});

test('holding the brake slows faster over time', () => {
  assert.ok(brakeDecel(sk, 0.6) > brakeDecel(sk, 0));
});

test('ollie height grows with speed and with the jump stat', () => {
  const g = data.physics.gravity;
  const h0 = jumpHeight(ollieVelocity(sk, 0), g);
  const h1 = jumpHeight(ollieVelocity(sk, sk.topSpeed), g);
  assert.ok(h1 > h0);
  const boosted = { ...sk, jump: sk.jump * 1.2 };
  assert.ok(jumpHeight(ollieVelocity(boosted, 5), g) > jumpHeight(ollieVelocity(sk, 5), g));
});

test('pushing accelerates the rider forward on flat ground', () => {
  const s = createSession({ data, mapId: 'training' });
  const z0 = s.body.pos.z;
  run(s, 3, { forward: true });
  assert.ok(speedOf(s.body) > 5, `speed ${speedOf(s.body)}`);
  assert.ok(s.body.pos.z > z0 + 5, 'moved forward (+Z at yaw 0)');
  assert.ok(speedOf(s.body) <= sk.topSpeed + 1e-6);
});

test('skateboard coasts further than the scooter (different rolling friction)', () => {
  const a = createSession({ data, mapId: 'training', vehicle: 'skateboard' });
  const b = createSession({ data, mapId: 'training', vehicle: 'scooter' });
  for (const s of [a, b]) {
    s.body.vel = { x: 0, y: 0, z: 8 };
    run(s, 4, {});
  }
  assert.ok(speedOf(a.body) > speedOf(b.body));
});

test('scooter kicks have a cooldown: push events are spaced out', () => {
  const s = createSession({ data, mapId: 'training', vehicle: 'scooter' });
  const ev = run(s, 2, { forward: true }).filter((e) => e.type === 'push');
  const cycle = sc.pushDuration + sc.pushCooldown;
  assert.ok(ev.length >= 2 && ev.length <= Math.ceil(2 / cycle) + 1, `pushes: ${ev.length}`);
});

test('braking brings the rider to a stop and never reverses', () => {
  const s = createSession({ data, mapId: 'training' });
  s.body.vel = { x: 0, y: 0, z: 9 };
  run(s, 3, { brake: true });
  assert.ok(speedOf(s.body) < 0.05);
  assert.ok(s.body.vel.z >= -1e-9);
});

test('steering right turns clockwise (heading decreases)', () => {
  const s = createSession({ data, mapId: 'training' });
  s.body.vel = { x: 0, y: 0, z: 6 };
  run(s, 0.5, { right: true });
  assert.ok(s.body.yaw < 0);
  assert.ok(s.body.vel.x < 0, 'moving toward -X (rider right when facing +Z)');
});

test('rider can never leave the map bounds', () => {
  const s = createSession({ data, mapId: 'training' });
  s.body.vel = { x: 0, y: 0, z: -12 };
  run(s, 6, { forward: true });
  const b = s.map.bounds;
  assert.ok(s.body.pos.z >= b.minZ && s.body.pos.z <= b.maxZ);
  assert.equal(s.stats2.outOfBounds, 0);
});

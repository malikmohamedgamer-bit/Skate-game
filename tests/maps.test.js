// Map data, validation, pickups and terrain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMap, MapError } from '../src/world/map.js';
import { buildWorld } from '../src/physics/collide.js';
import { crestLaunch, speedOf } from '../src/physics/body.js';
import { createSession, PICKUP_RADIUS, RIDER_CENTER } from '../src/game/session.js';
import { PICKUP_BOLTS } from '../src/game/economy.js';
import { loadData, frame, run } from './helpers.js';

const data = await loadData();

test('at least four themed maps ship: neighborhood, skatepark, plaza, downtown', () => {
  for (const id of ['neighborhood', 'skatepark', 'plaza', 'downtown']) assert.ok(data.maps[id], id);
  assert.ok(data.mapOrder.length >= 4);
});

for (const id of ['neighborhood', 'skatepark', 'plaza', 'downtown']) {
  test(`map "${id}" has bounds, ground, spawns and ramps, rails, benches, stairs, barriers and pickups`, () => {
    const m = data.maps[id];
    const w = buildWorld(m);
    assert.ok(m.bounds.maxX > m.bounds.minX && m.bounds.maxZ > m.bounds.minZ);
    assert.ok(m.terrain && m.terrain.type);
    assert.ok(m.spawns.length >= 2, 'spawn points');
    const types = new Set(w.prims.map((p) => p.type));
    const kinds = new Set(w.prims.map((p) => p.kind));
    assert.ok(types.has('kicker') || types.has('quarter') || types.has('bowl'), 'ramps');
    assert.ok(w.rails.some((r) => r.kind === 'rail' || r.kind === 'handrail'), 'rails');
    assert.ok(kinds.has('bench'), 'benches');
    assert.ok(types.has('stairs'), 'stairs');
    assert.ok(['barrier', 'wall', 'planter', 'car', 'building', 'block'].some((k) => kinds.has(k)), 'barriers');
    assert.ok(m.pickups.length >= 10, 'pickups');
  });
}

test('the skatepark has bowls and the downtown is hilly', () => {
  assert.ok(buildWorld(data.maps.skatepark).carves.length >= 2);
  const w = buildWorld(data.maps.downtown);
  const top = w.terrain.heightAt(0, 60);
  const bottom = w.terrain.heightAt(0, -60);
  assert.ok(top - bottom > 5, `height difference ${top - bottom}`);
  // Max slope on the street must still be rideable.
  let maxSlope = 0;
  for (let z = -78; z <= 78; z += 0.5) maxSlope = Math.max(maxSlope, w.terrain.slopeDegAt(0, z));
  assert.ok(maxSlope < 30, `max slope ${maxSlope}`);
});

test('map validation: readable errors for bad data', () => {
  assert.throws(() => normalizeMap({ id: 'x', spawns: [{ x: 0, z: 0 }] }), MapError);
  assert.throws(() => normalizeMap({ id: 'x', bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, spawns: [] }), /spawn/);
  assert.throws(
    () => normalizeMap({ id: 'x', bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, spawns: [{ x: 50, z: 0 }] }),
    /outside the bounds/,
  );
  assert.throws(
    () =>
      normalizeMap({
        id: 'x',
        bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
        spawns: [{ x: 0, z: 0 }],
        pickups: [
          { id: 'a', x: 1, z: 1 },
          { id: 'a', x: 2, z: 2 },
        ],
      }),
    /duplicate pickup/,
  );
});

test('every shipped map builds without object errors and has unique object ids', () => {
  for (const id of data.mapOrder) {
    const w = buildWorld(data.maps[id]);
    const ids = w.prims.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${id} has duplicate ids`);
  }
});

test('riding through a pickup collects it once and reports its Bolt value', () => {
  const s = createSession({ data, mapId: 'neighborhood' });
  const p = s.pickups.find((x) => x.id === 'n-p1');
  s.respawn({ x: p.x, z: p.z - 6, yaw: 0 });
  s.body.vel = { x: 0, y: 0, z: 6 };
  const ev = run(s, 2.5, {}).filter((e) => e.type === 'pickup');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].id, 'n-p1');
  assert.equal(ev[0].value, PICKUP_BOLTS);
  assert.ok(s.pickups.find((x) => x.id === 'n-p1').taken);
});

test('a high pickup needs a jump: riding under it does not collect it', () => {
  const s = createSession({ data, mapId: 'neighborhood' });
  const p = s.pickups.find((x) => x.id === 'n-p5'); // above the flatbar
  assert.ok(p.y - RIDER_CENTER > PICKUP_RADIUS);
  s.respawn({ x: p.x + 1.0, z: p.z - 6, yaw: 0 });
  s.body.vel = { x: 0, y: 0, z: 6 };
  const ev = run(s, 2, {}).filter((e) => e.type === 'pickup' && e.id === 'n-p5');
  assert.equal(ev.length, 0);
});

test('a pickup filter limits which pickups a session (level) uses', () => {
  const s = createSession({ data, mapId: 'neighborhood', pickupFilter: (p) => p.id === 'n-p3' });
  assert.deepEqual(
    s.pickups.map((p) => p.id),
    ['n-p3'],
  );
});

test('crest launch: fast over a convex hill top leaves the ground, slow stays down', () => {
  const up = { x: 0, y: 1, z: 0 };
  const tilt = (a) => ({ x: 0, y: Math.cos(a), z: Math.sin(a) });
  // Ground ahead falls away by 0.02 rad over one tick.
  assert.equal(crestLaunch(up, tilt(0.02), { x: 0, y: 0, z: 14 }, 1 / 60, 15), true);
  assert.equal(crestLaunch(up, tilt(0.02), { x: 0, y: 0, z: 4 }, 1 / 60, 15), false);
  assert.equal(crestLaunch(up, tilt(-0.02), { x: 0, y: 0, z: 14 }, 1 / 60, 15), false, 'concave never launches');
});

test('downtown: bombing the hill builds speed and the bump launches you', () => {
  const s = createSession({ data, mapId: 'downtown' });
  let max = 0;
  const ev = run(s, 12, (i, ss) => {
    max = Math.max(max, speedOf(ss.body));
    return frame({ forward: i < 120 });
  });
  assert.ok(max > 13, `max speed ${max}`);
  const lands = ev.filter((e) => e.type === 'land' && !e.duringBail);
  assert.ok(lands.length >= 3, 'several airs on the way down');
  assert.ok(!ev.some((e) => e.type === 'bail'), 'no bails on a straight run');
});

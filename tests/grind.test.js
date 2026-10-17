// Rail grinding: entry window, points, exits, balance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/game/session.js';
import { grindPointsFor } from '../src/rider/grind.js';
import { normalizeMap } from '../src/world/map.js';
import { loadData, frame, run } from './helpers.js';

const data = await loadData();

/** Ride along rail1 (x=-8, z -24..-8, 0.5 m) and ollie onto it. Optional per-tick overrides. */
function grindRail1({ speed = 7, ollieZ = -25.3, balance = true, extra = () => ({}) } = {}) {
  const s = createSession({ data, mapId: 'training' });
  s.body.pos = { x: -8, y: 0, z: -30 };
  s.body.vel = { x: 0, y: 0, z: speed };
  const ev = run(s, 5, (i, ss) => {
    const f = frame({ pressed: { ollie: ss.body.state === 'ride' && Math.abs(ss.body.pos.z - ollieZ) < speed / 120 } });
    if (ss.grind && balance) f.steer = -Math.max(-1, Math.min(1, ss.grind.balance * 3));
    Object.assign(f, extra(i, ss));
    return f;
  });
  return { s, ev };
}

test('grind points accrue per second and scale with speed (clamped)', () => {
  assert.equal(grindPointsFor(300, 1, 7), 300);
  assert.equal(grindPointsFor(300, 1, 14), 600);
  assert.equal(grindPointsFor(300, 1, 100), 600, 'capped at 2x');
  assert.equal(grindPointsFor(300, 1, 1), 150, 'floored at 0.5x');
  assert.ok(grindPointsFor(300, 2, 7) > grindPointsFor(300, 1, 7));
});

test('ollie onto a rail inside the height window starts a 50-50 grind and ends at the rail end', () => {
  const { ev, s } = grindRail1();
  const start = ev.find((e) => e.type === 'grindStart');
  assert.ok(start, 'grind started');
  assert.equal(start.name, '50-50 Grind');
  const done = ev.find((e) => e.type === 'trickLanded' && e.grind);
  assert.ok(done, 'grind scored');
  assert.ok(done.seconds > 1.5, `ground ${done.seconds}s`);
  assert.ok(done.points > 200);
  assert.equal(ev.find((e) => e.type === 'grindEnd').how, 'end');
  assert.ok(!ev.some((e) => e.type === 'bail'));
  assert.equal(s.body.state, 'ride', 'landed after the rail');
  assert.ok(s.body.pos.z > -8, 'continued past the end of the rail');
});

test('faster grinds earn more points over the same rail', () => {
  const slow = grindRail1({ speed: 6, ollieZ: -25.2 }).ev.find((e) => e.type === 'trickLanded' && e.grind);
  const fast = grindRail1({ speed: 10, ollieZ: -26 }).ev.find((e) => e.type === 'trickLanded' && e.grind);
  assert.ok(slow && fast);
  assert.ok(fast.points / fast.seconds > slow.points / slow.seconds);
});

test('ollieing off mid-rail exits with upward velocity', () => {
  let exited = false;
  const { ev } = grindRail1({
    extra: (i, ss) => {
      if (ss.grind && ss.grind.time > 0.8 && !exited) {
        exited = true;
        return { pressed: { ollie: true } };
      }
      return {};
    },
  });
  const end = ev.find((e) => e.type === 'grindEnd');
  assert.equal(end.how, 'ollie');
  assert.ok(end.time < 1.2);
});

test('outside the height window there is no grind (too high above / below the rail)', () => {
  const s = createSession({ data, mapId: 'training' });
  s.body.pos = { x: -8, y: 3, z: -20 };
  s.body.vel = { x: 0, y: 1.5, z: 7 };
  s.body.grounded = false;
  s.body.state = 'air';
  const ev = run(s, 0.3, {});
  assert.ok(!ev.some((e) => e.type === 'grindStart'), 'rising fast well above the rail');
});

test('moving across a rail too slowly along its direction does not grind', () => {
  const s = createSession({ data, mapId: 'training' });
  s.body.pos = { x: -9, y: 0.8, z: -16 };
  s.body.vel = { x: 4, y: -0.5, z: 0.3 };
  s.body.grounded = false;
  s.body.state = 'air';
  const ev = run(s, 0.4, {});
  assert.ok(!ev.some((e) => e.type === 'grindStart'));
});

test('perpendicular entry is a boardslide', () => {
  const s = createSession({ data, mapId: 'training' });
  s.body.pos = { x: -8.2, y: 0.85, z: -20 };
  s.body.vel = { x: 0.3, y: -1, z: 6 };
  s.body.grounded = false;
  s.body.state = 'air';
  s.body.takeoffYaw = Math.PI / 2; // board turned across the rail
  s.air = null;
  const ev = run(s, 0.3, {});
  const st = ev.find((e) => e.type === 'grindStart');
  assert.ok(st);
  assert.equal(st.name, 'Boardslide');
});

test('balance: ignoring the balance meter on a long rail eventually drops you (bail)', () => {
  const map = normalizeMap({
    id: 'longrail',
    bounds: { minX: -20, maxX: 20, minZ: -80, maxZ: 80 },
    spawns: [{ x: 0, z: -75 }],
    objects: [{ id: 'long', type: 'rail', x1: 0, z1: -60, x2: 0, z2: 70, h: 0.5 }],
  });
  const d = { ...data, maps: { longrail: map } };
  const s = createSession({ data: d, mapId: 'longrail' });
  s.body.pos = { x: 0, y: 0.9, z: -55 };
  s.body.vel = { x: 0, y: -0.5, z: 7 };
  s.body.grounded = false;
  s.body.state = 'air';
  const ev = run(s, 15, {});
  assert.ok(ev.some((e) => e.type === 'grindStart'));
  assert.ok(ev.some((e) => e.type === 'bail' && e.reason === 'lost balance'));
  // ...while correcting the balance keeps you on until the end.
  const s2 = createSession({ data: d, mapId: 'longrail' });
  s2.body.pos = { x: 0, y: 0.9, z: -55 };
  s2.body.vel = { x: 0, y: -0.5, z: 12 };
  s2.body.grounded = false;
  s2.body.state = 'air';
  const ev2 = run(s2, 15, (i, ss) => frame({ steer: ss.grind ? -Math.max(-1, Math.min(1, ss.grind.balance * 3)) : 0 }));
  assert.ok(!ev2.some((e) => e.type === 'bail'));
  assert.ok(ev2.some((e) => e.type === 'trickLanded' && e.grind));
});

test('downhill handrail speeds you up (slope gravity along the rail)', () => {
  const s = createSession({ data, mapId: 'training', spawnId: 'platform' });
  // Drop onto the left stair handrail near its top.
  const rail = s.world.rails.find((r) => r.id === 'stairs1-railL');
  s.body.pos = { x: rail.a.x + (rail.b.x - rail.a.x) * 0.1, y: rail.a.y + 0.2, z: rail.a.z + (rail.b.z - rail.a.z) * 0.1 };
  s.body.vel = { x: rail.dir.x * 4, y: -0.5, z: rail.dir.z * 4 };
  s.body.grounded = false;
  s.body.state = 'air';
  let maxSpeed = 0;
  const ev = run(s, 1.5, (i, ss) => {
    if (ss.grind) maxSpeed = Math.max(maxSpeed, ss.grind.speed);
    return frame({});
  });
  assert.ok(ev.some((e) => e.type === 'grindStart'));
  assert.ok(maxSpeed > 4.2, `speed grew to ${maxSpeed}`);
});

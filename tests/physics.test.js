// Collision, ramps, stairs, curbs, benches, barriers, bounds, launch consistency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/game/session.js';
import { buildWorld, groundAt, isInsideSolid, raycast, topAt } from '../src/physics/collide.js';
import { normalizeMap } from '../src/world/map.js';
import { createTerrain } from '../src/world/terrain.js';
import { expandObjects } from '../src/world/objects.js';
import { DEG } from '../src/physics/math.js';
import { loadData, frame, run } from './helpers.js';

const data = await loadData();
const g = data.physics.gravity;

function place(s, { x, y = null, z, yaw = 0, speed = 0 }) {
  s.body.pos = { x, y: y ?? groundAt(s.world, x, z, 99).h, z };
  s.body.yaw = yaw;
  s.body.vel = { x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed };
}

function customWorld(objects, bounds = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 }) {
  const map = normalizeMap({ id: 'custom', bounds, spawns: [{ x: 0, z: -25 }], objects });
  return { maps: { custom: map } };
}

test('kicker surface rises linearly with the right slope normal', () => {
  const t = createTerrain({ type: 'flat' });
  const [k] = expandObjects([{ id: 'k', type: 'kicker', x: 0, z: 0, w: 2, d: 2, h: 1 }], t);
  assert.ok(Math.abs(k.heightAtLocal(0, -1)) < 1e-9);
  assert.ok(Math.abs(k.heightAtLocal(0, 1) - 1) < 1e-9);
  const n = k.normalAtLocal(0, 0);
  assert.ok(Math.abs(Math.acos(n.y) / DEG - Math.atan(0.5) / DEG) < 1e-6);
  assert.ok(n.z < 0, 'normal leans back toward the approach side');
});

test('quarter pipe: smooth transition up to a near-vertical lip and a flat deck', () => {
  const t = createTerrain({ type: 'flat' });
  const [q] = expandObjects([{ id: 'q', type: 'quarter', x: 0, z: 0, w: 4, r: 3, angle: 80, deck: 1 }], t);
  assert.ok(q.vert);
  assert.ok(Math.abs(q.heightAtLocal(0, -q.hd)) < 1e-9);
  assert.ok(Math.abs(q.top - 3 * (1 - Math.cos(80 * DEG))) < 1e-9);
  const nearLip = q.normalAtLocal(0, -q.hd + q.transition - 0.01);
  assert.ok(Math.acos(nearLip.y) / DEG > 75);
});

test('bowl carves into the ground: deep in the middle, flush at the rim', () => {
  const d = customWorld([{ id: 'b', type: 'bowl', x: 0, z: 0, w: 14, d: 14, r: 2.5, angle: 75 }]);
  const w = buildWorld(d.maps.custom);
  const mid = groundAt(w, 0, 0).h;
  const depth = 2.5 * (1 - Math.cos(75 * DEG));
  assert.ok(Math.abs(mid + depth) < 1e-9, `bowl floor ${mid} vs -${depth}`);
  assert.ok(Math.abs(groundAt(w, 7, 0).h) < 1e-9, 'rim (coping) is at deck level');
  assert.ok(groundAt(w, 6.9, 0).n.y < Math.cos(60 * DEG), 'wall is near vertical just below the coping');
  assert.equal(groundAt(w, 10, 0).h, 0);
});

test('stairs: treads step down evenly; handrails are generated and grindable', () => {
  const t = createTerrain({ type: 'flat' });
  const prims = expandObjects([{ id: 's', type: 'stairs', x: 0, z: 0, w: 3, steps: 4, rise: 0.2, run: 0.3, top: 1, rails: 'both' }], t);
  const st = prims[0];
  assert.equal(prims.filter((p) => p.type === 'rail').length, 2);
  assert.ok(Math.abs(st.heightAtLocal(0, -st.hd + 0.5) - 0.8) < 1e-9, 'top landing');
  assert.ok(Math.abs(st.heightAtLocal(0, -st.hd + 1.1) - 0.6) < 1e-9, 'first step');
  assert.ok(Math.abs(st.heightAtLocal(0, st.hd - 0.01)) < 1e-9, 'bottom');
});

test('groundAt ignores surfaces above the rider (rolling under nothing, walls stay walls)', () => {
  const s = createSession({ data, mapId: 'training' });
  const under = groundAt(s.world, 20, -20, 0.2); // barrier top is 1.1 m
  assert.equal(under.h, 0);
  const over = groundAt(s.world, 20, -20, 5);
  assert.ok(Math.abs(over.h - 1.1) < 1e-9);
});

test('ramp launch height is consistent with speed (matches ballistic prediction)', () => {
  const kick = buildWorld(data.maps.training).prims.find((p) => p.id === 'kicker1');
  const theta = Math.atan(kick.height / kick.def.d);
  let prevApex = -1;
  let prevAir = -1;
  for (const v of [6, 7, 8, 9, 10, 11]) {
    const s = createSession({ data, mapId: 'training' });
    place(s, { x: 10, z: -24, speed: v });
    let apex = -1;
    let air = 0;
    run(s, 3, (i, ss) => {
      if (ss.body.state === 'air') {
        apex = Math.max(apex, ss.body.pos.y);
        air += 1 / 60;
      }
      return frame({});
    });
    // Energy at the lip (ignoring rolling friction), then a projectile along the slope.
    const vLip = Math.sqrt(v * v - 2 * g * kick.height);
    const predicted = kick.height + (vLip * Math.sin(theta)) ** 2 / (2 * g);
    assert.ok(apex > prevApex, `apex grows with speed (v=${v}: ${apex} vs ${prevApex})`);
    assert.ok(air > prevAir, `airtime grows with speed (v=${v})`);
    assert.ok(Math.abs(apex - predicted) < 0.06, `v=${v}: apex ${apex.toFixed(3)} vs predicted ${predicted.toFixed(3)}`);
    prevApex = apex;
    prevAir = air;
  }
});

test('ramp launch is deterministic (same input, same result)', () => {
  const runOnce = () => {
    const s = createSession({ data, mapId: 'training' });
    place(s, { x: 10, z: -24, speed: 9 });
    run(s, 2.5, {});
    return JSON.stringify(s.body.pos);
  };
  assert.equal(runOnce(), runOnce());
});

test('too slow for the kicker: roll back down (fakie), no launch', () => {
  const s = createSession({ data, mapId: 'training' });
  place(s, { x: 10, z: -24, speed: 4 });
  const ev = run(s, 3, {});
  assert.ok(!ev.some((e) => e.type === 'airborne'));
  assert.ok(ev.some((e) => e.type === 'fakieFlip'));
});

test('quarter pipe: vert air goes straight up and lands back on the ramp facing down it', () => {
  const s = createSession({ data, mapId: 'training' });
  place(s, { x: 0, z: 20, speed: 10 });
  const ev = run(s, 4, {});
  const air = ev.find((e) => e.type === 'airborne');
  assert.ok(air && air.vert, 'vert launch');
  assert.ok(!ev.some((e) => e.type === 'bail'), 'clean');
  assert.ok(s.body.vel.z < -5, 'riding back down the ramp');
  assert.equal(s.body.stance, 1, 'auto-turn means you land regular, not fakie');
});

test('barrier: riding into it bounces you back; hitting it very fast is a slam (bail)', () => {
  const a = createSession({ data, mapId: 'training' });
  place(a, { x: 20, z: -26, speed: 6 });
  const ev = run(a, 1.5, {});
  assert.ok(ev.some((e) => e.type === 'wallHit'));
  assert.ok(a.body.pos.z < -20.25 - 0.29, 'never inside the barrier');
  assert.ok(!ev.some((e) => e.type === 'bail'));
  const b = createSession({ data, mapId: 'training' });
  place(b, { x: 20, z: -26, speed: 11 });
  const ev2 = run(b, 1, {});
  assert.ok(ev2.some((e) => e.type === 'bail' && e.reason === 'slam'));
});

test('bench: side hit bounces; you can ollie onto the top and land on it', () => {
  const a = createSession({ data, mapId: 'training' });
  place(a, { x: -22, z: -10, yaw: 90 * DEG, speed: 5 });
  run(a, 1, {});
  assert.ok(a.body.pos.x < -18.3 - 0.29);
  // Ollie onto the bench across its width at a slight angle so we land on top (not the ledge rail).
  const d = customWorld([{ id: 'bench', type: 'bench', x: 0, z: 0, w: 3, d: 3, h: 0.45 }]);
  const b = createSession({ data: { ...data, ...d, maps: d.maps }, mapId: 'custom' });
  place(b, { x: 0, z: -4, speed: 5 });
  let onTop = false;
  run(b, 2, (i, ss) => {
    if (ss.body.grounded && Math.abs(ss.body.pos.y - 0.45) < 1e-6) onTop = true;
    return frame({ pressed: { ollie: i === 20 } });
  });
  assert.ok(onTop, 'landed on the bench top');
});

test('curb: rideable straight on, blocked at a glancing angle (keeps rolling along it)', () => {
  const a = createSession({ data, mapId: 'training' });
  place(a, { x: 22, z: -5, speed: 5 });
  run(a, 1.2, {});
  assert.ok(Math.abs(a.body.pos.y - 0.15) < 1e-6, 'stepped up onto the curb');
  const b = createSession({ data, mapId: 'training' });
  place(b, { x: 17.2, z: 0, yaw: 15 * DEG, speed: 6 });
  const ev = run(b, 1, {});
  assert.ok(ev.some((e) => e.type === 'wallHit'));
  assert.equal(b.body.pos.y, 0, 'stayed down');
  assert.ok(Math.hypot(b.body.vel.x, b.body.vel.z) > 4, 'deflected along the curb without losing most speed');
});

test('stairs: rideable along the axis (up and down), blocked at a steep side angle', () => {
  const up = createSession({ data, mapId: 'training' });
  place(up, { x: -21.5, z: 15, yaw: 30 * DEG, speed: 5 });
  run(up, 1, {});
  assert.ok(Math.abs(up.body.pos.y - 0.85) < 1e-6, `climbed to the platform (y=${up.body.pos.y})`);
  const down = createSession({ data, mapId: 'training' });
  place(down, { x: -20, z: 23, yaw: Math.PI, speed: 5 });
  const ev = run(down, 2.5, {});
  assert.ok(down.body.pos.z < 15 && down.body.pos.y === 0, 'rode down to the bottom');
  assert.ok(!ev.some((e) => e.type === 'bail'));
  const steep = createSession({ data, mapId: 'training' });
  place(steep, { x: -23.5, z: 16, yaw: 60 * DEG, speed: 5 });
  const ev2 = run(steep, 1, {});
  assert.ok(ev2.some((e) => e.type === 'wallHit'), 'blocked by the first step');
  assert.ok(steep.body.pos.y < 0.01);
});

test('funbox: roll up one kicker, across the deck and down the other side', () => {
  const s = createSession({ data, mapId: 'training' });
  place(s, { x: 14, z: 24, yaw: 90 * DEG, speed: 7 });
  let maxY = 0;
  run(s, 2, (i, ss) => {
    maxY = Math.max(maxY, ss.body.pos.y);
    return frame({});
  });
  assert.ok(maxY > 0.69, 'reached the deck');
  assert.ok(s.body.pos.x > 24, 'came out the other side');
});

test('rails are thin fences for a grounded rider (no rolling through them)', () => {
  const s = createSession({ data, mapId: 'training' });
  place(s, { x: -10, z: -16, yaw: 90 * DEG, speed: 5 });
  const ev = run(s, 1, {});
  assert.ok(ev.some((e) => e.type === 'wallHit'));
  assert.ok(s.body.pos.x < -8);
});

test('map bounds hold at any speed and angle', () => {
  for (const yaw of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const s = createSession({ data, mapId: 'training' });
    place(s, { x: 30, z: -30, yaw: yaw * DEG, speed: 15 });
    run(s, 4, { forward: true });
    const b = s.map.bounds;
    assert.ok(s.body.pos.x > b.minX && s.body.pos.x < b.maxX && s.body.pos.z > b.minZ && s.body.pos.z < b.maxZ, `yaw ${yaw}`);
    assert.equal(s.stats2.outOfBounds, 0);
  }
});

test('camera raycast: hits a wall, passes over open ground', () => {
  const s = createSession({ data, mapId: 'training' });
  const d = raycast(s.world, { x: 20, y: 0.6, z: -25 }, { x: 0, y: 0, z: 1 }, 10);
  assert.ok(d > 4.5 && d < 5, `hit barrier at ${d}`);
  assert.equal(raycast(s.world, { x: 0, y: 1.5, z: -25 }, { x: 0, y: 0, z: 1 }, 10), 10);
  assert.ok(isInsideSolid(s.world, 20, 0.5, -20));
  assert.ok(Math.abs(topAt(s.world, 20, -20) - 1.1) < 1e-9);
});

test('objects validate their data', () => {
  const t = createTerrain({ type: 'flat' });
  assert.throws(() => expandObjects([{ id: 'x', type: 'kicker', x: 0, z: 0 }], t), /needs numeric/);
  assert.throws(() => expandObjects([{ id: 'x', type: 'teleporter', x: 0, z: 0 }], t), /unknown object type/);
  assert.throws(() => expandObjects([{ id: 'r', type: 'rail', x1: 0, z1: 0, x2: 0, z2: 0.5, h: 0.5 }], t), /shorter/);
});

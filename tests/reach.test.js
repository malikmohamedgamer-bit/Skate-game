// The reachability checker must catch real problems (negative tests) and pass the shipped maps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMap } from '../src/world/reach.js';
import { normalizeMap } from '../src/world/map.js';
import { loadData } from './helpers.js';

const data = await loadData();

function withMap(raw) {
  const m = normalizeMap({ bounds: { minX: -25, maxX: 25, minZ: -25, maxZ: 25 }, spawns: [{ id: 'main', x: 0, z: -20 }], ...raw });
  return { ...data, maps: { ...data.maps, [m.id]: m } };
}

test('a rail too high to ollie onto is reported unreachable', () => {
  const d = withMap({ id: 'highrail', objects: [{ id: 'sky-rail', type: 'rail', x1: 0, z1: -5, x2: 0, z2: 10, h: 3.5 }] });
  const r = analyzeMap(d, 'highrail');
  assert.equal(r.ok, false);
  assert.equal(r.rails.find((x) => x.id === 'sky-rail').ok, false);
});

test('a normal rail is reachable', () => {
  const d = withMap({ id: 'okrail', objects: [{ id: 'flat', type: 'rail', x1: 0, z1: -5, x2: 0, z2: 10, h: 0.5 }] });
  const r = analyzeMap(d, 'okrail');
  assert.equal(r.ok, true, r.issues.join('; '));
});

test('a spawn sealed inside a room without a door is unreachable', () => {
  const d = withMap({
    id: 'sealed',
    spawns: [
      { id: 'main', x: 0, z: -20 },
      { id: 'jail', x: 10, z: 10 },
    ],
    objects: [{ id: 'cell', type: 'room', x: 10, z: 10, w: 6, d: 6, h: 3 }],
  });
  const r = analyzeMap(d, 'sealed');
  assert.equal(r.spawns.find((s) => s.id === 'jail').ok, false);
  assert.equal(r.ok, false);
});

test('a room with a door is enterable', () => {
  const d = withMap({
    id: 'door',
    spawns: [
      { id: 'main', x: 0, z: -20 },
      { id: 'inside', x: 10, z: 10 },
    ],
    objects: [{ id: 'room', type: 'room', x: 10, z: 10, w: 8, d: 8, h: 3, door: { side: 'south', width: 3 } }],
  });
  const r = analyzeMap(d, 'door');
  assert.equal(r.spawns.find((s) => s.id === 'inside').ok, true, r.issues.join('; '));
});

test('a kicker whose approach is walled off is reported', () => {
  const d = withMap({
    id: 'blocked-kicker',
    objects: [
      { id: 'k', type: 'kicker', x: 0, z: 5, w: 2.4, d: 2.2, h: 0.8 },
      { id: 'wall', type: 'wall', x: 0, z: 2, w: 8, d: 0.4, h: 3 },
      { id: 'wall2', type: 'wall', x: -2, z: 6, w: 0.4, d: 8, h: 3 },
      { id: 'wall3', type: 'wall', x: 2, z: 6, w: 0.4, d: 8, h: 3 },
      { id: 'wall4', type: 'wall', x: 0, z: 10, w: 8, d: 0.4, h: 3 },
    ],
  });
  const r = analyzeMap(d, 'blocked-kicker');
  assert.equal(r.ramps.find((x) => x.id === 'k').ok, false);
});

test('a very high pickup without a launch ramp is unreachable; a reachable one passes', () => {
  const d = withMap({
    id: 'pickups',
    pickups: [
      { id: 'low', x: 0, z: 0, y: 1 },
      { id: 'sky', x: 5, z: 0, y: 6 },
    ],
  });
  const r = analyzeMap(d, 'pickups');
  assert.equal(r.pickups.find((p) => p.id === 'low').ok, true);
  assert.equal(r.pickups.find((p) => p.id === 'sky').ok, false);
});

test('stairs whose bottom is walled off cannot be climbed', () => {
  const d = withMap({
    id: 'stairs-walled',
    spawns: [
      { id: 'main', x: 0, z: -20 },
      { id: 'top', x: 0, z: 12 },
    ],
    objects: [
      { id: 'deck', type: 'platform', x: 0, z: 12, w: 6, d: 6, h: 0.85 },
      { id: 'st', type: 'stairs', x: 0, z: 8.15, rot: 180, w: 4, steps: 5, rails: 'none' },
      { id: 'blocker', type: 'wall', x: 0, z: 6.9, w: 6.5, d: 0.4, h: 2.5 },
      // The stair sides are open (no handrails), and ollieing onto a low step from the side is legal,
      // so wall the sides too to make this a real dead end.
      { id: 'side-l', type: 'wall', x: -2.3, z: 8.0, w: 0.4, d: 2.6, h: 2.5 },
      { id: 'side-r', type: 'wall', x: 2.3, z: 8.0, w: 0.4, d: 2.6, h: 2.5 },
    ],
  });
  const r = analyzeMap(d, 'stairs-walled');
  assert.equal(r.spawns.find((s) => s.id === 'top').ok, false);
});

for (const id of ['training', 'neighborhood', 'skatepark', 'plaza', 'downtown']) {
  test(`shipped map "${id}": every spawn, ramp, rail, pickup and checkpoint is reachable`, () => {
    const r = analyzeMap(data, id);
    assert.equal(r.ok, true, r.issues.join('; '));
    assert.ok(r.cells.percent > 80);
  });
}

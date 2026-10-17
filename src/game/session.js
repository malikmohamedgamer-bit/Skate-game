// A play session: one rider on one map. Owns the simulation step and turns raw
// physics events into gameplay events. No DOM and no Three.js, so it also runs
// under Node (tests, map checks).

import { createBody, respawn, speedOf, stepBody } from '../physics/body.js';
import { buildWorld, insideBounds } from '../physics/collide.js';
import { lenXZ } from '../physics/math.js';
import { spawnById } from '../world/map.js';

export function createSession({ data, mapId, vehicle = 'skateboard', stats = null, settings = {}, spawnId = null }) {
  const map = data.maps[mapId];
  if (!map) throw new Error(`Unknown map ${mapId}`);
  const phys = data.physics;
  const world = buildWorld(map, []);
  const spawn = spawnById(map, spawnId);
  const body = createBody(world, spawn);
  const vstats = stats || data.vehicles[vehicle];

  const s = {
    map,
    world,
    phys,
    body,
    vehicle,
    stats: vstats,
    settings,
    spawn,
    time: 0,
    events: [],
    stats2: { maxSpeed: 0, distance: 0, outOfBounds: 0, ticks: 0 },
    lastInput: null,
  };

  s.step = (dt, input) => {
    s.time += dt;
    s.stats2.ticks++;
    s.lastInput = input;
    const ctrl = {
      steer: input.steer,
      push: input.forward || (settings.autoPush && body.grounded && speedOf(body) < vstats.topSpeed * 0.7 && !input.brake && !input.back),
      brake: input.brake || input.back,
      ollie: input.pressed.ollie,
    };
    const before = { ...body.pos };
    stepBody(body, world, vstats, phys, ctrl, dt);
    s.stats2.distance += lenXZ({ x: body.pos.x - before.x, y: 0, z: body.pos.z - before.z });
    s.stats2.maxSpeed = Math.max(s.stats2.maxSpeed, speedOf(body));
    if (!insideBounds(world, body.pos.x, body.pos.z, 0.01)) s.stats2.outOfBounds++;
    for (const e of body.events) s.events.push(e);
    body.events.length = 0;
  };

  s.respawn = () => {
    respawn(body, world, spawn);
    s.events.push({ type: 'respawn' });
  };

  s.drainEvents = () => {
    const out = s.events;
    s.events = [];
    return out;
  };

  return s;
}

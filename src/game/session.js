// A play session: one rider on one map. Owns the simulation step and turns raw
// physics events into gameplay events (tricks, grinds, bails). No DOM and no
// Three.js, so it also runs under Node (tests, map checks, soak).

import { bail, createBody, facesBackward, headingErrorMod180, respawn, settleLanding, speedOf, stepBody } from '../physics/body.js';
import { buildWorld, insideBounds, topAt } from '../physics/collide.js';
import { PICKUP_BOLTS } from './economy.js';
import { DEG, lenXZ, mulberry32 } from '../physics/math.js';
import { spawnById } from '../world/map.js';
import { createAirTricks, describeTrick, evaluateLanding, releaseGrab, stepAirTricks } from '../rider/tricks.js';
import { findGrindRail, grindPointsFor, startGrind, stepGrind } from '../rider/grind.js';

/** Roll (deg) of a landing surface across the board's direction. */
export function landingRollDeg(normal, yaw) {
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const side = Math.abs(normal.x * rx + normal.z * rz);
  return Math.asin(Math.min(1, side)) / DEG;
}

/** Pickups are collected when the rider's body center passes within this distance. */
export const PICKUP_RADIUS = 0.8;
/** Height of the rider's body center above the feet. */
export const RIDER_CENTER = 0.9;

export function createSession({
  data,
  mapId,
  vehicle = 'skateboard',
  stats = null,
  settings = {},
  spawnId = null,
  seed = 1234,
  pickupFilter = null,
}) {
  const map = data.maps[mapId];
  if (!map) throw new Error(`Unknown map ${mapId}`);
  const phys = data.physics;
  const world = buildWorld(map);
  const spawn = spawnById(map, spawnId);
  const body = createBody(world, spawn);
  const vstats = stats || data.vehicles[vehicle];
  const trickData = data.tricks;
  const grabKeys = trickData.grabKeys[vehicle];
  const rng = mulberry32(seed);

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
    air: null, // air trick state while airborne
    grind: null, // grind state while grinding
    grindPoints: 0,
    railCooldown: new Map(),
    lastTrick: null,
    stats2: { maxSpeed: 0, distance: 0, outOfBounds: 0, ticks: 0, tricks: 0, bails: 0, grindTime: 0, grindDistance: 0, airTime: 0 },
    lastInput: null,
    pickups: map.pickups
      .filter((p) => !pickupFilter || pickupFilter(p))
      .map((p) => ({ id: p.id, x: p.x, z: p.z, y: topAt(world, p.x, p.z) + p.y, taken: false })),
  };

  const emit = (e) => s.events.push(e);

  function collectPickups() {
    const cx = body.pos.x;
    const cy = body.pos.y + RIDER_CENTER;
    const cz = body.pos.z;
    const r2 = PICKUP_RADIUS * PICKUP_RADIUS;
    for (const p of s.pickups) {
      if (p.taken) continue;
      const dx = p.x - cx;
      const dz = p.z - cz;
      if (dx * dx + dz * dz > 4) continue;
      const dy = p.y - cy;
      if (dx * dx + dy * dy + dz * dz <= r2) {
        p.taken = true;
        emit({ type: 'pickup', id: p.id, value: PICKUP_BOLTS });
      }
    }
  }

  function startAir(opts) {
    s.air = createAirTricks(opts);
  }

  function liveAirYaw() {
    const t = s.air;
    const spin = t ? t.yawDeg * DEG : 0;
    return body.takeoffYaw + spin + (body.vertAir ? body.autoTurnDir * body.autoTurnDone : 0);
  }

  function handleLanding(e) {
    if (e.duringBail) {
      s.air = null;
      return;
    }
    const t = s.air || createAirTricks();
    s.stats2.airTime += t.airTime;
    const headingErrDeg = headingErrorMod180(body.airYaw, e.velYaw) / DEG;
    const rollDeg = landingRollDeg(e.normal, body.airYaw);
    const ev = evaluateLanding(t, { headingErrDeg, rollDeg, horizSpeed: lenXZ(body.vel) }, phys.landing, vstats, {
      forgiving: !!settings.forgivingLandings,
    });
    releaseGrab(t);
    s.air = null;
    if (!ev.clean) {
      bail(body, phys, ev.reason);
      return;
    }
    const fakie = facesBackward(body.airYaw, e.velYaw);
    // Scooters revert out of fakie automatically; skateboards ride switch/fakie.
    settleLanding(body, { fakie: vehicle === 'scooter' ? false : fakie });
    const trick = describeTrick(t, trickData, vehicle, { minAirTime: phys.landing.minTrickAirTime });
    if (trick) {
      const points = Math.round(trick.points * vstats.trickBonus);
      s.lastTrick = { ...trick, points, clean: true };
      s.stats2.tricks++;
      emit({ type: 'trickLanded', name: trick.name, points, trick, airTime: t.airTime, height: e.height, grind: false });
    } else {
      emit({ type: 'landClean' });
    }
  }

  function tryEnterGrind(prevPos) {
    const hit = findGrindRail(world, body, phys, prevPos);
    if (!hit) return false;
    if ((s.railCooldown.get(hit.rail.id) || 0) > 0) return false;
    const t = s.air || createAirTricks();
    // Tricks done before locking on must be finished.
    const ev = evaluateLanding(t, { headingErrDeg: 0, rollDeg: 0 }, phys.landing, vstats, {
      forgiving: !!settings.forgivingLandings,
      ignoreHeading: true,
    });
    if (!ev.clean) return false;
    releaseGrab(t);
    const trick = describeTrick(t, trickData, vehicle, { minAirTime: 0, includeOllie: false });
    if (trick) {
      const points = Math.round(trick.points * vstats.trickBonus);
      s.lastTrick = { ...trick, points, clean: true };
      s.stats2.tricks++;
      emit({ type: 'trickLanded', name: trick.name, points, trick, airTime: t.airTime, grind: false, intoGrind: true });
    }
    s.air = null;
    s.grind = startGrind(body, hit, trickData, vehicle, rng);
    s.grindPoints = 0;
    return true;
  }

  function handleGrindExit(how) {
    const g = s.grind;
    s.grind = null;
    s.railCooldown.set(g.rail.id, how === 'ollie' ? 0.2 : 0.6);
    s.stats2.grindTime += g.time;
    s.stats2.grindDistance += g.distance;
    const points = Math.round(s.grindPoints * vstats.trickBonus);
    s.grindPoints = 0;
    if (how === 'bail') {
      startAir({});
      bail(body, phys, 'lost balance');
      return;
    }
    if (g.time >= 0.1) {
      s.lastTrick = { name: g.name, points, clean: true, grind: true };
      s.stats2.tricks++;
      emit({ type: 'trickLanded', name: g.name, points, grind: true, seconds: g.time, distance: g.distance, category: g.category });
    }
    startAir({ ollied: how === 'ollie', fromGrind: true });
  }

  s.step = (dt, input) => {
    s.time += dt;
    s.stats2.ticks++;
    s.lastInput = input;
    for (const [k, v] of s.railCooldown) {
      if (v - dt <= 0) s.railCooldown.delete(k);
      else s.railCooldown.set(k, v - dt);
    }
    const prevPos = { ...body.pos };

    if (body.state === 'grind' && s.grind) {
      const res = stepGrind(s.grind, body, input, phys, vstats, dt, {
        rng,
        forgiving: !!settings.forgivingLandings,
      });
      if (res === 'grinding') {
        s.grindPoints += grindPointsFor(s.grind.perSecond, dt, s.grind.speed);
        emit({ type: 'grindTick', dt, speed: s.grind.speed });
      } else {
        handleGrindExit(res);
      }
    } else {
      const ctrl = {
        steer: input.steer,
        push:
          input.forward ||
          (!!settings.autoPush && body.grounded && speedOf(body) < vstats.topSpeed * 0.75 && !input.brake && !input.back),
        brake: input.brake || input.back,
        ollie: input.pressed.ollie,
      };
      stepBody(body, world, vstats, phys, ctrl, dt);
    }

    // Translate physics events.
    const evs = body.events.splice(0);
    for (const e of evs) {
      if (e.type === 'airborne') {
        startAir({ fakie: body.stance < 0, ollied: e.ollied, vert: e.vert });
        emit(e);
      } else if (e.type === 'land') {
        emit(e);
        handleLanding(e);
      } else if (e.type === 'bail') {
        s.stats2.bails++;
        s.air = null;
        if (s.grind) s.grind = null;
        emit(e);
      } else {
        emit(e);
      }
    }

    // Air tricks and grind snapping.
    if (body.state === 'air') {
      // Airborne without trick state (e.g. recovered from a bail mid-air): start tracking now.
      if (!s.air) startAir({ fakie: body.stance < 0, ollied: false });
      stepAirTricks(s.air, input, vstats, dt, grabKeys);
      body.airYaw = liveAirYaw();
      tryEnterGrind(prevPos);
    }

    if (s.pickups.length) collectPickups();
    s.stats2.distance += lenXZ({ x: body.pos.x - prevPos.x, y: 0, z: body.pos.z - prevPos.z });
    const sp = speedOf(body);
    if (sp > s.stats2.maxSpeed) s.stats2.maxSpeed = sp;
    if (!insideBounds(world, body.pos.x, body.pos.z, 0.01)) s.stats2.outOfBounds++;
  };

  /** Live description of the trick in progress (HUD). */
  s.currentTrickText = () => {
    if (s.grind) return { name: s.grind.name, points: Math.round(s.grindPoints * vstats.trickBonus), grind: true, balance: s.grind.balance };
    if (s.air && body.state === 'air') {
      // Rotations are committed, so describe where they will end up (plus any grab being held).
      const t = s.air;
      const preview = {
        ...t,
        yawDeg: t.yawTarget,
        pitchDeg: t.pitchTarget,
        boardYawDeg: t.boardTarget,
        grabs: t.grab ? [...t.grabs, { type: t.grab, time: Math.max(t.grabTime, trickData.minGrabTime) }] : t.grabs,
      };
      const d = describeTrick(preview, trickData, vehicle, { minAirTime: 0.3 });
      return d ? { name: d.name, points: Math.round(d.points * vstats.trickBonus), grind: false } : null;
    }
    return null;
  };

  s.respawn = (spawnPoint = spawn) => {
    respawn(body, world, spawnPoint);
    s.air = null;
    s.grind = null;
    s.grindPoints = 0;
    emit({ type: 'respawn' });
  };

  s.drainEvents = () => {
    const out = s.events;
    s.events = [];
    return out;
  };

  return s;
}

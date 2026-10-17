// Trick detection, rotation tracking, landing evaluation and naming.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAirTricks,
  describeTrick,
  enumerateTrickNames,
  evaluateLanding,
  nextMultiple,
  residual,
  stepAirTricks,
} from '../src/rider/tricks.js';
import { createSession } from '../src/game/session.js';
import { speedOf } from '../src/physics/body.js';
import { loadData, frame, run } from './helpers.js';

const data = await loadData();
const T = data.tricks;
const sk = data.vehicles.skateboard;
const sc = data.vehicles.scooter;
const L = data.physics.landing;

function airFor(seconds, inputFn, vstats = sk, vehicle = 'skateboard') {
  const t = createAirTricks({ ollied: true });
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) stepAirTricks(t, frame(inputFn(i)), vstats, 1 / 60, T.grabKeys[vehicle]);
  return t;
}

test('nextMultiple finds the next 180/360 in a direction', () => {
  assert.equal(nextMultiple(10, 180, 1), 180);
  assert.equal(nextMultiple(180, 180, 1), 360);
  assert.equal(nextMultiple(-10, 180, -1), -180);
  assert.equal(nextMultiple(0, 360, -1), -360);
});

test('spin: tapping left commits a full 180 (rotation auto-completes)', () => {
  const t = airFor(1, (i) => ({ left: i < 3 }));
  assert.equal(t.yawDeg, 180);
});

test('spin: holding right longer gives a 360 in the negative direction', () => {
  const t = airFor(1, (i) => ({ right: i < Math.round((300 / sk.spinRate) * 60) }));
  assert.equal(t.yawDeg, -360);
});

test('flip: each tap of forward commits one 360; back flips the other way; mixed input ignored', () => {
  const k = airFor(1, (i) => ({ pressed: { forward: i === 0 }, forward: i === 0 }));
  assert.equal(k.pitchDeg, 360);
  const h = airFor(1, (i) => ({ pressed: { back: i === 0 }, back: i === 0 }));
  assert.equal(h.pitchDeg, -360);
  const mixed = airFor(1, (i) => ({ pressed: { forward: i === 0, back: i === 5 }, forward: i === 0, back: i === 5 }));
  assert.equal(mixed.pitchDeg, 360);
});

test('holding push (forward) through an ollie does not trigger a flip', () => {
  const t = airFor(1, () => ({ forward: true }));
  assert.equal(t.pitchDeg, 0);
});

test('trick modifier + left = board spin (shove-it 180 / tailwhip 360); modifier alone = grab', () => {
  const s = airFor(1, (i) => ({ trick: true, left: i === 0, pressed: { left: i === 0 } }));
  assert.equal(s.boardYawDeg, 180);
  assert.equal(s.yawDeg, 0);
  const w = airFor(1, (i) => ({ trick: true, left: i === 0, pressed: { left: i === 0 } }), sc, 'scooter');
  assert.equal(w.boardYawDeg, 360);
  const g = airFor(0.5, () => ({ trick: true }));
  assert.equal(g.grab, 'indy');
  assert.ok(g.grabTime > 0.45);
  const nose = airFor(0.5, () => ({ trick: true, forward: true }));
  assert.equal(nose.grab, 'nose');
});

test('landing evaluation: clean when rotations are complete, bail mid-rotation', () => {
  const t = createAirTricks();
  t.yawDeg = 360;
  t.pitchDeg = 360;
  assert.ok(evaluateLanding(t, { headingErrDeg: 0, rollDeg: 0 }, L, sk).clean);
  t.pitchDeg = 250;
  const r = evaluateLanding(t, { headingErrDeg: 0, rollDeg: 0 }, L, sk);
  assert.equal(r.clean, false);
  assert.equal(r.reason, 'under-rotated flip');
  t.pitchDeg = 360;
  t.yawDeg = 90;
  assert.equal(evaluateLanding(t, { headingErrDeg: 0 }, L, sk).reason, 'under-rotated spin');
});

test('landing evaluation: sideways or tilted landings bail; forgiving mode widens tolerance', () => {
  const t = createAirTricks();
  assert.equal(evaluateLanding(t, { headingErrDeg: 50, rollDeg: 0, horizSpeed: 5 }, L, sk).reason, 'landed sideways');
  assert.equal(evaluateLanding(t, { headingErrDeg: 0, rollDeg: 45 }, L, sk).reason, 'landed on a tilt');
  t.yawDeg = 180 + L.spinTolerance + 10;
  assert.equal(evaluateLanding(t, { headingErrDeg: 0 }, L, sk).clean, false);
  assert.equal(evaluateLanding(t, { headingErrDeg: 0 }, L, sk, { forgiving: true }).clean, true);
});

test('residual measures distance to the nearest multiple', () => {
  assert.equal(residual(350, 360), 10);
  assert.equal(residual(190, 180), 10);
  assert.equal(residual(-170, 180), 10);
});

test('trick names are generated from data: ollie, spins, flips, varials, grabs', () => {
  const base = { ollied: true };
  const mk = (o) => Object.assign(createAirTricks(base), { airTime: 0.8 }, o);
  assert.equal(describeTrick(mk({}), T, 'skateboard').name, 'Ollie');
  assert.equal(describeTrick(mk({ pitchDeg: 360 }), T, 'skateboard').name, 'Kickflip');
  assert.equal(describeTrick(mk({ pitchDeg: -720 }), T, 'skateboard').name, 'Double Heelflip');
  assert.equal(describeTrick(mk({ yawDeg: -360, pitchDeg: 360 }), T, 'skateboard').name, 'FS 360 Kickflip');
  assert.equal(describeTrick(mk({ yawDeg: 180 }), T, 'skateboard').name, 'BS 180');
  assert.equal(describeTrick(mk({ boardYawDeg: 180 }), T, 'skateboard').name, 'Shove-it');
  assert.equal(describeTrick(mk({ boardYawDeg: 360, pitchDeg: 360 }), T, 'skateboard').name, 'Tre Flip');
  assert.equal(describeTrick(mk({ boardYawDeg: 180, pitchDeg: -360 }), T, 'skateboard').name, 'Varial Heelflip');
  assert.equal(describeTrick(mk({ grabs: [{ type: 'indy', time: 0.4 }] }), T, 'skateboard').name, 'Indy');
  assert.equal(describeTrick(mk({ fakie: true, yawDeg: 360 }), T, 'skateboard').name, 'Fakie BS 360');
  assert.equal(describeTrick(mk({ boardYawDeg: 360 }), T, 'scooter').name, 'Tailwhip');
  assert.equal(describeTrick(mk({ pitchDeg: -360 }), T, 'scooter').name, 'Backflip');
  assert.equal(describeTrick(mk({ pitchDeg: -360, boardYawDeg: 360 }), T, 'scooter').name, 'Flair Whip');
  assert.equal(describeTrick(mk({ grabs: [{ type: 'superman', time: 0.5 }] }), T, 'scooter').name, 'Superman');
});

test('bigger tricks score more points', () => {
  const mk = (o) => Object.assign(createAirTricks({ ollied: true }), { airTime: 0.8 }, o);
  const ollie = describeTrick(mk({}), T, 'skateboard').points;
  const kf = describeTrick(mk({ pitchDeg: 360 }), T, 'skateboard').points;
  const fs360kf = describeTrick(mk({ pitchDeg: 360, yawDeg: -360 }), T, 'skateboard').points;
  assert.ok(ollie < kf && kf < fs360kf);
});

test('no trick for a tiny hop with nothing in it (rolling off a curb)', () => {
  const t = Object.assign(createAirTricks({ ollied: false }), { airTime: 0.1 });
  assert.equal(describeTrick(t, T, 'skateboard'), null);
});

test('at least 30 distinct named tricks per vehicle', () => {
  for (const v of ['skateboard', 'scooter']) {
    const names = enumerateTrickNames(T, v);
    assert.ok(names.length >= 30, `${v}: ${names.length}`);
  }
});

test('in game: ollie on flat ground lands an "Ollie" with points', () => {
  const s = createSession({ data, mapId: 'training' });
  s.body.vel = { x: 0, y: 0, z: 6 };
  const ev = run(s, 2, (i) => frame({ pressed: { ollie: i === 5 } }));
  const t = ev.find((e) => e.type === 'trickLanded');
  assert.ok(t, 'trick landed');
  assert.equal(t.name, 'Ollie');
  assert.ok(t.points >= 50);
});

test('in game: FS 180 lands clean and switches to fakie; FS 360 kickflip lands clean', () => {
  const s = createSession({ data, mapId: 'training' });
  s.body.vel = { x: 0, y: 0, z: 7 };
  const ev = run(s, 2, (i) => frame({ pressed: { ollie: i === 5 }, right: i > 6 && i < 10 }));
  assert.equal(ev.find((e) => e.type === 'trickLanded').name, 'FS 180');
  assert.equal(s.body.stance, -1);
  const s2 = createSession({ data, mapId: 'training' });
  s2.body.vel = { x: 0, y: 0, z: 9 };
  const spinTicks = Math.round((200 / sk.spinRate) * 60);
  const ev2 = run(s2, 2, (i) => frame({ pressed: { ollie: i === 5, forward: i === 7 }, right: i > 6 && i < 7 + spinTicks }));
  assert.ok(!ev2.some((e) => e.type === 'bail'), JSON.stringify(ev2.filter((e) => e.type === 'bail')));
  assert.equal(ev2.find((e) => e.type === 'trickLanded').name, 'FS 360 Kickflip');
});

test('in game: a flip started too late bails, costs speed, and the rider recovers', () => {
  const s = createSession({ data, mapId: 'training' });
  s.body.vel = { x: 0, y: 0, z: 6 };
  let speedBefore = 0;
  const ev = run(s, 4, (i, ss) => {
    if (i === 40) speedBefore = speedOf(ss.body);
    return frame({ pressed: { ollie: i === 5, forward: i === 42 } });
  });
  const b = ev.find((e) => e.type === 'bail');
  assert.ok(b);
  assert.equal(b.reason, 'under-rotated flip');
  assert.ok(speedOf(s.body) < speedBefore * 0.5, 'bail costs speed');
  assert.ok(ev.some((e) => e.type === 'recover'));
  assert.equal(s.body.state, 'ride');
});

test('forgiving landings turns a slightly-late flip into a clean landing', () => {
  const sim = (forgiving, pressTick) => {
    const s = createSession({ data, mapId: 'training', settings: { forgivingLandings: forgiving } });
    s.body.vel = { x: 0, y: 0, z: 6 };
    let landTick = -1;
    const ev = run(s, 2, (i, ss) => {
      if (landTick < 0 && i > 5 && ss.body.state !== 'air') landTick = i;
      return frame({ pressed: { ollie: i === 5, forward: i === pressTick } });
    });
    return { ev, landTick };
  };
  const { landTick } = sim(false, -1);
  const flipTicks = Math.round((360 / sk.flipRate) * 60);
  // Leave ~4 ticks (~53 degrees) of the flip unfinished at touchdown: outside the normal
  // 35 degree tolerance but inside the forgiving (2x) tolerance.
  const press = landTick - flipTicks + 4;
  assert.ok(sim(false, press).ev.some((e) => e.type === 'bail'), 'normal tolerance bails');
  assert.ok(!sim(true, press).ev.some((e) => e.type === 'bail'), 'forgiving tolerance lands');
});

test('scooter: tailwhip lands clean; scooter gets its trick bonus', () => {
  const s = createSession({ data, mapId: 'training', vehicle: 'scooter' });
  s.body.vel = { x: 0, y: 0, z: 7 };
  const ev = run(s, 2, (i) => frame({ pressed: { ollie: i === 5, left: i === 7 }, trick: i >= 6 && i <= 8, left: i === 7 }));
  const t = ev.find((e) => e.type === 'trickLanded');
  assert.equal(t.name, 'Tailwhip');
  assert.equal(t.points, Math.round(t.trick.points * sc.trickBonus));
});

// A scripted "bot" rider for feasibility tests: plays a level through the real
// simulation (session + progression + level run) using only normal inputs.
// Tasks: goto (steer + push toward a point), trick (ollie + optional flip/spin),
// grind (line up on an approach point, ollie onto a rail, keep balance).

import { createSession } from '../src/game/session.js';
import { applyEvent, createRun, tickRun } from '../src/game/progression.js';
import { createLevelRun, levelPickupIds, updateLevelRun } from '../src/game/levels.js';
import { defaultSave } from '../src/core/save.js';
import { emptyFrame } from '../src/core/input.js';
import { speedOf } from '../src/physics/body.js';
import { wrapAngle } from '../src/physics/math.js';

function steerToward(body, x, z) {
  const target = Math.atan2(x - body.pos.x, z - body.pos.z);
  const err = wrapAngle(target - body.yaw);
  return { steer: Math.max(-1, Math.min(1, -err * 3)), err };
}

/**
 * Run a level with a task list. Returns { levelRun, run, events, time }.
 * tasks: [{ goto: [x, z], speed?, tol? } | { trick: 'ollie'|'kickflip'|'360' } | { grind: { from: [x,z], to: [x,z], ollieAt } } | { repeat: n, tasks }]
 */
export function playLevel(data, level, tasks, { maxSeconds = null, vehicle = 'skateboard', trace = null } = {}) {
  const map = data.maps[level.map];
  const ids = new Set(levelPickupIds(level, map));
  const session = createSession({ data, mapId: level.map, spawnId: level.spawn, vehicle, pickupFilter: (p) => ids.has(p.id) });
  const run = createRun({ mode: 'level', mapId: level.map, levelId: level.id });
  const profile = defaultSave(0);
  let lr = createLevelRun(level);
  const flat = [];
  const expand = (list) => {
    for (const t of list) {
      if (t.repeat) for (let i = 0; i < t.repeat; i++) expand(t.tasks);
      else flat.push({ ...t });
    }
  };
  expand(tasks);
  let ti = 0;
  let phase = 0;
  let timer = 0;
  const events = [];
  const dt = 1 / 60;
  const limit = maxSeconds ?? level.timeLimit + 1;
  for (let tick = 0; tick < limit * 60 && lr.status === 'running'; tick++) {
    const b = session.body;
    const f = emptyFrame();
    const task = flat[ti];
    const sp = speedOf(b);
    if (session.grind) {
      f.steer = -Math.max(-1, Math.min(1, session.grind.balance * 3));
    } else if (task && b.state === 'ride') {
      if (task.goto) {
        const [x, z] = task.goto;
        const dist = Math.hypot(x - b.pos.x, z - b.pos.z);
        const { steer, err } = steerToward(b, x, z);
        // Slow down to turn tightly when the target is close or behind.
        let want = task.speed ?? 8;
        if (Math.abs(err) > 0.5) want = Math.min(want, Math.max(2, dist * 1.2));
        if (Math.abs(err) > 1.0) want = Math.min(want, 4);
        f.steer = steer;
        if (sp > want + 1.5) f.brake = true;
        else if (sp < want) f.forward = true;
        if (dist < (task.tol ?? 2.5)) {
          ti++;
          phase = 0;
        }
      } else if (task.trick) {
        if (phase === 0) {
          if (sp < 6) f.forward = true;
          else {
            f.pressed.ollie = true;
            phase = 1;
            timer = 0;
          }
        } else if (phase === 2) {
          ti++;
          phase = 0;
        }
      } else if (task.grind || task.line) {
        // A "line" task is a grind approach without the ollie: line up and ride from -> to.
        const g = task.grind || task.line;
        const [fx, fz] = g.from;
        const [tx, tz] = g.to;
        const L = Math.hypot(tx - fx, tz - fz);
        const dx = (tx - fx) / L;
        const dz = (tz - fz) / L;
        const along = (b.pos.x - fx) * dx + (b.pos.z - fz) * dz;
        if (phase === 0 || phase === 4) {
          // Line up behind the approach point: first 9 m back, then 4 m back (configurable).
          const [far, near] = g.back || [9, 4];
          const back = phase === 0 ? far : near;
          const lx = fx - dx * back;
          const lz = fz - dz * back;
          const dist = Math.hypot(lx - b.pos.x, lz - b.pos.z);
          const { steer, err } = steerToward(b, lx, lz);
          let want = 6;
          if (Math.abs(err) > 0.5) want = Math.min(want, Math.max(2, dist * 1.2));
          if (Math.abs(err) > 1.0) want = Math.min(want, 3);
          f.steer = steer;
          if (sp > want + 1.5) f.brake = true;
          else if (sp < want) f.forward = true;
          if (dist < (phase === 0 ? 2 : 1.2)) phase = phase === 0 ? 4 : 1;
        } else if (phase === 1) {
          // Follow the line toward the rail, then ollie at `ollieAt` meters past the approach point.
          const ax = fx + dx * (along + 3);
          const az = fz + dz * (along + 3);
          const st = steerToward(b, ax, az);
          f.steer = st.steer;
          if (Math.abs(st.err) > 0.4) {
            if (sp > 3) f.brake = true;
          } else if (sp < (g.speed ?? 7)) f.forward = true;
          if (task.grind && along >= g.ollieAt) {
            f.pressed.ollie = true;
            phase = 3;
          } else if (task.line && along >= L) {
            phase = 3;
          }
        } else if (phase === 3) {
          ti++;
          phase = 0;
        }
      } else {
        ti++;
      }
    } else if (task && task.trick && phase === 1 && b.state === 'air') {
      timer++;
      if (task.trick === 'kickflip' && timer === 3) f.pressed.forward = true;
      if (task.trick === '360') f.left = timer < 20;
    }
    if (task && task.trick && phase === 1 && b.state === 'ride' && timer > 3) phase = 2;
    if (b.state === 'bail') phase = Math.min(phase, task && task.grind ? 0 : phase);

    if (trace) trace({ tick, ti, phase, task, b, f, session });
    session.step(dt, f);
    for (const e of session.drainEvents()) {
      if (e.type === 'bail') e.at = `${b.pos.x.toFixed(1)},${b.pos.z.toFixed(1)} task ${ti}`;
      events.push(e);
      applyEvent(run, profile, e);
    }
    tickRun(run, profile, dt, { inTrick: b.state === 'air' || b.state === 'grind' });
    const r = updateLevelRun(
      lr,
      level,
      map,
      { score: run.score.score, tricks: run.score.tricks, pickups: run.pickups.length, grindDistance: run.grindDistance, pos: b.pos },
      dt,
    );
    lr = r.run;
    events.push(...r.events);
    if (ti >= flat.length && lr.status === 'running' && level.objective.type !== 'score' && level.objective.type !== 'tricks') {
      // Out of tasks: just coast until the level ends.
    }
  }
  return { levelRun: lr, run, events, session };
}

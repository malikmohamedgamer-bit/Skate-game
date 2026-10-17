// Trick detection: spin/flip tracking, grabs, landing evaluation and naming.
// Pure functions (no DOM / Three.js). Data comes from src/data/tricks.json.
//
// Rotation model (accessibility-friendly "commit" rotation):
//   * Holding Left/Right in the air spins the body (yaw). On release the spin keeps
//     going until it reaches the next multiple of 180 degrees.
//   * Each press of Up/Down commits one full 360 flip (pitch axis). Holding keeps
//     adding flips.
//   * With the trick modifier held, Left/Right commits a board-only spin
//     (shove-it on a skateboard, tailwhip on a scooter) and Up/Down/none grabs.
// So a trick bails only if you run out of airtime mid-rotation (or land crooked).

export const AXES = ['yaw', 'pitch', 'board'];

export function createAirTricks({ fakie = false, ollied = false, fromGrind = false, vert = false } = {}) {
  return {
    yawDeg: 0,
    yawTarget: 0,
    pitchDeg: 0,
    pitchTarget: 0,
    flipDir: 0,
    boardYawDeg: 0,
    boardDir: 0,
    boardTarget: 0,
    grab: null,
    grabTime: 0,
    grabs: [],
    airTime: 0,
    fakie,
    ollied,
    fromGrind,
    vert,
    maxAbsYaw: 0,
  };
}

function approach(cur, target, step) {
  if (Math.abs(target - cur) <= step) return target;
  return cur + Math.sign(target - cur) * step;
}

/** Next multiple of `unit` in direction `dir` from `v` (strictly beyond when exactly on one). */
export function nextMultiple(v, unit, dir) {
  const k = v / unit;
  const eps = 1e-6;
  if (dir > 0) return (Math.floor(k + eps) + 1) * unit;
  return (Math.ceil(k - eps) - 1) * unit;
}

/**
 * Advance trick rotations by one tick.
 * input: { left, right, forward, back, trick, pressed: {left,right,forward,back,trick} }
 * vstats: vehicle stats (spinRate, flipRate, boardSpinRate, boardSpinUnit)
 */
export function stepAirTricks(t, input, vstats, dt, grabKeys) {
  t.airTime += dt;
  const mod = !!input.trick;
  const lr = (input.left ? 1 : 0) - (input.right ? 1 : 0); // +1 = left (positive yaw)

  // Body spin (yaw).
  if (!mod && lr !== 0) {
    t.yawDeg += lr * vstats.spinRate * dt;
    t.yawTarget = nextMultiple(t.yawDeg, 180, lr);
    // If we just crossed the old target while holding, the new target is ahead of us.
  } else {
    t.yawDeg = approach(t.yawDeg, t.yawTarget, vstats.spinRate * dt);
  }
  t.maxAbsYaw = Math.max(t.maxAbsYaw, Math.abs(t.yawDeg));

  // Flips (pitch). Each press commits one 360; holding the same direction keeps flipping.
  // Input in the other direction is ignored once a flip direction is committed.
  if (!mod) {
    const fdir = input.pressed.forward ? 1 : input.pressed.back ? -1 : 0;
    if (fdir !== 0 && (t.flipDir === 0 || t.flipDir === fdir)) {
      t.flipDir = fdir;
      t.pitchTarget += 360 * fdir;
    }
    const hold = input.forward ? 1 : input.back ? -1 : 0;
    if (hold !== 0 && hold === t.flipDir && Math.abs(t.pitchTarget - t.pitchDeg) < 90) t.pitchTarget += 360 * hold;
  }
  t.pitchDeg = approach(t.pitchDeg, t.pitchTarget, vstats.flipRate * dt);

  // Board-only spins (shove-it / tailwhip), same commit rules as flips.
  if (mod) {
    const bdir = input.pressed.left ? 1 : input.pressed.right ? -1 : 0;
    if (bdir !== 0 && (t.boardDir === 0 || t.boardDir === bdir)) {
      t.boardDir = bdir;
      t.boardTarget += vstats.boardSpinUnit * bdir;
    }
    if (lr !== 0 && lr === t.boardDir && Math.abs(t.boardTarget - t.boardYawDeg) < vstats.boardSpinUnit * 0.25) {
      t.boardTarget += vstats.boardSpinUnit * lr;
    }
  }
  t.boardYawDeg = approach(t.boardYawDeg, t.boardTarget, vstats.boardSpinRate * dt);

  // Grabs: modifier held without left/right.
  if (mod && lr === 0) {
    if (!t.grab) {
      const key = input.forward ? 'forward' : input.back ? 'back' : 'none';
      t.grab = grabKeys ? grabKeys[key] : key;
      t.grabTime = 0;
    }
    t.grabTime += dt;
  } else if (t.grab) {
    t.grabs.push({ type: t.grab, time: t.grabTime });
    t.grab = null;
    t.grabTime = 0;
  }
  return t;
}

/** Release any held grab (on landing / grind). */
export function releaseGrab(t) {
  if (t.grab) {
    t.grabs.push({ type: t.grab, time: t.grabTime, late: true });
    t.grab = null;
    t.grabTime = 0;
  }
}

export function residual(deg, unit) {
  return Math.abs(deg - Math.round(deg / unit) * unit);
}

/**
 * Decide whether a landing is clean.
 * ctx: { headingErrDeg, rollDeg, horizSpeed }
 * cfg: physics.landing; vstats for the board spin unit.
 */
export function evaluateLanding(t, ctx, cfg, vstats, { forgiving = false, ignoreHeading = false } = {}) {
  const m = forgiving ? cfg.forgivingMultiplier : 1;
  const r = {
    yaw: residual(t.yawDeg, 180),
    pitch: residual(t.pitchDeg, 360),
    board: residual(t.boardYawDeg, vstats.boardSpinUnit),
    heading: Math.abs(ctx.headingErrDeg || 0),
    roll: Math.abs(ctx.rollDeg || 0),
  };
  let reason = null;
  if (r.pitch > cfg.flipTolerance * m) reason = 'under-rotated flip';
  else if (r.yaw > cfg.spinTolerance * m) reason = 'under-rotated spin';
  else if (r.board > cfg.boardSpinTolerance * m) reason = vstats.boardSpinUnit === 360 ? 'incomplete tailwhip' : 'incomplete shove-it';
  else if (!ignoreHeading && (ctx.horizSpeed ?? 2) > 1 && r.heading > cfg.headingTolerance * m) reason = 'landed sideways';
  else if (r.roll > cfg.rollTolerance * m) reason = 'landed on a tilt';
  else if (t.grab && !forgiving && t.grabTime > 0.2) reason = 'still grabbing';
  return { clean: reason === null, reason, residuals: r };
}

function spinPrefix(data, deg) {
  const amount = Math.round(Math.abs(deg) / 180) * 180;
  if (amount === 0) return { text: '', points: 0, amount: 0 };
  const table = data.spins;
  const keys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  const use = keys.includes(amount) ? amount : keys[keys.length - 1];
  const extra = amount > use ? Math.round(((amount - use) / 180) * 400) : 0;
  const dir = deg > 0 ? data.spinLeft : data.spinRight;
  return { text: `${dir} ${amount}`, points: table[use] + extra, amount };
}

function flipPart(data, deg) {
  const count = Math.round(Math.abs(deg) / 360);
  if (count === 0) return null;
  const dir = deg > 0 ? 'up' : 'down';
  const list = data.flips[dir];
  const idx = Math.min(count, list.length) - 1;
  const extra = count > list.length ? (count - list.length) * 600 : 0;
  const name = count > list.length ? `${count}x ${list[0].name}` : list[idx].name;
  return { dir, count, name, points: list[idx].points + extra };
}

function boardPart(data, deg, unit) {
  const amount = Math.round(Math.abs(deg) / unit) * unit;
  if (amount === 0) return null;
  const keys = Object.keys(data.boardSpins)
    .map(Number)
    .sort((a, b) => a - b);
  const use = keys.includes(amount) ? amount : keys[keys.length - 1];
  const e = data.boardSpins[use];
  const extra = amount > use ? Math.round(((amount - use) / unit) * 300) : 0;
  return { amount, name: amount > use ? `${amount} ${e.name}` : e.name, points: e.points + extra };
}

/**
 * Name and base points for an air trick (before combo multiplier and vehicle bonus).
 * Returns null when nothing trick-worthy happened (e.g. rolling off a curb).
 */
export function describeTrick(t, trickData, vehicle, { minAirTime = 0.25, includeOllie = true } = {}) {
  const data = trickData[vehicle];
  const vunit = vehicle === 'scooter' ? 360 : 180;
  const parts = [];
  let points = 0;
  const spin = spinPrefix(data, t.yawDeg);
  const flip = flipPart(data, t.pitchDeg);
  const board = boardPart(data, t.boardYawDeg, vunit);
  const grabs = t.grabs.filter((g) => g.time >= (trickData.minGrabTime ?? 0.15));
  let main = '';
  if (flip && board) {
    const combo = (data.combos || []).find((c) => c.flip === flip.dir && c.count === flip.count && c.board === board.amount);
    if (combo) {
      main = combo.name;
      points += combo.points;
      parts.push('combo');
    } else {
      main = `${board.name} ${flip.name}`;
      points += board.points + flip.points;
      parts.push('board', 'flip');
    }
  } else if (flip) {
    main = flip.name;
    points += flip.points;
    parts.push('flip');
  } else if (board) {
    main = board.name;
    points += board.points;
    parts.push('board');
  }
  if (spin.amount) {
    points += spin.points;
    parts.push('spin');
  }
  const grabNames = [];
  for (const g of grabs) {
    const gd = data.grabs[g.type];
    if (!gd) continue;
    grabNames.push(gd.name);
    points += gd.points + Math.round(gd.perSecond * g.time);
  }
  if (grabNames.length) parts.push('grab');

  if (parts.length === 0) {
    if (t.airTime < minAirTime) return null;
    if (t.ollied && includeOllie) {
      main = data.ollie.name;
      points += data.ollie.points;
      parts.push('ollie');
    } else if (t.airTime >= 0.6) {
      main = data.air.name;
      points += data.air.points;
      parts.push('air');
    } else return null;
  } else if (t.ollied) {
    points += Math.round(data.ollie.points / 2);
  }
  const words = [];
  if (t.fakie) words.push('Fakie');
  if (spin.text) words.push(spin.text);
  if (main) words.push(main);
  if (grabNames.length) words.push(grabNames.join(' to '));
  points += Math.round(t.airTime * (trickData.airTimeBonusPerSecond ?? 0));
  return {
    name: words.join(' '),
    points: Math.round(points),
    parts,
    spin: spin.amount * Math.sign(t.yawDeg || 1),
    flips: flip ? flip.count * (flip.dir === 'up' ? 1 : -1) : 0,
    board: board ? board.amount : 0,
    grabs: grabNames,
  };
}

/** Grind category from the angle (deg, 0..90) between board and rail. */
export function grindCategory(angleDeg, trickData) {
  const a = Math.abs(angleDeg);
  if (a <= trickData.grindAngles.aligned) return 'aligned';
  if (a <= trickData.grindAngles.angled) return 'angled';
  return 'perpendicular';
}

export function grindName(trickData, vehicle, category, ledge = false) {
  const table = ledge ? trickData[vehicle].ledgeGrinds : trickData[vehicle].grinds;
  return table[category];
}

/** Every distinct trick name the generator can produce for a vehicle (used in tests and docs). */
export function enumerateTrickNames(trickData, vehicle) {
  const names = new Set();
  const unit = vehicle === 'scooter' ? 360 : 180;
  const data = trickData[vehicle];
  const grabKeys = Object.keys(data.grabs);
  const spins = [0, 180, -180, 360, -360, 540, -540, 720, -720];
  const flips = [0, 360, -360, 720, -720, 1080, -1080];
  const boards = [0, unit, unit * 2, unit * 3];
  for (const y of spins)
    for (const p of flips)
      for (const b of boards)
        for (const g of [null, ...grabKeys]) {
          const t = createAirTricks({ ollied: true });
          t.yawDeg = y;
          t.pitchDeg = p;
          t.boardYawDeg = b;
          t.airTime = 0.8;
          if (g) t.grabs.push({ type: g, time: 0.3 });
          const d = describeTrick(t, trickData, vehicle);
          if (d) names.add(d.name);
        }
  for (const k of ['grinds', 'ledgeGrinds']) for (const c of Object.values(data[k])) names.add(c.name);
  return [...names];
}

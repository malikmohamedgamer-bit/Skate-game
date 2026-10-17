// Levels: objectives, star ratings and unlocking. Pure functions.
//
// Objective types (src/data/levels.json):
//   score          reach N points          (stars at 3 thresholds, higher is better)
//   tricks         land N clean tricks
//   pickups        collect N pickups
//   grindDistance  grind N meters in total
//   timeTrial      pass the checkpoints in order (stars at 3 max times, lower is better)
// A level ends when its time limit runs out or the 3-star target is reached.
// It is complete with >= 1 star; otherwise it is failed.
// Unlocking: levels need their map unlocked (map.unlock.stars total stars) and
// optional { totalStars } and/or { level, levelStars } (stars on a previous level, default 1).

export const OBJECTIVE_TYPES = ['score', 'tricks', 'pickups', 'timeTrial', 'grindDistance'];

const LOWER_IS_BETTER = new Set(['timeTrial']);

/** Validate one level definition against the maps. Returns a list of problems. */
export function validateLevel(def, maps, allIds = []) {
  const errs = [];
  const p = (m) => errs.push(`level "${def.id}": ${m}`);
  if (!def.id) p('missing id');
  if (!def.name) p('missing name');
  const map = maps[def.map];
  if (!map) p(`unknown map "${def.map}"`);
  const o = def.objective || {};
  if (!OBJECTIVE_TYPES.includes(o.type)) p(`unknown objective type "${o.type}"`);
  if (!Array.isArray(o.stars) || o.stars.length !== 3 || o.stars.some((x) => !Number.isFinite(x) || x <= 0)) p('objective.stars needs 3 positive numbers');
  else if (LOWER_IS_BETTER.has(o.type) ? !(o.stars[0] >= o.stars[1] && o.stars[1] >= o.stars[2]) : !(o.stars[0] <= o.stars[1] && o.stars[1] <= o.stars[2]))
    p('objective.stars must get harder from 1 to 3 stars');
  if (!(def.timeLimit > 0)) p('timeLimit must be > 0');
  if (map) {
    if (def.spawn && !map.spawns.some((s) => s.id === def.spawn)) p(`unknown spawn "${def.spawn}"`);
    if (o.type === 'timeTrial') {
      if (!Array.isArray(o.checkpoints) || !o.checkpoints.length) p('timeTrial needs checkpoints');
      else for (const c of o.checkpoints) if (!map.checkpoints.some((x) => x.id === c)) p(`unknown checkpoint "${c}"`);
      if (o.stars && def.timeLimit < o.stars[0]) p('timeLimit is shorter than the 1-star time');
    }
    if (o.type === 'pickups') {
      const n = levelPickupIds(def, map).length;
      if (o.stars && o.stars[2] > n) p(`3-star target ${o.stars[2]} exceeds the ${n} pickups available`);
    }
    if (Array.isArray(def.pickups)) for (const id of def.pickups) if (!map.pickups.some((x) => x.id === id)) p(`unknown pickup "${id}"`);
  }
  if (def.unlock && def.unlock.level && !allIds.includes(def.unlock.level)) p(`unlock refers to unknown level "${def.unlock.level}"`);
  return errs;
}

export function validateLevels(levels, maps) {
  const ids = levels.map((l) => l.id);
  const errs = [];
  if (new Set(ids).size !== ids.length) errs.push('duplicate level ids');
  for (const l of levels) errs.push(...validateLevel(l, maps, ids));
  return errs;
}

export function levelPickupIds(def, map) {
  if (def.pickups === 'all') return map.pickups.map((p) => p.id);
  if (Array.isArray(def.pickups)) return def.pickups.slice();
  return [];
}

/** Stars (0..3) for a final objective value. */
export function starsFor(def, value) {
  const s = def.objective.stars;
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  if (LOWER_IS_BETTER.has(def.objective.type)) return value <= s[2] ? 3 : value <= s[1] ? 2 : value <= s[0] ? 1 : 0;
  return value >= s[2] ? 3 : value >= s[1] ? 2 : value >= s[0] ? 1 : 0;
}

export function createLevelRun(def) {
  return { id: def.id, time: 0, status: 'running', value: 0, checkpointIndex: 0, stars: 0, finishTime: null };
}

/**
 * Advance a level run. `stats` = { score, tricks, pickups, grindDistance, pos: {x,z} }.
 * Returns { run, events } (pure: input run is not mutated).
 */
export function updateLevelRun(lr, def, map, stats, dt) {
  if (lr.status !== 'running') return { run: lr, events: [] };
  const events = [];
  const run = { ...lr, time: lr.time + dt };
  const o = def.objective;
  if (o.type === 'timeTrial') {
    const cpId = o.checkpoints[run.checkpointIndex];
    const cp = map.checkpoints.find((c) => c.id === cpId);
    if (cp && Math.hypot(stats.pos.x - cp.x, stats.pos.z - cp.z) <= cp.radius) {
      run.checkpointIndex++;
      events.push({ type: 'checkpoint', id: cp.id, index: run.checkpointIndex, total: o.checkpoints.length, time: run.time });
      if (run.checkpointIndex >= o.checkpoints.length) {
        run.finishTime = run.time;
        run.value = run.time;
        run.stars = starsFor(def, run.time);
        run.status = run.stars > 0 ? 'complete' : 'failed';
        events.push({ type: run.status === 'complete' ? 'levelComplete' : 'levelFailed', stars: run.stars, value: run.value });
        return { run, events };
      }
    }
    if (run.time >= def.timeLimit) {
      run.status = 'failed';
      run.stars = 0;
      run.value = null;
      events.push({ type: 'levelFailed', stars: 0, value: null, reason: 'time' });
    }
    return { run, events };
  }
  const value = o.type === 'score' ? stats.score : o.type === 'tricks' ? stats.tricks : o.type === 'pickups' ? stats.pickups : stats.grindDistance;
  run.value = value;
  run.stars = starsFor(def, value);
  if (run.stars === 3 || run.time >= def.timeLimit) {
    run.status = run.stars > 0 ? 'complete' : 'failed';
    events.push({ type: run.status === 'complete' ? 'levelComplete' : 'levelFailed', stars: run.stars, value, reason: run.stars === 3 ? 'target' : 'time' });
  }
  return { run, events };
}

/** Human-readable objective and progress text for the HUD. */
export function objectiveText(def, lr) {
  const o = def.objective;
  const s = o.stars;
  const remaining = Math.max(0, def.timeLimit - (lr ? lr.time : 0));
  const next = lr ? Math.min(3, starsFor(def, lr.value ?? (o.type === 'timeTrial' ? Infinity : 0)) + 1) : 1;
  switch (o.type) {
    case 'score':
      return { title: 'Score points', progress: `${Math.round(lr?.value || 0).toLocaleString('en-US')} / ${s[next - 1].toLocaleString('en-US')}`, remaining };
    case 'tricks':
      return { title: 'Land clean tricks', progress: `${lr?.value || 0} / ${s[next - 1]}`, remaining };
    case 'pickups':
      return { title: 'Collect bolts', progress: `${lr?.value || 0} / ${s[next - 1]}`, remaining };
    case 'grindDistance':
      return { title: 'Grind distance', progress: `${(lr?.value || 0).toFixed(1)} m / ${s[next - 1]} m`, remaining };
    case 'timeTrial':
      return {
        title: 'Reach the checkpoints',
        progress: `Checkpoint ${Math.min((lr?.checkpointIndex || 0) + 1, o.checkpoints.length)} of ${o.checkpoints.length} · ★ ${s[0]}s ★★ ${s[1]}s ★★★ ${s[2]}s`,
        remaining,
      };
    default:
      return { title: '', progress: '', remaining };
  }
}

export function describeObjective(def) {
  const o = def.objective;
  const s = o.stars;
  switch (o.type) {
    case 'score':
      return `Score ${s.map((x) => x.toLocaleString('en-US')).join(' / ')} points in ${def.timeLimit}s`;
    case 'tricks':
      return `Land ${s.join(' / ')} clean tricks in ${def.timeLimit}s`;
    case 'pickups':
      return `Collect ${s.join(' / ')} bolts in ${def.timeLimit}s`;
    case 'grindDistance':
      return `Grind ${s.join(' / ')} m in ${def.timeLimit}s`;
    case 'timeTrial':
      return `Reach ${o.checkpoints.length} checkpoint${o.checkpoints.length > 1 ? 's' : ''} in ${s.join(' / ')}s`;
    default:
      return '';
  }
}

export function totalStars(levelProgress) {
  let n = 0;
  for (const l of Object.values(levelProgress || {})) n += l.bestStars || 0;
  return n;
}

export function isMapUnlocked(map, levelProgress) {
  return totalStars(levelProgress) >= (map.unlock?.stars || 0);
}

/** Returns { unlocked, reason } where reason explains what is missing. */
export function levelUnlockState(def, maps, levelProgress, levelsById = {}) {
  const map = maps[def.map];
  const have = totalStars(levelProgress);
  if (map && !isMapUnlocked(map, levelProgress)) return { unlocked: false, reason: `Earn ${map.unlock.stars} ★ total to unlock ${map.name} (you have ${have})` };
  const u = def.unlock || {};
  if (u.totalStars && have < u.totalStars) return { unlocked: false, reason: `Earn ${u.totalStars} ★ total (you have ${have})` };
  if (u.level) {
    const need = u.levelStars ?? 1;
    const best = levelProgress?.[u.level]?.bestStars || 0;
    if (best < need) {
      const name = levelsById[u.level]?.name || u.level;
      return { unlocked: false, reason: `Get ${need} ★ on "${name}" first` };
    }
  }
  return { unlocked: true, reason: null };
}

/**
 * Record a finished level. Returns { levels, prevStars, stars, improved }
 * (new object; input not mutated).
 */
export function recordLevelResult(levelProgress, def, result) {
  const prev = levelProgress?.[def.id] || { bestStars: 0, bestScore: 0, bestTime: null, completed: false };
  const stars = result.stars || 0;
  const next = {
    bestStars: Math.max(prev.bestStars, stars),
    bestScore: Math.max(prev.bestScore, result.score || 0),
    bestTime:
      def.objective.type === 'timeTrial' && stars > 0 && Number.isFinite(result.value) ? (prev.bestTime === null ? result.value : Math.min(prev.bestTime, result.value)) : prev.bestTime,
    completed: prev.completed || stars > 0,
  };
  return { levels: { ...levelProgress, [def.id]: next }, prevStars: prev.bestStars, stars, improved: stars > prev.bestStars };
}

/** The next level in data order after `id` (or null). */
export function nextLevel(levels, id) {
  const i = levels.findIndex((l) => l.id === id);
  return i >= 0 && i + 1 < levels.length ? levels[i + 1] : null;
}

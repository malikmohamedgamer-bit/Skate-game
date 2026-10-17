// Quests: definitions, progress, completion and rewards. Pure functions (no
// mutation of inputs; each returns a new state).
//
// State shape (stored in the save under `quests`):
//   { progress: { [id]: { progress, completed, rewarded, seen?: [mapIds], day? } },
//     daily: { day: 'YYYY-MM-DD' | null, ids: [questIds] } }
//
// Rules:
//   story     ordered chain; only the first unfinished story quest is active.
//   daily     `dailyPerDay` quests are picked from the pool for each local day
//             (device clock); their progress resets when the day changes.
//   challenge one-time; always active until completed.
// Rewards are granted exactly once per completion (`rewarded` flag); a daily
// quest can be earned again on a later day.

export const QUEST_TYPES = ['story', 'daily', 'challenge'];
export const GOAL_KINDS = ['cleanTricks', 'speed', 'grindSeconds', 'combo', 'pickups', 'finishLevel', 'buyItem', 'visitMap', 'runScore', 'airTime'];

/** Max-style goals keep the best value; count-style goals add up. */
const MAX_KINDS = new Set(['speed', 'combo', 'runScore', 'airTime']);

export function emptyQuestState() {
  return { progress: {}, daily: { day: null, ids: [] } };
}

/** Local calendar day key from a Date (device clock). */
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministically choose today's daily quests. */
export function pickDailyIds(defs, day, count = 3) {
  const pool = defs.filter((q) => q.type === 'daily').map((q) => q.id);
  const scored = pool.map((id) => ({ id, k: hashString(`${day}|${id}`) }));
  scored.sort((a, b) => a.k - b.k || (a.id < b.id ? -1 : 1));
  return scored.slice(0, Math.min(count, pool.length)).map((x) => x.id);
}

function cloneState(state) {
  const s = state && typeof state === 'object' ? state : emptyQuestState();
  const progress = {};
  for (const [k, v] of Object.entries(s.progress || {})) progress[k] = { ...v, ...(v.seen ? { seen: [...v.seen] } : {}) };
  return { progress, daily: { day: s.daily?.day ?? null, ids: [...(s.daily?.ids || [])] } };
}

/** On a new day: pick new dailies and reset daily progress. */
export function refreshDaily(state, defs, day, count = 3) {
  const s = cloneState(state);
  if (s.daily.day === day && s.daily.ids.length) return s;
  for (const q of defs) if (q.type === 'daily') delete s.progress[q.id];
  s.daily = { day, ids: pickDailyIds(defs, day, count) };
  return s;
}

export function entryOf(state, id) {
  return state.progress[id] || { progress: 0, completed: false, rewarded: false };
}

/** The story quest currently in play (first unfinished in order), or null. */
export function currentStory(state, defs) {
  const chain = defs.filter((q) => q.type === 'story').sort((a, b) => a.order - b.order);
  return chain.find((q) => !entryOf(state, q.id).completed) || null;
}

/** Quests that can make progress right now. */
export function activeQuestIds(state, defs) {
  const ids = [];
  const story = currentStory(state, defs);
  if (story) ids.push(story.id);
  for (const id of state.daily.ids) if (!entryOf(state, id).completed) ids.push(id);
  for (const q of defs) if (q.type === 'challenge' && !entryOf(state, q.id).completed) ids.push(q.id);
  return ids;
}

/** Does a gameplay event count toward a goal? Returns the amount (or value for max goals), or null. */
export function eventAmount(goal, e) {
  switch (goal.kind) {
    case 'cleanTricks':
      if (e.type !== 'trick') return null;
      if (goal.vehicle && e.vehicle !== goal.vehicle) return null;
      if (goal.map && e.map !== goal.map) return null;
      if (goal.grind === true && !e.grind) return null;
      if (goal.grind === false && e.grind) return null;
      if (goal.spin && !e.spin) return null;
      if (goal.trickIncludes && !String(e.name || '').toLowerCase().includes(goal.trickIncludes.toLowerCase())) return null;
      return 1;
    case 'speed':
      return e.type === 'speed' && (!goal.map || e.map === goal.map) ? e.kmh : null;
    case 'grindSeconds':
      return e.type === 'grind' ? e.seconds : null;
    case 'combo':
      return e.type === 'combo' ? e.count : null;
    case 'pickups':
      return e.type === 'pickup' && (!goal.map || e.map === goal.map) ? 1 : null;
    case 'finishLevel':
      if (e.type !== 'levelFinished') return null;
      if (goal.level && e.levelId !== goal.level) return null;
      if ((e.stars || 0) < (goal.stars || 1)) return null;
      return 1;
    case 'buyItem':
      if (e.type !== 'itemBought') return null;
      if (goal.category && e.category !== goal.category) return null;
      return 1;
    case 'visitMap':
      if (e.type !== 'mapVisited') return null;
      if (goal.map && e.mapId !== goal.map) return null;
      if (goal.maps && !goal.maps.includes(e.mapId)) return null;
      return 1;
    case 'runScore':
      return e.type === 'runScore' ? e.score : null;
    case 'airTime':
      return e.type === 'trick' && !e.grind && e.airTime ? e.airTime : null;
    default:
      return null;
  }
}

/**
 * Apply one gameplay event to all active quests.
 * Returns { state, completed: [questIds newly completed] }.
 */
export function applyQuestEvent(state, defs, e) {
  const s = cloneState(state);
  const completed = [];
  const byId = Object.fromEntries(defs.map((q) => [q.id, q]));
  // Completing a story quest activates the next one, which may also react to
  // this same event only from the next event onward (ordered chain).
  for (const id of activeQuestIds(s, defs)) {
    const q = byId[id];
    if (!q) continue;
    const amt = eventAmount(q.goal, e);
    if (amt === null || !(amt > 0)) continue;
    const cur = entryOf(s, id);
    const next = { ...cur, ...(cur.seen ? { seen: [...cur.seen] } : {}) };
    if (q.goal.kind === 'visitMap' && (q.goal.maps || q.goal.target > 1)) {
      const seen = new Set(next.seen || []);
      seen.add(e.mapId);
      next.seen = [...seen];
      next.progress = next.seen.length;
    } else if (MAX_KINDS.has(q.goal.kind)) {
      next.progress = Math.max(cur.progress || 0, amt);
    } else {
      next.progress = (cur.progress || 0) + amt;
    }
    if (q.type === 'daily') next.day = s.daily.day;
    if (!next.completed && next.progress >= q.goal.target) {
      next.completed = true;
      completed.push(id);
    }
    s.progress[id] = next;
  }
  return { state: s, completed };
}

/**
 * Grant rewards for completed, unrewarded quests (each exactly once).
 * Returns { state, bolts, claimed: [ids] }.
 */
export function claimRewards(state, defs) {
  const s = cloneState(state);
  let bolts = 0;
  const claimed = [];
  for (const q of defs) {
    const e = s.progress[q.id];
    if (e && e.completed && !e.rewarded) {
      s.progress[q.id] = { ...e, rewarded: true };
      bolts += Math.max(0, Math.floor(q.reward || 0));
      claimed.push(q.id);
    }
  }
  return { state: s, bolts, claimed };
}

/**
 * Bring "world state" quests up to date with facts from the profile (maps already
 * visited, level stars already earned) so an activated quest is not impossible.
 */
export function syncQuestsWithProfile(state, allDefs, { visitedMaps = [], levels = {} } = {}) {
  // Dailies only count what you do today, so they are never caught up from history.
  const defs = allDefs.filter((q) => q.type !== 'daily');
  let s = cloneState(state);
  const all = [];
  for (const m of visitedMaps) {
    const r = applyQuestEvent(s, defs, { type: 'mapVisited', mapId: m });
    s = r.state;
    all.push(...r.completed);
  }
  for (const [levelId, l] of Object.entries(levels)) {
    if (!l || !(l.bestStars > 0)) continue;
    const r = applyQuestEvent(s, defs, { type: 'levelFinished', levelId, stars: l.bestStars });
    s = r.state;
    all.push(...r.completed);
  }
  return { state: s, completed: all };
}

export function formatProgress(q, entry) {
  const p = Math.min(entry.progress || 0, q.goal.target);
  if (q.goal.kind === 'grindSeconds' || q.goal.kind === 'airTime') return `${p.toFixed(1)} / ${q.goal.target} s`;
  if (q.goal.kind === 'speed') return `${Math.floor(p)} / ${q.goal.target} km/h`;
  if (q.goal.kind === 'runScore') return `${Math.floor(p).toLocaleString('en-US')} / ${q.goal.target.toLocaleString('en-US')}`;
  return `${Math.floor(p)} / ${q.goal.target}`;
}

/** Quest list for the log and the HUD tracker. */
export function questView(state, defs) {
  const active = new Set(activeQuestIds(state, defs));
  const story = currentStory(state, defs);
  return defs
    .filter((q) => q.type !== 'daily' || state.daily.ids.includes(q.id))
    .map((q) => {
      const e = entryOf(state, q.id);
      let status = e.completed ? 'done' : active.has(q.id) ? 'active' : 'locked';
      if (q.type === 'story' && !e.completed && story && q.id !== story.id) status = 'locked';
      return { id: q.id, type: q.type, title: q.title, description: q.description, reward: q.reward, status, rewarded: !!e.rewarded, progressText: formatProgress(q, e), fraction: Math.min(1, (e.progress || 0) / q.goal.target) };
    });
}

export function validateQuests(defs, { levels = [], maps = {} } = {}) {
  const errs = [];
  const ids = new Set();
  const levelIds = new Set(levels.map((l) => l.id));
  for (const q of defs) {
    const p = (m) => errs.push(`quest "${q.id}": ${m}`);
    if (ids.has(q.id)) p('duplicate id');
    ids.add(q.id);
    if (!QUEST_TYPES.includes(q.type)) p(`bad type ${q.type}`);
    if (!q.goal || !GOAL_KINDS.includes(q.goal.kind)) p(`bad goal kind ${q.goal && q.goal.kind}`);
    else if (!(q.goal.target > 0)) p('goal.target must be > 0');
    if (!(q.reward > 0)) p('reward must be > 0');
    if (q.type === 'story' && !Number.isFinite(q.order)) p('story quests need an order');
    if (q.goal?.level && levels.length && !levelIds.has(q.goal.level)) p(`unknown level ${q.goal.level}`);
    if (q.goal?.map && Object.keys(maps).length && !maps[q.goal.map]) p(`unknown map ${q.goal.map}`);
    for (const m of q.goal?.maps || []) if (Object.keys(maps).length && !maps[m]) p(`unknown map ${m}`);
  }
  return errs;
}

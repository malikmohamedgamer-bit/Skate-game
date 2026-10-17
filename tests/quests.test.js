// Quest definitions, progress, completion, daily reset and one-time rewards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOAL_KINDS,
  activeQuestIds,
  applyQuestEvent,
  claimRewards,
  currentStory,
  dayKey,
  emptyQuestState,
  formatProgress,
  pickDailyIds,
  questView,
  refreshDaily,
  syncQuestsWithProfile,
  validateQuests,
} from '../src/game/quests.js';
import { questEvent } from '../src/game/progression.js';
import { createSaveStore, defaultSave, memoryStorage } from '../src/core/save.js';
import { loadData } from './helpers.js';

const data = await loadData();
const Q = data.quests;
const byId = Object.fromEntries(Q.map((q) => [q.id, q]));
const DAY = '2026-10-17';
const fresh = () => refreshDaily(emptyQuestState(), Q, DAY, data.questsPerDay);

function feed(state, events, defs = Q) {
  let s = state;
  const done = [];
  for (const e of events) {
    const r = applyQuestEvent(s, defs, e);
    s = r.state;
    done.push(...r.completed);
  }
  return { state: s, done };
}

test('at least 25 quests of all three types covering every required goal kind', () => {
  assert.ok(Q.length >= 25, `${Q.length} quests`);
  for (const t of ['daily', 'story', 'challenge']) assert.ok(Q.some((q) => q.type === t), t);
  const kinds = new Set(Q.map((q) => q.goal.kind));
  for (const k of ['cleanTricks', 'speed', 'grindSeconds', 'combo', 'pickups', 'finishLevel', 'buyItem', 'visitMap']) assert.ok(kinds.has(k), k);
  for (const k of kinds) assert.ok(GOAL_KINDS.includes(k));
});

test('shipped quest data is valid', () => {
  assert.deepEqual(validateQuests(Q, { levels: data.levels, maps: data.maps }), []);
  assert.ok(validateQuests([{ id: 'x', type: 'weekly', goal: { kind: 'dance', target: 0 }, reward: 0 }]).length >= 3);
});

test('day keys use the local device date', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 0, 6, 0, 1)), '2026-01-06');
});

test('daily quests: 3 per day, deterministic, change between days', () => {
  const a = pickDailyIds(Q, DAY, 3);
  assert.equal(a.length, 3);
  assert.deepEqual(pickDailyIds(Q, DAY, 3), a);
  assert.ok(a.every((id) => byId[id].type === 'daily'));
  const days = new Set();
  for (let d = 1; d <= 20; d++) days.add(pickDailyIds(Q, `2026-11-${String(d).padStart(2, '0')}`, 3).join(','));
  assert.ok(days.size > 5, 'rotates over days');
});

test('only the current story quest progresses (ordered chain)', () => {
  let s = fresh();
  assert.equal(currentStory(s, Q).id, 'story-01');
  // A trick does not advance story-02 while story-01 (speed) is unfinished.
  s = feed(s, [{ type: 'trick', name: 'Ollie' }]).state;
  assert.equal(s.progress['story-02'], undefined);
  const r = feed(s, [{ type: 'speed', kmh: 16 }]);
  assert.ok(r.done.includes('story-01'));
  assert.equal(currentStory(r.state, Q).id, 'story-02');
  const r2 = feed(r.state, [{ type: 'trick', name: 'Ollie' }, { type: 'trick', name: 'Ollie' }, { type: 'trick', name: 'Ollie' }]);
  assert.ok(r2.done.includes('story-02'));
});

test('progress kinds: counters add up, max goals keep the best, filters apply', () => {
  let s = fresh();
  s = feed(s, [{ type: 'grind', seconds: 25 }, { type: 'grind', seconds: 20 }]).state;
  assert.equal(s.progress['ch-grind-60'].progress, 45);
  s = feed(s, [{ type: 'combo', count: 7 }, { type: 'combo', count: 3 }]).state;
  assert.equal(s.progress['ch-combo-10'].progress, 7);
  const tre = feed(s, [{ type: 'trick', name: 'BS 180 Tre Flip' }]);
  assert.ok(tre.done.includes('ch-tre-flip'));
  s = feed(s, [{ type: 'trick', name: 'Ollie', vehicle: 'skateboard' }, { type: 'trick', name: 'Ollie', vehicle: 'scooter' }]).state;
  assert.equal(s.progress['ch-scooter'].progress, 1, 'vehicle filter');
  const air = feed(s, [{ type: 'trick', name: 'Air', airTime: 1.6 }]);
  assert.ok(air.done.includes('ch-big-air'));
});

test('visit-map quests count distinct maps', () => {
  let s = fresh();
  s = feed(s, ['neighborhood', 'neighborhood', 'skatepark', 'plaza'].map((m) => ({ type: 'mapVisited', mapId: m }))).state;
  assert.equal(s.progress['ch-all-maps'].progress, 3);
  const r = feed(s, [{ type: 'mapVisited', mapId: 'downtown' }]);
  assert.ok(r.done.includes('ch-all-maps'));
});

test('finish-level quests check the level and the stars', () => {
  const s = fresh();
  assert.equal(feed(s, [{ type: 'levelFinished', levelId: 'd1', stars: 1 }]).state.progress['story-12'], undefined, 'story-12 not active yet');
  const r = feed(s, [{ type: 'levelFinished', levelId: 'n2', stars: 3 }]);
  assert.ok(r.done.includes('ch-3stars'));
});

test('each quest rewards exactly once', () => {
  let s = fresh();
  s = feed(s, [{ type: 'speed', kmh: 20 }]).state;
  const c1 = claimRewards(s, Q);
  assert.equal(c1.bolts, byId['story-01'].reward);
  assert.deepEqual(c1.claimed, ['story-01']);
  const c2 = claimRewards(c1.state, Q);
  assert.equal(c2.bolts, 0);
  // More events after completion do not re-open or re-reward it.
  const again = feed(c2.state, [{ type: 'speed', kmh: 40 }]);
  assert.equal(again.state.progress['story-01'].rewarded, true);
  assert.equal(claimRewards(again.state, Q).claimed.includes('story-01'), false);
});

test('daily quests reset on a new day and can be earned again; others keep progress', () => {
  let s = refreshDaily(emptyQuestState(), Q, DAY, 3);
  const dailyId = s.daily.ids[0];
  const goal = byId[dailyId].goal;
  const ev = {
    cleanTricks: { type: 'trick', name: goal.trickIncludes ? 'Kickflip' : 'FS 180', spin: true },
    grindSeconds: { type: 'grind', seconds: 1 },
    combo: { type: 'combo', count: goal.target },
    pickups: { type: 'pickup' },
    speed: { type: 'speed', kmh: goal.target },
    finishLevel: { type: 'levelFinished', levelId: 'n1', stars: 3 },
  }[goal.kind];
  for (let i = 0; i < 40 && !s.progress[dailyId]?.completed; i++) s = feed(s, [ev]).state;
  assert.ok(s.progress[dailyId].completed);
  s = feed(s, [{ type: 'grind', seconds: 5 }]).state;
  const grindBefore = s.progress['ch-grind-60'].progress;
  const c = claimRewards(s, Q);
  assert.ok(c.claimed.includes(dailyId));
  s = refreshDaily(c.state, Q, '2026-10-18', 3);
  assert.equal(s.daily.day, '2026-10-18');
  assert.equal(s.progress[dailyId], undefined, 'daily progress cleared');
  assert.equal(s.progress['ch-grind-60'].progress, grindBefore, 'challenge progress kept');
  assert.deepEqual(refreshDaily(s, Q, '2026-10-18', 3), s, 'same day: no change');
});

test('syncing with the profile catches up map/level quests but never dailies', () => {
  const s = fresh();
  s.daily.ids = ['daily-level', ...s.daily.ids.filter((x) => x !== 'daily-level')].slice(0, 3);
  const r = syncQuestsWithProfile(s, Q, { visitedMaps: ['neighborhood', 'skatepark', 'plaza', 'downtown'], levels: { n1: { bestStars: 3 } } });
  assert.ok(r.completed.includes('ch-all-maps'));
  assert.ok(r.completed.includes('ch-3stars'));
  assert.ok(!r.completed.includes('daily-level'));
});

test('quest view lists active, done and locked quests with progress text', () => {
  let s = fresh();
  s = feed(s, [{ type: 'grind', seconds: 3.25 }]).state;
  const v = questView(s, Q);
  assert.equal(v.find((q) => q.id === 'story-01').status, 'active');
  assert.equal(v.find((q) => q.id === 'story-05').status, 'locked');
  assert.equal(v.find((q) => q.id === 'ch-grind-60').progressText, '3.3 / 60 s');
  assert.equal(v.filter((q) => q.type === 'daily').length, 3);
  assert.equal(formatProgress(byId['story-10'], { progress: 12.7 }), '12 / 45 km/h');
  assert.ok(activeQuestIds(s, Q).length >= 1 + 3);
});

test('progression: completing a quest credits its Bolts once and reports it', () => {
  const p = defaultSave(0);
  p.quests = fresh();
  const before = p.bolts;
  const n = questEvent(p, Q, { type: 'speed', kmh: 30 });
  assert.ok(n.some((x) => x.type === 'questComplete' && x.id === 'story-01'));
  assert.equal(p.bolts, before + byId['story-01'].reward);
  const n2 = questEvent(p, Q, { type: 'speed', kmh: 35 });
  assert.ok(!n2.some((x) => x.type === 'questComplete' && x.id === 'story-01'));
  assert.equal(p.bolts, before + byId['story-01'].reward);
});

test('quest progress persists through a save/load round trip', () => {
  const storage = memoryStorage();
  const store = createSaveStore(storage, { now: () => 1 });
  const p = defaultSave(1);
  p.quests = feed(fresh(), [{ type: 'mapVisited', mapId: 'plaza' }, { type: 'grind', seconds: 7 }]).state;
  store.write(p);
  const loaded = store.load().save;
  assert.equal(loaded.quests.progress['ch-grind-60'].progress, 7);
  assert.deepEqual(loaded.quests.progress['ch-all-maps'].seen, ['plaza']);
  assert.equal(loaded.quests.daily.day, DAY);
});

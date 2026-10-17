// Level objectives, stars, unlocking and validation (pure logic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OBJECTIVE_TYPES,
  createLevelRun,
  describeObjective,
  isMapUnlocked,
  levelUnlockState,
  nextLevel,
  objectiveText,
  recordLevelResult,
  starsFor,
  totalStars,
  updateLevelRun,
  validateLevel,
  validateLevels,
} from '../src/game/levels.js';
import { loadData } from './helpers.js';

const data = await loadData();
const L = Object.fromEntries(data.levels.map((l) => [l.id, l]));
const byId = L;

test('at least 12 levels across all four themed maps, using every objective type', () => {
  assert.ok(data.levels.length >= 12, `${data.levels.length} levels`);
  const maps = new Set(data.levels.map((l) => l.map));
  for (const m of ['neighborhood', 'skatepark', 'plaza', 'downtown']) assert.ok(maps.has(m), m);
  const types = new Set(data.levels.map((l) => l.objective.type));
  for (const t of OBJECTIVE_TYPES) assert.ok(types.has(t), t);
});

test('all shipped level data is valid', () => {
  assert.deepEqual(validateLevels(data.levels, data.maps), []);
});

test('validation catches broken level data', () => {
  const bad = { id: 'x', name: 'X', map: 'nowhere', objective: { type: 'dance', stars: [3, 2] }, timeLimit: 0 };
  const errs = validateLevel(bad, data.maps, []);
  assert.ok(errs.some((e) => e.includes('unknown map')));
  assert.ok(errs.some((e) => e.includes('unknown objective')));
  assert.ok(errs.some((e) => e.includes('3 positive numbers')));
  assert.ok(errs.some((e) => e.includes('timeLimit')));
  const tooMany = { id: 'y', name: 'Y', map: 'neighborhood', objective: { type: 'pickups', stars: [5, 10, 99] }, timeLimit: 60, pickups: 'all' };
  assert.ok(validateLevel(tooMany, data.maps).some((e) => e.includes('exceeds')));
  const easierAt3 = { id: 'z', name: 'Z', map: 'neighborhood', objective: { type: 'score', stars: [100, 50, 10] }, timeLimit: 60 };
  assert.ok(validateLevel(easierAt3, data.maps).some((e) => e.includes('harder')));
});

test('star ratings: 1-3 stars by thresholds; time trials reward lower times', () => {
  const sc = L.n1;
  assert.equal(starsFor(sc, 0), 0);
  assert.equal(starsFor(sc, sc.objective.stars[0]), 1);
  assert.equal(starsFor(sc, sc.objective.stars[1]), 2);
  assert.equal(starsFor(sc, sc.objective.stars[2] + 1), 3);
  const tt = L.n4;
  assert.equal(starsFor(tt, tt.objective.stars[2] - 1), 3);
  assert.equal(starsFor(tt, tt.objective.stars[1]), 2);
  assert.equal(starsFor(tt, tt.objective.stars[0]), 1);
  assert.equal(starsFor(tt, tt.objective.stars[0] + 0.1), 0);
  assert.equal(starsFor(tt, null), 0);
});

test('score level: ends at the time limit with the stars earned, or early at 3 stars', () => {
  const def = L.n1;
  let lr = createLevelRun(def);
  const oneStar = def.objective.stars[0];
  let r = updateLevelRun(lr, def, data.maps.neighborhood, { score: oneStar, tricks: 0, pickups: 0, grindDistance: 0, pos: { x: 0, z: 0 } }, def.timeLimit - 1);
  assert.equal(r.run.status, 'running');
  assert.equal(lr.status, 'running', 'pure');
  r = updateLevelRun(r.run, def, data.maps.neighborhood, { score: oneStar, pos: { x: 0, z: 0 } }, 1);
  assert.equal(r.run.status, 'complete');
  assert.equal(r.run.stars, 1);
  assert.equal(r.events[0].type, 'levelComplete');
  lr = createLevelRun(def);
  r = updateLevelRun(lr, def, data.maps.neighborhood, { score: def.objective.stars[2], pos: { x: 0, z: 0 } }, 5);
  assert.equal(r.run.status, 'complete', 'ends early at 3 stars');
  assert.equal(r.run.stars, 3);
});

test('a level with no star at the time limit is failed', () => {
  const def = L.n3;
  const r = updateLevelRun(createLevelRun(def), def, data.maps.neighborhood, { tricks: 1, pos: { x: 0, z: 0 } }, def.timeLimit);
  assert.equal(r.run.status, 'failed');
  assert.equal(r.events[0].type, 'levelFailed');
});

test('time trial: checkpoints must be reached in order; finish time sets the stars', () => {
  const def = L.n4;
  const map = data.maps.neighborhood;
  const cps = def.objective.checkpoints.map((id) => map.checkpoints.find((c) => c.id === id));
  let lr = createLevelRun(def);
  // Visiting the second checkpoint first does nothing.
  let r = updateLevelRun(lr, def, map, { pos: { x: cps[1].x, z: cps[1].z } }, 1);
  assert.equal(r.run.checkpointIndex, 0);
  r = updateLevelRun(r.run, def, map, { pos: { x: cps[0].x, z: cps[0].z } }, 10);
  assert.equal(r.run.checkpointIndex, 1);
  assert.equal(r.events[0].type, 'checkpoint');
  r = updateLevelRun(r.run, def, map, { pos: { x: cps[1].x, z: cps[1].z } }, 10);
  assert.equal(r.run.status, 'complete');
  assert.equal(r.run.finishTime, 21);
  assert.equal(r.run.stars, starsFor(def, 21));
  lr = createLevelRun(def);
  r = updateLevelRun(lr, def, map, { pos: { x: 0, z: -50 } }, def.timeLimit);
  assert.equal(r.run.status, 'failed');
});

test('pickup and grind-distance objectives track their values', () => {
  const p = L.n2;
  const r = updateLevelRun(createLevelRun(p), p, data.maps.neighborhood, { pickups: p.objective.stars[2], pos: { x: 0, z: 0 } }, 3);
  assert.equal(r.run.stars, 3);
  const g = L.s2;
  const r2 = updateLevelRun(createLevelRun(g), g, data.maps.skatepark, { grindDistance: g.objective.stars[1] + 0.5, pos: { x: 0, z: 0 } }, g.timeLimit);
  assert.equal(r2.run.stars, 2);
});

test('unlocking: first level open, later ones need stars on the previous level, maps need total stars', () => {
  const none = {};
  assert.equal(levelUnlockState(L.n1, data.maps, none, byId).unlocked, true);
  const n2 = levelUnlockState(L.n2, data.maps, none, byId);
  assert.equal(n2.unlocked, false);
  assert.match(n2.reason, /First Push/);
  assert.equal(levelUnlockState(L.n2, data.maps, { n1: { bestStars: 1 } }, byId).unlocked, true);
  const s1 = levelUnlockState(L.s1, data.maps, { n1: { bestStars: 2 } }, byId);
  assert.equal(s1.unlocked, false, 'skatepark needs 3 stars total');
  assert.match(s1.reason, /3 ★/);
  assert.equal(levelUnlockState(L.s1, data.maps, { n1: { bestStars: 3 } }, byId).unlocked, true);
  assert.equal(isMapUnlocked(data.maps.downtown, { a: { bestStars: 3 }, b: { bestStars: 3 } }), false);
  assert.equal(isMapUnlocked(data.maps.downtown, { a: { bestStars: 3 }, b: { bestStars: 3 }, c: { bestStars: 3 }, d: { bestStars: 3 } }), true);
});

test('map unlock thresholds are reachable: earlier maps hold enough stars', () => {
  const order = ['neighborhood', 'skatepark', 'plaza', 'downtown'];
  let available = 0;
  for (const m of order) {
    assert.ok(available >= data.maps[m].unlock.stars, `${m} needs ${data.maps[m].unlock.stars}, earlier maps offer ${available}`);
    available += data.levels.filter((l) => l.map === m).length * 3;
  }
});

test('recording results keeps the best stars/score/time and reports improvement', () => {
  let r = recordLevelResult({}, L.n4, { stars: 1, score: 100, value: 40 });
  assert.equal(r.improved, true);
  assert.equal(r.levels.n4.bestTime, 40);
  r = recordLevelResult(r.levels, L.n4, { stars: 3, score: 50, value: 25 });
  assert.equal(r.prevStars, 1);
  assert.equal(r.levels.n4.bestStars, 3);
  assert.equal(r.levels.n4.bestTime, 25);
  assert.equal(r.levels.n4.bestScore, 100);
  r = recordLevelResult(r.levels, L.n4, { stars: 1, score: 10, value: 45 });
  assert.equal(r.improved, false);
  assert.equal(r.levels.n4.bestStars, 3);
  assert.equal(r.levels.n4.bestTime, 25);
  assert.equal(totalStars(r.levels), 3);
});

test('objective text and descriptions exist for every level', () => {
  for (const l of data.levels) {
    assert.ok(describeObjective(l).length > 5, l.id);
    const t = objectiveText(l, createLevelRun(l));
    assert.ok(t.title && t.progress, l.id);
  }
  assert.equal(nextLevel(data.levels, 'n1').id, 'n2');
  assert.equal(nextLevel(data.levels, data.levels[data.levels.length - 1].id), null);
});

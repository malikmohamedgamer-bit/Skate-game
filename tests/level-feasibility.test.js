// Every level can be completed (>= 1 star) through the real simulation by a bot
// using only normal inputs (push, steer, brake, ollie, flip). This guards against
// impossible thresholds, blocked routes and broken checkpoints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playLevel } from './bot.js';
import { PLANS } from './level-plans.js';
import { loadData } from './helpers.js';

const data = await loadData();

for (const level of data.levels) {
  test(`level ${level.id} "${level.name}" (${level.objective.type}) is completable with at least 1 star`, () => {
    const plan = PLANS[level.id];
    assert.ok(plan && plan.length, `no bot plan for ${level.id}`);
    const r = playLevel(data, level, plan);
    assert.equal(r.levelRun.status, 'complete', `status ${r.levelRun.status}, value ${r.levelRun.value}`);
    assert.ok(r.levelRun.stars >= 1);
    assert.equal(r.session.stats2.outOfBounds, 0);
    assert.equal(r.session.body.safetyResets, 0, 'never fell through the world');
  });
}

for (const level of data.levels.filter((l) => l.objective.type === 'timeTrial')) {
  test(`time trial ${level.id} is also completable on the scooter`, () => {
    const r = playLevel(data, level, PLANS[level.id], { vehicle: 'scooter' });
    assert.equal(r.levelRun.status, 'complete', `scooter: ${r.levelRun.status}`);
  });
}

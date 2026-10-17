import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCY,
  GRIND_BOLTS_PER_SECOND,
  LEVEL_COMPLETE_BOLTS,
  MAX_BOLTS,
  PICKUP_BOLTS,
  POINTS_PER_BOLT,
  RUN_GRIND_BOLT_CAP,
  RUN_TRICK_BOLT_CAP,
  STAR_BOLTS,
  addBolts,
  canAfford,
  cheapestUnowned,
  createRunEarnings,
  earnFromGrind,
  earnFromPickup,
  earnFromTrick,
  levelReward,
  sanitizeBalance,
  spend,
} from '../src/game/economy.js';

test('the currency is called Bolts', () => {
  assert.equal(CURRENCY, 'Bolts');
});

test('spending never makes the balance negative', () => {
  assert.deepEqual(spend(50, 80), { ok: false, balance: 50, reason: 'insufficient', short: 30 });
  assert.deepEqual(spend(80, 80), { ok: true, balance: 0, reason: null });
  assert.equal(spend(-10, 5).ok, false);
  assert.equal(spend(-10, 5).balance, 0);
  for (let b = 0; b < 200; b += 7) for (let p = 0; p < 200; p += 11) assert.ok(spend(b, p).balance >= 0);
});

test('purchases check the balance first and reject invalid prices', () => {
  assert.equal(canAfford(100, 100), true);
  assert.equal(canAfford(99, 100), false);
  assert.equal(spend(100, -5).reason, 'invalid-price');
  assert.equal(spend(100, 1.5).reason, 'invalid-price');
  assert.equal(spend(100, NaN).reason, 'invalid-price');
  assert.equal(canAfford(100, NaN), false);
});

test('adding Bolts ignores negative/invalid amounts and clamps to the max', () => {
  assert.equal(addBolts(10, -5), 10);
  assert.equal(addBolts(10, NaN), 10);
  assert.equal(addBolts(10, 2.9), 12);
  assert.equal(addBolts(MAX_BOLTS - 1, 10), MAX_BOLTS);
  assert.equal(sanitizeBalance(-3), 0);
  assert.equal(sanitizeBalance('lots'), 0);
});

test('trick Bolts scale with points and carry fractions between tricks', () => {
  let run = createRunEarnings();
  let r = earnFromTrick(run, POINTS_PER_BOLT * 3);
  assert.equal(r.bolts, 3);
  run = r.run;
  r = earnFromTrick(run, POINTS_PER_BOLT / 2);
  assert.equal(r.bolts, 0);
  r = earnFromTrick(r.run, POINTS_PER_BOLT / 2);
  assert.equal(r.bolts, 1, 'two half-Bolt tricks make one Bolt');
});

test('trick Bolts are capped per run', () => {
  let run = createRunEarnings();
  let total = 0;
  for (let i = 0; i < 100; i++) {
    const r = earnFromTrick(run, 5000);
    run = r.run;
    total += r.bolts;
  }
  assert.equal(total, RUN_TRICK_BOLT_CAP);
  assert.equal(earnFromTrick(run, 99999).bolts, 0);
  assert.equal(earnFromTrick(run, 99999).capped, true);
});

test('grinding earns per second, capped per run', () => {
  let run = createRunEarnings();
  let total = 0;
  for (let i = 0; i < 60; i++) {
    const r = earnFromGrind(run, 1 / 60);
    run = r.run;
    total += r.bolts;
  }
  assert.equal(total, GRIND_BOLTS_PER_SECOND);
  for (let i = 0; i < 10000; i++) {
    const r = earnFromGrind(run, 0.5);
    run = r.run;
    total += r.bolts;
  }
  assert.equal(total, RUN_GRIND_BOLT_CAP);
});

test('each pickup pays once per run', () => {
  const r = earnFromPickup(createRunEarnings(), 'p1');
  assert.equal(r.bolts, PICKUP_BOLTS);
  assert.equal(earnFromPickup(r.run, 'p1').bolts, 0);
  assert.equal(earnFromPickup(r.run, 'p2').bolts, PICKUP_BOLTS);
});

test('level rewards: base for finishing, star bonuses only for new stars', () => {
  assert.equal(levelReward(0, 0), 0);
  assert.equal(levelReward(0, 1), LEVEL_COMPLETE_BOLTS + STAR_BOLTS[1]);
  assert.equal(levelReward(0, 3), LEVEL_COMPLETE_BOLTS + STAR_BOLTS[1] + STAR_BOLTS[2] + STAR_BOLTS[3]);
  assert.equal(levelReward(3, 3), LEVEL_COMPLETE_BOLTS, 'replaying a 3-star level only pays the base');
  assert.equal(levelReward(1, 2), LEVEL_COMPLETE_BOLTS + STAR_BOLTS[2]);
});

test('cheapestUnowned finds the cheapest item not yet owned', () => {
  const items = [
    { id: 'a', price: 0 },
    { id: 'b', price: 300 },
    { id: 'c', price: 60 },
    { id: 'd', price: 90 },
  ];
  assert.equal(cheapestUnowned(items, ['a']).id, 'c');
  assert.equal(cheapestUnowned(items, ['a', 'c']).id, 'd');
  assert.equal(cheapestUnowned(items, ['a', 'b', 'c', 'd']), null);
});

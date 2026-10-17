import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, createRun, finishRun, tickRun } from '../src/game/progression.js';
import { defaultSave } from '../src/core/save.js';
import { POINTS_PER_BOLT, STARTING_BOLTS } from '../src/game/economy.js';
import { createSession } from '../src/game/session.js';
import { loadData, frame } from './helpers.js';

const data = await loadData();

test('a landed trick adds score with the combo multiplier and credits Bolts', () => {
  const run = createRun();
  const p = defaultSave(1);
  const n1 = applyEvent(run, p, { type: 'trickLanded', name: 'Kickflip', points: POINTS_PER_BOLT * 5 });
  assert.equal(run.score.score, POINTS_PER_BOLT * 5);
  assert.equal(p.bolts, STARTING_BOLTS + 5);
  assert.ok(n1.some((n) => n.type === 'bolts' && n.amount === 5));
  applyEvent(run, p, { type: 'trickLanded', name: 'Kickflip', points: POINTS_PER_BOLT * 5 });
  assert.equal(run.score.combo, 2);
  assert.equal(run.score.score, POINTS_PER_BOLT * 5 + POINTS_PER_BOLT * 5 * 1.5);
  assert.equal(p.stats.tricks, 2);
});

test('bail resets the combo and is recorded', () => {
  const run = createRun();
  const p = defaultSave(1);
  applyEvent(run, p, { type: 'trickLanded', name: 'Ollie', points: 100 });
  applyEvent(run, p, { type: 'trickLanded', name: 'Ollie', points: 100 });
  const n = applyEvent(run, p, { type: 'bail', reason: 'slam' });
  assert.equal(run.score.combo, 0);
  assert.equal(p.stats.bails, 1);
  assert.equal(n[0].type, 'bail');
});

test('grind time Bolts are paid when the grind scores', () => {
  const run = createRun();
  const p = defaultSave(1);
  for (let i = 0; i < 120; i++) applyEvent(run, p, { type: 'grindTick', dt: 1 / 60, speed: 7 });
  assert.equal(p.bolts, STARTING_BOLTS, 'not yet paid');
  const n = applyEvent(run, p, { type: 'trickLanded', name: '50-50 Grind', points: 0, grind: true });
  assert.equal(p.bolts, STARTING_BOLTS + 4);
  assert.ok(n.some((x) => x.type === 'bolts' && x.source === 'grind'));
  assert.ok(Math.abs(run.grindSeconds - 2) < 1e-9);
});

test('pickups pay once per run', () => {
  const run = createRun();
  const p = defaultSave(1);
  applyEvent(run, p, { type: 'pickup', id: 'a', value: 10 });
  applyEvent(run, p, { type: 'pickup', id: 'a', value: 10 });
  assert.equal(p.bolts, STARTING_BOLTS + 10);
  assert.equal(p.stats.pickups, 1);
});

test('combo end is reported after the window', () => {
  const run = createRun();
  const p = defaultSave(1);
  applyEvent(run, p, { type: 'trickLanded', name: 'Ollie', points: 100 });
  applyEvent(run, p, { type: 'trickLanded', name: 'Ollie', points: 100 });
  let ended = [];
  for (let i = 0; i < 300 && !ended.length; i++) ended = tickRun(run, p, 1 / 60);
  assert.equal(ended[0].type, 'comboEnd');
  assert.equal(ended[0].count, 2);
  finishRun(run, p);
  assert.equal(p.stats.bestScore, 250);
});

test('end to end in the simulation: an ollie increases Bolts', () => {
  const s = createSession({ data, mapId: 'training' });
  const run = createRun();
  const p = defaultSave(1);
  s.body.vel = { x: 0, y: 0, z: 7 };
  for (let i = 0; i < 120; i++) {
    s.step(1 / 60, frame({ pressed: { ollie: i === 5 } }));
    for (const e of s.drainEvents()) applyEvent(run, p, e);
  }
  assert.ok(run.score.score >= 50);
  assert.ok(p.bolts > STARTING_BOLTS, `bolts ${p.bolts}`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSteps, DEFAULT_DT } from '../src/core/loop.js';

test('fixed timestep: one 60 Hz frame produces one tick', () => {
  const r = computeSteps(0, 1 / 60);
  assert.equal(r.steps, 1);
  assert.ok(r.accumulator < 1e-9);
});

test('fixed timestep: leftover time is carried to the next frame', () => {
  let acc = 0;
  let total = 0;
  // 144 Hz display for one second -> exactly 60 ticks overall
  for (let i = 0; i < 144; i++) {
    const r = computeSteps(acc, 1 / 144);
    acc = r.accumulator;
    total += r.steps;
  }
  assert.ok(total === 60 || total === 59, `got ${total}`);
});

test('fixed timestep: long stalls are clamped to maxSteps (no spiral of death)', () => {
  const r = computeSteps(0, 2.0, DEFAULT_DT, 5);
  assert.equal(r.steps, 5);
  assert.equal(r.accumulator, 0);
});

test('fixed timestep: timeScale slows simulated time (slow game speed)', () => {
  let acc = 0;
  let total = 0;
  for (let i = 0; i < 60; i++) {
    const r = computeSteps(acc, 1 / 60, DEFAULT_DT, 5, 0.5);
    acc = r.accumulator;
    total += r.steps;
  }
  assert.equal(total, 30);
});

test('fixed timestep: bad frame durations are ignored', () => {
  assert.equal(computeSteps(0, NaN).steps, 0);
  assert.equal(computeSteps(0, -1).steps, 0);
});

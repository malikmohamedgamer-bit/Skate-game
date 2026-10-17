import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMBO_MULTIPLIER_CAP, COMBO_STEP, COMBO_WINDOW, applyBail, awardTrick, comboMultiplier, createScore, tickCombo } from '../src/game/scoring.js';

test('first trick has multiplier 1; each extra trick in the combo adds COMBO_STEP', () => {
  assert.equal(comboMultiplier(1), 1);
  assert.equal(comboMultiplier(2), 1 + COMBO_STEP);
  assert.equal(comboMultiplier(3), 1 + 2 * COMBO_STEP);
});

test('multiplier is capped at the documented value', () => {
  assert.equal(COMBO_MULTIPLIER_CAP, 5);
  assert.equal(comboMultiplier(100), COMBO_MULTIPLIER_CAP);
  assert.equal(comboMultiplier(0), 1);
  assert.equal(comboMultiplier(NaN), 1);
});

test('awardTrick multiplies base points by the combo and is pure', () => {
  const s0 = createScore();
  const a = awardTrick(s0, 100);
  assert.equal(a.awarded, 100);
  assert.equal(a.state.combo, 1);
  const b = awardTrick(a.state, 100);
  assert.equal(b.awarded, 150);
  assert.equal(b.state.score, 250);
  assert.equal(s0.score, 0, 'input not mutated');
  assert.equal(s0.combo, 0);
});

test('combo grows on clean landings and resets on bail; score is kept', () => {
  let s = createScore();
  for (let i = 0; i < 4; i++) s = awardTrick(s, 100).state;
  assert.equal(s.combo, 4);
  const scoreBefore = s.score;
  s = applyBail(s);
  assert.equal(s.combo, 0);
  assert.equal(s.comboPoints, 0);
  assert.equal(s.score, scoreBefore);
  assert.equal(awardTrick(s, 100).multiplier, 1);
});

test('combo banks after COMBO_WINDOW seconds on the ground; air time pauses it', () => {
  const s = awardTrick(awardTrick(createScore(), 100).state, 100).state;
  let r = tickCombo(s, COMBO_WINDOW * 2, true);
  assert.equal(r.state.combo, 2, 'paused while in a trick');
  r = tickCombo(s, COMBO_WINDOW - 0.1);
  assert.equal(r.ended, null);
  r = tickCombo(r.state, 0.2);
  assert.deepEqual(r.ended, { count: 2, points: 250 });
  assert.equal(r.state.combo, 0);
});

test('capped multiplier: a 20-trick combo never awards more than 5x base', () => {
  let s = createScore();
  let last = 0;
  for (let i = 0; i < 20; i++) {
    const r = awardTrick(s, 100);
    s = r.state;
    last = r.awarded;
  }
  assert.equal(last, 500);
  assert.equal(s.bestCombo, 20);
});

test('invalid or negative base points score nothing', () => {
  assert.equal(awardTrick(createScore(), -50).awarded, 0);
  assert.equal(awardTrick(createScore(), NaN).awarded, 0);
});

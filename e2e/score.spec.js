// Milestone 3: score, combo multiplier, Bolts earned from tricks, and persistence.
import { test, expect } from '@playwright/test';
import { openGame, state, tap, advance, expectNoErrors } from './helpers.js';

async function ollieOnce(page) {
  await tap(page, 'Space');
  await advance(page, 1.1);
}

test('a trick raises the score and the Bolts balance; HUD shows both', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
    window.__game.place({ x: 0, z: -30, speed: 8 });
  });
  const s0 = await state(page);
  expect(s0.score.score).toBe(0);
  // Kickflip for a decent number of points.
  await tap(page, 'Space');
  await advance(page, 0.05);
  await tap(page, 'KeyW');
  await advance(page, 1.1);
  const s1 = await state(page);
  expect(s1.lastTrick.name).toBe('Kickflip');
  expect(s1.score.score).toBeGreaterThan(0);
  expect(s1.bolts).toBeGreaterThan(s0.bolts);
  await expect(page.locator('#hud-score')).toHaveText(String(s1.score.score));
  await expect(page.locator('#hud-bolts')).toHaveText(String(s1.bolts));
  expectNoErrors(errors);
});

test('combo: consecutive clean tricks multiply; a bail resets the combo', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
    window.__game.place({ x: 0, z: -35, speed: 6 });
  });
  await ollieOnce(page);
  await ollieOnce(page);
  const s = await state(page);
  expect(s.score.combo).toBe(2);
  expect(s.score.multiplier).toBe(1.5);
  await expect(page.locator('#hud-combo')).toContainText('x1.5');
  // Late flip -> bail -> combo reset.
  await tap(page, 'Space');
  await advance(page, 0.6);
  await tap(page, 'KeyW');
  await advance(page, 0.5);
  const s2 = await state(page);
  expect(s2.rider.state).toBe('bail');
  expect(s2.score.combo).toBe(0);
  expect(s2.score.score).toBe(s.score.score);
  expectNoErrors(errors);
});

test('Bolts are saved and survive a reload', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
    window.__game.place({ x: 0, z: -35, speed: 6 });
  });
  await ollieOnce(page);
  await ollieOnce(page);
  const earned = (await state(page)).bolts;
  await page.evaluate(() => window.__game.flushSave());
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.ready);
  const after = await state(page);
  expect(after.saveStatus).toBe('current');
  expect(after.bolts).toBe(earned);
  await expect(page.locator('#menu-bolts')).toHaveText(String(earned));
  expectNoErrors(errors);
});

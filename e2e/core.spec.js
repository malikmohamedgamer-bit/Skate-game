// Milestone 1: the game loads, the rider moves with real key presses, the camera follows.
import { test, expect } from '@playwright/test';
import { openGame, state, hold, expectNoErrors } from './helpers.js';

test('loads, starts free roam, pushes forward and steers', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => window.__game.startFreeRoam('training'));
  await page.evaluate(() => window.__game.setManual(true));
  const s0 = await state(page);
  expect(s0.screen).toBe('play');
  expect(s0.rider.speed).toBe(0);

  await hold(page, 'KeyW', 2);
  const s1 = await state(page);
  expect(s1.rider.speed).toBeGreaterThan(4);
  expect(s1.rider.pos.z).toBeGreaterThan(s0.rider.pos.z + 3);

  // Camera follows: it is behind the rider (lower z) and has moved with it.
  expect(s1.camera.eye.z).toBeLessThan(s1.rider.pos.z);
  expect(s1.camera.eye.z).toBeGreaterThan(s0.camera.eye.z);

  await hold(page, 'KeyD', 0.6);
  const s2 = await state(page);
  expect(s2.rider.yaw).toBeLessThan(-0.2);

  await hold(page, 'ShiftLeft', 3);
  const s3 = await state(page);
  expect(s3.rider.speed).toBeLessThan(0.1);
  expectNoErrors(errors);
});

test('real-time loop advances without manual stepping', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => window.__game.startFreeRoam('training'));
  const t0 = (await state(page)).ticks;
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  const s = await state(page);
  expect(s.ticks).toBeGreaterThan(t0 + 10);
  expect(s.rider.speed).toBeGreaterThan(0.5);
  expectNoErrors(errors);
});

test('pause stops the simulation and resume continues', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => window.__game.startFreeRoam('training'));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  const t0 = (await state(page)).ticks;
  await page.waitForTimeout(500);
  expect((await state(page)).ticks).toBe(t0);
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForTimeout(500);
  expect((await state(page)).ticks).toBeGreaterThan(t0);
  expectNoErrors(errors);
});

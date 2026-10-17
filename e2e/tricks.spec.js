// Milestone 2: physics and tricks in the real browser with real key presses.
import { test, expect } from '@playwright/test';
import { openGame, state, hold, tap, advance, expectNoErrors } from './helpers.js';

async function start(page) {
  const errors = await openGame(page);
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
  });
  return errors;
}

test('push, ollie with Space: lands an Ollie with a trick score', async ({ page }) => {
  const errors = await start(page);
  await hold(page, 'KeyW', 1.5);
  await tap(page, 'Space');
  expect((await state(page)).rider.state).toBe('air');
  await advance(page, 1.2);
  const s = await state(page);
  expect(s.rider.state).toBe('ride');
  expect(s.lastTrick.name).toBe('Ollie');
  expect(s.lastTrick.points).toBeGreaterThanOrEqual(50);
  await expect(page.locator('#hud-trick')).toContainText('Clean');
  expectNoErrors(errors);
});

test('kickflip: Space then W in the air; live trick name shows while flipping', async ({ page }) => {
  const errors = await start(page);
  await page.evaluate(() => window.__game.place({ x: 0, z: -30, speed: 7 }));
  await tap(page, 'Space');
  await advance(page, 0.05);
  await tap(page, 'KeyW');
  await advance(page, 0.1);
  const mid = await state(page);
  expect(mid.air.pitchDeg).toBeGreaterThan(30);
  expect(mid.liveTrick.name).toBe('Kickflip');
  await expect(page.locator('#hud-trick')).toContainText('Kickflip');
  await advance(page, 1.2);
  const s = await state(page);
  expect(s.lastTrick.name).toBe('Kickflip');
  expectNoErrors(errors);
});

test('spin: hold D in the air for an FS 180, landing fakie', async ({ page }) => {
  const errors = await start(page);
  await page.evaluate(() => window.__game.place({ x: 0, z: -30, speed: 7 }));
  await tap(page, 'Space');
  await hold(page, 'KeyD', 0.08);
  await advance(page, 1.2);
  const s = await state(page);
  expect(s.lastTrick.name).toBe('FS 180');
  expect(s.rider.stance).toBe(-1);
  expectNoErrors(errors);
});

test('late flip bails and the HUD says Bail with a reason (not color only)', async ({ page }) => {
  const errors = await start(page);
  await page.evaluate(() => window.__game.place({ x: 0, z: -30, speed: 6 }));
  await tap(page, 'Space');
  await advance(page, 0.6);
  await tap(page, 'KeyW');
  await advance(page, 0.1);
  const s = await state(page);
  expect(s.rider.state).toBe('bail');
  await expect(page.locator('#hud-trick')).toContainText('Bail');
  await expect(page.locator('#hud-trick')).toContainText('under-rotated flip');
  expectNoErrors(errors);
});

test('grind the training rail: balance meter shows, grind scores on exit', async ({ page }) => {
  const errors = await start(page);
  await page.evaluate(() => window.__game.place({ x: -8, z: -30, speed: 7 }));
  // Roll until just before the rail, then ollie onto it.
  for (let i = 0; i < 200; i++) {
    const z = (await state(page)).rider.pos.z;
    if (z >= -25.4) break;
    await advance(page, 1 / 60);
  }
  await tap(page, 'Space');
  await advance(page, 0.5);
  const g = await state(page);
  expect(g.rider.state).toBe('grind');
  expect(g.grind.name).toBe('50-50 Grind');
  await expect(page.locator('#hud-balance')).toBeVisible();
  // Keep balance with A/D until the grind ends.
  for (let i = 0; i < 240; i++) {
    const s = await state(page);
    if (s.rider.state !== 'grind') break;
    const key = s.grind.balance > 0.05 ? 'KeyA' : s.grind.balance < -0.05 ? 'KeyD' : null;
    if (key) await page.keyboard.down(key);
    await advance(page, 1 / 30);
    if (key) await page.keyboard.up(key);
  }
  await advance(page, 1);
  const s = await state(page);
  expect(s.lastTrick.grind).toBe(true);
  expect(s.lastTrick.points).toBeGreaterThan(100);
  expectNoErrors(errors);
});

test('quarter pipe: vert air and back down without bailing', async ({ page }) => {
  const errors = await start(page);
  await page.evaluate(() => window.__game.place({ x: 0, z: 20, speed: 10 }));
  let sawAir = false;
  for (let i = 0; i < 40; i++) {
    await advance(page, 0.1);
    if ((await state(page)).rider.state === 'air') sawAir = true;
  }
  const s = await state(page);
  expect(sawAir).toBe(true);
  expect(s.rider.state).toBe('ride');
  expect(s.rider.vel.z).toBeLessThan(-3);
  expectNoErrors(errors);
});

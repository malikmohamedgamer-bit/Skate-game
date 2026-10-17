// Milestone 9: gamepad mapping through the browser Gamepad API. There is no physical pad in
// CI, so navigator.getGamepads() is replaced with a scripted standard-mapping pad.
import { test, expect } from '@playwright/test';
import { openGame, state, expectNoErrors } from './helpers.js';

async function installPad(page) {
  await page.addInitScript(() => {
    const pad = {
      id: 'Scripted standard gamepad',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    window.__pad = pad;
    Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [pad] });
  });
}

const button = (page, i, down) =>
  page.evaluate(
    ({ i, down }) => {
      window.__pad.buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 };
    },
    { i, down },
  );
const stick = (page, x, y) =>
  page.evaluate(
    ({ x, y }) => {
      window.__pad.axes[0] = x;
      window.__pad.axes[1] = y;
    },
    { x, y },
  );
// Gamepads are polled once per rendered frame, so render every 4th tick while stepping
// (every advance() call also renders once, so 1-tick presses are still seen).
const advance = (page, s) => page.evaluate((sec) => window.__game.advance(sec, 4), s);

test('gamepad: RT pushes, stick steers, A ollies, stick-up flips, LT brakes, Start pauses', async ({ page }) => {
  await installPad(page);
  const errors = await openGame(page);
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
  });

  await button(page, 7, true); // RT
  await advance(page, 2);
  await button(page, 7, false);
  const s1 = await state(page);
  expect(s1.rider.speed).toBeGreaterThan(4);

  await stick(page, 1, 0); // steer right
  await advance(page, 0.5);
  await stick(page, 0, 0);
  expect((await state(page)).rider.yaw).toBeLessThan(s1.rider.yaw - 0.2);

  await page.evaluate(() => window.__game.place({ x: 0, z: -30, speed: 6 }));
  await button(page, 0, true); // A
  await advance(page, 1 / 60);
  await button(page, 0, false);
  await advance(page, 1 / 60);
  expect((await state(page)).rider.state).toBe('air');
  await stick(page, 0, -1); // stick up in the air = flip forward
  await advance(page, 0.05);
  await stick(page, 0, 0);
  await advance(page, 1.2);
  expect((await state(page)).lastTrick).toMatchObject({ name: 'Kickflip', clean: true });

  await button(page, 6, true); // LT
  await advance(page, 3);
  await button(page, 6, false);
  expect((await state(page)).rider.speed).toBeLessThan(0.2);

  await button(page, 9, true); // Start
  await advance(page, 1 / 60);
  await button(page, 9, false);
  expect((await state(page)).screen).toBe('pause');
  expectNoErrors(errors);
});

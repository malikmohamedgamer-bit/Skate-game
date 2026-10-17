// Milestone 8: touch controls on an emulated phone (landscape, touch enabled).
import { test, expect } from '@playwright/test';
import { openGame, state, advance, expectNoErrors } from './helpers.js';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

async function startPlay(page) {
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
  });
}

/** Synthetic touch pointer events (for press-and-hold and swipes). */
async function pointer(page, type, x, y, id = 7, selector = '#touch-controls') {
  await page.evaluate(
    ({ type, x, y, id, selector }) => {
      const target = document.elementFromPoint(x, y) || document.querySelector(selector);
      target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    },
    { type, x, y, id, selector },
  );
}

async function center(page, sel) {
  const b = await page.locator(sel).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
}

test('touch controls appear in play (not in menus) and every button is at least 44x44', async ({ page }) => {
  const errors = await openGame(page);
  await expect(page.locator('#touch-controls')).toBeHidden();
  await startPlay(page);
  await expect(page.locator('#touch-controls')).toBeVisible();
  for (const id of ['left', 'right', 'forward', 'back', 'ollie', 'trick']) {
    const b = await page.locator(`.tbtn-${id}`).boundingBox();
    expect(b.width, id).toBeGreaterThanOrEqual(44);
    expect(b.height, id).toBeGreaterThanOrEqual(44);
  }
  const pause = await page.locator('#hud-pause').boundingBox();
  expect(pause.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('.tbtn-ollie')).toHaveAttribute('aria-label', 'Ollie');
  expectNoErrors(errors);
});

test('tap OLLIE (real touchscreen tap) jumps and scores a trick', async ({ page }) => {
  const errors = await openGame(page);
  await startPlay(page);
  await page.evaluate(() => window.__game.place({ x: 0, z: -30, speed: 6 }));
  const o = await center(page, '.tbtn-ollie');
  await page.touchscreen.tap(o.x, o.y);
  await advance(page, 1 / 60);
  expect((await state(page)).rider.state).toBe('air');
  await advance(page, 1.2);
  expect((await state(page)).lastTrick.name).toBe('Ollie');
  expectNoErrors(errors);
});

test('hold PUSH to accelerate, hold a steer button to turn, hold BRAKE to stop', async ({ page }) => {
  const errors = await openGame(page);
  await startPlay(page);
  const push = await center(page, '.tbtn-forward');
  await pointer(page, 'pointerdown', push.x, push.y, 11);
  await advance(page, 2);
  await pointer(page, 'pointerup', push.x, push.y, 11);
  const s1 = await state(page);
  expect(s1.rider.speed).toBeGreaterThan(4);
  const right = await center(page, '.tbtn-right');
  await pointer(page, 'pointerdown', right.x, right.y, 12);
  await advance(page, 0.5);
  await pointer(page, 'pointerup', right.x, right.y, 12);
  expect((await state(page)).rider.yaw).toBeLessThan(s1.rider.yaw - 0.2);
  const brake = await center(page, '.tbtn-back');
  await pointer(page, 'pointerdown', brake.x, brake.y, 13);
  await advance(page, 3);
  await pointer(page, 'pointerup', brake.x, brake.y, 13);
  expect((await state(page)).rider.speed).toBeLessThan(0.2);
  expectNoErrors(errors);
});

test('swipe up on the right side ollies; swipe up in the air flips', async ({ page }) => {
  const errors = await openGame(page);
  await startPlay(page);
  await page.evaluate(() => window.__game.place({ x: 0, z: -30, speed: 7 }));
  // Right side, above the buttons.
  await pointer(page, 'pointerdown', 620, 120, 21);
  await pointer(page, 'pointerup', 620, 30, 21);
  await advance(page, 1 / 60);
  expect((await state(page)).rider.state).toBe('air');
  await advance(page, 0.05);
  await pointer(page, 'pointerdown', 620, 120, 22);
  await pointer(page, 'pointerup', 620, 30, 22);
  await advance(page, 0.15);
  expect((await state(page)).air.pitchDeg).toBeGreaterThan(30);
  await advance(page, 1.2);
  expect((await state(page)).lastTrick.name).toBe('Kickflip');
  expectNoErrors(errors);
});

test('larger buttons and the one-handed layout', async ({ page }) => {
  const errors = await openGame(page);
  await startPlay(page);
  const before = await page.locator('.tbtn-ollie').boundingBox();
  await page.evaluate(() => {
    window.__game.changeSetting('a11y.touchScale', 1.5);
    window.__game.changeSetting('a11y.touchLayout', 'left');
  });
  const after = await page.locator('.tbtn-ollie').boundingBox();
  expect(after.width).toBeGreaterThan(before.width * 1.4);
  // One-handed left: every control sits in the left half of the screen.
  for (const id of ['left', 'right', 'forward', 'back', 'ollie', 'trick']) {
    const b = await page.locator(`.tbtn-${id}`).boundingBox();
    expect(b.x + b.width, id).toBeLessThan(844 / 2 + 1);
  }
  expectNoErrors(errors);
});

test('portrait shows a rotate prompt and pauses; landscape hides it', async ({ page }) => {
  const errors = await openGame(page);
  await startPlay(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#rotate-prompt')).toBeVisible();
  await expect(page.locator('#rotate-prompt')).toContainText('rotate');
  expect((await state(page)).screen).toBe('pause');
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#rotate-prompt')).toBeHidden();
  expectNoErrors(errors);
});

test('the page never scrolls or zooms during play', async ({ page }) => {
  const errors = await openGame(page);
  await startPlay(page);
  for (let i = 0; i < 5; i++) {
    await pointer(page, 'pointerdown', 600, 100, 30 + i);
    await pointer(page, 'pointerup', 600, 300, 30 + i);
  }
  await page.touchscreen.tap(420, 200);
  const m = await page.evaluate(() => ({
    sy: window.scrollY,
    st: document.scrollingElement.scrollTop,
    body: getComputedStyle(document.body).touchAction,
    overscroll: getComputedStyle(document.body).overscrollBehaviorY,
    viewport: document.querySelector('meta[name=viewport]').content,
  }));
  expect(m.sy).toBe(0);
  expect(m.st).toBe(0);
  expect(m.body).toBe('none');
  expect(m.overscroll).toBe('none');
  expect(m.viewport).toContain('user-scalable=no');
  expectNoErrors(errors);
});

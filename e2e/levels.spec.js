// Milestone 5: levels from the menu, objectives, stars, unlocking, pause/retry/quit, results.
import { test, expect } from '@playwright/test';
import { openGame, seedSave, saveWith, state, tap, advance, expectNoErrors } from './helpers.js';

async function kickflips(page, n) {
  for (let i = 0; i < n; i++) {
    await tap(page, 'Space');
    await advance(page, 0.05);
    await tap(page, 'KeyW');
    await advance(page, 0.9);
  }
}

test('play a level from the menu: objective HUD, pause, retry and quit', async ({ page }) => {
  const errors = await openGame(page);
  await page.getByRole('button', { name: 'Play levels' }).click();
  await expect(page.getByRole('heading', { name: 'Levels' })).toBeVisible();
  await page.locator('[data-level="n1"]').click();
  await page.evaluate(() => window.__game.setManual(true));
  let s = await state(page);
  expect(s.screen).toBe('play');
  expect(s.level.id).toBe('n1');
  await expect(page.locator('#hud-objective')).toContainText('First Push');
  await expect(page.locator('#hud-objective')).toContainText('1:30');
  await page.keyboard.down('KeyW');
  await advance(page, 3);
  await page.keyboard.up('KeyW');
  expect((await state(page)).level.time).toBeGreaterThan(2.9);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry level' }).click();
  s = await state(page);
  expect(s.screen).toBe('play');
  expect(s.level.time).toBe(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quit to menu' }).click();
  await expect(page.getByRole('button', { name: 'Play levels' })).toBeVisible();
  expect((await state(page)).screen).toBe('menu');
  expectNoErrors(errors);
});

test('locked levels explain why and do not start', async ({ page }) => {
  const errors = await openGame(page);
  await page.getByRole('button', { name: 'Play levels' }).click();
  const card = page.locator('[data-level="n2"]');
  await expect(card).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#lvl-n2-desc')).toContainText('Locked');
  await expect(page.locator('#lvl-s1-desc')).toContainText('3 ★');
  // Keyboard users press Enter on the (aria-disabled, still focusable) card.
  await card.focus();
  await page.keyboard.press('Enter');
  expect((await state(page)).screen).toBe('menu');
  await expect(page.locator('#sr-polite')).toContainText('First Push');
  expectNoErrors(errors);
});

test('complete a level: stars, Bolts reward, saved progress, next level unlocked', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => {
    window.__game.startLevel('n1');
    window.__game.setManual(true);
    window.__game.place({ x: 0, z: -48, speed: 7 });
  });
  const boltsBefore = (await state(page)).bolts;
  await kickflips(page, 6);
  const mid = await state(page);
  expect(mid.score.score).toBeGreaterThan(1500);
  // Run out the clock.
  await advance(page, 90);
  const s = await state(page);
  expect(s.screen).toBe('results');
  expect(s.lastResult.status).toBe('complete');
  expect(s.lastResult.stars).toBeGreaterThanOrEqual(1);
  expect(s.lastResult.boltsLevel).toBeGreaterThan(0);
  expect(s.bolts).toBeGreaterThan(boltsBefore + s.lastResult.boltsLevel - 1);
  await expect(page.getByRole('heading', { name: /Level complete/ })).toBeVisible();
  await expect(page.locator('.result-stars')).toContainText(`${s.lastResult.stars} of 3 stars`);
  const profile = await page.evaluate(() => window.__game.profile());
  expect(profile.levels.n1.bestStars).toBe(s.lastResult.stars);
  await page.getByRole('button', { name: /Next: Bolt Run/ }).click();
  expect((await state(page)).level.id).toBe('n2');
  expectNoErrors(errors);
});

test('failing a time trial shows 0 stars and offers a retry', async ({ page }) => {
  await seedSave(page, saveWith({ levels: { n1: 1, n2: 1, n3: 1 } }));
  const errors = await openGame(page, { clearSave: false });
  await page.evaluate(() => {
    window.__game.startLevel('n4');
    window.__game.setManual(true);
  });
  await advance(page, 46);
  const s = await state(page);
  expect(s.screen).toBe('results');
  expect(s.lastResult.status).toBe('failed');
  expect(s.lastResult.stars).toBe(0);
  await expect(page.getByRole('heading', { name: /Level failed/ })).toBeVisible();
  await expect(page.locator('.result-stars')).toContainText('0 of 3 stars');
  await page.getByRole('button', { name: 'Retry' }).click();
  expect((await state(page)).level.id).toBe('n4');
  expectNoErrors(errors);
});

test('pause, retry and quit work in every level', async ({ page }) => {
  // Unlock everything.
  const all = {};
  for (const id of ['n1', 'n2', 'n3', 'n4', 's1', 's2', 's3', 's4', 'p1', 'p2', 'p3', 'p4', 'd1', 'd2', 'd3', 'd4']) all[id] = 1;
  all.n1 = 3;
  all.n2 = 3;
  all.n3 = 3;
  all.n4 = 3;
  await seedSave(page, saveWith({ levels: all }));
  const errors = await openGame(page, { clearSave: false });
  const ids = await page.evaluate(() => window.__game.profile() && Object.keys(window.__game.profile().levels));
  expect(ids.length).toBe(16);
  for (const id of ids) {
    await page.evaluate((lv) => {
      window.__game.startLevel(lv);
      window.__game.setManual(true);
    }, id);
    expect((await state(page)).level.id, id).toBe(id);
    await page.keyboard.down('KeyW');
    await advance(page, 1);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry level' }).click();
    const s = await state(page);
    expect(s.level.id).toBe(id);
    expect(s.level.time).toBe(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Quit to menu' }).click();
    expect((await state(page)).screen, id).toBe('menu');
  }
  expectNoErrors(errors);
});

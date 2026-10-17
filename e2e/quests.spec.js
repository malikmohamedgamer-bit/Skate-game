// Milestone 6: quests complete from gameplay, reward exactly once, persist, quest log, tracker, dailies.
import { test, expect } from '@playwright/test';
import { openGame, state, hold, expectNoErrors } from './helpers.js';

test('complete a quest by playing: reward granted once, persisted after reload', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
  });
  const start = (await state(page)).bolts;
  await expect(page.locator('#hud-tracker')).toContainText('Roll Out');
  // Story quest 1: reach 15 km/h. Push with W.
  await hold(page, 'KeyW', 3);
  let s = await state(page);
  expect(s.rider.speed * 3.6).toBeGreaterThan(15);
  let done = await page.evaluate(() => window.__game.questsCompleted());
  expect(done.map((q) => q.id)).toContain('story-01');
  expect(s.bolts).toBe(start + 30);
  await expect(page.locator('#hud-toast')).toContainText('Quest complete: Roll Out');
  await expect(page.locator('#sr-polite')).toContainText('Quest complete: Roll Out');
  // Keep going faster: the reward is not granted again.
  await hold(page, 'KeyW', 3);
  s = await state(page);
  done = await page.evaluate(() => window.__game.questsCompleted());
  expect(done.filter((q) => q.id === 'story-01').length).toBe(1);
  expect(s.bolts).toBe(start + 30);
  const profile = await page.evaluate(() => window.__game.profile());
  expect(profile.quests.progress['story-01']).toMatchObject({ completed: true, rewarded: true });
  // The tracker moves on to the next story quest.
  await expect(page.locator('#hud-tracker')).toContainText('Pop It');
  // Persist and reload: still rewarded once, Bolts unchanged.
  await page.evaluate(() => window.__game.flushSave());
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.ready);
  const after = await page.evaluate(() => window.__game.profile());
  expect(after.bolts).toBe(start + 30);
  expect(after.quests.progress['story-01'].rewarded).toBe(true);
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
  });
  await hold(page, 'KeyW', 2);
  expect(await page.evaluate(() => window.__game.questsCompleted())).toEqual([]);
  expect((await state(page)).bolts).toBe(start + 30);
  expectNoErrors(errors);
});

test('quest log: tabs work with the keyboard and show progress', async ({ page }) => {
  const errors = await openGame(page);
  await page.getByRole('button', { name: 'Quests' }).click();
  await expect(page.getByRole('heading', { name: 'Quests' })).toBeVisible();
  const storyTab = page.getByRole('tab', { name: 'Story' });
  await expect(storyTab).toBeFocused();
  await expect(storyTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#qpanel-story')).toContainText('Roll Out');
  await expect(page.locator('#qpanel-story')).toContainText('0 / 15 km/h');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Daily' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#qpanel-daily')).toBeVisible();
  expect(await page.locator('#qpanel-daily .quest').count()).toBe(3);
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Challenges' })).toHaveAttribute('aria-selected', 'true');
  expect(await page.locator('#qpanel-challenge .quest').count()).toBeGreaterThanOrEqual(10);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Play levels' })).toBeVisible();
  expectNoErrors(errors);
});

test('daily quests change and reset when the device date changes', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => window.__game.setNow(new Date(2026, 9, 17, 12).getTime()));
  const d1 = (await page.evaluate(() => window.__game.profile())).quests.daily;
  expect(d1.day).toBe('2026-10-17');
  await page.evaluate(() => window.__game.setNow(new Date(2026, 9, 18, 0, 5).getTime()));
  const d2 = (await page.evaluate(() => window.__game.profile())).quests.daily;
  expect(d2.day).toBe('2026-10-18');
  expect(d2.ids.length).toBe(3);
  expectNoErrors(errors);
});

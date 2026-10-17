// Milestone 9: the whole required e2e checklist as one player journey, in order, in one
// browser session, using the menus and real key presses:
// load → start a level → push → ollie → land a trick → score changes → currency increases →
// buy an item with enough currency → balance drops → equip → preview updates →
// complete a quest → reward granted once.
import { test, expect } from '@playwright/test';
import { openGame, state, advance, hold, tap, expectNoErrors } from './helpers.js';

const questRewards = async (page) => (await page.evaluate(() => window.__game.questsCompleted())).reduce((a, q) => a + q.reward, 0);

test('player journey: the full e2e checklist in one session', async ({ page }) => {
  // Load.
  const errors = await openGame(page);
  await expect(page.locator('#game-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play levels' })).toBeVisible();
  const bolts0 = (await state(page)).bolts;
  expect(bolts0).toBe(150);

  // Start a level from the menu.
  await page.getByRole('button', { name: 'Play levels' }).click();
  await page.locator('[data-level="n1"]').click();
  await page.evaluate(() => window.__game.setManual(true));
  let s = await state(page);
  expect(s.screen).toBe('play');
  expect(s.level).toMatchObject({ id: 'n1', status: 'running' });
  await expect(page.locator('#hud-objective')).toContainText('First Push');

  // Push (W), then steer a touch left (A) so the tricks below land beside the road kicker, not on it.
  await hold(page, 'KeyW', 1);
  s = await state(page);
  expect(s.rider.speed).toBeGreaterThan(4);
  expect(s.score.score).toBe(0);
  await hold(page, 'KeyA', 0.15);

  // Ollie.
  await tap(page, 'Space');
  expect((await state(page)).rider.state).toBe('air');
  await advance(page, 1.2);
  s = await state(page);
  expect(s.rider.state).toBe('ride');
  expect(s.lastTrick).toMatchObject({ name: 'Ollie', clean: true });
  const scoreAfterOllie = s.score.score;
  expect(scoreAfterOllie).toBeGreaterThan(0);

  // Land a trick: kickflip (ollie, then forward in the air).
  const boltsBeforeFlip = s.bolts;
  const questsBeforeFlip = await questRewards(page);
  await tap(page, 'Space');
  await advance(page, 0.05);
  await tap(page, 'KeyW');
  await advance(page, 1.2);
  s = await state(page);
  expect(s.lastTrick).toMatchObject({ name: 'Kickflip', clean: true });

  // Score changes (and the HUD shows it).
  expect(s.score.score).toBeGreaterThan(scoreAfterOllie);
  await expect(page.locator('#hud-score')).toContainText(s.score.score.toLocaleString('en-US'));

  // Currency increases from the trick itself (quest rewards in between are counted separately).
  const fromQuests = (await questRewards(page)) - questsBeforeFlip;
  expect(s.bolts - fromQuests).toBeGreaterThan(boltsBeforeFlip);
  await expect(page.locator('#hud-bolts')).toHaveText(String(s.bolts));

  // Complete a quest: pushing past 15 km/h completed the first story quest, paid once.
  let done = await page.evaluate(() => window.__game.questsCompleted());
  expect(done.filter((q) => q.id === 'story-01')).toHaveLength(1);

  // Quit to the menu and open the shop.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quit to menu' }).click();
  const boltsBeforeShop = (await state(page)).bolts;
  expect(boltsBeforeShop).toBeGreaterThan(bolts0);
  await page.getByRole('button', { name: 'Shop & garage' }).click();
  await page.getByRole('tab', { name: 'Decks' }).click();
  await page.mouse.move(5, 5); // no hover try-on
  const preview0 = await page.evaluate(() => window.__game.shopPreview(0.6));

  // Buy an item with enough currency; the balance drops by its price.
  expect(boltsBeforeShop).toBeGreaterThanOrEqual(80);
  await page.getByRole('button', { name: 'Buy Street Deck for 80 Bolts' }).click();
  expect((await state(page)).bolts).toBe(boltsBeforeShop - 80);
  await expect(page.locator('#shop-bolts')).toHaveText(String(boltsBeforeShop - 80));

  // Equip it; the 3D preview updates.
  await page.getByRole('button', { name: 'Equip Street Deck' }).click();
  await page.mouse.move(5, 5);
  const preview1 = await page.evaluate(() => window.__game.shopPreview(0.6));
  expect(preview1.model.deck.color).not.toBe(preview0.model.deck.color);
  expect(preview1.hash).not.toBe(preview0.hash);
  expect((await page.evaluate(() => window.__game.profile())).equipped.skateboard.deck).toBe('deck_street');

  // Reward granted once: ride fast again (new session, then after a reload) and nothing is paid twice.
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
  });
  const boltsBeforeAgain = (await state(page)).bolts;
  await hold(page, 'KeyW', 3);
  expect((await state(page)).rider.speed * 3.6).toBeGreaterThan(15);
  done = await page.evaluate(() => window.__game.questsCompleted());
  expect(done.filter((q) => q.id === 'story-01')).toHaveLength(1);
  expect((await state(page)).bolts).toBe(boltsBeforeAgain);
  await page.evaluate(() => window.__game.flushSave());
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.ready);
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
  });
  await hold(page, 'KeyW', 3);
  expect(await page.evaluate(() => window.__game.questsCompleted())).toEqual([]);
  const profile = await page.evaluate(() => window.__game.profile());
  expect(profile.quests.progress['story-01']).toMatchObject({ completed: true, rewarded: true });
  expect(profile.bolts).toBe(boltsBeforeAgain);
  expect(profile.owned).toContain('deck_street');
  expectNoErrors(errors);
});

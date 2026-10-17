// Milestone 7: buy with enough currency, balance drops, equip, preview updates, applied in game.
import { test, expect } from '@playwright/test';
import { openGame, seedSave, saveWith, state, expectNoErrors } from './helpers.js';

const preview = (page) => page.evaluate(() => window.__game.shopPreview(0.6));

test('buy, equip, preview updates, customize, and the gear is used in game and saved', async ({ page }) => {
  const errors = await openGame(page);
  await page.getByRole('button', { name: 'Shop & garage' }).click();
  await expect(page.getByRole('heading', { name: 'Shop & garage' })).toBeVisible();
  await page.getByRole('tab', { name: 'Decks' }).click();
  await expect(page.locator('#shop-preview')).toBeVisible();
  await page.mouse.move(5, 5); // no hover try-on
  const before = await preview(page);
  expect(before.model.deck.color).toBe('#d94a38'); // classic deck
  const bolts0 = (await state(page)).bolts;
  expect(bolts0).toBe(150);

  // Not enough Bolts for the Pro Model: refused, balance unchanged.
  await page.locator('[data-item="deck_pro"] [data-buy]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sr-polite')).toContainText('Not enough Bolts');
  expect((await state(page)).bolts).toBe(150);

  // Buy the Street Deck (80).
  await page.getByRole('button', { name: 'Buy Street Deck for 80 Bolts' }).click();
  expect((await state(page)).bolts).toBe(70);
  await expect(page.locator('#shop-bolts')).toHaveText('70');
  await expect(page.locator('#sr-polite')).toContainText('Bought Street Deck for 80 Bolts');
  let profile = await page.evaluate(() => window.__game.profile());
  expect(profile.owned).toContain('deck_street');
  expect(profile.equipped.skateboard.deck).toBe('deck_classic');

  // Equip it: the 3D preview is rebuilt with the new part and its pixels change.
  await page.getByRole('button', { name: 'Equip Street Deck' }).click();
  await page.mouse.move(5, 5);
  const afterEquip = await preview(page);
  expect(afterEquip.model.deck.color).toBe('#2f80ed');
  expect(afterEquip.hash).not.toBe(before.hash);
  profile = await page.evaluate(() => window.__game.profile());
  expect(profile.equipped.skateboard.deck).toBe('deck_street');
  await expect(page.locator('[data-item="deck_street"]')).toContainText('Equipped');

  // Customize color and pattern by name.
  await page.locator('#cust-slot').selectOption('skateboard.deck');
  await page.getByRole('button', { name: 'Sky Blue' }).click();
  await expect(page.getByRole('button', { name: 'Sky Blue' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Stripes' }).click();
  await page.mouse.move(5, 5);
  const custom = await preview(page);
  expect(custom.model.deck.color).toBe('#56b4e9');
  expect(custom.model.deck.pattern).toBe('stripes');
  expect(custom.hash).not.toBe(afterEquip.hash);

  // Applied in game: the rider model and the handling use the equipped deck.
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game.startFreeRoam('training'));
  const look = await page.evaluate(() => window.__game.riderLook());
  expect(look.deck).toEqual({ color: '#56b4e9', pattern: 'stripes' });
  const stats = await page.evaluate(() => window.__game.sessionStats());
  expect(stats.jump).toBeCloseTo(5.7 + 0.25, 5);

  // Saved: survives a reload.
  await page.evaluate(() => window.__game.flushSave());
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.ready);
  profile = await page.evaluate(() => window.__game.profile());
  expect(profile.bolts).toBe(70);
  expect(profile.equipped.skateboard.deck).toBe('deck_street');
  expect(profile.colors['skateboard.deck']).toMatchObject({ color: '#56b4e9', pattern: 'stripes' });
  expectNoErrors(errors);
});

test('buy the scooter, switch vehicles, and ride it', async ({ page }) => {
  await seedSave(page, saveWith({ bolts: 400 }));
  const errors = await openGame(page, { clearSave: false });
  await page.getByRole('button', { name: 'Shop & garage' }).click();
  await page.getByRole('button', { name: 'Buy Kick Scooter for 200 Bolts' }).click();
  await page.getByRole('button', { name: 'Equip Kick Scooter' }).click();
  await page.mouse.move(5, 5);
  const p = await preview(page);
  expect(p.model.vehicle).toBe('scooter');
  await expect(page.getByRole('tab', { name: 'Bars' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game.startFreeRoam('training'));
  expect((await page.evaluate(() => window.__game.riderLook())).vehicle).toBe('scooter');
  expect((await page.evaluate(() => window.__game.sessionStats())).pushStyle).toBe('kick');
  expectNoErrors(errors);
});

test('the shop is keyboard navigable: category tabs with arrows, items with Tab/Enter', async ({ page }) => {
  const errors = await openGame(page);
  await page.getByRole('button', { name: 'Shop & garage' }).click();
  await expect(page.getByRole('tab', { name: 'Boards & scooters' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Decks' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Decks' })).toHaveAttribute('aria-selected', 'true');
  // Tab into the item list and buy the grip tape with Enter.
  await page.getByRole('tab', { name: 'Grip tape' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Buy Clear Grip for 60 Bolts' }).focus();
  await page.keyboard.press('Enter');
  expect((await state(page)).bolts).toBe(90);
  expectNoErrors(errors);
});

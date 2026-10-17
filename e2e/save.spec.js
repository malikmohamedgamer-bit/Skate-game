// Milestone 9: a schema v1 save (tests/fixtures/save-v1.json) migrates in the real browser.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { openGame, seedSave, state, expectNoErrors } from './helpers.js';

const v1 = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/save-v1.json', import.meta.url), 'utf8'));

test('a schema v1 save loads, migrates to the current schema and is written back', async ({ page }) => {
  await seedSave(page, v1);
  const errors = await openGame(page, { clearSave: false });
  const s = await state(page);
  expect(s.saveStatus).toBe('migrated');
  expect(s.bolts).toBe(420); // v1 "coins"
  const profile = await page.evaluate(() => window.__game.profile());
  expect(profile.schemaVersion).toBe(3);
  expect(profile.owned).toContain('deck_pro');
  expect(profile.equipped.skateboard.deck).toBe('deck_pro');
  expect(profile.settings.audio).toMatchObject({ volume: 0.4, muted: true });
  // The migrated board is used in game.
  await page.evaluate(() => window.__game.startFreeRoam('training'));
  expect((await page.evaluate(() => window.__game.riderLook())).deck.color).toBeTruthy();
  // Written back in the current schema; the next load is a plain load.
  await page.evaluate(() => window.__game.flushSave());
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('boltskate.save')));
  expect(stored.schemaVersion).toBe(3);
  expect(stored.bolts).toBe(420);
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.ready);
  expect((await state(page)).saveStatus).toBe('current');
  expect((await state(page)).bolts).toBe(420);
  expectNoErrors(errors);
});

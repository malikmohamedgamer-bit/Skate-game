// Milestone 4: every map loads and renders in the browser; pickups pay Bolts.
import { test, expect } from '@playwright/test';
import { openGame, seedSave, saveWith, state, advance, expectNoErrors } from './helpers.js';

for (const mapId of ['training', 'neighborhood', 'skatepark', 'plaza', 'downtown']) {
  test(`map "${mapId}" loads from the menu, renders and is rideable`, async ({ page }) => {
    // Enough stars to unlock every map.
    await seedSave(page, saveWith({ levels: { n1: 3, n2: 3, n3: 3, n4: 3 } }));
    const errors = await openGame(page, { clearSave: false });
    await page.getByRole('button', { name: 'Free roam' }).click();
    await page.locator(`#map-list [data-map="${mapId}"]`).click();
    await page.evaluate(() => window.__game.setManual(true));
    const s0 = await state(page);
    expect(s0.screen).toBe('play');
    expect(s0.mapId).toBe(mapId);
    await page.keyboard.down('KeyW');
    await advance(page, 2);
    await page.keyboard.up('KeyW');
    const s1 = await state(page);
    expect(s1.rider.speed).toBeGreaterThan(2);
    expect(s1.stats.outOfBounds).toBe(0);
    // The canvas shows a real scene (not a single flat color).
    const shot = await page.locator('#game-canvas').screenshot();
    expect(shot.length).toBeGreaterThan(20000);
    const visited = await page.evaluate(() => window.__game.profile().visitedMaps);
    expect(visited).toContain(mapId);
    expectNoErrors(errors);
  });
}

test('riding through a pickup collects it and adds Bolts', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => {
    window.__game.startFreeRoam('neighborhood');
    window.__game.setManual(true);
  });
  const s0 = await state(page);
  const p = s0.pickups.find((x) => x.id === 'n-p1');
  await page.evaluate((pk) => window.__game.place({ x: pk.x, z: pk.z - 5, yaw: 0, speed: 5 }), p);
  await advance(page, 2);
  const s1 = await state(page);
  expect(s1.pickups.find((x) => x.id === 'n-p1').taken).toBe(true);
  expect(s1.bolts).toBe(s0.bolts + 10);
  await expect(page.locator('#hud-bolts')).toHaveText(String(s0.bolts + 10));
  expectNoErrors(errors);
});

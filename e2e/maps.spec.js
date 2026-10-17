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
  // Riding at 18 km/h also completes the first story quest; count its reward separately.
  const questBolts = (await page.evaluate(() => window.__game.questsCompleted())).reduce((a, q) => a + q.reward, 0);
  expect(s1.bolts).toBe(s0.bolts + 10 + questBolts);
  await expect(page.locator('#hud-bolts')).toHaveText(String(s1.bolts));
  expectNoErrors(errors);
});

test('switching maps releases GPU resources (no texture or geometry leak)', async ({ page }) => {
  const errors = await openGame(page);
  const info = (mapId) =>
    page.evaluate((id) => {
      window.__game.startFreeRoam(id);
      window.__game.setManual(true);
      window.__game.advance(1);
      return window.__game.renderInfo();
    }, mapId);
  const first = await info('training');
  for (const m of ['neighborhood', 'skatepark', 'plaza', 'downtown', 'training', 'training']) await info(m);
  const again = await info('training');
  // Before the fix every session left its ground texture behind (2 -> 13 textures here).
  expect(again.textures).toBe(first.textures);
  expect(again.geometries).toBe(first.geometries);
  const audit = await page.evaluate(() => window.__game.gpuAudit());
  expect(audit.textures, 'renderer holds only the textures the scene uses').toBe(audit.sceneTextures);
  expect(audit.geometries, 'renderer holds only the geometries the scene uses').toBe(audit.sceneGeometries);
  // The audit also holds when hidden objects (the rider's body in first person) were never drawn.
  const fp = await page.evaluate(() => {
    window.__game.changeSetting('camera.mode', 'first');
    window.__game.startFreeRoam('plaza');
    window.__game.setManual(true);
    window.__game.advance(0.5);
    return { audit: window.__game.gpuAudit(), body: window.__game.state().riderBodyVisible };
  });
  expect(fp.body).toBe(false);
  expect(fp.audit.geometries).toBe(fp.audit.sceneGeometries);
  expect(fp.audit.textures).toBe(fp.audit.sceneTextures);
  expectNoErrors(errors);
});

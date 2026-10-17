// Milestone 8: accessibility in the real browser.
import { test, expect } from '@playwright/test';
import { openGame, state, tap, advance, expectNoErrors } from './helpers.js';

const a11y = (page) => page.evaluate(() => window.__game.a11y());

async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings & accessibility' }).click();
  await expect(page.getByRole('heading', { name: 'Settings & accessibility' })).toBeVisible();
}

test('keyboard only: Tab moves with a visible focus ring, Enter opens, Space toggles, Escape goes back, focus is trapped', async ({ page }) => {
  const errors = await openGame(page);
  // Main menu: the first button is focused and has a thick visible outline.
  const ring = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { text: el.textContent.trim(), outline: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
  let f = await ring();
  expect(f.text).toContain('Play levels');
  expect(f.outline).not.toBe('none');
  expect(f.width).toBeGreaterThanOrEqual(3);
  // Tab through to Settings and press Enter.
  for (let i = 0; i < 10; i++) {
    if ((await ring()).text.includes('Settings')) break;
    await page.keyboard.press('Tab');
  }
  f = await ring();
  expect(f.text).toContain('Settings');
  expect(f.width).toBeGreaterThanOrEqual(3);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Settings & accessibility' })).toBeVisible();
  // Tab to the High contrast checkbox and toggle it with Space.
  for (let i = 0; i < 10; i++) {
    const id = await page.evaluate(() => document.activeElement.id);
    if (id === 'set-contrast') break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Space');
  expect((await a11y(page)).bodyClasses).toContain('high-contrast');
  // Focus never escapes the dialog: Shift+Tab from the first control wraps to the last.
  await page.locator('[data-action="back"]').focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement.closest('#screen-settings'))).toBe(true);
  // Escape goes back to the main menu.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Play levels' })).toBeVisible();
  expectNoErrors(errors);
});

test('remap a key: new key works in game; conflicts are detected and can be swapped', async ({ page }) => {
  const errors = await openGame(page);
  await openSettings(page);
  await page.locator('[data-rebind="ollie"][data-slot="0"]').click();
  await expect(page.locator('#key-notice')).toContainText('Press the new key');
  await page.keyboard.press('KeyL');
  let b = (await a11y(page)).bindings;
  expect(b.ollie[0]).toBe('KeyL');
  // Conflict: try to put W (push) on ollie.
  await page.locator('[data-rebind="ollie"][data-slot="0"]').click();
  await page.keyboard.press('KeyW');
  await expect(page.getByRole('alert')).toContainText('already used for');
  await expect(page.getByRole('alert')).toContainText('Push');
  b = (await a11y(page)).bindings;
  expect(b.ollie[0]).toBe('KeyL');
  expect(b.forward[0]).toBe('KeyW');
  await page.getByRole('button', { name: 'Swap keys' }).click();
  b = (await a11y(page)).bindings;
  expect(b.ollie[0]).toBe('KeyW');
  expect(b.forward[0]).toBe('KeyL');
  // Reserved keys are refused with an explanation.
  await page.locator('[data-rebind="trick"][data-slot="0"]').click();
  await page.keyboard.press('Tab');
  await expect(page.locator('#key-notice')).toContainText('menu navigation');
  // Use the new keys in game: L pushes, W ollies.
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
  });
  await page.keyboard.down('KeyL');
  await advance(page, 1.5);
  await page.keyboard.up('KeyL');
  expect((await state(page)).rider.speed).toBeGreaterThan(3);
  await tap(page, 'KeyW');
  expect((await state(page)).rider.state).toBe('air');
  // Saved with the profile.
  const saved = await page.evaluate(() => window.__game.profile().bindings);
  expect(saved.ollie[0]).toBe('KeyW');
  expectNoErrors(errors);
});

test('one-handed keyboard preset puts every action on one side', async ({ page }) => {
  const errors = await openGame(page);
  await openSettings(page);
  await page.locator('#set-onehand').selectOption('right');
  const b = (await a11y(page)).bindings;
  expect(b.ollie[0]).toBe('Slash');
  expect(b.forward[0]).toBe('ArrowUp');
  expect(b.trick[0]).toBe('Period');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
  });
  await page.keyboard.down('ArrowUp');
  await advance(page, 1.2);
  await page.keyboard.up('ArrowUp');
  await tap(page, 'Slash');
  expect((await state(page)).rider.state).toBe('air');
  expectNoErrors(errors);
});

test('reduced motion: no FOV zoom with speed and CSS animations off', async ({ page }) => {
  const errors = await openGame(page);
  const fovAtSpeed = async () => {
    await page.evaluate(() => {
      window.__game.startFreeRoam('training');
      window.__game.setManual(true);
      window.__game.place({ x: 0, z: -30, speed: 10 });
    });
    for (let i = 0; i < 30; i++) await advance(page, 1 / 30);
    return (await a11y(page)).fov;
  };
  const normal = await fovAtSpeed();
  expect(normal).toBeGreaterThan(64);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game.changeSetting('a11y.reducedMotion', true));
  await page.getByRole('button', { name: 'Quit to menu' }).click();
  const reduced = await fovAtSpeed();
  expect(reduced).toBe(62);
  const cls = (await a11y(page)).bodyClasses;
  expect(cls).toContain('reduced-motion');
  expectNoErrors(errors);
});

test('text size, game speed, forgiving landings and colorblind/high-contrast palettes apply', async ({ page }) => {
  const errors = await openGame(page);
  await openSettings(page);
  await page.locator('#set-text').fill('150');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('24px');
  await page.locator('#set-speed').selectOption('0.5');
  await page.locator('#set-forgiving').check();
  await page.locator('#set-cb').check();
  expect((await a11y(page)).bodyClasses).toContain('cb-safe');
  await page.locator('#set-contrast').check();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
  });
  const s = await a11y(page);
  expect(s.timeScale).toBe(0.5);
  expect(s.sessionSettings.forgivingLandings).toBe(true);
  expect(s.sceneBackground).toBe('#000000');
  // Slow game speed: one real second simulates half a second.
  const ticks = await page.evaluate(() => window.__game.advance(1));
  expect(ticks).toBe(30);
  expectNoErrors(errors);
});

test('screen reader announcements and sound captions for tricks, quests and Bolts', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
    window.__game.place({ x: 0, z: -30, speed: 7 });
  });
  await tap(page, 'Space');
  await expect(page.locator('#captions')).toContainText('[board pop]');
  await advance(page, 1.2);
  await expect(page.locator('#captions')).toContainText('[clean landing]');
  await expect.poll(async () => (await a11y(page)).announcements.join(' | ')).toContain('Ollie');
  // Quest completion (Roll Out at 15 km/h already reached by the placement speed).
  await expect.poll(async () => (await a11y(page)).announcements.join(' | ')).toContain('Quest complete');
  await advance(page, 2);
  await expect.poll(async () => (await a11y(page)).announcements.join(' | ')).toContain('Bolts');
  // Live regions are polite and assertive.
  expect(await page.locator('#sr-polite').getAttribute('aria-live')).toBe('polite');
  expect(await page.locator('#sr-assertive').getAttribute('aria-live')).toBe('assertive');
  expectNoErrors(errors);
});

test('menus use dialog roles, headings and labelled controls', async ({ page }) => {
  const errors = await openGame(page);
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  await openSettings(page);
  // Every form control in settings has an accessible name.
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('#screen-settings input, #screen-settings select, #screen-settings button')]
      .filter((el) => {
        const id = el.id;
        const label = id && document.querySelector(`label[for="${id}"]`);
        return !(label && label.textContent.trim()) && !el.getAttribute('aria-label') && !el.textContent.trim();
      })
      .map((el) => el.outerHTML.slice(0, 80)),
  );
  expect(unnamed).toEqual([]);
  expectNoErrors(errors);
});

test('a bail shows "✖ Bail" with its reason (once) and is captioned as a crash, not a clean landing', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => {
    window.__game.startFreeRoam('training');
    window.__game.setManual(true);
    window.__game.place({ x: 0, z: -30, speed: 6 });
  });
  await tap(page, 'Space');
  await advance(page, 0.6);
  // Clear old captions so we only see what the landing produces.
  await page.evaluate(() => (document.querySelector('#captions').innerHTML = ''));
  await tap(page, 'KeyW');
  await advance(page, 0.3);
  expect((await state(page)).rider.state).toBe('bail');
  const text = await page.locator('#hud-trick').textContent();
  expect(text).toContain('✖ Bail');
  expect(text).toContain('under-rotated flip');
  expect(text).not.toContain('Bail Bail');
  await expect(page.locator('#captions')).toContainText('[crash]');
  await expect(page.locator('#captions')).not.toContainText('[clean landing]');
  expectNoErrors(errors);
});

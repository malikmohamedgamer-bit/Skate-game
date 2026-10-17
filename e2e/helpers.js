// Shared Playwright helpers.
import { expect } from '@playwright/test';

/** Open the game with a clean save and collect console errors. */
export async function openGame(page, { clearSave = true, query = '' } = {}) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  if (clearSave) {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('__e2e_cleared')) {
        localStorage.clear();
        sessionStorage.setItem('__e2e_cleared', '1');
      }
    });
  }
  await page.goto('/index.html' + query);
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 30_000 });
  return errors;
}

export async function state(page) {
  return page.evaluate(() => window.__game.state());
}

/** Advance the deterministic simulation by `seconds` while keys are held. */
export async function advance(page, seconds) {
  return page.evaluate((s) => window.__game.advance(s), seconds);
}

/** Hold a key down for `seconds` of simulated time. */
export async function hold(page, key, seconds) {
  await page.keyboard.down(key);
  await advance(page, seconds);
  await page.keyboard.up(key);
}

export async function tap(page, key) {
  await page.keyboard.down(key);
  await advance(page, 1 / 60);
  await page.keyboard.up(key);
}

export function expectNoErrors(errors) {
  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
}

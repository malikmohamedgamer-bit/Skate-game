// Soak test config: same browser setup as the e2e suite, only runs e2e/soak.spec.js.
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: /soak\.spec\.js/,
  timeout: 30 * 60_000,
});

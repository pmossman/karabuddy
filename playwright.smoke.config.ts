import { defineConfig, devices } from '@playwright/test';

// Smoke tests run against a LIVE deployed URL (a Vercel preview in CI, or
// any URL via SMOKE_BASE_URL) — NOT the local test server. No webServer, no
// pglite: this exercises the real build + real (isolated preview) DB end to
// end, the gate before promoting a commit to production. Kept separate from
// playwright.config.ts so the pglite e2e suite and these never mix.
const BASE_URL = process.env.SMOKE_BASE_URL;
if (!BASE_URL) {
  throw new Error('SMOKE_BASE_URL is required (the deployed preview URL to smoke-test)');
}

export default defineConfig({
  testDir: './test/smoke',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

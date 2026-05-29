import { defineConfig, devices } from '@playwright/test';

// E2E config. Starts the Next.js test server before tests, with env
// vars wired for the in-memory blob + test-mode endpoints. The test DB
// must already be up + migrated (test/e2e/global-setup.ts handles the
// migration step).
//
// Run: `npm run test:e2e` (starts everything)
// Or:  `npm run test:e2e:ui` for the Playwright inspector.
const PORT = 3001; // separate from dev to avoid clashing with `npm run dev`
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false, // shared DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // shared DB
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  globalSetup: './test/e2e/global-setup.ts',
  webServer: {
    // Use `next dev` for fast iteration; CI can override with `next start`
    // after a build, but for E2E correctness `next dev` is identical
    // to user-facing prod for our purposes (no build-time RSC distinction).
    command: `next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NODE_ENV: 'test',
      KARABUDDY_TEST_API: '1',
      KARABUDDY_DB_DRIVER: 'pg',
      KARABUDDY_BLOB_MODE: 'memory',
      KARABUDDY_TEST_ORIGIN: BASE_URL,
      POSTGRES_URL: process.env.POSTGRES_URL || 'postgres://karabuddy_test:karabuddy_test@localhost:5433/karabuddy_test',
      POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL || 'postgres://karabuddy_test:karabuddy_test@localhost:5433/karabuddy_test',
      AUTH_SECRET: 'test-secret-do-not-use-in-prod',
      AUTH_URL: BASE_URL,
      // Disable next-auth providers in test — we use the test-sign-in
      // endpoint instead. Real OAuth in tests is too flaky.
      AUTH_DISCORD_ID: 'unused-in-test',
      AUTH_DISCORD_SECRET: 'unused-in-test',
      AUTH_GOOGLE_ID: 'unused-in-test',
      AUTH_GOOGLE_SECRET: 'unused-in-test',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

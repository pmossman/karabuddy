import { defineConfig, devices } from '@playwright/test';

// Smoke tests against a real production BUILD (not the pglite test server).
// Two modes:
//   • SMOKE_BASE_URL set  → hit that live URL (e.g. a deployed preview).
//   • SMOKE_BASE_URL unset → boot `next start` here (CI-local smoke): CI runs
//     `next build` first, then this config starts the prod server against the
//     isolated ci-preview DB (POSTGRES_URL + KARABUDDY_BLOB_MODE=memory passed
//     in by the workflow) and smoke-tests localhost. This is the gate before
//     a fresh production deploy — verifies real build + real isolated DB end
//     to end without needing an (SSO-protected, Pro-only) Vercel preview.
const BASE_URL = process.env.SMOKE_BASE_URL;
const LOCAL_URL = 'http://localhost:3000';

export default defineConfig({
  testDir: './test/smoke',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL || LOCAL_URL,
    trace: 'on-first-retry',
  },
  // Boot the prebuilt prod server locally unless smoking a remote URL. Inherits
  // the workflow step's env (ci-preview POSTGRES_URL, memory blob, dummy auth).
  webServer: BASE_URL
    ? undefined
    : {
        command: 'npx next start -p 3000',
        url: LOCAL_URL,
        timeout: 120_000,
        reuseExistingServer: false,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

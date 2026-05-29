// Playwright global setup — runs once before all E2E tests.
//
// Responsibility: ensure the test DB schema is up to date. Migrations
// are idempotent so re-running between test runs is fine. The DB itself
// must already be running (docker compose -f docker-compose.test.yml up -d).
//
// We DON'T truncate here — each E2E test does its own fixture setup +
// teardown (or just lives with the previous test's state, which is OK
// for happy-path tests where each test makes its own user via the test
// sign-in endpoint).
import { execSync } from 'node:child_process';

export default async function globalSetup() {
  const url = process.env.POSTGRES_URL
    || 'postgres://karabuddy_test:karabuddy_test@localhost:5433/karabuddy_test';
  console.log('[e2e] applying migrations to', url.replace(/:[^:@]+@/, ':***@'));
  execSync('npx drizzle-kit migrate', {
    stdio: 'inherit',
    env: {
      ...process.env,
      POSTGRES_URL_NON_POOLING: url,
    },
  });
}

// Playwright global setup — runs once before all E2E tests.
//
// pglite mode (default): no-op. The dev server starts with an empty
// in-memory pglite + applies migrations on first DB access via a
// startup hook in `lib/db.ts` (well, not yet — see comment below).
// For now we just print a heads-up; the migration runs server-side on
// boot via the next custom server hook, OR more practically each test
// uses the test sign-in endpoint which lazy-creates schema on first
// touch.
//
// pg mode: defer to drizzle-kit migrate against the live Postgres.
import { execSync } from 'node:child_process';

export default async function globalSetup() {
  const driver = process.env.KARABUDDY_DB_DRIVER || 'pglite';
  if (driver === 'pg') {
    const url = process.env.POSTGRES_URL!;
    console.log('[e2e] applying migrations to', url.replace(/:[^:@]+@/, ':***@'));
    execSync('npx drizzle-kit migrate', {
      stdio: 'inherit',
      env: { ...process.env, POSTGRES_URL_NON_POOLING: url },
    });
  } else {
    console.log('[e2e] using in-process pglite — schema migrates on server boot');
  }
}

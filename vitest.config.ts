import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest config — splits tests into projects so the unit suite runs
// without DB and the API integration suite uses a real Postgres.
//
// Run `npm run test:unit` for fast feedback (pure logic, ~1s).
// Run `npm run test:api` for DB-backed integration tests (needs the
// Docker compose Postgres up + migrations applied).
// Run `npm test` to run everything.
export default defineConfig({
  test: {
    projects: [
      {
        // Pure logic — webapp libs + extension JS. No DB, no network.
        // Runs in Node, picks up `lib/**/*.test.ts` and `extension/**/*.test.js`.
        extends: false,
        test: {
          name: 'unit',
          include: [
            'lib/**/*.test.ts',
            'extension/**/*.test.js',
            'test/unit/**/*.test.ts',
          ],
          environment: 'node',
        },
        resolve: {
          alias: { '@': path.resolve(__dirname) },
        },
      },
      {
        // API integration — exercises route handlers + Drizzle against
        // the local Docker Postgres. setupFiles runs migrations once per
        // suite and gives each test a fresh schema via TRUNCATE.
        extends: false,
        test: {
          name: 'api',
          include: ['test/api/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['test/api/setup.ts'],
          // Long timeout for the migration setup on first run.
          hookTimeout: 30_000,
          // Serial so tests don't fight over the shared DB. Fast enough
          // at our scale; parallelism via separate transactions can
          // come later if test count grows.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
        resolve: {
          alias: { '@': path.resolve(__dirname) },
        },
      },
    ],
  },
});

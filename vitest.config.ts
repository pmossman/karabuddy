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
        // an in-process pglite Postgres (or pg if KARABUDDY_DB_DRIVER=pg
        // is set explicitly). setupFiles runs migrations once per suite
        // and gives each test a fresh schema via TRUNCATE CASCADE.
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
          env: {
            // Inline defaults so a bare `vitest run --project api` works
            // without the env-var prefix in package.json. npm scripts can
            // still override.
            KARABUDDY_DB_DRIVER: process.env.KARABUDDY_DB_DRIVER || 'pglite',
            KARABUDDY_BLOB_MODE: process.env.KARABUDDY_BLOB_MODE || 'memory',
            AUTH_SECRET: process.env.AUTH_SECRET || 'test-secret',
            AUTH_URL: process.env.AUTH_URL || 'http://localhost:3001',
            KARABUDDY_TEST_API: '1',
            NODE_ENV: 'test',
          },
        },
        resolve: {
          alias: { '@': path.resolve(__dirname) },
        },
      },
    ],
  },
});

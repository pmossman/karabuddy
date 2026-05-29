import { beforeAll, beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import { getDb, getPgliteClient } from '@/lib/db';

// API test setup. Default driver is pglite (in-process Postgres, zero
// install); the same tests also work against a real Postgres if
// KARABUDDY_DB_DRIVER=pg is set explicitly (e.g. in CI with the
// service-container Docker Postgres).
//
// Migrations run ONCE per suite via Drizzle's programmatic migrator
// (works with pglite; drizzle-kit migrate uses pg driver and can't talk
// to in-memory pglite). Each test gets a fresh schema via TRUNCATE
// CASCADE on every table — faster than drop+migrate, simpler than
// per-test transactions when handlers do their own queries.

const TABLES = [
  'replay_team_shares',
  'team_invites',
  'team_members',
  'teams',
  'tags',
  'replays',
  'extension_tokens',
  'sessions',
  'accounts',
  'verification_tokens',
  'users',
];

beforeAll(async () => {
  const driver = process.env.KARABUDDY_DB_DRIVER || 'pglite';
  if (driver === 'pglite') {
    // Programmatic pglite migration. Reads the drizzle/ folder same as
    // drizzle-kit migrate would.
    const drizzleDb = getDb();
    await migrate(drizzleDb, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  } else if (driver === 'pg') {
    // Defer to drizzle-kit for a real Postgres (CI / Docker path).
    const { execSync } = await import('node:child_process');
    execSync('npx drizzle-kit migrate', {
      stdio: 'inherit',
      env: { ...process.env, POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL! },
    });
  } else {
    throw new Error(`unsupported KARABUDDY_DB_DRIVER for tests: ${driver}`);
  }
});

beforeEach(async () => {
  const driver = process.env.KARABUDDY_DB_DRIVER || 'pglite';
  if (driver === 'pglite') {
    const client = getPgliteClient();
    await client.exec(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.POSTGRES_URL! });
    try {
      await pool.query(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
    } finally {
      await pool.end();
    }
  }
});

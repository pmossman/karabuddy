import { beforeAll, beforeEach } from 'vitest';

// API test environment. Runs ONCE per suite (beforeAll), connecting to
// the Docker compose Postgres and applying all migrations. Each test
// gets a fresh schema state via TRUNCATE on every table (faster than
// drop+migrate, simpler than per-test transactions when handlers run
// their own queries).
//
// Required env (set by `npm run test:api`):
//   POSTGRES_URL=postgres://karabuddy_test:karabuddy_test@localhost:5433/karabuddy_test
//   POSTGRES_URL_NON_POOLING=<same>
//   KARABUDDY_DB_DRIVER=pg
//   KARABUDDY_BLOB_MODE=memory
//   AUTH_SECRET=test-secret
//   AUTH_URL=http://localhost:3001
//   KARABUDDY_TEST_API=1
import { Pool } from 'pg';

const TEST_DB_URL = process.env.POSTGRES_URL!;

// Tables created by our migrations. TRUNCATE in dependency-safe order
// via CASCADE so we don't have to track FK chains by hand.
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
  if (!TEST_DB_URL) {
    throw new Error('POSTGRES_URL must be set for API tests');
  }
  // Apply migrations. We shell out to drizzle-kit because it's the
  // canonical migrator; Vitest tolerates the async work.
  const { execSync } = await import('node:child_process');
  execSync('npx drizzle-kit migrate', {
    stdio: 'inherit',
    env: { ...process.env, POSTGRES_URL_NON_POOLING: TEST_DB_URL },
  });
});

beforeEach(async () => {
  // Per-test wipe. Single CASCADE TRUNCATE statement on all tables.
  const pool = new Pool({ connectionString: TEST_DB_URL });
  try {
    await pool.query(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  } finally {
    await pool.end();
  }
});

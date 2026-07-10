import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

// Driver-agnostic db handle. Driver chosen via KARABUDDY_DB_DRIVER:
//   neon    (default, prod) — @neondatabase/serverless HTTP
//   pg      — standard pg driver (local Docker Postgres OR CI service)
//   pglite  — @electric-sql/pglite in-process Postgres (zero-install
//             local tests; data lives in-memory by default OR on disk
//             via KARABUDDY_PGLITE_PATH)
//
// All three adapters wrap the same Drizzle schema so route code is
// unaffected. Migrations apply identically to all three.
//
// We type the return as the neon adapter's shape (prod) so route code
// gets proper inference. The pg + pglite adapters are structurally
// compatible — same schema, same query API — so the runtime cast is
// safe; only edge cases like driver-specific extensions would differ.
type AnyDb = NeonHttpDatabase<typeof schema>;

function neonDb() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { neon } = require('@neondatabase/serverless');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/neon-http');
  const sql = neon(process.env.POSTGRES_URL!);
  return drizzle(sql, { schema });
}

let pgPool: any = null;
function pgDb() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/node-postgres');
  // KARABUDDY_PG_POOL_MAX lets batch scripts widen the pool for concurrency
  // (default = node-postgres' 10). No effect on the app, which never sets it.
  const max = Number(process.env.KARABUDDY_PG_POOL_MAX) || undefined;
  pgPool ||= new Pool({ connectionString: process.env.POSTGRES_URL!, max });
  return drizzle(pgPool, { schema });
}

// PGLite cache lives on globalThis so instrumentation.ts (which Next
// bundles separately from route handlers) shares the same in-memory
// DB instance as the rest of the app. Without this, the migrator
// would build the schema on one in-memory DB and route queries would
// hit a different one.
type PgliteGlobals = { __kbPglite?: any; __kbPgliteDrizzle?: any };
function pgliteDb() {
  const g = globalThis as unknown as PgliteGlobals;
  if (g.__kbPgliteDrizzle) return g.__kbPgliteDrizzle;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require('@electric-sql/pglite');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/pglite');
  // Memory-mode default; tests can opt into disk persistence via
  // KARABUDDY_PGLITE_PATH (useful for "share state across runs" debugging).
  const dataDir = process.env.KARABUDDY_PGLITE_PATH || 'memory://';
  g.__kbPglite ||= new PGlite(dataDir);
  g.__kbPgliteDrizzle = drizzle(g.__kbPglite, { schema });
  return g.__kbPgliteDrizzle;
}

// Internal helper for the test migrator — returns the raw pglite client
// so TRUNCATE / direct queries work without re-wrapping through drizzle.
export function getPgliteClient() {
  const g = globalThis as unknown as PgliteGlobals;
  if (!g.__kbPglite) pgliteDb();
  return g.__kbPglite;
}

export function getDb(): AnyDb {
  const driver = process.env.KARABUDDY_DB_DRIVER || 'neon';
  if (driver === 'pglite') return pgliteDb();
  if (driver === 'pg') return pgDb();
  return neonDb();
}

export type Db = AnyDb;

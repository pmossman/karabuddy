// Node-runtime-only instrumentation body. Imported dynamically from
// `instrumentation.ts` after the NEXT_RUNTIME=nodejs gate so the Edge
// bundle never tries to compile any of this.

export async function runNodeInstrumentation() {
  const driver = process.env.KARABUDDY_DB_DRIVER;
  if (driver !== 'pglite') return;
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const { getDb } = await import('./db');
  console.log('[karabuddy] applying pglite migrations…');
  // Cast: getDb()'s declared shape is the neon adapter (prod); in this
  // branch we know KARABUDDY_DB_DRIVER === 'pglite' so the actual
  // runtime instance is a PGliteDatabase. The migrator API is
  // structurally identical so the cast is safe.
  await migrate(getDb() as any, { migrationsFolder: process.cwd() + '/drizzle' });
  console.log('[karabuddy] pglite ready');
}

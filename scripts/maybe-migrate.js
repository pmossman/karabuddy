#!/usr/bin/env node
// Run pending Drizzle migrations as part of the Vercel PRODUCTION
// build. Skipped for previews, for local `npm run build`, and for CI —
// previews share a DB with prod (only one POSTGRES_URL env per Vercel
// project) and we don't want a PR's untested migration silently
// applying to prod before review; locally we use pglite for tests.
//
// Failure mode: if a migration fails here, the Vercel build fails
// → no broken deploy goes live. Migrations are sequenced via the
// drizzle/meta/_journal.json, so partial state is safe to re-attempt.

const env = process.env.VERCEL_ENV || '';
if (env !== 'production') {
  console.log(`[maybe-migrate] skip — VERCEL_ENV is "${env || '(unset)'}"`);
  process.exit(0);
}

if (!process.env.POSTGRES_URL) {
  console.error('[maybe-migrate] POSTGRES_URL missing on production build');
  process.exit(1);
}

// Validate the journal BEFORE migrating. drizzle applies entries whose
// `when` is greater than the last-applied timestamp, so a non-monotonic
// `when` would be SILENTLY SKIPPED (no error, table just never created →
// runtime 500s). Fail the build loudly instead. (CI's unit test catches
// this at PR time too; this is the last line of defense at deploy.)
const { validateMigrationJournal } = require('./validate-migration-journal');
const journalErrors = validateMigrationJournal(require('path').join(__dirname, '..'));
if (journalErrors.length > 0) {
  console.error('[maybe-migrate] migration journal is invalid — aborting before migrate:');
  for (const e of journalErrors) console.error('  • ' + e);
  process.exit(1);
}

const { execSync } = require('child_process');
console.log('[maybe-migrate] running drizzle-kit migrate against production…');
try {
  execSync('npx drizzle-kit migrate', { stdio: 'inherit' });
  console.log('[maybe-migrate] migrations applied');
} catch (err) {
  console.error('[maybe-migrate] migration failed:', err && err.message || err);
  process.exit(1);
}

// One-shot B71/B74 recovery: backfill tag_team_scope for pre-B71 tags.
//
// Per replay: explicit shares win; else the single MULTI-MEMBER team common
// to all member-taggers (solo teams excluded); else personal. See
// lib/tagScope.backfillTagScopes for the full rule + not-idempotent caveat.
//
// Targets whatever DB the env points at (same precedence as drizzle.config):
// locally that's the Docker dev DB via .env.development.local; to run against
// PROD, run with prod creds, e.g.:
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<prod>" npx tsx scripts/backfill-tag-scope.ts
//
// Run (local): npx tsx scripts/backfill-tag-scope.ts
import { config } from 'dotenv';
config({ path: '.env.development.local' });
config({ path: '.env.local' });

import { backfillTagScopes } from '../lib/tagScope';

(async () => {
  const res = await backfillTagScopes();
  console.log(
    `[backfill-tag-scope] scanned ${res.scanned} unscoped tag(s); recovered ${res.replaysRecovered} replay(s); wrote ${res.scoped} scope row(s)`,
  );
  process.exit(0);
})().catch((err) => {
  console.error('[backfill-tag-scope] failed:', err);
  process.exit(1);
});

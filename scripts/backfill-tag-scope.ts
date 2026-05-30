// One-shot B71 migration: backfill tag_team_scope for pre-B71 tags.
//
// A tag on a replay shared with exactly one team is scoped to that team;
// replays shared with 0 or 2+ teams leave their tags personal. See
// lib/tagScope.backfillTagScopes for the rule + the not-idempotent caveat.
//
// Run: tsx scripts/backfill-tag-scope.ts
import { backfillTagScopes } from '../lib/tagScope';

(async () => {
  const res = await backfillTagScopes();
  console.log(
    `[backfill-tag-scope] scanned ${res.scanned} unscoped tag(s); scoped ${res.scoped} to a single-share team`,
  );
  process.exit(0);
})().catch((err) => {
  console.error('[backfill-tag-scope] failed:', err);
  process.exit(1);
});

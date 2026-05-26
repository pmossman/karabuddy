// One-off: for any replay whose tags table is empty, fetch its Blob
// payload, parse `tags`, and insert them. Idempotent — re-running just
// processes any newly-uploaded replays that pre-date the tag-migration
// fix in /api/replays POST.
//
// Usage:  npx tsx scripts/backfill-tags.ts [slug]
//   With no arg: scan every replay row.
//   With a slug: backfill just that one.

import 'dotenv/config';
import { config as dotenvConfig } from 'dotenv';
import { eq } from 'drizzle-orm';

dotenvConfig({ path: '.env.local' });

async function main() {
  const { getDb } = await import('../lib/db');
  const { replays, tags } = await import('../lib/schema');
  const { generateTagId } = await import('../lib/slug');

  const argSlug = process.argv[2];
  const db = getDb();
  const rows = argSlug
    ? await db.select().from(replays).where(eq(replays.slug, argSlug))
    : await db.select().from(replays);

  console.log(`scanning ${rows.length} replay(s)…`);

  for (const row of rows) {
    const existing = await db.select().from(tags).where(eq(tags.replaySlug, row.slug));
    const existingIds = new Set(existing.map((t) => t.id));
    const res = await fetch(row.payloadBlobUrl);
    if (!res.ok) {
      console.log(`  ${row.slug}: payload fetch failed (${res.status}) — skipping`);
      continue;
    }
    const parsed = await res.json();
    const payloadTags = Array.isArray(parsed.tags) ? parsed.tags : [];
    if (payloadTags.length === 0) {
      console.log(`  ${row.slug}: no tags in payload`);
      continue;
    }
    const missing = payloadTags
      .filter((t: any) => Number.isFinite(t?.frameIndex))
      .map((t: any) => ({
        id: t.id || generateTagId(),
        replaySlug: row.slug,
        frameIndex: Math.max(0, Math.floor(t.frameIndex)),
        authorToken: row.ownerToken,
        authorName: String(t.author || 'anon'),
        comment: String(t.comment || ''),
      }))
      .filter((t: any) => !existingIds.has(t.id));
    if (missing.length === 0) {
      console.log(`  ${row.slug}: all ${payloadTags.length} payload tag(s) already migrated`);
      continue;
    }
    await db.insert(tags).values(missing);
    console.log(`  ${row.slug}: backfilled ${missing.length} of ${payloadTags.length} payload tag(s) (${existing.length} pre-existing)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

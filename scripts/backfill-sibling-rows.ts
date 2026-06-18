// B166 one-shot backfill: split historically FOLDED double-sided replays into
// independent per-recorder rows.
//
// Before B166, when two teammates both recorded a game the 2nd recording was
// folded into the 1st recorder's row as a `replay_alt_payload` (the 2nd recorder
// got no row of their own). B166 makes every recorder keep an independent row and
// composes "double-sided" at runtime from the two sibling rows. This backfill
// materializes the missing sibling row from each existing alt payload so:
//   - the 2nd recorder gets their own one-sided "My Replay", and
//   - the /perspective endpoint (now sibling-sourced) keeps serving the 2nd POV
//     for these historical games.
//
// The new row copies the SHARED game metadata (gameId, players, match, decks,
// winners, createdAt) from the canonical row — same physical game — and the
// POV-specific bits (payload blob, ownerPlayerId, actionCount, clientMeta) from
// the alt payload. The alt_payload rows are LEFT IN PLACE (dropping the table is
// a later contract step); this backfill is purely additive and safe to run while
// the old code is still live (the new rows aren't shared, so they don't surface).
//
// Idempotent: skips when a row already exists for (gameId, altUserId).
//
// Run (DRY RUN by default — prints what it would do):
//   tsx scripts/backfill-sibling-rows.ts
// Apply for real (against whatever POSTGRES_URL/driver the env points at):
//   tsx scripts/backfill-sibling-rows.ts --apply
// For a deliberate PROD run pass prod creds explicitly, e.g.:
//   KARABUDDY_DB_DRIVER=pg POSTGRES_URL="<prod>" tsx scripts/backfill-sibling-rows.ts --apply

import { and, eq } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { replays, replayAltPayload } from '../lib/schema';
import { put } from '../lib/blob';
import { generateSlug } from '../lib/slug';

const CACHE_MAX_AGE_SECONDS = 300; // mirror the upload route (blob is overwritten in place on later upserts)

export async function backfillSiblingRows({ apply, log = () => {} }: { apply: boolean; log?: (m: string) => void }): Promise<{ created: number; skipped: number; orphaned: number }> {
  const db = getDb();

  const alts = await db.select().from(replayAltPayload);
  log(`${apply ? 'APPLY' : 'DRY RUN'}: scanning ${alts.length} alt payload(s)`);

  let created = 0, skipped = 0, orphaned = 0;
  for (const alt of alts) {
    if (!alt.altUserId) {
      // The alt recorder's account is gone — nothing to attribute a row to.
      orphaned++;
      log(`  ${alt.replaySlug}: skip (alt recorder account deleted)`);
      continue;
    }
    const [canonical] = await db.select().from(replays).where(eq(replays.slug, alt.replaySlug)).limit(1);
    if (!canonical) {
      skipped++;
      log(`  ${alt.replaySlug}: skip (canonical row missing)`);
      continue;
    }
    if (canonical.userId === alt.altUserId) {
      skipped++;
      log(`  ${alt.replaySlug}: skip (canonical already owned by alt recorder)`);
      continue;
    }

    // Idempotency: does the alt recorder already have a row for this game?
    const [existing] = await db
      .select({ slug: replays.slug })
      .from(replays)
      .where(and(eq(replays.gameId, canonical.gameId), eq(replays.userId, alt.altUserId)))
      .limit(1);
    if (existing) {
      skipped++;
      log(`  ${alt.replaySlug}: skip (sibling row already exists: ${existing.slug})`);
      continue;
    }

    const slug = generateSlug();
    if (!apply) {
      log(`  ${alt.replaySlug}: WOULD create row ${slug} (user ${alt.altUserId}, game ${canonical.gameId}, pov ${alt.altOwnerPlayerId})`);
      created++;
      continue;
    }

    const blob = await put(`replays/${slug}.json`, alt.payload, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: CACHE_MAX_AGE_SECONDS,
    });
    await db.insert(replays).values({
      slug,
      gameId: canonical.gameId,
      userId: alt.altUserId,
      // Synthetic owner token: these rows are account-owned; the token only has
      // to be non-null + distinct. Deterministic so a re-run can't collide.
      ownerToken: `kbx_backfill_${slug}`,
      players: canonical.players,
      durationMs: canonical.durationMs,
      actionCount: alt.altActionCount,
      payloadBlobUrl: blob.url,
      payloadSizeBytes: alt.payload.length,
      match: canonical.match,
      decks: canonical.decks,
      winners: canonical.winners,
      ownerPlayerId: alt.altOwnerPlayerId,
      clientMeta: alt.altClientMeta ?? null,
      createdAt: canonical.createdAt,
    });
    // NB: deliberately NOT recording a replay_participants row for the sibling.
    // The B166 code derives intra-team / "internal" detection from replays.userId
    // grouped by gameId, not participants — and adding one would let the STILL-LIVE
    // old code (participant-based stats) double-count during the deploy window.
    created++;
    log(`  ${alt.replaySlug}: created sibling row ${slug} for ${alt.altUserId}`);
  }

  log(`${apply ? 'created' : 'would create'} ${created}; skipped ${skipped}; orphaned ${orphaned}`);
  return { created, skipped, orphaned };
}

// CLI entry. Importing this module (e.g. from a test) does NOT run it.
if (process.argv[1] && process.argv[1].includes('backfill-sibling-rows')) {
  backfillSiblingRows({ apply: process.argv.includes('--apply'), log: (m) => console.log(m) })
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}

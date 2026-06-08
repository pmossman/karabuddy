import { NextResponse } from 'next/server';
import { put } from '@/lib/blob';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, replayAltPayload, replayParticipants, replayTeamShares, tags, teamMembers } from '@/lib/schema';
import { sharedTeam } from '@/lib/altPerspective';
import { sanitizeClientMeta } from '@/lib/clientMeta';
import { generateSlug, generateTagId } from '@/lib/slug';
import { corsHeaders, preflight } from '@/lib/cors';
import { resolveUserId } from '@/lib/userResolution';
import { sanitizeIncomingMentions } from '@/lib/mentions';
import { decodeReplay, extractWinners, mergeDecks, reconstructFinalState } from '@/lib/replayDecoder';
import { persistReplayFacts } from '@/lib/statsPersist';
import { resolveTagScope, writeTagScope } from '@/lib/tagScope';

export const runtime = 'nodejs';
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

export function OPTIONS(req: Request) {
  return preflight(req);
}

// B71: the extension's bubble arms a set of teams to share this match's
// replay with. Apply those shares as part of the upload (validated:
// uploader must be a member of each) BEFORE lifting tags, so the lifted
// in-game tags' default scope resolves to the just-created shares. Returns
// nothing — idempotent, best-effort (a bad slug just doesn't share).
async function applyUploadShares(slug: string, userId: string | null, shareTeamSlugs: unknown): Promise<void> {
  if (!userId || !Array.isArray(shareTeamSlugs) || shareTeamSlugs.length === 0) return;
  const requested = shareTeamSlugs.filter((s): s is string => typeof s === 'string');
  if (requested.length === 0) return;
  const db = getDb();
  // Only teams the uploader actually belongs to (same guard as the
  // team-shares endpoint — can't pollute a team you're not in).
  const memberRows = await db
    .select({ teamSlug: teamMembers.teamSlug })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), inArray(teamMembers.teamSlug, requested)));
  if (memberRows.length === 0) return;
  await db
    .insert(replayTeamShares)
    .values(memberRows.map((m) => ({ replaySlug: slug, teamSlug: m.teamSlug, sharedBy: userId })))
    .onConflictDoNothing();
}

// B84: register the uploader's karabuddy account as a participant (recorder)
// of this replay. Idempotent. When two teammates both record the same match,
// both get rows → account-based intra-team detection, no karabast usernames.
// B101/P0: materialize Stats/Meta facts for this upload (ADR 0007). Guarded —
// must NEVER fail the upload (same posture as notifyMentions). Idempotent on
// gameId, so re-running on a re-upload just refreshes. Decoding all frames is
// bounded work; we only call this on the new-insert path + the final (winner-
// present) snapshot, not on every mid-match periodic snapshot (perf — a P1
// rollup/cron can revisit). The backfill covers historical replays.
async function persistStatsSafe(slug: string, parsed: any, gameId: string, winners: string[] | null): Promise<void> {
  try {
    const decoded = decodeReplay(parsed);
    await persistReplayFacts({
      decoded,
      replaySlug: slug,
      gameId,
      winners,
      ownerPlayerId: typeof parsed.localPlayerId === 'string' ? parsed.localPlayerId : null,
      durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : null,
    });
  } catch (e) {
    console.error('[stats] persistReplayFacts failed for', slug, e);
  }
}

async function recordParticipant(slug: string, userId: string | null): Promise<void> {
  if (!userId) return;
  await getDb().insert(replayParticipants).values({ replaySlug: slug, userId }).onConflictDoNothing();
}

// B71: scope each lifted payload tag. Default (no per-tag teamSlugs) →
// the replay's shares (just applied above); an explicit teamSlugs on the
// tag narrows it. resolveTagScope clamps to (shares ∩ author memberships).
async function scopeLiftedTags(
  slug: string,
  userId: string | null,
  payloadTags: any[],
): Promise<void> {
  for (const t of payloadTags) {
    if (!Number.isFinite(t?.frameIndex) || !t?.id) continue;
    const requested = Array.isArray(t.teamSlugs)
      ? t.teamSlugs.filter((s: unknown) => typeof s === 'string')
      : undefined;
    const scope = await resolveTagScope({ replaySlug: slug, authorUserId: userId, requested });
    await writeTagScope(t.id, scope);
  }
}

// POST /api/replays — upload a replay payload + create metadata row.
// Body shape: { installToken, payload: string (JSON of the .karareplay file) }
// Returns: { slug, url }
export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const body = await req.json();
    const installToken: string = String(body.installToken || '').trim();
    const payloadText: string = typeof body.payload === 'string' ? body.payload : '';
    // B71: teams the bubble armed for this match. Applied as replay shares
    // (validated) and used as the default audience for lifted in-game tags.
    const shareTeamSlugs: unknown = body.shareTeamSlugs;
    // B114: recorder/client metadata the extension SW attached (ext version,
    // browser). Untrusted → whitelist + length-cap. Null for web / pre-B114.
    const clientMeta = sanitizeClientMeta(body.clientMeta);
    if (!installToken) {
      return NextResponse.json({ ok: false, error: 'installToken required' }, { status: 400, headers });
    }
    if (!payloadText) {
      return NextResponse.json({ ok: false, error: 'payload required' }, { status: 400, headers });
    }
    if (payloadText.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload too large' }, { status: 413, headers });
    }

    // Validate the payload looks like one of our replays — version + events
    // + an initial gamestate snapshot we can read player metadata from.
    let parsed: any;
    try { parsed = JSON.parse(payloadText); } catch {
      return NextResponse.json({ ok: false, error: 'payload is not valid JSON' }, { status: 400, headers });
    }
    if (parsed?.version !== 1 && parsed?.version !== 2) {
      return NextResponse.json({ ok: false, error: 'unsupported replay version' }, { status: 400, headers });
    }
    const firstGamestate = (parsed.events || []).find(
      (e: any) => e.event === 'gamestate' && e.args?.[0]
    );
    const snapshot = firstGamestate?.args?.[0]?.full
      || (parsed.version === 1 ? firstGamestate?.args?.[0] : null);
    const gameId: string | null = snapshot?.id || null;
    if (!gameId) {
      return NextResponse.json({ ok: false, error: 'no gameId in payload' }, { status: 400, headers });
    }
    const players = snapshot?.players
      ? Object.entries(snapshot.players).map(([id, p]: [string, any]) => ({
          // B59: keep the playerId on each serialized player so the UI
          // can match winners[] → player and render the W/L badge.
          id,
          username: p.user?.username || '',
          leader: p.leader ? { name: p.leader.name || '', set: p.leader.setId?.set || '', number: p.leader.setId?.number || 0 } : null,
          base: p.base ? { name: p.base.name || '', set: p.base.setId?.set || '', number: p.base.setId?.number || 0 } : null,
        }))
      : [];

    const db = getDb();
    const userId = await resolveUserId({ installToken });

    // B59: reconstruct the FINAL gamestate by applying all gamestate
    // patches in order, then extract winners from it. The recorder
    // emits one {full:...} at start and {patch:...} deltas after — a
    // naïve "last gamestate" read returns a delta object with no
    // winner field. Reconstruction handles both the (rare) full-only
    // case AND the (common) full + N patches case.
    const finalSnapshot = reconstructFinalState(parsed);
    const winners = extractWinners(finalSnapshot);

    // Upsert by gameId. The recorder fires periodic snapshots during an
    // active match (B26) plus the final on game-end; each one overwrites the
    // existing blob + metadata + upserts payload-carried tags. Same slug
    // throughout the match so the in-game "Open on karabuddy →" link is
    // stable and karabuddy-side tag edits aren't blown away.
    const existing = await db.select().from(replays).where(eq(replays.gameId, gameId)).limit(1);
    if (existing.length > 0) {
      const replay = existing[0];

      // Different owner uploading the same gameId = both players in the match
      // have the extension. Preserve the original recording's ownership and
      // return its slug (today's behavior; a (gameId, ownerToken) unique
      // constraint to give each player their own row is its own task).
      const sameOwner = replay.ownerToken === installToken;
      const sameUser = replay.userId && userId && replay.userId === userId;
      if (!sameOwner && !sameUser) {
        // B82: teammate-vs-teammate — both players recorded the same match.
        // Don't discard the second upload's deck snapshot; merge it into the
        // canonical replay so the (otherwise-masked) opponent's FULL list is
        // known — a complete-information review. Decks are immutable per match,
        // so this is a safe idempotent enrich. The first uploader's POV/frames
        // stay canonical (we don't overwrite the recording itself).
        let enriched = false;
        if (parsed.decks) {
          const merged = mergeDecks(replay.decks as any, parsed.decks);
          if (merged) {
            await db.update(replays).set({ decks: merged }).where(eq(replays.slug, replay.slug));
            enriched = true;
          }
        }
        // B112: double-sided replays. Retain the 2nd recording (this player's
        // POV, with THEIR hand unmasked) as the alt perspective — but ONLY when
        // both recorders are accounts on the SAME team (the privacy gate: a
        // stranger who happens to record the same gameId never gets their hand
        // stored as someone's alt). Stale-guard against the alt recorder's own
        // periodic snapshots (it uploads periodic + finalize, like the canonical
        // side). Served only via the auth-gated /perspective endpoint.
        let altStored = false;
        if (userId && replay.userId && (await sharedTeam(replay.userId, userId))) {
          const incomingActionCount = parsed.actionCount || 0;
          const [existingAlt] = await db
            .select({ altActionCount: replayAltPayload.altActionCount })
            .from(replayAltPayload)
            .where(eq(replayAltPayload.replaySlug, replay.slug))
            .limit(1);
          if (!existingAlt || incomingActionCount >= existingAlt.altActionCount) {
            const altValues = {
              altUserId: userId,
              altOwnerPlayerId: typeof parsed.localPlayerId === 'string' ? parsed.localPlayerId : null,
              altActionCount: incomingActionCount,
              payload: payloadText,
              // B114: the ALT recorder's ext version — so a double-sided replay
              // records BOTH sides' clients. Only overwrite when present (don't
              // null out a stored value from a client that didn't send it).
              ...(clientMeta ? { altClientMeta: clientMeta } : {}),
            };
            await db
              .insert(replayAltPayload)
              .values({ replaySlug: replay.slug, ...altValues })
              .onConflictDoUpdate({ target: replayAltPayload.replaySlug, set: altValues });
            altStored = true;
          }
        }
        // B84: the 2nd teammate is now a recorded participant (account-based
        // intra-team detection + the match shows in their library too).
        await recordParticipant(replay.slug, userId);
        return NextResponse.json({ ok: true, slug: replay.slug, url: `/r/${replay.slug}`, deduped: true, enrichedDecks: enriched, altStored }, { headers });
      }

      // Stale-snapshot guard: a finalize-upload can race with an in-flight
      // periodic snapshot. The recording array grows monotonically within a
      // single match, so a payload carrying fewer actions than the latest
      // saved state is by definition older. Reject so finalize wins.
      const incomingActionCount = parsed.actionCount || 0;
      if (incomingActionCount < replay.actionCount) {
        return NextResponse.json({ ok: true, slug: replay.slug, url: `/r/${replay.slug}`, staleSnapshot: true }, { headers });
      }

      // Overwrite the existing blob in place. `addRandomSuffix: false` pins
      // the path; in @vercel/blob 0.27.x this silently overwrites an existing
      // blob at the same path (no explicit allowOverwrite flag needed at this
      // version).
      await put(`replays/${replay.slug}.json`, payloadText, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });

      // Refresh metadata; bump userId if the install has since claimed an
      // account (resolveUserId can promote null → real userId).
      //
      // B42: `match` is OK to overwrite — it might change mid-match (e.g.
      // bo3 score updates). `decks` is set ONCE on first write and never
      // re-written; the deck registered at match start is canonical, and
      // periodic snapshots shouldn't overwrite it with a possibly-null
      // value (e.g. if the recorder lost lobby state across a refresh).
      const updates: Record<string, unknown> = {
        userId: userId || replay.userId,
        players,
        durationMs: parsed.durationMs || 0,
        actionCount: parsed.actionCount || 0,
        payloadSizeBytes: payloadText.length,
      };
      if (parsed.match !== undefined) updates.match = parsed.match;
      if (!replay.decks && parsed.decks) updates.decks = parsed.decks;
      // B114: refresh the recorder's client metadata (latest upload wins) —
      // only when this upload carried it, so we don't null a stored value.
      if (clientMeta) updates.clientMeta = clientMeta;
      // B59: only write winners on the upsert path if we actually
      // detected them THIS upload. A periodic snapshot before game-end
      // shouldn't clobber a previously-extracted winner.
      if (winners !== null) updates.winners = winners;
      await db.update(replays).set(updates).where(eq(replays.slug, replay.slug));

      // Upsert payload-carried tags. New tag ids are inserted; existing ids
      // get their mutable fields refreshed from the extension's local copy
      // (so extension-side edits during a match propagate). Tags added on
      // karabuddy.app aren't in the payload and stay untouched.
      const payloadTagsExisting = (Array.isArray(parsed.tags) ? parsed.tags : [])
        .filter((t: any) => Number.isFinite(t?.frameIndex));
      // Normalise ids up-front so the insert and the scope-write below use
      // the same id (B71 scoping reads t.id).
      for (const t of payloadTagsExisting) if (!t.id) t.id = generateTagId();
      const validTags = payloadTagsExisting.map((t: any) => {
        // B55c: extension may now include structured mentions on tags.
        const m = sanitizeIncomingMentions(t.mentions);
        return {
          id: t.id,
          replaySlug: replay.slug,
          frameIndex: Math.max(0, Math.floor(t.frameIndex)),
          userId,
          authorToken: installToken,
          authorName: String(t.author || 'anon'),
          comment: String(t.comment || ''),
          mentions: m.userIds.length || m.teamSlugs.length ? m : null,
        };
      });
      if (validTags.length > 0) {
        await db.insert(tags).values(validTags).onConflictDoUpdate({
          target: tags.id,
          set: {
            comment: sql`excluded.comment`,
            authorName: sql`excluded.author_name`,
            frameIndex: sql`excluded.frame_index`,
            mentions: sql`excluded.mentions`,
          },
        });
      }
      // B71: apply the bubble's armed shares, then scope the lifted tags.
      await applyUploadShares(replay.slug, userId, shareTeamSlugs);
      await scopeLiftedTags(replay.slug, userId, payloadTagsExisting);
      await recordParticipant(replay.slug, userId);
      // Refresh stats only once the game has ended (winner present) — skips the
      // re-decode on every mid-match periodic snapshot.
      if (winners) await persistStatsSafe(replay.slug, parsed, gameId, winners);

      return NextResponse.json({ ok: true, slug: replay.slug, url: `/r/${replay.slug}`, snapshot: true }, { headers });
    }

    // New row → write payload to Blob, then insert metadata.
    const slug = generateSlug();
    const blob = await put(`replays/${slug}.json`, payloadText, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });

    await db.insert(replays).values({
      slug,
      gameId,
      userId,
      ownerToken: installToken,
      players,
      durationMs: parsed.durationMs || 0,
      actionCount: parsed.actionCount || 0,
      payloadBlobUrl: blob.url,
      payloadSizeBytes: payloadText.length,
      // B42: nullable JSONB columns — undefined for replays uploaded by
      // pre-B42 extension versions, populated for new uploads.
      match: parsed.match ?? null,
      decks: parsed.decks ?? null,
      winners,
      // B59-followup: stash the recorder's POV so the "Wins" filter on
      // /replays?tab=mine knows which player was "me" without a per-
      // row karabast-username lookup.
      ownerPlayerId: typeof parsed.localPlayerId === 'string' ? parsed.localPlayerId : null,
      // B114: recorder/client metadata (ext version, browser) — null for web
      // uploads + pre-B114 extensions.
      clientMeta,
    });

    // Lift tags embedded in the payload into the tags table so the viewer
    // page reads them via the same relational source as web-added tags.
    // Same user-attribution logic as the replay row: signed-in or matched
    // by karabastUsername → userId; otherwise anon by installToken.
    const payloadTags = (Array.isArray(parsed.tags) ? parsed.tags : [])
      .filter((t: any) => Number.isFinite(t?.frameIndex));
    for (const t of payloadTags) if (!t.id) t.id = generateTagId();
    if (payloadTags.length > 0) {
      await db.insert(tags).values(
        payloadTags.map((t: any) => {
          const m = sanitizeIncomingMentions(t.mentions);
          return {
            id: t.id,
            replaySlug: slug,
            frameIndex: Math.max(0, Math.floor(t.frameIndex)),
            userId,
            authorToken: installToken,
            authorName: String(t.author || 'anon'),
            comment: String(t.comment || ''),
            mentions: m.userIds.length || m.teamSlugs.length ? m : null,
          };
        })
      );
    }
    // B71: apply the bubble's armed shares, then scope the lifted tags
    // (default → the just-applied shares; per-tag teamSlugs narrows).
    await applyUploadShares(slug, userId, shareTeamSlugs);
    await scopeLiftedTags(slug, userId, payloadTags);
    await recordParticipant(slug, userId);
    await persistStatsSafe(slug, parsed, gameId, winners);

    return NextResponse.json({ ok: true, slug, url: `/r/${slug}` }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] POST /api/replays failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

// GET /api/replays?owner=<installToken> — an install's library (the token is
// the view-only auth signal, B54). B85: no public list — without an owner there's
// nothing to return (replays are link-accessible + team-shared, never browsable).
export async function GET(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const url = new URL(req.url);
    const owner = url.searchParams.get('owner');
    if (!owner) return NextResponse.json({ ok: true, data: [] }, { headers });
    const db = getDb();
    const rows = await db.select().from(replays).where(eq(replays.ownerToken, owner)).orderBy(desc(replays.createdAt)).limit(100);
    return NextResponse.json({ ok: true, data: rows }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] GET /api/replays failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

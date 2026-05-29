import { NextResponse } from 'next/server';
import { put } from '@/lib/blob';
import { desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, tags } from '@/lib/schema';
import { generateSlug, generateTagId } from '@/lib/slug';
import { corsHeaders, preflight } from '@/lib/cors';
import { resolveUserId } from '@/lib/userResolution';
import { sanitizeIncomingMentions } from '@/lib/mentions';
import { extractWinners, lastGamestateSnapshot } from '@/lib/replayDecoder';

export const runtime = 'nodejs';
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

export function OPTIONS(req: Request) {
  return preflight(req);
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
    const recordedUsername = players.find((p: any) => p?.username)?.username || null;
    const userId = await resolveUserId({ installToken, recordedUsername });

    // B59: extract winner(s) from the LAST gamestate snapshot in the
    // payload. Periodic snapshots before game-end produce null here;
    // the final snapshot at game-end carries the winner signal.
    const finalSnapshot = lastGamestateSnapshot(parsed);
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
        return NextResponse.json({ ok: true, slug: replay.slug, url: `/r/${replay.slug}`, deduped: true }, { headers });
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
      // B59: only write winners on the upsert path if we actually
      // detected them THIS upload. A periodic snapshot before game-end
      // shouldn't clobber a previously-extracted winner.
      if (winners !== null) updates.winners = winners;
      await db.update(replays).set(updates).where(eq(replays.slug, replay.slug));

      // Upsert payload-carried tags. New tag ids are inserted; existing ids
      // get their mutable fields refreshed from the extension's local copy
      // (so extension-side edits during a match propagate). Tags added on
      // karabuddy.app aren't in the payload and stay untouched.
      const payloadTagsExisting = Array.isArray(parsed.tags) ? parsed.tags : [];
      const validTags = payloadTagsExisting
        .filter((t: any) => Number.isFinite(t?.frameIndex))
        .map((t: any) => {
          // B55c: extension may now include structured mentions on tags.
          const m = sanitizeIncomingMentions(t.mentions);
          return {
            id: t.id || generateTagId(),
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
      visibility: 'unlisted',
    });

    // Lift tags embedded in the payload into the tags table so the viewer
    // page reads them via the same relational source as web-added tags.
    // Same user-attribution logic as the replay row: signed-in or matched
    // by karabastUsername → userId; otherwise anon by installToken.
    const payloadTags = Array.isArray(parsed.tags) ? parsed.tags : [];
    if (payloadTags.length > 0) {
      await db.insert(tags).values(
        payloadTags
          .filter((t: any) => Number.isFinite(t?.frameIndex))
          .map((t: any) => {
            const m = sanitizeIncomingMentions(t.mentions);
            return {
              id: t.id || generateTagId(),
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

    return NextResponse.json({ ok: true, slug, url: `/r/${slug}` }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] POST /api/replays failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

// GET /api/replays?owner=<installToken> — list replays. With no owner param,
// returns recent public replays; with owner, returns that token's library
// (regardless of whether the install has been claimed by an account — the
// token itself is the auth signal for view-only access, B54).
export async function GET(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const url = new URL(req.url);
    const owner = url.searchParams.get('owner');
    const db = getDb();
    const rows = owner
      ? await db.select().from(replays).where(eq(replays.ownerToken, owner)).orderBy(desc(replays.createdAt)).limit(100)
      : await db.select().from(replays).where(eq(replays.visibility, 'public')).orderBy(desc(replays.createdAt)).limit(50);
    return NextResponse.json({ ok: true, data: rows }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] GET /api/replays failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}

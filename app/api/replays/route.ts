import { NextResponse } from 'next/server';
import { put } from '@/lib/blob';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, replayParticipants, replayTeamShares, tags, teamMembers, teams } from '@/lib/schema';
import { shareAllowed } from '@/lib/privateTeams';
import { sanitizeClientMeta } from '@/lib/clientMeta';
import { generateSlug, generateTagId } from '@/lib/slug';
import { corsHeaders, preflight } from '@/lib/cors';
import { resolveUserId } from '@/lib/userResolution';
import { sanitizeIncomingMentions } from '@/lib/mentions';
import { extractWinners, reconstructFinalState } from '@/lib/replayDecoder';
import { mergeSlices, sliceHasKeys } from '@/lib/replayMerge';
import { persistReplayStats } from '@/lib/replayStatsPersist';
import { resolveTagScope, writeTagScope } from '@/lib/tagScope';

export const runtime = 'nodejs';
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
// The replay payload blob is overwritten in place at a stable path as a game
// streams in, so it's a MUTABLE resource and must not get the @vercel/blob
// default 1-year browser cache (which permanently pins an early partial fetch).
const PAYLOAD_CACHE_MAX_AGE_SECONDS = 300;

export function OPTIONS(req: Request) {
  return preflight(req);
}

// B71: the extension's bubble arms a set of teams to share this match's
// replay with. Apply those shares as part of the upload (validated:
// uploader must be a member of each) BEFORE lifting tags, so the lifted
// in-game tags' default scope resolves to the just-created shares. Returns
// nothing — idempotent, best-effort (a bad slug just doesn't share).
async function applyUploadShares(
  slug: string,
  userId: string | null,
  shareTeamSlugs: unknown,
  // B170/ADR 0010: the replay's encryption state. shareAllowed() drops any share
  // that would put plaintext into a private team or ciphertext into a non-private
  // team (the server-side backstop — see lib/privateTeams).
  encrypted: boolean = false,
  replayTeamKeyId: string | null = null,
): Promise<void> {
  if (!userId || !Array.isArray(shareTeamSlugs) || shareTeamSlugs.length === 0) return;
  const requested = shareTeamSlugs.filter((s): s is string => typeof s === 'string');
  if (requested.length === 0) return;
  const db = getDb();
  // Only teams the uploader actually belongs to (same guard as the
  // team-shares endpoint — can't pollute a team you're not in), with each
  // team's privacy state so we can enforce share compatibility.
  const memberRows = await db
    .select({ teamSlug: teamMembers.teamSlug, privateMode: teams.privateMode, teamKeyId: teams.teamKeyId })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
    .where(and(eq(teamMembers.userId, userId), inArray(teamMembers.teamSlug, requested)));
  const allowed = memberRows.filter((m) =>
    shareAllowed({ encrypted, replayTeamKeyId, team: { privateMode: m.privateMode, teamKeyId: m.teamKeyId } }).ok,
  );
  if (allowed.length === 0) return;
  await db
    .insert(replayTeamShares)
    .values(allowed.map((m) => ({ replaySlug: slug, teamSlug: m.teamSlug, sharedBy: userId })))
    .onConflictDoNothing();
}

// B84: register the uploader's karabuddy account as a participant (recorder)
// of this replay. Idempotent. When two teammates both record the same match,
// both get rows → account-based intra-team detection, no karabast usernames.
// B101/P0: materialize Stats/Meta facts for this upload (ADR 0007). Guarded —
// must NEVER fail the upload (same posture as notifyMentions). Idempotent on
// gameId, so re-running on a re-upload just refreshes. Extracted to a shared
// helper (lib/replayStatsPersist) so MANUAL result assignment (lib/replayResult)
// persists a user-asserted win/loss through the identical path.
const persistStatsSafe = persistReplayStats;

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

// B170 / ADR 0010 — encrypted (private-team) upload path. The `payload` is an
// E2EE envelope (opaque ciphertext), NOT a karabast replay, so the server does
// NO decode / winner-extract / stats / tag-lift — it stores ciphertext + the
// encrypted summary + the flag + the non-secret team_key_id, and enforces that
// every shared team is a private team whose key matches (defense-in-depth over
// the client's withhold). gameId is a content-free opaque dedup id the extension
// sends in the clear so periodic snapshots overwrite one row (metadata floor).
async function handleEncryptedUpload(opts: {
  headers: Record<string, string>;
  body: any;
  installToken: string;
  payloadText: string;
  clientMeta: ReturnType<typeof sanitizeClientMeta>;
}): Promise<NextResponse> {
  const { headers, body, installToken, payloadText, clientMeta } = opts;
  const db = getDb();

  const teamKeyId = typeof body.teamKeyId === 'string' ? body.teamKeyId : '';
  const gameId = typeof body.gameId === 'string' ? body.gameId : '';
  const encryptedSummary = typeof body.encryptedSummary === 'string' ? body.encryptedSummary : '';
  const requestedSlugs = Array.isArray(body.shareTeamSlugs)
    ? body.shareTeamSlugs.filter((s: unknown): s is string => typeof s === 'string')
    : [];
  if (!teamKeyId || !gameId || !encryptedSummary) {
    return NextResponse.json({ ok: false, error: 'encrypted upload requires teamKeyId, gameId, encryptedSummary' }, { status: 400, headers });
  }
  if (encryptedSummary.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: 'encrypted summary too large' }, { status: 413, headers });
  }
  if (requestedSlugs.length === 0) {
    return NextResponse.json({ ok: false, error: 'encrypted upload must target at least one private team' }, { status: 400, headers });
  }

  const userId = await resolveUserId({ installToken });
  if (!userId) {
    // No account → can't be a member of a private team → can't validate the key.
    return NextResponse.json({ ok: false, error: 'sign in required for private uploads' }, { status: 401, headers });
  }

  // HARD enforcement: every target must be a team the uploader belongs to, in
  // private mode, with team_key_id === this replay's key. Reject otherwise — an
  // encrypted upload aimed at the wrong/non-private team is a client bug, and we
  // must never store it as a share that can't be decrypted (or shouldn't exist).
  const memberRows = await db
    .select({ teamSlug: teamMembers.teamSlug, privateMode: teams.privateMode, teamKeyId: teams.teamKeyId })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
    .where(and(eq(teamMembers.userId, userId), inArray(teamMembers.teamSlug, requestedSlugs)));
  const memberBySlug = new Map(memberRows.map((m) => [m.teamSlug, m]));
  for (const slugReq of requestedSlugs) {
    const m = memberBySlug.get(slugReq);
    if (!m) {
      return NextResponse.json({ ok: false, error: `not a member of team ${slugReq}` }, { status: 403, headers });
    }
    const decision = shareAllowed({ encrypted: true, replayTeamKeyId: teamKeyId, team: { privateMode: m.privateMode, teamKeyId: m.teamKeyId } });
    if (!decision.ok) {
      return NextResponse.json({ ok: false, error: `${slugReq}: ${decision.error}` }, { status: 400, headers });
    }
  }

  const durationMs = typeof body.durationMs === 'number' ? body.durationMs : 0;
  const actionCount = typeof body.actionCount === 'number' ? body.actionCount : 0;

  // Per-(gameId, owner) dedup, mirroring the plaintext path (B158). Encrypted
  // uploads carry the FULL re-encrypted payload each time, so overwrite-latest
  // (guarded by actionCount) is correct — no slice merge (can't merge ciphertext).
  const ownerCond = or(eq(replays.ownerToken, installToken), eq(replays.userId, userId));
  const [mine] = await db
    .select()
    .from(replays)
    .where(and(eq(replays.gameId, gameId), eq(replays.encrypted, true), ownerCond))
    .limit(1);

  if (mine) {
    if (actionCount < mine.actionCount) {
      return NextResponse.json({ ok: true, slug: mine.slug, url: `/r/${mine.slug}`, staleSnapshot: true }, { headers });
    }
    await put(`replays/${mine.slug}.json`, payloadText, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: PAYLOAD_CACHE_MAX_AGE_SECONDS,
    });
    const updates: Record<string, unknown> = {
      userId: userId || mine.userId,
      encryptedSummary,
      teamKeyId,
      durationMs,
      actionCount,
      payloadSizeBytes: payloadText.length,
    };
    if (clientMeta) updates.clientMeta = clientMeta;
    await db.update(replays).set(updates).where(eq(replays.slug, mine.slug));
    await applyUploadShares(mine.slug, userId, requestedSlugs, true, teamKeyId);
    await recordParticipant(mine.slug, userId);
    return NextResponse.json({ ok: true, slug: mine.slug, url: `/r/${mine.slug}`, snapshot: true, encrypted: true }, { headers });
  }

  const slug = generateSlug();
  const blob = await put(`replays/${slug}.json`, payloadText, {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    cacheControlMaxAge: PAYLOAD_CACHE_MAX_AGE_SECONDS,
  });
  await db.insert(replays).values({
    slug,
    gameId,
    userId,
    ownerToken: installToken,
    // No plaintext identity on an encrypted row: players is [] (NOT NULL) and
    // match/decks/winners/displayName/labels stay null. The matchup is in the
    // encrypted summary, decrypted client-side.
    players: [],
    durationMs,
    actionCount,
    payloadBlobUrl: blob.url,
    payloadSizeBytes: payloadText.length,
    encrypted: true,
    teamKeyId,
    encryptedSummary,
    clientMeta,
  });
  await applyUploadShares(slug, userId, requestedSlugs, true, teamKeyId);
  await recordParticipant(slug, userId);
  return NextResponse.json({ ok: true, slug, url: `/r/${slug}`, encrypted: true }, { headers });
}

// POST /api/replays — upload a replay payload + create metadata row.
// Body shape: { installToken, payload: string (JSON of the .karareplay file) }
// Returns: { slug, url }
export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const body = await req.json();
    const installToken: string = String(body.installToken || '').trim();
    // `let`: the same-owner upsert may replace these with the slice-MERGED
    // payload (B120) before writing the blob + metadata.
    let payloadText: string = typeof body.payload === 'string' ? body.payload : '';
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

    // B170 / ADR 0010: encrypted (private-team) upload. The payload is opaque
    // ciphertext, so it diverges entirely from the plaintext decode path below.
    if (body.encrypted === true) {
      return await handleEncryptedUpload({ headers, body, installToken, payloadText, clientMeta });
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
    let winners = extractWinners(finalSnapshot);

    // Upsert by gameId. The recorder fires periodic snapshots during an
    // active match (B26) plus the final on game-end; each one overwrites the
    // existing blob + metadata + upserts payload-carried tags. Same slug
    // throughout the match so the in-game "Open on karabuddy →" link is
    // stable and karabuddy-side tag edits aren't blown away.
    // B158: per-owner upsert key. gameId is no longer unique — an OPPONENT's
    // recording of the same game is a SEPARATE row owned by them. Find MY prior
    // recording of this game (a periodic/finalize snapshot) by (gameId, owner).
    const ownerCond = userId
      ? or(eq(replays.ownerToken, installToken), eq(replays.userId, userId))
      : eq(replays.ownerToken, installToken);
    const [mine] = await db.select().from(replays)
      .where(and(eq(replays.gameId, gameId), ownerCond)).limit(1);

    // B166: I haven't recorded this game myself — fall through to a NEW row of
    // my own (the new-row insert below), exactly as a non-teammate opponent does
    // (B158). We no longer fold a teammate's 2nd recording into the 1st
    // recorder's row as a stored `replay_alt_payload`. Every recorder keeps an
    // INDEPENDENT row (their own POV) that survives as a one-sided "My Replay"
    // even after they leave the team. "Double-sided" is now a RUNTIME
    // composition of the two sibling rows (same gameId, owners who currently
    // share a team) — see lib/doubleSided.ts + the /perspective endpoint — not
    // ownership baked into one row.

    // My own prior recording of this game → snapshot merge / overwrite.
    if (mine) {
      const replay = mine;
      // B120: slice-and-merge. A game can be split across two karabast tabs
      // (the server rebinds the single game socket → the tabs flip-flop), so
      // each tab captures only part of the stream. If BOTH the incoming slice
      // and the stored blob carry per-frame keys (new extension), stitch them by
      // key into one complete timeline instead of last-write-wins clobbering.
      // Any unkeyed payload (old extension) → fall through to the stale guard +
      // overwrite below (no regression during rollout). Best-effort: a fetch /
      // merge / size failure falls back too.
      let mergedOk = false;
      if (sliceHasKeys(parsed)) {
        try {
          const storedBlob = await (await fetch(replay.payloadBlobUrl)).json();
          if (sliceHasKeys(storedBlob)) {
            const merged = mergeSlices([storedBlob, parsed]);
            const mergedText = merged ? JSON.stringify(merged) : '';
            if (merged && mergedText.length <= MAX_PAYLOAD_BYTES) {
              parsed = merged;
              payloadText = mergedText;
              winners = extractWinners(reconstructFinalState(parsed));
              mergedOk = true;
            } else if (merged) {
              console.warn('[karabuddy] merged replay exceeds size cap; falling back', { gameId, bytes: mergedText.length });
            }
          }
        } catch (err) {
          console.warn('[karabuddy] slice merge failed; falling back to overwrite:', err);
        }
      }

      // Stale-snapshot guard: a finalize-upload can race with an in-flight
      // periodic snapshot. The recording array grows monotonically within a
      // single match, so a payload carrying fewer actions than the latest
      // saved state is by definition older. Reject so finalize wins. Skipped on
      // the merged path — the key-union is order-independent, and a later slice
      // can carry fewer total actions yet contribute unique keys.
      const incomingActionCount = parsed.actionCount || 0;
      if (!mergedOk && incomingActionCount < replay.actionCount) {
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
        // This blob is overwritten in place as the game streams in (B120 merge),
        // so it must NOT carry the default 1-year browser cache — a viewer who
        // fetched an early partial would be pinned to it for a year. A short TTL
        // (matching s-maxage) lets stale copies self-heal within minutes.
        cacheControlMaxAge: PAYLOAD_CACHE_MAX_AGE_SECONDS,
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
      // shouldn't clobber a previously-extracted winner. And a MANUALLY
      // assigned result (winnerManual) is authoritative — a later re-upload
      // never overwrites the user's call.
      if (winners !== null && !replay.winnerManual) updates.winners = winners;
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
      // Short TTL: this path is overwritten in place on later snapshots/merges
      // (see the upsert branch above), so an immutable-length cache poisons
      // early viewers. Self-heals within minutes instead.
      cacheControlMaxAge: PAYLOAD_CACHE_MAX_AGE_SECONDS,
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

import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { put } from '@/lib/blob';
import { getDb } from '@/lib/db';
import { replays, replayTeamShares, tags, teamMembers, teams } from '@/lib/schema';
import { resolveUserIdFromRequest } from '@/lib/userResolution';

export const runtime = 'nodejs';
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024; // 8 MB (mirrors the upload cap)
const PAYLOAD_CACHE_MAX_AGE_SECONDS = 300;

// B170 / ADR 0010 — accept a RE-WRAPPED encrypted replay during key rotation.
// The owner's browser asked the extension to re-wrap each envelope's data key
// from the old team key to the new one (the content ciphertext is untouched —
// see lib/e2ee.rewrapKey). This endpoint stores the re-wrapped envelopes and
// flips the replay's team_key_id to the new kid. The server still never sees a
// key or any plaintext — only opaque ciphertext whose advertised `kid` we check.
//
// AUTHORIZATION: the caller must be an OWNER of a PRIVATE team this replay is
// shared with (rotation is a team-management action). Re-wrapping discloses
// nothing new — a team owner already holds the team key and can decrypt shared
// replays; this only re-secures the at-rest ciphertext under the new key.

// A minimal structural check that a value is one of our E2EE envelopes carrying
// the expected kid. We can't decrypt (no key) — the GCM tag is the real gate on
// the client — but rejecting a wrong/missing kid stops a rotation from storing
// ciphertext under a key id that won't match the team after the flip.
function envelopeHasKid(raw: string, expectedKid: string): boolean {
  try {
    const env = JSON.parse(raw);
    return !!env && env.v === 1 && env.kid === expectedKid && !!env.wrap?.ct && !!env.data?.ct;
  } catch {
    return false;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Session OR install token, so the extension's key manager can drive rotation.
  const userId = await resolveUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const newTeamKeyId = String(body.newTeamKeyId || '').trim();
  const payload = typeof body.payload === 'string' ? body.payload : '';
  const encryptedSummary = typeof body.encryptedSummary === 'string' ? body.encryptedSummary : '';
  const incomingTags: { id: string; commentEncrypted: string }[] = Array.isArray(body.tags)
    ? body.tags
        .filter((t: any) => t && typeof t.id === 'string' && typeof t.commentEncrypted === 'string')
        .map((t: any) => ({ id: t.id, commentEncrypted: t.commentEncrypted }))
    : [];

  if (!newTeamKeyId || !payload || !encryptedSummary) {
    return NextResponse.json({ ok: false, error: 'newTeamKeyId, payload, encryptedSummary required' }, { status: 400 });
  }
  if (payload.length > MAX_PAYLOAD_BYTES || encryptedSummary.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: 'payload too large' }, { status: 413 });
  }
  // Every submitted envelope must already carry the NEW kid (a correctly
  // re-wrapped envelope does). Refuse otherwise — never store under a stale kid.
  if (!envelopeHasKid(payload, newTeamKeyId) || !envelopeHasKid(encryptedSummary, newTeamKeyId)) {
    return NextResponse.json({ ok: false, error: 'envelope is not wrapped under newTeamKeyId' }, { status: 400 });
  }
  for (const t of incomingTags) {
    if (!envelopeHasKid(t.commentEncrypted, newTeamKeyId)) {
      return NextResponse.json({ ok: false, error: `tag ${t.id} envelope is not wrapped under newTeamKeyId` }, { status: 400 });
    }
  }

  const db = getDb();
  const [replay] = await db.select().from(replays).where(eq(replays.slug, slug)).limit(1);
  if (!replay) return NextResponse.json({ ok: false, error: 'replay not found' }, { status: 404 });
  if (!replay.encrypted) {
    return NextResponse.json({ ok: false, error: 'replay is not encrypted' }, { status: 400 });
  }

  // The caller must OWN a private team this replay is shared with.
  const ownerTeams = await db
    .select({ teamSlug: teamMembers.teamSlug })
    .from(teamMembers)
    .innerJoin(replayTeamShares, eq(replayTeamShares.teamSlug, teamMembers.teamSlug))
    .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
    .where(and(
      eq(teamMembers.userId, userId),
      eq(teamMembers.role, 'owner'),
      eq(teams.privateMode, true),
      eq(replayTeamShares.replaySlug, slug),
    ));
  if (ownerTeams.length === 0) {
    return NextResponse.json({ ok: false, error: 'must own a private team this replay is shared with' }, { status: 403 });
  }

  // Idempotent: re-running the same rotation re-stores identical ciphertext.
  // A row whose payload lives INLINE (a data: URL — the local/demo seed, which
  // needs no blob infra) stays inline; everything else overwrites the blob in
  // place (stable path) and the row points at the returned URL (same in-place URL
  // in prod, so a no-op).
  let newBlobUrl: string;
  if (replay.payloadBlobUrl.startsWith('data:')) {
    newBlobUrl = `data:application/json;base64,${Buffer.from(payload).toString('base64')}`;
  } else {
    const blob = await put(`replays/${slug}.json`, payload, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: PAYLOAD_CACHE_MAX_AGE_SECONDS,
    });
    newBlobUrl = blob.url;
  }

  await db
    .update(replays)
    .set({ teamKeyId: newTeamKeyId, encryptedSummary, payloadSizeBytes: payload.length, payloadBlobUrl: newBlobUrl })
    .where(eq(replays.slug, slug));

  // Update each re-wrapped tag comment. Scope the write to THIS replay's tags so
  // a bogus id can't touch another replay's row.
  if (incomingTags.length) {
    const ids = incomingTags.map((t) => t.id);
    const owned = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.replaySlug, slug), inArray(tags.id, ids)));
    const ownedIds = new Set(owned.map((t) => t.id));
    for (const t of incomingTags) {
      if (!ownedIds.has(t.id)) continue;
      await db.update(tags).set({ commentEncrypted: t.commentEncrypted }).where(eq(tags.id, t.id));
    }
  }

  return NextResponse.json({ ok: true, slug, teamKeyId: newTeamKeyId });
}

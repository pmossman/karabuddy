import { NextResponse } from 'next/server';
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, replayTeamShares, tags, teamMembers, teams } from '@/lib/schema';
import { resolveUserIdFromRequest } from '@/lib/userResolution';

export const runtime = 'nodejs';

// B170 / ADR 0010 — accept EITHER an Auth.js session OR the extension install
// token (resolveUserIdFromRequest), so the extension's key manager can drive the
// whole rotation without a webapp session (same owner-gated, token-authed pattern
// uploads + team-shares already use). Owner is then verified per team below.

// B170 / ADR 0010 — key-rotation manifest (owner-only). Lists every encrypted
// replay still under the team's CURRENT key (the "old" kid we're rotating away
// from), plus its encrypted tag comments, so the owner's browser can walk them,
// ask the extension to re-wrap each envelope's data key (old→new key — the
// extension is the sole keyholder; the server never sees a key), and POST the
// re-wrapped envelopes back via /api/replays/[slug]/rewrap.
//
// Returns ONLY metadata + ciphertext locations — blob URLs, the encrypted
// summary, and encrypted comment ciphertext (all opaque). No plaintext, fully
// E2EE-compatible. As replays get re-wrapped (replays.team_key_id flips to the
// new kid) they drop out of this list, so re-fetching it makes rotation
// RESUMABLE — re-run picks up exactly what's left.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const userId = await resolveUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const db = getDb();
  const [me] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId)))
    .limit(1);
  if (!me || me.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });
  }
  const [team] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  if (!team) return NextResponse.json({ ok: false, error: 'team not found' }, { status: 404 });
  if (!team.privateMode || !team.teamKeyId) {
    return NextResponse.json({ ok: false, error: 'team is not private' }, { status: 400 });
  }
  const oldKid = team.teamKeyId;

  // Encrypted replays shared with this team, still under the current key.
  const rows = await db
    .select({
      slug: replays.slug,
      payloadBlobUrl: replays.payloadBlobUrl,
      encryptedSummary: replays.encryptedSummary,
    })
    .from(replayTeamShares)
    .innerJoin(replays, eq(replays.slug, replayTeamShares.replaySlug))
    .where(and(
      eq(replayTeamShares.teamSlug, slug),
      eq(replays.encrypted, true),
      eq(replays.teamKeyId, oldKid),
    ));

  // Their encrypted tag comments (the only tag field that's ciphertext).
  const slugs = rows.map((r) => r.slug);
  const tagRows = slugs.length
    ? await db
        .select({ id: tags.id, replaySlug: tags.replaySlug, commentEncrypted: tags.commentEncrypted })
        .from(tags)
        .where(and(inArray(tags.replaySlug, slugs), isNotNull(tags.commentEncrypted)))
    : [];
  const tagsByReplay = new Map<string, { id: string; commentEncrypted: string }[]>();
  for (const t of tagRows) {
    if (!t.commentEncrypted) continue;
    const list = tagsByReplay.get(t.replaySlug) || [];
    list.push({ id: t.id, commentEncrypted: t.commentEncrypted });
    tagsByReplay.set(t.replaySlug, list);
  }

  return NextResponse.json({
    ok: true,
    currentTeamKeyId: oldKid,
    replays: rows.map((r) => ({
      slug: r.slug,
      payloadBlobUrl: r.payloadBlobUrl,
      encryptedSummary: r.encryptedSummary,
      tags: tagsByReplay.get(r.slug) || [],
    })),
  });
}

// POST /api/teams/[slug]/rotation-manifest  body: { newTeamKeyId }
// FINALIZE a rotation: flip the team to the new kid — but only once every
// encrypted replay shared with the team is already re-wrapped to it (a
// completeness backstop, so the team key + its replays can't drift apart).
// Owner-only; session OR install token (so the key manager can finalize).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const userId = await resolveUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const newKid = String(body.newTeamKeyId || '').trim();
  if (!newKid) {
    return NextResponse.json({ ok: false, error: 'newTeamKeyId required' }, { status: 400 });
  }
  const db = getDb();
  const [me] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId)))
    .limit(1);
  if (!me || me.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });
  }
  const [team] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  if (!team?.privateMode) {
    return NextResponse.json({ ok: false, error: 'team is not private' }, { status: 400 });
  }
  // B170: keys are one-per-team — don't rotate onto a key another team already uses.
  const [clash] = await db
    .select({ slug: teams.slug })
    .from(teams)
    .where(and(eq(teams.teamKeyId, newKid), ne(teams.slug, slug)))
    .limit(1);
  if (clash) {
    return NextResponse.json({ ok: false, error: 'That key is already used by another team. Generate a separate key to rotate to.' }, { status: 409 });
  }
  const [straggler] = await db
    .select({ slug: replays.slug })
    .from(replayTeamShares)
    .innerJoin(replays, eq(replays.slug, replayTeamShares.replaySlug))
    .where(and(
      eq(replayTeamShares.teamSlug, slug),
      eq(replays.encrypted, true),
      ne(replays.teamKeyId, newKid),
    ))
    .limit(1);
  if (straggler) {
    return NextResponse.json(
      { ok: false, error: 'rotation incomplete: some shared replays are not yet re-wrapped to the new key' },
      { status: 409 },
    );
  }
  await db.update(teams).set({ teamKeyId: newKid }).where(eq(teams.slug, slug));
  return NextResponse.json({ ok: true, teamKeyId: newKid });
}

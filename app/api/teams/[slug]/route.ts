import { NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { requireTeamMember } from '@/lib/apiAuth';
import { teams, teamMembers, users } from '@/lib/schema';

export const runtime = 'nodejs';

// GET /api/teams/[slug] — team detail + member list. Signed-in user must
// be a member; non-members get 403 (we don't want random users probing
// team membership by slug enumeration).
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;
  const db = getDb();
  const [team] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  if (!team) {
    return NextResponse.json({ ok: false, error: 'team not found' }, { status: 404 });
  }
  const members = await db
    .select({
      userId: teamMembers.userId,
      role: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamSlug, slug))
    .orderBy(teamMembers.joinedAt);
  return NextResponse.json({ ok: true, team, members, viewerRole: m.role });
}

// PATCH /api/teams/[slug]  body: { name }
// Rename the team. Owner-only.
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug, { role: 'owner' });
  if (m instanceof NextResponse) return m;
  const db = getDb();
  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name: string = String(body.name || '').trim();
    if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
    if (name.length > 80) return NextResponse.json({ ok: false, error: 'name too long' }, { status: 400 });
    update.name = name;
  }
  // B170 / ADR 0010: toggle private (E2EE) mode. Enabling stores the NON-SECRET
  // team_key_id the owner generated in the extension (the key never reaches the
  // server); disabling clears it (future uploads go plaintext — existing
  // encrypted replays keep their own team_key_id and stay viewable with the key).
  // The webapp capability-gates the owner's toggle client-side; the server just
  // records the choice.
  if (body.privateMode !== undefined) {
    if (body.privateMode === true) {
      const teamKeyId = String(body.teamKeyId || '').trim();
      if (!teamKeyId) {
        return NextResponse.json({ ok: false, error: 'teamKeyId required to enable private mode' }, { status: 400 });
      }
      // B170: keys are ONE-PER-TEAM. Reject a key already in use by another team —
      // sharing a key would let either team decrypt the other's replays. Each team
      // gets its own key (generate a fresh one in the extension).
      const [clash] = await db
        .select({ slug: teams.slug })
        .from(teams)
        .where(and(eq(teams.teamKeyId, teamKeyId), ne(teams.slug, slug)))
        .limit(1);
      if (clash) {
        return NextResponse.json({ ok: false, error: 'That key is already used by another team. Generate a separate key for this team.' }, { status: 409 });
      }
      update.privateMode = true;
      update.teamKeyId = teamKeyId;
    } else {
      update.privateMode = false;
      update.teamKeyId = null;
    }
  }
  // B170 / ADR 0010: rotation FINALIZE (flip the team to the new key) lives in
  // POST /api/teams/[slug]/rotation-manifest now — it's owner-gated by session OR
  // install token so the extension's key manager can run the whole rotation.

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400 });
  }
  await db.update(teams).set(update).where(eq(teams.slug, slug));
  return NextResponse.json({ ok: true });
}

// DELETE /api/teams/[slug] — leave the team. Last-owner-leaving guarded:
// they must promote someone else first, or delete the team entirely
// (deletion handled separately).
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug, { notMemberStatus: 404 });
  if (m instanceof NextResponse) return m;
  const userId = m.userId;
  const db = getDb();

  // If owner: ensure another owner exists, else block.
  if (m.role === 'owner') {
    const otherOwners = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.role, 'owner')));
    if (otherOwners.filter((o) => o.userId !== userId).length === 0) {
      return NextResponse.json(
        { ok: false, error: 'You are the only owner. Promote someone else first, or delete the team.' },
        { status: 400 }
      );
    }
  }

  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId)));
  return NextResponse.json({ ok: true });
}

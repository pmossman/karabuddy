import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teams, teamMembers, users } from '@/lib/schema';

export const runtime = 'nodejs';

// GET /api/teams/[slug] — team detail + member list. Signed-in user must
// be a member; non-members get 403 (we don't want random users probing
// team membership by slug enumeration).
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const db = getDb();
  const [me] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId)))
    .limit(1);
  if (!me) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  }
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
  return NextResponse.json({ ok: true, team, members, viewerRole: me.role });
}

// PATCH /api/teams/[slug]  body: { name }
// Rename the team. Owner-only.
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
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
  const body = await req.json().catch(() => ({}));
  const name: string = String(body.name || '').trim();
  if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
  if (name.length > 80) return NextResponse.json({ ok: false, error: 'name too long' }, { status: 400 });
  await db.update(teams).set({ name }).where(eq(teams.slug, slug));
  return NextResponse.json({ ok: true });
}

// DELETE /api/teams/[slug] — leave the team. Last-owner-leaving guarded:
// they must promote someone else first, or delete the team entirely
// (deletion handled separately).
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const db = getDb();
  const [me] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId)))
    .limit(1);
  if (!me) return NextResponse.json({ ok: false, error: 'not a member' }, { status: 404 });

  // If owner: ensure another owner exists, else block.
  if (me.role === 'owner') {
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

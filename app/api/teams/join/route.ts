import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teamInvites, teamMembers, teams } from '@/lib/schema';

export const runtime = 'nodejs';

// POST /api/teams/join  body: { code }
// Accepts an invite code → adds the signed-in user as a member of the
// invite's team. Returns the team slug so the client can redirect.
//
// Idempotent: if the user is already a member, this is a no-op + the
// invite's `usesRemaining` is NOT decremented.
export async function POST(req: Request) {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const code: string = String(body.code || '').trim();
  if (!code) return NextResponse.json({ ok: false, error: 'code required' }, { status: 400 });

  const db = getDb();
  const [invite] = await db.select().from(teamInvites).where(eq(teamInvites.code, code)).limit(1);
  if (!invite) {
    return NextResponse.json({ ok: false, error: 'invite not found' }, { status: 404 });
  }
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return NextResponse.json({ ok: false, error: 'invite expired' }, { status: 410 });
  }
  if (invite.usesRemaining !== null && invite.usesRemaining <= 0) {
    return NextResponse.json({ ok: false, error: 'invite exhausted' }, { status: 410 });
  }

  const [team] = await db.select().from(teams).where(eq(teams.slug, invite.teamSlug)).limit(1);
  if (!team) {
    return NextResponse.json({ ok: false, error: 'team no longer exists' }, { status: 404 });
  }

  // Already a member? Idempotent no-op — don't burn a use.
  const [existing] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, invite.teamSlug), eq(teamMembers.userId, userId)))
    .limit(1);
  if (existing) {
    return NextResponse.json({ ok: true, slug: invite.teamSlug, alreadyMember: true });
  }

  await db.insert(teamMembers).values({
    teamSlug: invite.teamSlug,
    userId,
    role: 'member',
  });

  // Decrement use count if bounded. Use atomic SQL update so concurrent
  // joins don't over-decrement.
  if (invite.usesRemaining !== null) {
    await db
      .update(teamInvites)
      .set({ usesRemaining: sql`${teamInvites.usesRemaining} - 1` })
      .where(eq(teamInvites.code, code));
  }

  return NextResponse.json({ ok: true, slug: invite.teamSlug });
}

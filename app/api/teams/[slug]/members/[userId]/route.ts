import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teamMembers } from '@/lib/schema';

export const runtime = 'nodejs';

// PATCH /api/teams/[slug]/members/[userId]  body: { role: 'owner' }
// Transfer ownership: an owner hands the team to another member — the target
// becomes an owner and the acting owner steps down to a regular member. Any
// other owners are unaffected, so the team always keeps at least one owner.
export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string; userId: string }> }) {
  const { slug, userId: targetId } = await params;
  const session = await auth();
  const meId: string | null = (session?.user as any)?.id || null;
  if (!meId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });

  const db = getDb();
  const [me] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, meId)))
    .limit(1);
  if (!me || me.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (body.role !== 'owner') {
    return NextResponse.json({ ok: false, error: "only { role: 'owner' } (ownership transfer) is supported" }, { status: 400 });
  }
  if (targetId === meId) {
    return NextResponse.json({ ok: false, error: 'you are already an owner' }, { status: 400 });
  }

  const [target] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, targetId)))
    .limit(1);
  if (!target) return NextResponse.json({ ok: false, error: 'not a team member' }, { status: 404 });

  // Promote the target, then step down. (neon-http has no transactions; the
  // promote-first order guarantees the team is never left without an owner.)
  await db.update(teamMembers).set({ role: 'owner' }).where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, targetId)));
  await db.update(teamMembers).set({ role: 'member' }).where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, meId)));
  return NextResponse.json({ ok: true });
}

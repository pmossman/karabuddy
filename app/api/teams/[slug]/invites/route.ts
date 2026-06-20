import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teamInvites, teamMembers } from '@/lib/schema';
import { generateInviteCode } from '@/lib/slug';

export const runtime = 'nodejs';

// POST /api/teams/[slug]/invites — generate a new invite code. Owner-only.
// Default: no expiry, unlimited uses. Body can override:
//   { expiresInDays?: number, usesRemaining?: number }
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = session?.user?.id || null;
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
  const expiresAt =
    typeof body.expiresInDays === 'number' && body.expiresInDays > 0
      ? new Date(Date.now() + body.expiresInDays * 86_400_000)
      : null;
  const usesRemaining =
    typeof body.usesRemaining === 'number' && body.usesRemaining > 0
      ? body.usesRemaining
      : null;

  const code = generateInviteCode();
  await db.insert(teamInvites).values({
    code,
    teamSlug: slug,
    createdBy: userId,
    expiresAt,
    usesRemaining,
  });
  return NextResponse.json({ ok: true, code });
}

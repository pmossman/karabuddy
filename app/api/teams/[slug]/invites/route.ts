import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { teamInvites } from '@/lib/schema';
import { generateInviteCode } from '@/lib/slug';
import { requireTeamMember } from '@/lib/apiAuth';

export const runtime = 'nodejs';

// POST /api/teams/[slug]/invites — generate a new invite code. Owner-only.
// Default: no expiry, unlimited uses. Body can override:
//   { expiresInDays?: number, usesRemaining?: number }
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug, { role: 'owner' });
  if (m instanceof NextResponse) return m;
  const userId = m.userId;
  const db = getDb();

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

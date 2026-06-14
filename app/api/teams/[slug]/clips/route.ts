import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { authContextFromRequest } from '@/lib/replayPermissions';
import { getTeamMembership } from '@/lib/teamSurface';
import { teamClips } from '@/lib/clipBrowser';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/clips — B142: clips on replays surfaced to this team
// (explicit share OR a tag scoped to the team). Member-only, mirroring
// /api/teams/[slug]/replays.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  }
  const me = await getTeamMembership(slug, userId);
  if (!me) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  }
  const ctx = authContextFromRequest(req, userId);
  const data = await teamClips(slug, ctx);
  return NextResponse.json({ ok: true, data });
}

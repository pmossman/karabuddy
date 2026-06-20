import { NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/apiAuth';
import { authContextFromRequest } from '@/lib/replayPermissions';
import { teamClips } from '@/lib/clipBrowser';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/clips — B142: clips on replays surfaced to this team
// (explicit share OR a tag scoped to the team). Member-only, mirroring
// /api/teams/[slug]/replays.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;
  const ctx = authContextFromRequest(req, m.userId);
  const data = await teamClips(slug, ctx);
  return NextResponse.json({ ok: true, data });
}

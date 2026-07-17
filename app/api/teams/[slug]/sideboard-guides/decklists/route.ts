import { NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/apiAuth';
import { archetypeDecklists } from '@/lib/sideboardGuides';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/sideboard-guides/decklists?ownLeader=&ownBase= — B232:
// candidate BASELINE decklists (recent shared replays of this archetype, full
// main + sideboard) for authoring a guide through the lens of a real list. The
// viewer's own lists sort first. Member-only.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;
  const u = new URL(req.url);
  const ownLeader = u.searchParams.get('ownLeader');
  const ownBase = u.searchParams.get('ownBase');
  if (!ownLeader) return NextResponse.json({ ok: false, error: 'ownLeader required' }, { status: 400 });
  const decklists = await archetypeDecklists(slug, m.userId, ownLeader, ownBase);
  return NextResponse.json({ ok: true, data: { decklists } });
}

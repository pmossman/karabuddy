import { NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/apiAuth';
import { matchupCardPool } from '@/lib/sideboardGuides';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/sideboard-guides/pool?ownLeader=&ownBase= — B231: the
// frequency-sorted candidate card pool for authoring a guide (the team's cards
// for that archetype). Member-only.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;
  const u = new URL(req.url);
  const ownLeader = u.searchParams.get('ownLeader');
  const ownBase = u.searchParams.get('ownBase');
  if (!ownLeader) return NextResponse.json({ ok: false, error: 'ownLeader required' }, { status: 400 });
  const pool = await matchupCardPool(slug, ownLeader, ownBase);
  return NextResponse.json({ ok: true, data: pool });
}

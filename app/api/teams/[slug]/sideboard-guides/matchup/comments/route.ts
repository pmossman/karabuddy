import { NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/apiAuth';
import { addMatchupComment, type Matchup } from '@/lib/sideboardGuides';

export const runtime = 'nodejs';

// POST /api/teams/[slug]/sideboard-guides/matchup/comments — any team member can
// comment on a matchup (discussion is matchup-level, not per-take).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mem = await requireTeamMember(slug);
  if (mem instanceof NextResponse) return mem;
  const body = await req.json().catch(() => ({}));
  const m = { ownLeader: body?.ownLeader, ownBase: body?.ownBase, oppLeader: body?.oppLeader, oppBase: body?.oppBase };
  if (![m.ownLeader, m.ownBase, m.oppLeader, m.oppBase].every((s) => typeof s === 'string' && s)) {
    return NextResponse.json({ ok: false, error: 'matchup required' }, { status: 400 });
  }
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ ok: false, error: 'empty comment' }, { status: 400 });
  const id = await addMatchupComment(slug, mem.userId, m as Matchup, text.slice(0, 2000));
  return NextResponse.json({ ok: true, data: { id } });
}

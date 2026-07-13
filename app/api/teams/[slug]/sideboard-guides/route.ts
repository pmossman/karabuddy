import { NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/apiAuth';
import { listGuides, createGuide, teamMatchupOptions, sanitizeGuideCards, buildArtFromMatchups } from '@/lib/sideboardGuides';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/sideboard-guides — B231: the team's sideboard guides +
// the leader/base matchup options that feed the authoring selectors. Member-only.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;
  const [guides, matchups] = await Promise.all([listGuides(slug), teamMatchupOptions(slug)]);
  const art = buildArtFromMatchups(matchups);
  return NextResponse.json({ ok: true, data: { guides, matchups, art, viewerId: m.userId } });
}

// POST — create a guide authored by the caller.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;
  const body = await req.json().catch(() => ({}));
  const { ownLeader, ownBase, oppLeader, oppBase } = body ?? {};
  if (![ownLeader, ownBase, oppLeader, oppBase].every((s) => typeof s === 'string' && s.trim())) {
    return NextResponse.json({ ok: false, error: 'a full matchup (both leaders + bases) is required' }, { status: 400 });
  }
  const id = await createGuide({
    teamSlug: slug, authorId: m.userId,
    ownLeader: ownLeader.trim(), ownBase: ownBase.trim(), oppLeader: oppLeader.trim(), oppBase: oppBase.trim(),
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : null,
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 5000) : '',
    cardsIn: sanitizeGuideCards(body.cardsIn),
    cardsOut: sanitizeGuideCards(body.cardsOut),
  });
  return NextResponse.json({ ok: true, data: { id } });
}

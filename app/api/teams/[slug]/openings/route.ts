import { NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/apiAuth';
import { openingPoolForTeam } from '@/lib/openingDrills';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/openings — B221: the team's opening-drill pool.
// Member-only. Items are quiz-anonymized (no recorder identity) unless
// ?recorder=<userId> is given — the teammate filter ("coaching mode")
// inherently reveals whose openings you asked for — or the item is the
// viewer's own (the uploader view). Reveal data (recorded decision, tallies)
// is only present on items the viewer answered or owns.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;

  const url = new URL(req.url);
  const recorder = url.searchParams.get('recorder');

  let items = await openingPoolForTeam(slug, m.userId, { withRecorder: !!recorder });
  if (recorder) items = items.filter((i) => i.recorder?.userId === recorder);

  return NextResponse.json({ ok: true, data: items });
}

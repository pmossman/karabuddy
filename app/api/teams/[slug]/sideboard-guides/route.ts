import { NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/apiAuth';
import { listTeamMatchups, teamMatchupOptions, leaderArtFromMatchups, baseKindsByKey } from '@/lib/sideboardGuides';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/sideboard-guides — B231: the team's MATCHUPS (grouped
// takes) for the browse list + the selector options/art. Member-only. A matchup
// is the top-level unit; its takes + discussion load from the /matchup route.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;
  const [matchups, options] = await Promise.all([listTeamMatchups(slug, m.userId), teamMatchupOptions(slug)]);
  return NextResponse.json({
    ok: true,
    data: { matchups, options, leaderArt: leaderArtFromMatchups(options), baseKinds: baseKindsByKey(options), viewerId: m.userId },
  });
}

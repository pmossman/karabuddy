import { NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/apiAuth';
import { sideboardPoolForTeam } from '@/lib/sideboardDrills';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/sideboarding — B227: the team's sideboard-drill pool.
// Member-only; quiz-anonymized unless ?recorder=<userId> (coaching mode) or the
// item is the viewer's own. Reveal data (the recorded swap) only on answered/
// owned items.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;

  const recorder = new URL(req.url).searchParams.get('recorder');
  let items = await sideboardPoolForTeam(slug, m.userId, { withRecorder: !!recorder });
  if (recorder) items = items.filter((i) => i.recorder?.userId === recorder);

  return NextResponse.json({ ok: true, data: items });
}

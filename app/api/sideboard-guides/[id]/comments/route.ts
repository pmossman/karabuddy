import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/apiAuth';
import { getGuide, isTeamMember, addGuideComment } from '@/lib/sideboardGuides';

export const runtime = 'nodejs';

// POST /api/sideboard-guides/[id]/comments — any TEAM MEMBER can comment on a
// guide (authorship gates editing the guide, not commenting on it).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const guide = await getGuide(id);
  if (!guide) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (!(await isTeamMember(guide.teamSlug, s.userId))) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ ok: false, error: 'empty comment' }, { status: 400 });
  const commentId = await addGuideComment(id, s.userId, text.slice(0, 2000));
  return NextResponse.json({ ok: true, data: { id: commentId } });
}

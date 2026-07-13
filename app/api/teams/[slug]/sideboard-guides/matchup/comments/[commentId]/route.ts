import { NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/apiAuth';
import { deleteMatchupComment } from '@/lib/sideboardGuides';

export const runtime = 'nodejs';

// DELETE a matchup comment — its own poster only (a team member).
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string; commentId: string }> }) {
  const { slug, commentId } = await params;
  const mem = await requireTeamMember(slug);
  if (mem instanceof NextResponse) return mem;
  const ok = await deleteMatchupComment(commentId, mem.userId);
  if (!ok) return NextResponse.json({ ok: false, error: 'not found or not yours' }, { status: 403 });
  return NextResponse.json({ ok: true });
}

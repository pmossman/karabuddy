import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/apiAuth';
import { deleteGuideComment } from '@/lib/sideboardGuides';

export const runtime = 'nodejs';

// DELETE a comment — its own author only. (Guide authors can moderate via
// deleting the guide; individual comments belong to their poster.)
export async function DELETE(_req: Request, { params }: { params: Promise<{ commentId: string }> }) {
  const { commentId } = await params;
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const ok = await deleteGuideComment(commentId, s.userId);
  if (!ok) return NextResponse.json({ ok: false, error: 'not found or not yours' }, { status: 403 });
  return NextResponse.json({ ok: true });
}

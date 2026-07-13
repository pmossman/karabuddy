import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/apiAuth';
import { getGuide, updateGuide, deleteGuide, isTeamMember, sanitizeGuideCards, matchupContextForTeam } from '@/lib/sideboardGuides';

export const runtime = 'nodejs';

// A single guide, resolved by id. Team membership is checked via the guide's own
// team; edits/deletes are author-only. (Guides live under a team but are
// addressed by their globally-unique id for view/edit/delete.)

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const guide = await getGuide(id);
  if (!guide) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (!(await isTeamMember(guide.teamSlug, s.userId))) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  const { leaderArt, baseKinds } = await matchupContextForTeam(guide.teamSlug);
  return NextResponse.json({ ok: true, data: { ...guide, leaderArt, baseKinds, canEdit: guide.authorId === s.userId } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const guide = await getGuide(id);
  if (!guide) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (guide.authorId !== s.userId) return NextResponse.json({ ok: false, error: 'only the author can edit this guide' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string') patch.title = body.title.trim() ? body.title.trim().slice(0, 120) : null;
  else if (body.title === null) patch.title = null;
  if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 5000);
  if (Array.isArray(body.cardsIn)) patch.cardsIn = sanitizeGuideCards(body.cardsIn);
  if (Array.isArray(body.cardsOut)) patch.cardsOut = sanitizeGuideCards(body.cardsOut);
  for (const k of ['ownLeader', 'ownBase', 'oppLeader', 'oppBase'] as const) {
    if (typeof body[k] === 'string' && body[k].trim()) patch[k] = body[k].trim();
  }
  await updateGuide(id, s.userId, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const guide = await getGuide(id);
  if (!guide) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  if (guide.authorId !== s.userId) return NextResponse.json({ ok: false, error: 'only the author can delete this guide' }, { status: 403 });
  await deleteGuide(id, s.userId);
  return NextResponse.json({ ok: true });
}

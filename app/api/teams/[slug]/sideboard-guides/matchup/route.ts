import { NextResponse } from 'next/server';
import { requireTeamMember } from '@/lib/apiAuth';
import {
  matchupTakes, listMatchupComments, matchupContextForTeam, computeConsensus,
  upsertMyTake, deleteMyTake, sanitizeGuideCards, sanitizeBaseline, type Matchup,
} from '@/lib/sideboardGuides';

export const runtime = 'nodejs';

function matchupFromQuery(url: string): Matchup | null {
  const u = new URL(url).searchParams;
  const m = { ownLeader: u.get('ownLeader'), ownBase: u.get('ownBase'), oppLeader: u.get('oppLeader'), oppBase: u.get('oppBase') };
  if (![m.ownLeader, m.ownBase, m.oppLeader, m.oppBase].every((s) => typeof s === 'string' && s)) return null;
  return m as Matchup;
}
function matchupFromBody(body: any): Matchup | null {
  const m = { ownLeader: body?.ownLeader, ownBase: body?.ownBase, oppLeader: body?.oppLeader, oppBase: body?.oppBase };
  if (![m.ownLeader, m.ownBase, m.oppLeader, m.oppBase].every((s) => typeof s === 'string' && s.trim())) return null;
  return { ownLeader: m.ownLeader.trim(), ownBase: m.ownBase.trim(), oppLeader: m.oppLeader.trim(), oppBase: m.oppBase.trim() };
}

// GET — the matchup view: every take, the consensus, discussion, and the
// viewer's own take. Member-only.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mem = await requireTeamMember(slug);
  if (mem instanceof NextResponse) return mem;
  const m = matchupFromQuery(req.url);
  if (!m) return NextResponse.json({ ok: false, error: 'matchup required' }, { status: 400 });
  const [takes, comments, ctx] = await Promise.all([matchupTakes(slug, m), listMatchupComments(slug, m), matchupContextForTeam(slug)]);
  const consensus = computeConsensus(takes);
  const myTake = takes.find((t) => t.authorId === mem.userId) ?? null;
  return NextResponse.json({ ok: true, data: { matchup: m, takes, consensus, comments, myTake, viewerId: mem.userId, ...ctx } });
}

// PUT — upsert the caller's ONE take for this matchup.
export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mem = await requireTeamMember(slug);
  if (mem instanceof NextResponse) return mem;
  const body = await req.json().catch(() => ({}));
  const m = matchupFromBody(body);
  if (!m) return NextResponse.json({ ok: false, error: 'a full matchup (both leaders + bases) is required' }, { status: 400 });
  await upsertMyTake(slug, mem.userId, m, typeof body.notes === 'string' ? body.notes.slice(0, 5000) : '', sanitizeGuideCards(body.cardsIn), sanitizeGuideCards(body.cardsOut), sanitizeBaseline(body.baseline));
  return NextResponse.json({ ok: true });
}

// DELETE — remove the caller's take from this matchup.
export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mem = await requireTeamMember(slug);
  if (mem instanceof NextResponse) return mem;
  const m = matchupFromQuery(req.url);
  if (!m) return NextResponse.json({ ok: false, error: 'matchup required' }, { status: 400 });
  await deleteMyTake(slug, mem.userId, m);
  return NextResponse.json({ ok: true });
}

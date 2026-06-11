import { NextResponse } from 'next/server';
import { desc, eq, inArray, count } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { tournaments, tournamentEntrants, tournamentRounds } from '@/lib/schema';
import { getTeamMembership } from '@/lib/teamSurface';
import { generateSlug } from '@/lib/slug';

export const runtime = 'nodejs';

const VISIBILITIES = ['open', 'hidden-until-start', 'private'] as const;

// GET /api/teams/[slug]/tournaments — list this team's tournaments with
// entrant/round counts for the tab's cards. Member-gated.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  if (!(await getTeamMembership(slug, userId))) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.teamSlug, slug))
    .orderBy(desc(tournaments.createdAt));

  const ids = rows.map((t) => t.id);
  const entrantCounts = new Map<string, number>();
  const roundCounts = new Map<string, number>();
  if (ids.length > 0) {
    const ec = await db
      .select({ id: tournamentEntrants.tournamentId, n: count() })
      .from(tournamentEntrants)
      .where(inArray(tournamentEntrants.tournamentId, ids))
      .groupBy(tournamentEntrants.tournamentId);
    for (const r of ec) entrantCounts.set(r.id, Number(r.n));
    const rc = await db
      .select({ id: tournamentRounds.tournamentId, n: count() })
      .from(tournamentRounds)
      .where(inArray(tournamentRounds.tournamentId, ids))
      .groupBy(tournamentRounds.tournamentId);
    for (const r of rc) roundCounts.set(r.id, Number(r.n));
  }

  return NextResponse.json({
    ok: true,
    data: rows.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      decklistVisibility: t.decklistVisibility,
      plannedRounds: t.plannedRounds,
      createdAt: t.createdAt.toISOString(),
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      entrantCount: entrantCounts.get(t.id) ?? 0,
      roundCount: roundCounts.get(t.id) ?? 0,
    })),
  });
}

// POST /api/teams/[slug]/tournaments — create. Any member may create; the
// creator becomes the organizer (team owners are organizers of everything).
//   body: { name: string, decklistVisibility?, plannedRounds? }
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  if (!(await getTeamMembership(slug, userId))) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 120);
  if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });

  const visibility = body.decklistVisibility ?? 'hidden-until-start';
  if (!VISIBILITIES.includes(visibility)) {
    return NextResponse.json({ ok: false, error: 'invalid decklistVisibility' }, { status: 400 });
  }
  let plannedRounds: number | null = null;
  if (body.plannedRounds != null) {
    const n = Number(body.plannedRounds);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      return NextResponse.json({ ok: false, error: 'invalid plannedRounds' }, { status: 400 });
    }
    plannedRounds = n;
  }

  const id = generateSlug('tn_', 8);
  await getDb().insert(tournaments).values({
    id,
    teamSlug: slug,
    name,
    createdBy: userId,
    decklistVisibility: visibility,
    plannedRounds,
  });
  return NextResponse.json({ ok: true, id });
}

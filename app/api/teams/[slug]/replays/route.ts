import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, count } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, users, teamMembers, tags, tagTeamScope } from '@/lib/schema';
import { surfacedReplaySlugs } from '@/lib/teamSurface';
import { requireTeamMember } from '@/lib/apiAuth';
import { serializeReplayRow } from '@/lib/replayRow';

export const runtime = 'nodejs';

// GET /api/teams/[slug]/replays — list replays surfaced to this team.
// Member-only. Surfacing rule lives in lib/teamSurface; this route is
// the thin shell that joins user names + sorts.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireTeamMember(slug);
  if (m instanceof NextResponse) return m;
  const userId = m.userId;

  const surfaceSlugs = await surfacedReplaySlugs([slug]);
  if (surfaceSlugs.length === 0) {
    return NextResponse.json({ ok: true, data: [] });
  }

  const db = getDb();
  const memberIds = (await db
    .select({ id: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamSlug, slug))).map((r) => r.id);
  const memberSet = new Set(memberIds);

  const rows = await db
    .select({ replay: replays, ownerName: users.name })
    .from(replays)
    .leftJoin(users, eq(users.id, replays.userId))
    .where(inArray(replays.slug, surfaceSlugs))
    .orderBy(desc(replays.createdAt))
    .limit(200);

  // B166: a game is now ONE physical match recorded as up to two independent
  // rows (one per recorder). "Internal" (teammate-vs-teammate) is detected by
  // grouping recorders by gameId: ≥2 of THIS team's members recorded the game —
  // counting ALL rows for that gameId, not just the surfaced ones. The same
  // condition means a double-sided view is composable within this team.
  const gameIds = [...new Set(rows.map((r) => r.replay.gameId))];
  const recorderRows = gameIds.length > 0
    ? await db.select({ gameId: replays.gameId, userId: replays.userId }).from(replays).where(inArray(replays.gameId, gameIds))
    : [];
  const teamRecordersByGame = new Map<string, Set<string>>();
  for (const r of recorderRows) {
    if (!r.userId || !memberSet.has(r.userId)) continue;
    let s = teamRecordersByGame.get(r.gameId);
    if (!s) { s = new Set(); teamRecordersByGame.set(r.gameId, s); }
    s.add(r.userId);
  }
  const internalGame = (gid: string) => (teamRecordersByGame.get(gid)?.size ?? 0) >= 2;

  // B100: comments visible to THIS team per replay (tags scoped to the team).
  const commentCountBySlug = new Map<string, number>();
  const countRows = await db
    .select({ replaySlug: tags.replaySlug, n: count() })
    .from(tags)
    .innerJoin(tagTeamScope, eq(tagTeamScope.tagId, tags.id))
    .where(and(inArray(tags.replaySlug, surfaceSlugs), eq(tagTeamScope.teamSlug, slug)))
    .groupBy(tags.replaySlug);
  for (const c of countRows) commentCountBySlug.set(c.replaySlug, Number(c.n));

  // B166: COLLAPSE surfaced rows to one card per gameId — two recorders of one
  // game (e.g. two teammates) must not show as two mirrored series. Pick a
  // representative consistently: the viewer's own recording first, else the
  // recorder who owns the most surfaced rows here (keeps a Bo3 under one owner /
  // lobbyId so series segmentation stays intact), tie-broken by slug.
  const ownerKey = (rep: typeof rows[number]['replay']) => rep.userId ?? `tok:${rep.ownerToken}`;
  const ownerFreq = new Map<string, number>();
  for (const { replay } of rows) ownerFreq.set(ownerKey(replay), (ownerFreq.get(ownerKey(replay)) ?? 0) + 1);
  const byGame = new Map<string, typeof rows>();
  for (const row of rows) {
    let g = byGame.get(row.replay.gameId);
    if (!g) { g = []; byGame.set(row.replay.gameId, g); }
    g.push(row);
  }
  const reps = [...byGame.values()].map((group) => {
    return [...group].sort((x, y) => {
      const xv = x.replay.userId === userId ? 1 : 0, yv = y.replay.userId === userId ? 1 : 0;
      if (xv !== yv) return yv - xv;
      const xf = ownerFreq.get(ownerKey(x.replay)) ?? 0, yf = ownerFreq.get(ownerKey(y.replay)) ?? 0;
      if (xf !== yf) return yf - xf;
      return x.replay.slug < y.replay.slug ? -1 : 1;
    })[0];
  });
  reps.sort((a, b) => new Date(b.replay.createdAt).getTime() - new Date(a.replay.createdAt).getTime());

  // B116: serialize via the shared serializer. Team perspective = the
  // representative recorder's side; `isMine` lets the owner manage their own row.
  const flat = reps.map(({ replay, ownerName }) => serializeReplayRow(replay, {
    ownerName,
    viewerPlayerId: replay.ownerPlayerId ?? null,
    internal: internalGame(replay.gameId),
    commentCount: commentCountBySlug.get(replay.slug) ?? 0,
    isMine: !!replay.userId && replay.userId === userId,
    doubleSided: internalGame(replay.gameId),
  }));
  return NextResponse.json({ ok: true, data: flat });
}

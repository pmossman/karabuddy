import { NextResponse } from 'next/server';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, users, teamMembers, replayTeamShares, replayReviews, tournaments, tournamentEntrants, tournamentMatches, tournamentRounds, tags, tagTeamScope } from '@/lib/schema';
import { getTeamMembership, surfacedReplaySlugs } from '@/lib/teamSurface';
import { serializeReplayRow } from '@/lib/replayRow';
import { reviewersForTeam } from '@/lib/reviews';
import { computeStandings, type SwissMatch } from '@/lib/swiss';
import { orderPlayersOwnerFirst } from '@/lib/players';

export const runtime = 'nodejs';

const RECENT_REPLAYS = 6;
const REVIEW_PREVIEW = 8;
const REVIEWED_PREVIEW = 4;
const DISCUSSION_PREVIEW = 5;
const STANDINGS_PREVIEW = 6;
const REGISTRANTS_PREVIEW = 16;

// GET /api/teams/[slug]/overview — the team dashboard bundle: a summary of
// recent activity across every feature, built by reusing the tabs' queries/
// helpers so it can't drift. Active tournaments carry live standings; reviews
// carry both open requests AND recently-completed reviews.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) return NextResponse.json({ ok: false, error: 'sign in required' }, { status: 401 });
  if (!(await getTeamMembership(slug, userId))) {
    return NextResponse.json({ ok: false, error: 'not a member' }, { status: 403 });
  }

  const db = getDb();

  // Member count (the roster card was dropped; the team header still shows it).
  const memberCount = (await db.select({ id: teamMembers.userId }).from(teamMembers).where(eq(teamMembers.teamSlug, slug))).length;

  // Surfaced replays for this team (same rule as the Replays tab).
  const surfaceSlugs = await surfacedReplaySlugs([slug]);

  // Recent surfaced replays — newest first.
  let recentReplays: ReturnType<typeof serializeReplayRow>[] = [];
  if (surfaceSlugs.length > 0) {
    const rows = await db
      .select({ replay: replays, ownerName: users.name })
      .from(replays)
      .leftJoin(users, eq(users.id, replays.userId))
      .where(inArray(replays.slug, surfaceSlugs))
      .orderBy(desc(replays.createdAt))
      .limit(RECENT_REPLAYS);
    recentReplays = rows.map((r) => serializeReplayRow(r.replay, { ownerName: r.ownerName ?? null, viewerPlayerId: null }));
  }

  // Open review requests — count + "awaiting you" + a preview list.
  const flagged = await db
    .select({ replaySlug: replayTeamShares.replaySlug, requestedAt: replayTeamShares.reviewRequestedAt, requestedBy: replayTeamShares.reviewRequestedBy })
    .from(replayTeamShares)
    .where(and(eq(replayTeamShares.teamSlug, slug), isNotNull(replayTeamShares.reviewRequestedAt)))
    .orderBy(desc(replayTeamShares.reviewRequestedAt));

  let reviewReplays: any[] = [];
  let awaitingYou = 0;
  if (flagged.length > 0) {
    const flaggedSlugs = flagged.map((f) => f.replaySlug);
    const reviewerMarks = await reviewersForTeam(flaggedSlugs, slug);
    const reviewedByYou = (s: string) => (reviewerMarks.get(s) ?? []).some((m) => m.userId === userId);
    awaitingYou = flagged.filter((f) => !reviewedByYou(f.replaySlug)).length;

    const previewSlugs = flaggedSlugs.slice(0, REVIEW_PREVIEW);
    const requesterIds = Array.from(new Set(flagged.map((f) => f.requestedBy).filter(Boolean))) as string[];
    const requesterNames = new Map<string, string | null>();
    if (requesterIds.length > 0) {
      const rn = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, requesterIds));
      for (const r of rn) requesterNames.set(r.id, r.name ?? null);
    }
    const rows = await db.select({ replay: replays, ownerName: users.name }).from(replays).leftJoin(users, eq(users.id, replays.userId)).where(inArray(replays.slug, previewSlugs));
    const bySlug = new Map(rows.map((r) => [r.replay.slug, r]));
    reviewReplays = previewSlugs.map((s) => {
      const row = bySlug.get(s);
      if (!row) return null;
      const f = flagged.find((x) => x.replaySlug === s)!;
      return {
        ...serializeReplayRow(row.replay, { ownerName: row.ownerName ?? null, viewerPlayerId: null }),
        requestedAt: f.requestedAt instanceof Date ? f.requestedAt.toISOString() : (f.requestedAt as any) ?? null,
        requestedByName: f.requestedBy ? requesterNames.get(f.requestedBy) ?? null : null,
        reviewedByYou: reviewedByYou(s),
        reviewerCount: (reviewerMarks.get(s) ?? []).length,
      };
    }).filter(Boolean);
  }

  // Recently COMPLETED reviews — durable reviewer marks, newest first, grouped
  // per replay. Surfaces even when there are no open requests so the card is
  // never empty when the team is reviewing actively.
  const markRows = await db
    .select({ replaySlug: replayReviews.replaySlug, reviewedAt: replayReviews.reviewedAt, reviewerName: users.name })
    .from(replayReviews)
    .innerJoin(users, eq(users.id, replayReviews.reviewerUserId))
    .where(eq(replayReviews.teamSlug, slug))
    .orderBy(desc(replayReviews.reviewedAt));
  const reviewedByReplay = new Map<string, { reviewedAt: Date | string; names: string[] }>();
  for (const m of markRows) {
    let e = reviewedByReplay.get(m.replaySlug);
    if (!e) { e = { reviewedAt: m.reviewedAt, names: [] }; reviewedByReplay.set(m.replaySlug, e); } // first = latest (desc)
    if (m.reviewerName) e.names.push(m.reviewerName);
  }
  let recentlyReviewed: any[] = [];
  const reviewedSlugs = Array.from(reviewedByReplay.keys()).slice(0, REVIEWED_PREVIEW);
  if (reviewedSlugs.length > 0) {
    const rows = await db.select({ replay: replays, ownerName: users.name }).from(replays).leftJoin(users, eq(users.id, replays.userId)).where(inArray(replays.slug, reviewedSlugs));
    const bySlug = new Map(rows.map((r) => [r.replay.slug, r]));
    recentlyReviewed = reviewedSlugs.map((s) => {
      const row = bySlug.get(s);
      if (!row) return null;
      const e = reviewedByReplay.get(s)!;
      return {
        ...serializeReplayRow(row.replay, { ownerName: row.ownerName ?? null, viewerPlayerId: null }),
        reviewedAt: e.reviewedAt instanceof Date ? e.reviewedAt.toISOString() : String(e.reviewedAt),
        reviewerNames: Array.from(new Set(e.names)),
      };
    }).filter(Boolean);
  }

  // Recent discussion — latest team-scoped tags on surfaced replays.
  let recentDiscussion: any[] = [];
  if (surfaceSlugs.length > 0) {
    const discRows = await db
      .select({ id: tags.id, replaySlug: tags.replaySlug, comment: tags.comment, createdAt: tags.createdAt, authorName: tags.authorName, authorUserName: users.name, authorImage: users.image, players: replays.players, ownerPlayerId: replays.ownerPlayerId })
      .from(tags)
      .innerJoin(tagTeamScope, and(eq(tagTeamScope.tagId, tags.id), eq(tagTeamScope.teamSlug, slug)))
      .leftJoin(users, eq(users.id, tags.userId))
      .innerJoin(replays, eq(replays.slug, tags.replaySlug))
      .where(inArray(tags.replaySlug, surfaceSlugs))
      .orderBy(desc(tags.createdAt))
      .limit(DISCUSSION_PREVIEW);
    recentDiscussion = discRows.map((r) => {
      const players = orderPlayersOwnerFirst(r.players as any, r.ownerPlayerId) as any[];
      const names = players.map((p) => p?.username || p?.name).filter(Boolean);
      return {
        id: r.id,
        replaySlug: r.replaySlug,
        comment: r.comment ?? '',
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        author: r.authorUserName || r.authorName || 'Someone',
        authorImage: r.authorImage ?? null,
        matchup: names.length >= 2 ? `${names[0]} vs ${names[1]}` : (names[0] || 'Replay'),
      };
    });
  }

  // Tournaments — count + ACTIVE ones (not completed) enriched with live
  // standings (in-progress) / registrant names (registration).
  const tRows = await db.select().from(tournaments).where(eq(tournaments.teamSlug, slug)).orderBy(desc(tournaments.createdAt));
  const activeRows = tRows.filter((t) => t.status !== 'completed').slice(0, 3);
  const activeTournaments = [];
  for (const t of activeRows) {
    const [entrants, matches, rounds] = await Promise.all([
      db.select({ id: tournamentEntrants.id, displayName: tournamentEntrants.displayName, dropped: tournamentEntrants.dropped }).from(tournamentEntrants).where(eq(tournamentEntrants.tournamentId, t.id)).orderBy(asc(tournamentEntrants.createdAt)),
      db.select({ entrant1Id: tournamentMatches.entrant1Id, entrant2Id: tournamentMatches.entrant2Id, games: tournamentMatches.games, status: tournamentMatches.status, tableNumber: tournamentMatches.tableNumber, roundId: tournamentMatches.roundId }).from(tournamentMatches).where(eq(tournamentMatches.tournamentId, t.id)),
      db.select({ id: tournamentRounds.id, number: tournamentRounds.number }).from(tournamentRounds).where(eq(tournamentRounds.tournamentId, t.id)).orderBy(asc(tournamentRounds.number)),
    ]);
    const nameById = new Map(entrants.map((e) => [e.id, e.displayName]));
    const swissMatches: SwissMatch[] = matches.map((m) => ({ entrant1Id: m.entrant1Id, entrant2Id: m.entrant2Id, games: (m.games as { winner: string | null }[]) ?? [] }));
    const standings = rounds.length > 0
      ? computeStandings(entrants.map((e) => ({ id: e.id, dropped: e.dropped })), swissMatches)
          .slice(0, STANDINGS_PREVIEW)
          .map((s) => ({ rank: s.rank, name: nameById.get(s.entrantId) ?? '—', wins: s.wins, losses: s.losses, draws: s.draws, points: s.points }))
      : [];
    // Current round pairings — the live "who's playing whom" view.
    const currentRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
    const pairings = currentRound
      ? matches
          .filter((m) => m.roundId === currentRound.id)
          .sort((a, b) => a.tableNumber - b.tableNumber)
          .map((m) => {
            const games = (m.games as { winner: string | null }[]) ?? [];
            let w1 = 0, w2 = 0;
            for (const g of games) { if (g.winner === m.entrant1Id) w1++; else if (g.winner && g.winner === m.entrant2Id) w2++; }
            const winnerId = m.entrant2Id === null ? m.entrant1Id : w1 > w2 ? m.entrant1Id : w2 > w1 ? m.entrant2Id : null;
            return {
              table: m.tableNumber,
              name1: nameById.get(m.entrant1Id) ?? '—',
              name2: m.entrant2Id ? nameById.get(m.entrant2Id) ?? '—' : null, // null = bye
              winnerName: winnerId ? nameById.get(winnerId) ?? null : null,
              status: m.status,
              score: m.entrant2Id === null ? 'bye' : `${w1}–${w2}`,
            };
          })
      : [];
    activeTournaments.push({
      id: t.id,
      name: t.name,
      status: t.status,
      entrantCount: entrants.length,
      currentRound: rounds.length,
      currentRoundNumber: currentRound?.number ?? 0,
      plannedRounds: t.plannedRounds ?? null,
      standings,
      pairings,
      registrants: entrants.slice(0, REGISTRANTS_PREVIEW).map((e) => e.displayName),
    });
  }

  return NextResponse.json({
    ok: true,
    counts: {
      tournaments: tRows.length,
      openReviews: flagged.length,
      awaitingYou,
      surfacedReplays: surfaceSlugs.length,
      members: memberCount,
    },
    activeTournaments,
    reviewReplays,
    recentlyReviewed,
    recentDiscussion,
    recentReplays,
  });
}

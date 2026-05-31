import { eq, desc, inArray } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, users, replayTeamShares, teams } from '@/lib/schema';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { MineEmpty } from './MineEmpty';
import { MineAnonymous } from './MineAnonymous';
import { ReplayFilters } from './ReplayFilters';

export const dynamic = 'force-dynamic';

// B85: "/replays" is just your own replays now — the public browse list was
// removed (replays are link-accessible + team-shared, not browsable). Signed-in
// → your library (SSR); signed-out → MineAnonymous (probes the extension token).
export default async function ReplaysIndex() {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;

  let rows: { replay: typeof replays.$inferSelect; ownerName: string | null }[] = [];
  // B89: per-replay team shares, so the Shared/Unlisted tabs + card badge can
  // tell at a glance who a replay is surfaced to. A non-shared replay is
  // "unlisted" (link-accessible), never "private" — keep the label honest.
  const sharesBySlug = new Map<string, { slug: string; name: string }[]>();
  if (userId) {
    const db = getDb();
    rows = await db
      .select({ replay: replays, ownerName: users.name })
      .from(replays)
      .leftJoin(users, eq(users.id, replays.userId))
      .where(eq(replays.userId, userId))
      .orderBy(desc(replays.createdAt))
      .limit(100);

    const slugs = rows.map((r) => r.replay.slug);
    if (slugs.length > 0) {
      const shareRows = await db
        .select({ replaySlug: replayTeamShares.replaySlug, teamSlug: teams.slug, teamName: teams.name })
        .from(replayTeamShares)
        .innerJoin(teams, eq(teams.slug, replayTeamShares.teamSlug))
        .where(inArray(replayTeamShares.replaySlug, slugs));
      for (const s of shareRows) {
        const arr = sharesBySlug.get(s.replaySlug) ?? [];
        arr.push({ slug: s.teamSlug, name: s.teamName });
        sharesBySlug.set(s.replaySlug, arr);
      }
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      <h1 style={{ margin: '0 0 20px', fontSize: 26, fontWeight: 600 }}>Your replays</h1>
      {!userId ? (
        // B54: anonymous viewers still see THEIR OWN replays via the extension's
        // install token; MineAnonymous probes the bridge and falls through to
        // MineEmpty (install pitch) if there's no extension.
        <MineAnonymous />
      ) : (
        <ReplayFilters rows={rows.map((r) => serializeRow(r, sharesBySlug.get(r.replay.slug) ?? []))} canManage showShareTabs emptyState={<MineEmpty />} />
      )}
    </main>
  );
}

function serializeRow({ replay: r, ownerName }: { replay: any; ownerName: string | null }, sharedTeams: { slug: string; name: string }[]) {
  return {
    sharedTeams,
    slug: r.slug,
    gameId: r.gameId,
    userId: r.userId,
    // B59-followup: reorder so the recorder's POV is listed first.
    players: orderPlayersOwnerFirst(r.players, r.ownerPlayerId),
    durationMs: r.durationMs,
    actionCount: r.actionCount,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    match: r.match ?? null,
    displayName: r.displayName ?? null,
    labels: r.labels ?? null,
    winners: r.winners ?? null,
    ownerPlayerId: r.ownerPlayerId ?? null,
    ownerName,
  };
}

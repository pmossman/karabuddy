import { eq, desc, inArray, count } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, users, replayTeamShares, replayParticipants, replayAltPayload, teams, tags } from '@/lib/schema';
import { serializeReplayRow } from '@/lib/replayRow';
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
  // B100: per-replay comment count, surfaced in the browser so you can see
  // discussion activity at a glance without opening each replay.
  const commentCountBySlug = new Map<string, number>();
  // B116: "My Replays" = every replay I RECORDED — not just ones the canonical
  // row is attributed to me. A double-sided replay I recorded as player 2 lives
  // under my teammate's userId (my POV is in replay_alt_payload), so union three
  // signals: my own uploads, any replay I'm a participant of, and any alt I
  // recorded. `altSideBySlug` carries my POV's playerId for the alt case so the
  // serializer resolves "my leader" correctly.
  const altSideBySlug = new Map<string, string | null>();
  if (userId) {
    const db = getDb();
    const [ownSlugRows, partSlugRows, altRows] = await Promise.all([
      db.select({ slug: replays.slug }).from(replays).where(eq(replays.userId, userId)),
      db.select({ slug: replayParticipants.replaySlug }).from(replayParticipants).where(eq(replayParticipants.userId, userId)),
      db.select({ slug: replayAltPayload.replaySlug, altOwnerPlayerId: replayAltPayload.altOwnerPlayerId }).from(replayAltPayload).where(eq(replayAltPayload.altUserId, userId)),
    ]);
    for (const a of altRows) altSideBySlug.set(a.slug, a.altOwnerPlayerId);
    const mineSlugs = Array.from(new Set([
      ...ownSlugRows.map((r) => r.slug),
      ...partSlugRows.map((r) => r.slug),
      ...altRows.map((r) => r.slug),
    ]));

    // One ordered+limited fetch over the union (apply the limit ONCE, post-union).
    rows = mineSlugs.length > 0
      ? await db
          .select({ replay: replays, ownerName: users.name })
          .from(replays)
          .leftJoin(users, eq(users.id, replays.userId))
          .where(inArray(replays.slug, mineSlugs))
          .orderBy(desc(replays.createdAt))
          .limit(100)
      : [];

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

      // Total comments per replay (all tags on the owner's own replays — it's
      // their library, so we count everything, not the viewer-scoped subset).
      const countRows = await db
        .select({ replaySlug: tags.replaySlug, n: count() })
        .from(tags)
        .where(inArray(tags.replaySlug, slugs))
        .groupBy(tags.replaySlug);
      for (const c of countRows) commentCountBySlug.set(c.replaySlug, Number(c.n));
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
        <ReplayFilters
          rows={rows.map(({ replay, ownerName }) => serializeReplayRow(replay, {
            ownerName,
            // Perspective = me: my own uploads use the canonical ownerPlayerId;
            // a replay I recorded as the alt (2nd player) uses my alt POV side.
            viewerPlayerId: replay.userId === userId ? replay.ownerPlayerId : (altSideBySlug.get(replay.slug) ?? null),
            sharedTeams: sharesBySlug.get(replay.slug) ?? [],
            commentCount: commentCountBySlug.get(replay.slug) ?? 0,
          }))}
          canManage
          showShareTabs
          emptyState={<MineEmpty />}
        />
      )}
    </main>
  );
}

import { eq, desc, inArray, count, asc } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, users, replayTeamShares, replayParticipants, replayAltPayload, teamMembers, teams, tags } from '@/lib/schema';
import { serializeReplayRow } from '@/lib/replayRow';
import { MineEmpty } from './MineEmpty';
import { MineAnonymous } from './MineAnonymous';
import { LibraryTabs } from './LibraryTabs';
import { ReplayFilters } from './ReplayFilters';
import { TeamReplays } from '@/app/(app)/teams/[slug]/TeamReplays';

export const dynamic = 'force-dynamic';

const PAGE_STYLE: React.CSSProperties = { maxWidth: 1100, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' };

// B117: "/replays" is the All-Replays hub — a tab strip switches between MY
// replays (default) and each team I'm on, in place via `?team=<slug>`. Signed-in
// only; anonymous visitors still see their own extension-token library.
export default async function ReplaysIndex({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const { team: teamParam } = await searchParams;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;

  if (!userId) {
    // B54: anonymous viewers still see THEIR OWN replays via the extension's
    // install token; MineAnonymous probes the bridge and falls through to
    // MineEmpty (install pitch) if there's no extension. No team tabs.
    return (
      <main style={PAGE_STYLE}>
        <h1 style={{ margin: '0 0 20px', fontSize: 24, fontWeight: 700 }}>Your replays</h1>
        <MineAnonymous />
      </main>
    );
  }

  const db = getDb();
  const myTeams = await db
    .select({ slug: teams.slug, name: teams.name })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teams.name));

  // An unknown / non-member ?team falls back to My replays (tab reads as such).
  const activeTeam = teamParam && myTeams.some((t) => t.slug === teamParam) ? teamParam : null;

  return (
    <main style={PAGE_STYLE}>
      <h1 style={{ margin: '0 0 14px', fontSize: 24, fontWeight: 700 }}>Replays</h1>
      <LibraryTabs teams={myTeams} activeSlug={activeTeam} />
      <div style={{ marginTop: 18 }}>
        {activeTeam ? <TeamReplays teamSlug={activeTeam} /> : <MyReplays userId={userId} />}
      </div>
    </main>
  );
}

// -- My replays (the default tab) -------------------------------------------
// B116: "My Replays" = every replay I RECORDED — my own uploads, replays I'm a
// participant of, and double-sided games I recorded as the alt (2nd) player
// (whose canonical row is attributed to my teammate). Union the three signals.
async function MyReplays({ userId }: { userId: string }) {
  const db = getDb();
  const altSideBySlug = new Map<string, string | null>();

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
  const rows = mineSlugs.length > 0
    ? await db
        .select({ replay: replays, ownerName: users.name })
        .from(replays)
        .leftJoin(users, eq(users.id, replays.userId))
        .where(inArray(replays.slug, mineSlugs))
        .orderBy(desc(replays.createdAt))
        .limit(100)
    : [];

  const slugs = rows.map((r) => r.replay.slug);
  const sharesBySlug = new Map<string, { slug: string; name: string }[]>();
  const commentCountBySlug = new Map<string, number>();
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
    // Total comments per replay (all tags on the owner's own replays).
    const countRows = await db
      .select({ replaySlug: tags.replaySlug, n: count() })
      .from(tags)
      .where(inArray(tags.replaySlug, slugs))
      .groupBy(tags.replaySlug);
    for (const c of countRows) commentCountBySlug.set(c.replaySlug, Number(c.n));
  }

  return (
    <ReplayFilters
      rows={rows.map(({ replay, ownerName }) => serializeReplayRow(replay, {
        ownerName,
        // Perspective = me: my own uploads use the canonical ownerPlayerId; a
        // replay I recorded as the alt (2nd player) uses my alt POV side.
        viewerPlayerId: replay.userId === userId ? replay.ownerPlayerId : (altSideBySlug.get(replay.slug) ?? null),
        sharedTeams: sharesBySlug.get(replay.slug) ?? [],
        commentCount: commentCountBySlug.get(replay.slug) ?? 0,
      }))}
      canManage
      showShareTabs
      emptyState={<MineEmpty />}
    />
  );
}


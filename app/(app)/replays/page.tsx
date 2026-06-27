import Link from 'next/link';
import { eq, desc, inArray, count, and, isNotNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, users, replayTeamShares, teams, teamMembers, tags, replayReviews } from '@/lib/schema';
import { serializeReplayRow } from '@/lib/replayRow';
import { doubleSidedGameIds } from '@/lib/doubleSided';
import { recordedReplaySlugs } from '@/lib/recordedReplays';
import { MineEmpty } from './MineEmpty';
import { MineAnonymous } from './MineAnonymous';
import { LibraryTabs } from './LibraryTabs';
import { ReplayFilters } from './ReplayFilters';
import { PublicReplays } from './PublicReplays';

export const dynamic = 'force-dynamic';

const PAGE_STYLE: React.CSSProperties = { maxWidth: 1100, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' };

// B117: "/replays" is the All-Replays hub — a tab strip switches between MY
// replays (default) and each team I'm on, in place via `?team=<slug>`. Signed-in
// only; anonymous visitors still see their own extension-token library.
export default async function ReplaysIndex({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: tabParam } = await searchParams;
  const session = await auth();
  const userId: string | null = session?.user?.id || null;

  if (!userId) {
    // B54: anonymous viewers still see THEIR OWN replays via the extension's
    // install token; MineAnonymous probes the bridge and falls through to
    // MineEmpty (install pitch) if there's no extension. No team tabs —
    // but B133: the 🌐 Public tab IS here, signed-out: published replays are
    // the shop window that shows what the app does.
    const publicTab = tabParam === 'public';
    return (
      <main style={PAGE_STYLE}>
        <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 700 }}>Replays</h1>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#a0a8b8', lineHeight: 1.5, maxWidth: 640 }}>
          Record your <a href="https://karabast.net" style={{ color: '#5db4ff' }}>karabast.net</a> games with the
          extension to replay them frame-by-frame, tag key turns, and review matchups. Browse public replays below, or{' '}
          <Link href="/signin?callbackUrl=/replays" style={{ color: '#5db4ff' }}>sign in</Link> to save your own.
        </p>
        <LibraryTabs activeSlug={publicTab ? 'public' : null} />
        <div style={{ marginTop: 18 }}>
          {publicTab ? <PublicReplays /> : <MineAnonymous />}
        </div>
      </main>
    );
  }

  // B133: the public discovery scope (?tab=public) — not a team. Team replays
  // moved to the team page (TEAM section), so this page is personal + public.
  const publicTab = tabParam === 'public';

  return (
    <main style={PAGE_STYLE}>
      <h1 style={{ margin: '0 0 14px', fontSize: 24, fontWeight: 700 }}>Replays</h1>
      <LibraryTabs activeSlug={publicTab ? 'public' : null} />
      <div style={{ marginTop: 18 }}>
        {publicTab ? <PublicReplays /> : <MyReplays userId={userId} />}
      </div>
    </main>
  );
}

// -- My replays (the default tab) -------------------------------------------
// B116/B156: "My Replays" = every replay I RECORDED — my own uploads + the
// double-sided games where I recorded the alt (2nd) player side (canonical row
// attributed to my teammate). Deliberately NOT replays I'm merely a resolved
// `replay_participants` entry of: that included OPPONENTS (handle-matched on
// upload) and leaked their name + private team shares into my library (B156).
async function MyReplays({ userId }: { userId: string }) {
  const db = getDb();
  const { slugs: mineSlugs } = await recordedReplaySlugs(userId);

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
  const reviewBySlug = new Map<string, { requested: boolean; reviewerCount: number }>();
  // B166: "both POVs" = one of my games has a sibling recording owned by a
  // current teammate (a double-sided view I could compose). Computed by gameId,
  // not a stored alt payload.
  const dsGameIds = await doubleSidedGameIds(userId, rows.map((r) => r.replay.gameId));
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

    // B149: review-request status on the owner's OWN replays (the "in review" /
    // "reviewed ×N" badge). Open request = the user requested it + it's not
    // cancelled; reviewerCount = total durable marks across teams.
    const reqRows = await db
      .select({ slug: replayTeamShares.replaySlug })
      .from(replayTeamShares)
      .where(and(
        inArray(replayTeamShares.replaySlug, slugs),
        eq(replayTeamShares.reviewRequestedBy, userId),
        isNotNull(replayTeamShares.reviewRequestedAt),
      ));
    const markRows = await db
      .select({ slug: replayReviews.replaySlug, n: count() })
      .from(replayReviews)
      .where(inArray(replayReviews.replaySlug, slugs))
      .groupBy(replayReviews.replaySlug);
    const markCountBySlug = new Map(markRows.map((m) => [m.slug, Number(m.n)]));
    for (const r of reqRows) reviewBySlug.set(r.slug, { requested: true, reviewerCount: markCountBySlug.get(r.slug) ?? 0 });
  }

  // Teams the viewer belongs to — populates the bulk "share with" picker.
  const myTeams = await db
    .select({ slug: teams.slug, name: teams.name })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
    .where(eq(teamMembers.userId, userId));

  return (
    <ReplayFilters
      rows={rows.map(({ replay, ownerName }) => serializeReplayRow(replay, {
        ownerName,
        // B166: every row in my library is one I own → my POV is its ownerPlayerId.
        viewerPlayerId: replay.ownerPlayerId ?? null,
        sharedTeams: sharesBySlug.get(replay.slug) ?? [],
        commentCount: commentCountBySlug.get(replay.slug) ?? 0,
        doubleSided: dsGameIds.has(replay.gameId),
        isPublic: !!replay.publicAt,
      })).map((row) => ({ ...row, reviewRequest: reviewBySlug.get(row.slug) ?? null }))}
      canManage
      showShareTabs
      myTeams={myTeams}
      emptyState={<MineEmpty />}
    />
  );
}


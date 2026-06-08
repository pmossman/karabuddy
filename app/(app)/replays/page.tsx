import { eq, desc, inArray, count, asc } from 'drizzle-orm';
import Link from 'next/link';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, users, replayTeamShares, replayParticipants, replayAltPayload, teamMembers, teams, tags } from '@/lib/schema';
import { serializeReplayRow } from '@/lib/replayRow';
import { MineEmpty } from './MineEmpty';
import { MineAnonymous } from './MineAnonymous';
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

// -- The hub tab strip -------------------------------------------------------
// My replays + a tab per team. Beyond INLINE_TEAMS, extras collapse into a
// no-JS `More ▾` disclosure (<details>) so it scales to many teams without
// overflowing. The active team is always surfaced inline.
const INLINE_TEAMS = 4;

function LibraryTabs({ teams: myTeams, activeSlug }: { teams: { slug: string; name: string }[]; activeSlug: string | null }) {
  let visible = myTeams.slice(0, INLINE_TEAMS);
  let overflow = myTeams.slice(INLINE_TEAMS);
  // Keep the active team visible: if it's hiding in the overflow, swap it into
  // the last inline slot (the displaced team moves to the front of overflow).
  if (activeSlug && overflow.some((t) => t.slug === activeSlug)) {
    const active = overflow.find((t) => t.slug === activeSlug)!;
    const displaced = visible[visible.length - 1];
    overflow = [displaced, ...overflow.filter((t) => t.slug !== activeSlug)];
    visible = [...visible.slice(0, INLINE_TEAMS - 1), active];
  }

  return (
    <>
      {/* Strip the default <details> disclosure triangle so `More ▾` reads as a tab. */}
      <style>{'summary.kb-more-tab{list-style:none}summary.kb-more-tab::-webkit-details-marker{display:none}'}</style>
      <div role="tablist" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, borderBottom: '1px solid #2e333c', flexWrap: 'wrap' }}>
        <HubTab href="/replays" active={!activeSlug}>My replays</HubTab>
        {visible.map((t) => (
          <HubTab key={t.slug} href={`/replays?team=${t.slug}`} active={activeSlug === t.slug}>{t.name}</HubTab>
        ))}
        {overflow.length > 0 && (
          <details style={{ position: 'relative' }}>
            <summary className="kb-more-tab" style={hubTabStyle(false)}>More ▾</summary>
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 4, minWidth: 180, background: '#11141a', border: '1px solid #2e333c', borderRadius: 8, padding: 6, display: 'flex', flexDirection: 'column', gap: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }}>
              {overflow.map((t) => (
                <Link
                  key={t.slug}
                  href={`/replays?team=${t.slug}`}
                  style={{ padding: '6px 10px', fontSize: 13, fontWeight: 600, color: activeSlug === t.slug ? '#fff' : '#a0a8b8', textDecoration: 'none', borderRadius: 6 }}
                >
                  {t.name}
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>
    </>
  );
}

function hubTabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    fontSize: 14,
    fontWeight: 600,
    color: active ? '#e6e6e6' : '#828b99',
    textDecoration: 'none',
    borderBottom: `2px solid ${active ? '#4d9dff' : 'transparent'}`,
    marginBottom: -1,
    cursor: 'pointer',
    background: active ? 'rgba(77,157,255,0.10)' : 'transparent',
    borderRadius: '4px 4px 0 0',
    whiteSpace: 'nowrap',
  };
}

function HubTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link role="tab" aria-selected={active} href={href} style={hubTabStyle(active)}>
      {children}
    </Link>
  );
}

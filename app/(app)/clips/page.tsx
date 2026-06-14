import { asc, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teams, teamMembers } from '@/lib/schema';
import { myCreatedClips, clipsOnMyReplays, teamClips } from '@/lib/clipBrowser';
import type { AuthContext } from '@/lib/replayPermissions';
import { ClipLibraryTabs } from './ClipLibraryTabs';
import { ClipsBrowser } from './ClipsBrowser';
import { MyClipsAnonymous } from './MyClipsAnonymous';

export const dynamic = 'force-dynamic';

const PAGE_STYLE: React.CSSProperties = { maxWidth: 1100, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' };

// B142: "/clips" — browse clips by scope (My Clips / On My Replays / a tab per
// team), mirroring the /replays hub. Anonymous visitors still see their own
// install-token clips.
export default async function ClipsIndex({ searchParams }: { searchParams: Promise<{ team?: string; tab?: string }> }) {
  const { team: teamParam, tab: tabParam } = await searchParams;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;

  if (!userId) {
    return (
      <main style={PAGE_STYLE}>
        <h1 style={{ margin: '0 0 14px', fontSize: 24, fontWeight: 700 }}>Clips</h1>
        <ClipLibraryTabs teams={[]} active="created" />
        <div style={{ marginTop: 18 }}>
          <MyClipsAnonymous />
        </div>
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

  const activeTeam = teamParam && myTeams.some((t) => t.slug === teamParam) ? teamParam : null;
  const onMyReplays = !activeTeam && tabParam === 'on-my-replays';
  const active = activeTeam ?? (onMyReplays ? 'on-my-replays' : 'created');

  const ctx: AuthContext = { sessionUserId: userId, installToken: null };
  const rows = activeTeam
    ? await teamClips(activeTeam, ctx)
    : onMyReplays
      ? await clipsOnMyReplays(ctx)
      : await myCreatedClips(ctx);

  const emptyLabel = activeTeam
    ? 'No clips on this team’s replays yet.'
    : onMyReplays
      ? 'No one has clipped your replays yet.'
      : 'You haven’t made any clips yet. Open a replay and use the ✂ Clip button to capture a moment.';

  return (
    <main style={PAGE_STYLE}>
      <h1 style={{ margin: '0 0 14px', fontSize: 24, fontWeight: 700 }}>Clips</h1>
      <ClipLibraryTabs teams={myTeams} active={active} />
      <div style={{ marginTop: 18 }}>
        <ClipsBrowser rows={rows} showCreator={!!activeTeam || onMyReplays} emptyLabel={emptyLabel} />
      </div>
    </main>
  );
}

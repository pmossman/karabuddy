import Link from 'next/link';
import { eq, desc } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teams, teamMembers, replays } from '@/lib/schema';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { ReplayCard } from '@/app/(app)/replays/ReplayCard';
import { HomeTeamActivity } from './HomeTeamActivity';
import { HomeAnonymousReplays } from './HomeAnonymousReplays';

export const dynamic = 'force-dynamic';

const RECENT_LIMIT = 6;

// B70: home page rebuilt around the teams experience.
// - Signed-in members lead with per-team activity sections, then their
//   most recent recorded replays.
// - Signed-in users with no team get a "start a team" nudge + replays.
// - Signed-out visitors lead with their own (anonymous) recent replays.
// The brand mark lives only in the persistent header now (no hero), and
// the /claim pitch is gone — linking is fully automated (B54/B69).
export default async function Home() {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;

  if (!userId) {
    return (
      <Main>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Your replays</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
            Games you’ve recorded with the extension.{' '}
            <Link href="/signin" style={{ color: '#5a8cff' }}>Sign in</Link> to save them to an
            account and unlock teams, or{' '}
            <Link href="/install" style={{ color: '#5a8cff' }}>install the extension</Link> to start
            recording.
          </p>
        </div>
        <HomeAnonymousReplays />
      </Main>
    );
  }

  const db = getDb();
  const [myTeams, recentRows] = await Promise.all([
    db
      .select({ slug: teams.slug, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
      .where(eq(teamMembers.userId, userId))
      .orderBy(teamMembers.joinedAt),
    db
      .select()
      .from(replays)
      .where(eq(replays.userId, userId))
      .orderBy(desc(replays.createdAt))
      .limit(RECENT_LIMIT),
  ]);

  const recent = recentRows.map(serializeRow);

  return (
    <Main>
      <section style={{ marginBottom: 36 }}>
        <SectionHeader title="Team activity" />
        {myTeams.length > 0 ? (
          <HomeTeamActivity teams={myTeams} />
        ) : (
          <TeamCta />
        )}
      </section>

      <section data-testid="home-recent-replays">
        <SectionHeader
          title="Your recent replays"
          action={recent.length > 0 ? { href: '/replays?tab=mine', label: 'View all →' } : undefined}
        />
        {recent.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 14,
            }}
          >
            {recent.map((r) => (
              <ReplayCard key={r.slug} replay={r as any} canManage={false} />
            ))}
          </div>
        ) : (
          <RecentEmpty />
        )}
      </section>
    </Main>
  );
}

function serializeRow(r: any) {
  return {
    slug: r.slug,
    gameId: r.gameId,
    userId: r.userId,
    players: orderPlayersOwnerFirst(r.players, r.ownerPlayerId),
    durationMs: r.durationMs,
    actionCount: r.actionCount,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    match: r.match ?? null,
    displayName: r.displayName ?? null,
    labels: r.labels ?? null,
    winners: r.winners ?? null,
    ownerPlayerId: r.ownerPlayerId ?? null,
  };
}

function Main({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '32px 28px 80px',
        color: '#e6e6e6',
        fontFamily: 'var(--font-barlow), sans-serif',
      }}
    >
      {children}
    </main>
  );
}

function SectionHeader({ title, action }: { title: string; action?: { href: string; label: string } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e6e6e6' }}>{title}</h2>
      {action && (
        <Link href={action.href} style={{ fontSize: 12, fontWeight: 600, color: '#5a8cff', textDecoration: 'none' }}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

function TeamCta() {
  return (
    <div
      data-testid="home-team-cta"
      style={{
        padding: 20,
        background: 'rgba(74, 124, 255, 0.06)',
        border: '1px solid rgba(74, 124, 255, 0.25)',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, color: '#e6e6e6' }}>Start a team</div>
      <p style={{ margin: 0, fontSize: 13, color: '#a0a8b8', lineHeight: 1.5, maxWidth: 560 }}>
        Teams are where karabuddy comes alive — tag each other’s replays, discuss key turns, and
        review matchups together for deck-tuning or tournament prep. Create one, or open an invite
        link a teammate sent you.
      </p>
      <div>
        <Link
          href="/teams"
          style={{
            display: 'inline-block',
            padding: '9px 16px',
            background: '#4a7cff',
            color: 'white',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Create or join a team →
        </Link>
      </div>
    </div>
  );
}

function RecentEmpty() {
  return (
    <div
      style={{
        padding: 24,
        border: '1px dashed #2e333c',
        borderRadius: 10,
        color: '#a0a8b8',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      No replays yet. Record one with the karabuddy Chrome extension on{' '}
      <a href="https://karabast.net" style={{ color: '#5a8cff' }}>karabast.net</a> — they upload
      here automatically.{' '}
      <Link href="/install" style={{ color: '#5a8cff' }}>Install the extension →</Link>
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq, desc, inArray, isNotNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays } from '@/lib/schema';
import { resolveActiveTeam } from '@/lib/activeTeam';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { getSampleReplaySlugs } from '@/lib/sampleReplays';
import { anonymizePlayersSummary } from '@/lib/anonymizeReplay';
import { ReplayCard } from '@/app/(app)/replays/ReplayCard';
import { HomeReviewRequests } from './HomeReviewRequests';
import { HomeAnonymousReplays } from './HomeAnonymousReplays';
import { Panel } from '@/app/_components/Panel';
import { TacticalHeading } from '@/app/_components/TacticalHeading';
import { tokens } from '@/app/_theme/karabuddyTokens';

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
    // B133: lead with recent PUBLIC replays — real games owners chose to
    // publish (comments included, anonymized) beat a static curated sample as
    // the shop window. Falls back to the B107 samples while nothing is public.
    const publicReplays = await loadPublicReplays();
    const showcase = publicReplays.length > 0 ? publicReplays : await loadSampleReplays();
    return (
      <Main>
        {showcase.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>See it in action</h1>
                {publicReplays.length > 0 && (
                  <Link href="/replays?tab=public" style={{ color: '#5db4ff', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                    Browse all public replays →
                  </Link>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#a0a8b8', lineHeight: 1.5, maxWidth: 640 }}>
                KaraBuddy records your <a href="https://karabast.net" style={{ color: '#5db4ff' }}>karabast.net</a>{' '}
                games so you can replay them frame-by-frame, tag key turns, and review matchups with
                your team. {publicReplays.length > 0
                  ? 'These are real games their owners shared publicly — comments included, players anonymized.'
                  : 'Open a sample below — players are anonymized.'}
              </p>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 14,
              }}
            >
              {showcase.map((r) => (
                <ReplayCard key={r.slug} replay={r as any} canManage={false} />
              ))}
            </div>
          </section>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Your replays</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
            Games you’ve recorded with the extension.{' '}
            <Link href="/signin" style={{ color: '#5db4ff' }}>Sign in</Link> to save them to an
            account and unlock teams, or{' '}
            <Link href="/install" style={{ color: '#5db4ff' }}>install the extension</Link> to start
            recording.
          </p>
        </div>
        <HomeAnonymousReplays />
      </Main>
    );
  }

  // Team-centric home: a member lands on their active team's dashboard, never
  // this personal digest. redirect() must sit outside any try/catch (it throws
  // a control-flow signal Next catches). Only the no-team user falls through to
  // the personal home below.
  const { active } = await resolveActiveTeam(userId);
  if (active) {
    redirect(`/teams/${active.slug}`);
  }

  const db = getDb();
  const recentRows = await db
    .select()
    .from(replays)
    .where(eq(replays.userId, userId))
    .orderBy(desc(replays.createdAt))
    .limit(RECENT_LIMIT);

  const recent = recentRows.map(serializeRow);

  return (
    <Main>
      {/* B149: the requester's own open review requests (renders nothing when none). */}
      <HomeReviewRequests />

      <section style={{ marginBottom: 36 }}>
        <SectionHeader title="Team activity" />
        <TeamCta />
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

// B133: most recently published public replays, anonymized for the signed-out
// home (same treatment as samples: Player1/Player2, no "YOU" deck badge, no
// uploader identity). displayName is kept — it's user-chosen and the owner
// published deliberately.
async function loadPublicReplays() {
  const db = getDb();
  const rows = await db
    .select()
    .from(replays)
    .where(isNotNull(replays.publicAt))
    .orderBy(desc(replays.publicAt))
    .limit(RECENT_LIMIT);
  return rows.map((r) => {
    const base = serializeRow(r);
    return { ...base, userId: null, players: anonymizePlayersSummary(base.players as any[]), ownerPlayerId: null };
  });
}

// B107: fetch the curated sample replays (by slug), preserve the curated
// order, and anonymize the player handles for public display.
async function loadSampleReplays() {
  const slugs = getSampleReplaySlugs();
  if (slugs.length === 0) return [];
  const db = getDb();
  const rows = await db.select().from(replays).where(inArray(replays.slug, slugs));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  return slugs
    .map((s) => bySlug.get(s))
    .filter(Boolean)
    .map((r) => {
      const base = serializeRow(r);
      // Null ownerPlayerId too: there's no "you" in an anonymized sample, so the
      // decks modal shouldn't badge a deck "YOU".
      return { ...base, players: anonymizePlayersSummary(base.players as any[]), displayName: null, ownerPlayerId: null };
    });
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

const actionLinkStyle: React.CSSProperties = {
  // Reset the heading's inherited mono/uppercase/tracking for the link.
  fontFamily: 'var(--font-barlow), sans-serif',
  textTransform: 'none',
  letterSpacing: 0,
  fontSize: 12,
  fontWeight: 600,
  color: '#5db4ff',
  textDecoration: 'none',
};

function SectionHeader({ title, action }: { title: string; action?: { href: string; label: string } }) {
  return (
    <TacticalHeading
      action={action ? <Link href={action.href} style={actionLinkStyle}>{action.label}</Link> : undefined}
    >
      {title}
    </TacticalHeading>
  );
}

function TeamCta() {
  return (
    <Panel accent style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div data-testid="home-team-cta" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
              background: tokens.button.bg,
              color: tokens.color.accent,
              border: `1px solid ${tokens.color.primary}`,
              boxShadow: tokens.button.glow,
              borderRadius: tokens.radius.sm,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Create or join a team →
          </Link>
        </div>
      </div>
    </Panel>
  );
}

function RecentEmpty() {
  return (
    <Panel hud={false} style={{ border: '1px dashed #2e333c', background: 'transparent', boxShadow: 'none' }}>
      <span style={{ color: '#a0a8b8', fontSize: 13, lineHeight: 1.5 }}>
        No replays yet. Record one with the karabuddy Chrome extension on{' '}
        <a href="https://karabast.net" style={{ color: '#5db4ff' }}>karabast.net</a> — they upload
        here automatically.{' '}
        <Link href="/install" style={{ color: '#5db4ff' }}>Install the extension →</Link>
      </span>
    </Panel>
  );
}

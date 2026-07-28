import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teams, teamMembers, users } from '@/lib/schema';
import { TeamControls } from './TeamControls';
import { MyPrivateAccess } from '@/app/_components/MyPrivateAccess';
import { PrivateModeToggle } from './PrivateModeToggle';
import { ReadinessRoster } from './ReadinessRoster';
import { Panel } from '@/app/_components/Panel';
import { TransferOwnership } from './TransferOwnership';
import { RemoveMember } from './RemoveMember';
import { DeleteTeam } from './DeleteTeam';
import { TeamDiscordConnect } from './TeamDiscordConnect';
import { TeamOverview } from './TeamOverview';
import { TeamReplays } from './TeamReplays';
import { TeamDiscussion } from './TeamDiscussion';
import { TeamTournaments } from './TeamTournaments';
import { ReviewQueue } from './ReviewQueue';
import { TeamOpenings } from './TeamOpenings';
import { SideboardingHub } from './SideboardingHub';
import { ClipsBrowser } from '@/app/(app)/clips/ClipsBrowser';
import { StatsClient } from '@/app/(app)/stats/StatsClient';
import { teamClips } from '@/lib/clipBrowser';
import { tokens } from '@/app/_theme/karabuddyTokens';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}

// B61 split the team page into discussion + replays. B62 tabs it: one
// page, three+ distinct concerns, separate tab per concern. Active tab
// is URL-persisted (`?tab=X`) so deep-links + browser back work.
// Overview is the default landing "hub"; the rest stay as drill-in tabs. The
// clean-URL rule maps the default tab to bare /teams/<slug>, so old ?tab= deep
// links keep working — only change: bare /teams/<slug> now lands on Overview.
const VALID_TABS = ['overview', 'discussion', 'replays', 'clips', 'review', 'openings', 'sideboarding', 'tournaments', 'stats', 'members', 'settings'] as const;
type Tab = (typeof VALID_TABS)[number];
const DEFAULT_TAB: Tab = 'overview';

function parseTab(raw: string | undefined): Tab {
  return VALID_TABS.includes(raw as Tab) ? (raw as Tab) : DEFAULT_TAB;
}

// Small electric-blue eyebrow above the team name on each feature page — orients
// the user + differentiates the tabs (which all share the team-name header). The
// dashboard (overview) is the landing, so it stands on the team name alone.
const TAB_EYEBROW: Partial<Record<Tab, string>> = {
  discussion: 'Team Discussion',
  replays: 'Team Replays',
  clips: 'Team Clips',
  review: 'Team Reviews',
  openings: 'Team Openings',
  tournaments: 'Team Tournaments',
  stats: 'Team Stats',
  members: 'Team Members',
  settings: 'Team Settings',
};

// B81: the "Add to Discord" bot-invite URL (scope=bot, View+Send perms). State
// carries the team slug so the callback binds the guild to this team. Null when
// Discord isn't configured (no client id) → the connect UI shows a hint instead.
function discordAuthorizeUrl(slug: string): string | null {
  const clientId = process.env.AUTH_DISCORD_ID;
  if (!clientId) return null;
  const base = (process.env.KARABUDDY_PUBLIC_URL || 'https://karabuddy.app').replace(/\/$/, '');
  const redirect = encodeURIComponent(`${base}/api/discord/callback`);
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=3072&response_type=code&redirect_uri=${redirect}&state=${encodeURIComponent(slug)}`;
}

export default async function TeamPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = parseTab(rawTab);

  const session = await auth();
  const userId: string | null = session?.user?.id || null;
  if (!userId) {
    redirect(`/signin?callbackUrl=/teams/${slug}`);
  }

  const db = getDb();
  const [team] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  if (!team) notFound();

  const [me] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamSlug, slug), eq(teamMembers.userId, userId)))
    .limit(1);
  if (!me) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 600 }}>{team.name}</h1>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: '#a0a8b8' }}>
          You&apos;re not a member of this team. Ask an owner for an invite link.
        </p>
        <Link href="/teams" style={{ color: '#5db4ff', fontSize: 13 }}>← All teams</Link>
      </main>
    );
  }

  // Members list is always fetched — it's small and drives both the
  // Members tab AND the "N members" header summary.
  const members = await db
    .select({
      userId: teamMembers.userId,
      role: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
      name: users.name,
      image: users.image,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamSlug, slug))
    .orderBy(teamMembers.joinedAt);

  const isOverview = tab === 'overview';

  // Team clips live here (TEAM section), mirroring team Replays — the personal
  // /clips page no longer carries per-team tabs.
  const teamClipRows = tab === 'clips'
    ? await teamClips(slug, { sessionUserId: userId, installToken: null })
    : [];

  const isGauntlet = tab === 'openings';

  return (
    <main
      style={{
        // The overview dashboard + the openings gauntlet (rail + table stage)
        // both want the wide canvas.
        maxWidth: isOverview || isGauntlet ? 1440 : 1100,
        margin: '0 auto',
        // The gauntlet is a play surface — every vertical pixel goes to the
        // table, so its header collapses to one slim line and the padding
        // tightens (the sitewide footer is hidden by the tab itself).
        padding: isGauntlet ? '16px 20px 28px' : '32px 28px 80px',
        color: '#e6e6e6',
        fontFamily: 'var(--font-barlow), sans-serif',
      }}
    >
      {isGauntlet ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '0 0 12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: tokens.led.on }}>
            Team Openings
          </span>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#c8cdd8' }}>{team.name}</h1>
        </div>
      ) : (
        <>
          {TAB_EYEBROW[tab] && (
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: tokens.led.on, margin: '0 0 3px' }}>
              {TAB_EYEBROW[tab]}
            </div>
          )}
          <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 600 }}>{team.name}</h1>
          <p style={{ margin: '0 0 20px', fontSize: 12, color: '#6c7588' }}>
            {members.length} {members.length === 1 ? 'member' : 'members'} · Created{' '}
            {new Date(team.createdAt).toLocaleDateString()}
          </p>
        </>
      )}

      {/* B170 / ADR 0010: a private team's members get a top-of-page nudge until
          they're set up (extension + key). Hidden once ready, and never shown for
          non-private teams. Shows on every tab so it can't be missed. */}
      {(team as any).privateMode && (
        <MyPrivateAccess variant="banner" teamName={team.name} teamKeyId={(team as any).teamKeyId ?? null} />
      )}

      {/* Section nav lives in the left sidebar now — no in-page tab bar. */}
      <div style={{ marginTop: isOverview ? 4 : 20 }}>
        {tab === 'overview' && <TeamOverview slug={slug} />}
        {tab === 'discussion' && <TeamDiscussion teamSlug={slug} />}
        {tab === 'replays' && <TeamReplays teamSlug={slug} isOwner={me.role === 'owner'} />}
        {tab === 'clips' && (
          <ClipsBrowser rows={teamClipRows} showCreator emptyLabel="No clips on this team’s replays yet." />
        )}
        {tab === 'review' && <ReviewQueue teamSlug={slug} />}
        {tab === 'openings' && (
          (team as any).privateMode ? (
            // B221: openings are extracted from plaintext frames server-side —
            // a private team's encrypted replays never expose them (ADR 0010).
            <div style={{ padding: 32, textAlign: 'center', color: '#8a93a3', maxWidth: 460, margin: '0 auto', lineHeight: 1.5 }}>
              <div style={{ fontSize: 32 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#e6ebf2', marginTop: 8 }}>Opening drills are off for private teams</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>
                This team’s replays are end-to-end encrypted, so the server can’t read the hands
                to build drills from them.
              </div>
            </div>
          ) : (
            <TeamOpenings
              teamSlug={slug}
              members={members.map((m) => ({ userId: m.userId, name: m.name }))}
              viewerName={session?.user?.name || 'You'}
            />
          )
        )}
        {tab === 'sideboarding' && (
          (team as any).privateMode ? (
            // B227: sideboards diff the recorder's plaintext decklists across
            // games — a private team's encrypted replays never expose them.
            <div style={{ padding: 32, textAlign: 'center', color: '#8a93a3', maxWidth: 460, margin: '0 auto', lineHeight: 1.5 }}>
              <div style={{ fontSize: 32 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#e6ebf2', marginTop: 8 }}>Sideboard drills are off for private teams</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>
                This team’s replays are end-to-end encrypted, so the server can’t read the decklists
                to build drills from them.
              </div>
            </div>
          ) : (
            <SideboardingHub
              teamSlug={slug}
              members={members.map((m) => ({ userId: m.userId, name: m.name }))}
              viewerName={session?.user?.name || 'You'}
            />
          )
        )}
        {tab === 'stats' && (
          (team as any).privateMode ? (
            // B170 / ADR 0010: stats are mined from plaintext frames server-side,
            // which a private team's encrypted replays never expose — so there's
            // nothing to aggregate. Say so plainly rather than show an empty page.
            <div style={{ padding: 32, textAlign: 'center', color: '#8a93a3', maxWidth: 460, margin: '0 auto', lineHeight: 1.5 }}>
              <div style={{ fontSize: 32 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#e6ebf2', marginTop: 8 }}>Stats are off for private teams</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>
                This team’s replays are end-to-end encrypted, so the server can’t read the cards or
                results to build matchup and card stats. Review your games in the viewer instead.
              </div>
            </div>
          ) : (
            <StatsClient scope="team" teamSlug={slug} teamName={team.name} signedIn embedded />
          )
        )}
        {tab === 'tournaments' && <TeamTournaments teamSlug={slug} />}
        {tab === 'members' && <MembersList members={members} viewerUserId={userId} />}
        {tab === 'settings' && (
          // B170: one consistent stack — a bare action row on top, then uniform
          // Panel sections with even rhythm (each section roots in <Panel>).
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
            <TeamControls
              slug={slug}
              teamName={team.name}
              viewerRole={me.role}
              memberCount={members.length}
            />
            {me.role === 'owner' && (
              <>
                <TeamDiscordConnect
                  slug={slug}
                  authorizeUrl={discordAuthorizeUrl(slug)}
                  initialGuildId={team.discordGuildId}
                  initialChannelId={team.discordChannelId}
                />
                {/* B160: hand the team to another member (you step down). */}
                <TransferOwnership slug={slug} members={members} viewerUserId={userId} />
                {/* Remove a member from the team (owner only, are-you-sure confirm). */}
                <RemoveMember slug={slug} members={members} viewerUserId={userId} />
                {/* B192: permanently delete the team (owner only, typed-name confirm). */}
                <DeleteTeam slug={slug} teamName={team.name} />
              </>
            )}
            {/* B170 / ADR 0010: encryption is an advanced/security section near
                the bottom — deliberately not the headline. With private mode ON
                several panels pertain to it (toggle, key, readiness, rotation),
                so they live under one labeled "Privacy & encryption" sub-section
                divided off from the general settings. Owner sees the management
                panels; every member of a private team gets the load-your-key
                affordance (they need the key to view/record). */}
            {(me.role === 'owner' || (team as any).privateMode) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', color: '#e6ebf2', display: 'flex', alignItems: 'center', gap: 9 }}>
                    🔒 Privacy &amp; encryption
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#8a93a3', lineHeight: 1.5 }}>
                    End-to-end encrypt this team&apos;s replays — not even the KaraBuddy team can read them.{' '}
                    <Link href="/how-privacy-mode-works#for-owners" style={{ color: '#5db4ff', textDecoration: 'none' }}>How it works →</Link>
                  </p>
                </div>
                {me.role === 'owner' && (
                  <PrivateModeToggle
                    slug={slug}
                    initialPrivateMode={!!(team as any).privateMode}
                    initialTeamKeyId={(team as any).teamKeyId ?? null}
                  />
                )}
                {(team as any).privateMode && (
                  <Panel>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#e6ebf2', display: 'flex', alignItems: 'center', gap: 8 }}>Your team key</div>
                    <p style={{ margin: '8px 0 14px', fontSize: 13, color: '#a0a8b8', lineHeight: 1.55 }}>
                      Load this team&apos;s key in the extension to view and record. It stays on your device and is never
                      sent to karabuddy.
                    </p>
                    {/* B170: the member's personal "am I set up?" checklist —
                        carries the single contextual key-manager button (Open /
                        Manage), so no separate ManageKeysButton is needed here. */}
                    <MyPrivateAccess variant="checklist" teamName={team.name} teamKeyId={(team as any).teamKeyId ?? null} />
                  </Panel>
                )}
                {me.role === 'owner' && (team as any).privateMode && <ReadinessRoster slug={slug} />}
                {/* B170 / ADR 0010: key rotation lives in the extension's key
                    manager now (open it via "Manage this team's key" above) — the
                    whole rotation runs there without bouncing back to the webapp. */}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function MembersList({ members, viewerUserId }: { members: any[]; viewerUserId: string }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {members.map((m: any) => (
        <div
          key={m.userId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            background: tokens.surface.panel,
            border: `1px solid ${tokens.surface.panelBorder}`,
            borderRadius: tokens.radius.md,
            boxShadow: tokens.surface.panelShadow,
          }}
        >
          {m.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.image} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
          ) : (
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#2e333c' }} />
          )}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {m.name || 'Unnamed'}
            </span>
          </div>
          {m.role === 'owner' && (
            <span style={{ fontSize: 10, color: '#5db4ff', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
              Owner
            </span>
          )}
          {m.userId === viewerUserId && (
            <span style={{ fontSize: 10, color: '#6bd968', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
              You
            </span>
          )}
        </div>
      ))}
    </section>
  );
}

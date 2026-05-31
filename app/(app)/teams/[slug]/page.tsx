import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teams, teamMembers, users } from '@/lib/schema';
import { TeamControls } from './TeamControls';
import { TeamNotificationPrefs } from './TeamNotificationPrefs';
import { TeamDiscordConnect } from './TeamDiscordConnect';
import { TeamReplays } from './TeamReplays';
import { TeamDiscussion } from './TeamDiscussion';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}

// B61 split the team page into discussion + replays. B62 tabs it: one
// page, three+ distinct concerns, separate tab per concern. Active tab
// is URL-persisted (`?tab=X`) so deep-links + browser back work.
const VALID_TABS = ['discussion', 'replays', 'members', 'settings'] as const;
type Tab = (typeof VALID_TABS)[number];
const DEFAULT_TAB: Tab = 'discussion';

function parseTab(raw: string | undefined): Tab {
  return VALID_TABS.includes(raw as Tab) ? (raw as Tab) : DEFAULT_TAB;
}

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
  const userId: string | null = (session?.user as any)?.id || null;
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
        <Link href="/teams" style={{ color: '#5da9ff', fontSize: 13 }}>← All teams</Link>
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
      karabastUsername: users.karabastUsername,
      image: users.image,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamSlug, slug))
    .orderBy(teamMembers.joinedAt);

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
      <div style={{ marginBottom: 8 }}>
        <Link href="/teams" style={{ color: '#a0a8b8', fontSize: 12, textDecoration: 'none' }}>← Teams</Link>
      </div>
      <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 600 }}>{team.name}</h1>
      <p style={{ margin: '0 0 20px', fontSize: 12, color: '#6c7588' }}>
        {members.length} {members.length === 1 ? 'member' : 'members'} · Created{' '}
        {new Date(team.createdAt).toLocaleDateString()}
      </p>

      <TabBar slug={slug} active={tab} />

      <div style={{ marginTop: 20 }}>
        {tab === 'discussion' && <TeamDiscussion teamSlug={slug} />}
        {tab === 'replays' && <TeamReplays teamSlug={slug} />}
        {tab === 'members' && <MembersList members={members} viewerUserId={userId} />}
        {tab === 'settings' && (
          <>
            <TeamControls
              slug={slug}
              teamName={team.name}
              viewerRole={me.role}
              memberCount={members.length}
            />
            <TeamNotificationPrefs slug={slug} />
            {me.role === 'owner' && (
              <TeamDiscordConnect
                slug={slug}
                authorizeUrl={discordAuthorizeUrl(slug)}
                initialGuildId={team.discordGuildId}
                initialChannelId={team.discordChannelId}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

function TabBar({ slug, active }: { slug: string; active: Tab }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'discussion', label: 'Discussion' },
    { id: 'replays', label: 'Replays' },
    { id: 'members', label: 'Members' },
    { id: 'settings', label: 'Settings' },
  ];
  return (
    <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid #2e333c' }}>
      {tabs.map((t) => {
        const isActive = active === t.id;
        // Default tab omits ?tab=X for clean URLs.
        const href = t.id === DEFAULT_TAB ? `/teams/${slug}` : `/teams/${slug}?tab=${t.id}`;
        return (
          <Link
            key={t.id}
            role="tab"
            aria-selected={isActive}
            href={href}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              color: isActive ? '#e6e6e6' : '#a0a8b8',
              textDecoration: 'none',
              borderBottom: isActive ? '2px solid #4a7cff' : '2px solid transparent',
              marginBottom: -1,
              background: isActive ? 'rgba(74, 124, 255, 0.06)' : 'transparent',
              borderRadius: '4px 4px 0 0',
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
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
            background: 'rgba(17, 20, 26, 0.6)',
            border: '1px solid #2e333c',
            borderRadius: 6,
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
              {m.karabastUsername || m.name || 'Unnamed'}
            </span>
            {m.karabastUsername && m.name && m.name !== m.karabastUsername && (
              <span style={{ fontSize: 11, color: '#6c7588' }}>{m.name}</span>
            )}
          </div>
          {m.role === 'owner' && (
            <span style={{ fontSize: 10, color: '#5da9ff', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
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

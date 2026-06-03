import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { auth, signIn } from '@/auth';
import { getDb } from '@/lib/db';
import { users, accounts, teams, teamMembers } from '@/lib/schema';
import { UploadThresholdForm } from './UploadThresholdForm';
import { NotificationsForm } from './NotificationsForm';
import { StatsPrivacyForm } from './StatsPrivacyForm';
import { TeamNotificationPrefs } from '../teams/[slug]/TeamNotificationPrefs';
import { LinkedExtensions } from './LinkedExtensions';
import { Panel } from '@/app/_components/Panel';
import { TacticalHeading } from '@/app/_components/TacticalHeading';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B83: Slack-style settings — a left rail of sections instead of one long
// scroll. Per-team notification prefs moved in under "Teams".
const SECTIONS = [
  { id: 'account', label: 'Account' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'teams', label: 'Teams' },
  { id: 'extension', label: 'Extension' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const desc: React.CSSProperties = { margin: '0 0 16px', fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) redirect('/signin?callbackUrl=/settings');
  const { section: raw } = await searchParams;
  const section: SectionId = SECTIONS.find((s) => s.id === raw)?.id ?? 'account';

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [discordAccount] = await db
    .select({ id: accounts.providerAccountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, 'discord')))
    .limit(1);
  const discordLinked = !!discordAccount;

  const myTeams = section === 'teams'
    ? await db.select({ slug: teams.slug, name: teams.name }).from(teamMembers).innerJoin(teams, eq(teams.slug, teamMembers.teamSlug)).where(eq(teamMembers.userId, userId))
    : [];

  return (
    <main style={{ maxWidth: 940, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      <h1 style={{ margin: '0 0 24px', fontSize: 26, fontWeight: 600 }}>Settings</h1>
      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <nav data-testid="settings-nav" style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 150, flex: '0 0 auto' }}>
          {SECTIONS.map((s) => {
            const active = s.id === section;
            return (
              <Link
                key={s.id}
                href={`/settings?section=${s.id}`}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  borderLeft: `2px solid ${active ? tokens.led.on : 'transparent'}`,
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: 'none',
                  color: active ? '#fff' : '#a0a8b8',
                  background: active ? tokens.led.rowOn : 'transparent',
                  boxShadow: active ? '0 0 10px rgba(77, 210, 255, 0.1)' : 'none',
                }}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {section === 'account' && (
            <>
              <Panel>
                <TacticalHeading>Discord</TacticalHeading>
                <p style={desc}>Used for sign-in and @-mention notifications.</p>
                {discordLinked ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#6bd968' }}>✓ Discord connected — DMs can reach you.</p>
                ) : (
                  <form action={async () => { 'use server'; await signIn('discord', { redirectTo: '/settings?section=account' }); }}>
                    <p style={{ margin: '0 0 8px', fontSize: 13, color: '#a0a8b8' }}>Connect Discord to enable DM notifications:</p>
                    <button type="submit" style={{ background: '#5865F2', color: '#fff', border: 0, borderRadius: 6, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Connect Discord
                    </button>
                  </form>
                )}
              </Panel>
              <Panel>
                <TacticalHeading>Community stats</TacticalHeading>
                <p style={desc}>
                  Your games feed the anonymized <Link href="/stats" style={{ color: '#5db4ff' }}>global meta stats</Link> (aggregate win
                  rates only, never individual games, and only above a minimum sample size). Turn this off to exclude your
                  replays from the global numbers — your personal and team stats are unaffected.
                </p>
                <StatsPrivacyForm initialExcluded={!!user?.excludeFromGlobalStats} />
              </Panel>
            </>
          )}

          {section === 'notifications' && (
            <Panel>
              <TacticalHeading>Discord notifications</TacticalHeading>
              <p style={desc}>
                Get a Discord DM (or a ping in your team&apos;s channel) when someone @-mentions you on a replay.
                This master switch overrides per-team settings (under <Link href="/settings?section=teams" style={{ color: '#5db4ff' }}>Teams</Link>);
                the <Link href="/mentions" style={{ color: '#5db4ff' }}>Mentions inbox</Link> always works regardless.
              </p>
              <NotificationsForm initialDisabled={!!user?.notificationsDisabled} />
            </Panel>
          )}

          {section === 'teams' && (
            <Panel>
              <TacticalHeading>Team notifications</TacticalHeading>
              <p style={desc}>Your per-team DM preferences. Rename, invites, and Discord for a team live on the team&apos;s own page.</p>
              {myTeams.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: '#a0a8b8' }}>
                  You&apos;re not in any teams yet. <Link href="/teams" style={{ color: '#5db4ff' }}>Teams →</Link>
                </p>
              ) : (
                myTeams.map((t) => (
                  <div key={t.slug} style={{ borderTop: '1px solid #2e333c', paddingTop: 14, marginTop: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: 14 }}>{t.name}</strong>
                      <Link href={`/teams/${t.slug}?tab=settings`} style={{ fontSize: 12, color: '#5db4ff' }}>Manage team →</Link>
                    </div>
                    <TeamNotificationPrefs slug={t.slug} />
                  </div>
                ))
              )}
            </Panel>
          )}

          {section === 'extension' && (
            <>
              <Panel>
                <TacticalHeading>Minimum actions before upload</TacticalHeading>
                <p style={desc}>
                  How many actions <strong>each</strong> player must take before a match is worth uploading. Matches
                  where either player did less (rage-quits, abandoned lobbies) are skipped by automatic uploads; manual
                  saves are never blocked. Default is 5.
                </p>
                <UploadThresholdForm initial={user?.minUploadActions ?? 5} />
              </Panel>
              <Panel>
                <TacticalHeading>Linked extensions</TacticalHeading>
                <p style={desc}>
                  Every browser where you&apos;ve installed the extension and visited karabuddy.app while signed in.
                  Replays uploaded from a linked install attribute to your account. Revoke any you don&apos;t recognize.
                </p>
                <LinkedExtensions />
              </Panel>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

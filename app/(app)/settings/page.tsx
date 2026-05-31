import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { auth, signIn } from '@/auth';
import { getDb } from '@/lib/db';
import { users, accounts } from '@/lib/schema';
import { SettingsForm } from './SettingsForm';
import { UploadThresholdForm } from './UploadThresholdForm';
import { NotificationsForm } from './NotificationsForm';
import { LinkedExtensions } from './LinkedExtensions';

export default async function SettingsPage() {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) redirect('/signin?callbackUrl=/settings');
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  // B81: is a Discord account linked? (DMs need it — Google-only users link here.)
  const [discordAccount] = await db
    .select({ id: accounts.providerAccountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, 'discord')))
    .limit(1);
  const discordLinked = !!discordAccount;

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 32px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      <h1 style={{ margin: '0 0 24px', fontSize: 26, fontWeight: 600 }}>Settings</h1>

      <section style={{ padding: 20, background: 'rgba(17,20,26,0.6)', border: '1px solid #2e333c', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600 }}>karabast.net username</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
          Your username on karabast.net. When set, replays uploaded via the extension under this
          username (or with tags authored under this name) are automatically attributed to you.
          Existing anonymous matches get claimed too.
        </p>
        <SettingsForm initial={user?.karabastUsername || ''} />
      </section>

      <section style={{ marginTop: 24, padding: 20, background: 'rgba(17,20,26,0.6)', border: '1px solid #2e333c', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600 }}>Minimum actions before upload</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
          How many actions <strong>each</strong> player must take before a match is worth uploading.
          Matches where either player did less (rage-quits, abandoned lobbies) are skipped by the
          extension&apos;s automatic uploads. Manual saves are never blocked. Default is 5.
        </p>
        <UploadThresholdForm initial={user?.minUploadActions ?? 5} />
      </section>

      <section style={{ marginTop: 24, padding: 20, background: 'rgba(17,20,26,0.6)', border: '1px solid #2e333c', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600 }}>Discord notifications</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
          Get a Discord DM (or a ping in your team&apos;s channel) when someone @-mentions you on a replay.
          Needs a linked Discord account; the master switch below overrides per-team settings, and the{' '}
          <a href="/mentions" style={{ color: '#5da9ff' }}>Mentions inbox</a> always works regardless.
        </p>
        {discordLinked ? (
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6bd968' }}>✓ Discord connected — DMs can reach you.</p>
        ) : (
          <div style={{ margin: '0 0 14px' }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#a0a8b8' }}>
              You signed in with Google — connect Discord to enable DM notifications:
            </p>
            <form action={async () => { 'use server'; await signIn('discord', { redirectTo: '/settings' }); }}>
              <button type="submit" style={{ background: '#5865F2', color: '#fff', border: 0, borderRadius: 6, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Connect Discord
              </button>
            </form>
          </div>
        )}
        <NotificationsForm initialDisabled={!!user?.notificationsDisabled} />
      </section>

      <section style={{ marginTop: 24, padding: 20, background: 'rgba(17,20,26,0.6)', border: '1px solid #2e333c', borderRadius: 8 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600 }}>Linked extensions</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
          Every browser where you&apos;ve installed the karabuddy extension AND visited
          karabuddy.app while signed in shows up here. Replays uploaded from a linked
          install attribute to your account automatically. Revoke any link you don&apos;t
          recognize.
        </p>
        <LinkedExtensions />
      </section>
    </main>
  );
}

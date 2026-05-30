import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { users } from '@/lib/schema';
import { SettingsForm } from './SettingsForm';
import { LinkedExtensions } from './LinkedExtensions';

export default async function SettingsPage() {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) redirect('/signin?callbackUrl=/settings');
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

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

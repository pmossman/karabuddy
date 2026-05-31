import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teams, teamMembers } from '@/lib/schema';
import { CreateTeamForm } from './CreateTeamForm';

export const dynamic = 'force-dynamic';

// B55a: index of the signed-in user's teams. Anonymous viewers see a
// sign-in prompt — teams require an account (anonymous-extension flow
// can browse own replays without an account, but teams are deliberately
// account-gated because they involve social trust).
export default async function TeamsIndex() {
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;

  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '32px 28px 80px',
        color: '#e6e6e6',
        fontFamily: 'var(--font-barlow), sans-serif',
      }}
    >
      <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 600 }}>Teams</h1>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
        Groups for deck-tuning, tournament prep, or just reviewing matches with
        friends. Team members can tag each other&apos;s replays, get @-mention
        notifications, and surface tagged matches in a shared view.
      </p>

      {!userId ? (
        <SignInPrompt />
      ) : (
        <TeamsList userId={userId} />
      )}
    </main>
  );
}

async function TeamsList({ userId }: { userId: string }) {
  const db = getDb();
  const rows = await db
    .select({
      slug: teams.slug,
      name: teams.name,
      role: teamMembers.role,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
    .where(eq(teamMembers.userId, userId))
    .orderBy(teamMembers.joinedAt);
  return (
    <>
      {rows.length > 0 && (
        <section style={{ marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Your teams
          </div>
          {rows.map((t) => (
            <Link
              key={t.slug}
              href={`/teams/${t.slug}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                background: 'rgba(17, 20, 26, 0.6)',
                border: '1px solid #2e333c',
                borderRadius: 8,
                color: '#e6e6e6',
                textDecoration: 'none',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</span>
              <span style={{ fontSize: 11, color: t.role === 'owner' ? '#5db4ff' : '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                {t.role}
              </span>
            </Link>
          ))}
        </section>
      )}

      <section style={{ borderTop: rows.length > 0 ? '1px solid #2e333c' : 'none', paddingTop: rows.length > 0 ? 24 : 0 }}>
        <CreateTeamForm />
      </section>

      <section style={{ marginTop: 24, padding: 16, background: 'rgba(77, 157, 255, 0.06)', border: '1px solid rgba(77, 157, 255, 0.2)', borderRadius: 8 }}>
        <div style={{ fontSize: 12, color: '#a7d2ff', lineHeight: 1.5 }}>
          Joining an existing team? Open the invite link your team owner sent —
          it&apos;ll look like <code style={{ color: '#5db4ff' }}>karabuddy.app/teams/join?code=…</code>
        </div>
      </section>
    </>
  );
}

function SignInPrompt() {
  return (
    <div style={{ padding: 32, border: '1px dashed #2e333c', borderRadius: 8, textAlign: 'center' }}>
      <p style={{ margin: 0, color: '#a0a8b8', fontSize: 13 }}>Sign in to create or join a team.</p>
      <Link
        href="/signin?callbackUrl=/teams"
        style={{ display: 'inline-block', marginTop: 16, padding: '10px 16px', background: '#4d9dff', color: 'white', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
      >
        Sign in
      </Link>
    </div>
  );
}

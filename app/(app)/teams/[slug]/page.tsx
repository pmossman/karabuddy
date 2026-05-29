import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { teams, teamMembers, users } from '@/lib/schema';
import { TeamControls } from './TeamControls';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

// B55a: team home — member list + invite/leave controls. B55b will add
// the team replays grid below the member list.
export default async function TeamPage({ params }: PageProps) {
  const { slug } = await params;
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
    // Not a member — show a stub asking for an invite. Don't leak the
    // member list to non-members.
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
        <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 600 }}>{team.name}</h1>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: '#a0a8b8' }}>
          You&apos;re not a member of this team. Ask an owner for an invite link.
        </p>
        <Link href="/teams" style={{ color: '#5da9ff', fontSize: 13 }}>← All teams</Link>
      </main>
    );
  }

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
        maxWidth: 720,
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
      <p style={{ margin: '0 0 24px', fontSize: 12, color: '#6c7588' }}>
        {members.length} {members.length === 1 ? 'member' : 'members'} · Created{' '}
        {new Date(team.createdAt).toLocaleDateString()}
      </p>

      <TeamControls
        slug={slug}
        teamName={team.name}
        viewerRole={me.role}
        memberCount={members.length}
      />

      <section style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Members
        </div>
        {members.map((m) => (
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
            {m.userId === userId && (
              <span style={{ fontSize: 10, color: '#6bd968', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                You
              </span>
            )}
          </div>
        ))}
      </section>

      <section style={{ marginTop: 28, padding: 16, background: 'rgba(74, 124, 255, 0.04)', border: '1px dashed #2e333c', borderRadius: 8 }}>
        <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Team replays
        </div>
        <p style={{ margin: 0, fontSize: 12, color: '#a0a8b8', lineHeight: 1.5 }}>
          Coming soon (B55b). Replays your team members tag or share will surface here.
        </p>
      </section>
    </main>
  );
}

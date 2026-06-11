import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTournamentAccess } from '@/lib/tournamentAccess';
import { TournamentDetail } from './TournamentDetail';

export const dynamic = 'force-dynamic';

// B124: tournament detail page — server component gates auth + access +
// existence, then the client TournamentDetail drives everything off
// GET /api/teams/[slug]/tournaments/[id].
// B127: viewable by team members OR linked entrants (invite-link players get
// tournament-scoped access without team membership).
export default async function TournamentPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) redirect(`/signin?callbackUrl=/teams/${slug}/tournaments/${id}`);

  const access = await getTournamentAccess(slug, id, userId);
  if (!access) notFound();
  if (!access.canView) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600 }}>Team tournament</h1>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: '#a0a8b8' }}>
          Tournaments are visible to team members and registered players. Ask the
          organizer for an invite link.
        </p>
        <Link href="/teams" style={{ color: '#5db4ff', fontSize: 13 }}>← All teams</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      {/* The team page is member-gated — entrant-only viewers get no back link. */}
      {access.isMember && (
        <div style={{ marginBottom: 8 }}>
          <Link href={`/teams/${slug}?tab=tournaments`} style={{ color: '#a0a8b8', fontSize: 12, textDecoration: 'none' }}>
            ← Tournaments
          </Link>
        </div>
      )}
      <TournamentDetail teamSlug={slug} tournamentId={id} />
    </main>
  );
}

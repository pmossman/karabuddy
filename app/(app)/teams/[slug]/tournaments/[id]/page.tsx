import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTeamMembership } from '@/lib/teamSurface';
import { loadTournament } from '@/lib/tournamentAccess';
import { TournamentDetail } from './TournamentDetail';

export const dynamic = 'force-dynamic';

// B124: tournament detail page — server component gates auth + membership +
// existence (same pattern as the team page), then the client TournamentDetail
// drives everything off GET /api/teams/[slug]/tournaments/[id].
export default async function TournamentPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const session = await auth();
  const userId: string | null = (session?.user as any)?.id || null;
  if (!userId) redirect(`/signin?callbackUrl=/teams/${slug}/tournaments/${id}`);

  const me = await getTeamMembership(slug, userId);
  if (!me) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600 }}>Team tournament</h1>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: '#a0a8b8' }}>
          Tournaments are visible to team members only. Ask an owner for an invite link.
        </p>
        <Link href="/teams" style={{ color: '#5db4ff', fontSize: 13 }}>← All teams</Link>
      </main>
    );
  }

  const t = await loadTournament(slug, id);
  if (!t) notFound();

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      <div style={{ marginBottom: 8 }}>
        <Link href={`/teams/${slug}?tab=tournaments`} style={{ color: '#a0a8b8', fontSize: 12, textDecoration: 'none' }}>
          ← Tournaments
        </Link>
      </div>
      <TournamentDetail teamSlug={slug} tournamentId={id} />
    </main>
  );
}

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { count, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { tournamentRounds, type TournamentDeck } from '@/lib/schema';
import { getTournamentAccess, loadEntrant, canSeeDeck } from '@/lib/tournamentAccess';
import { DeckList, BigCard, sumCounts } from '@/app/_components/DeckGrid';

export const dynamic = 'force-dynamic';

// B124: registered-decklist view for one tournament entrant. Same card grid as
// the replay deck page; gated by team membership + the tournament's decklist
// visibility setting (server-side — the API hides the deck the same way).
export default async function TournamentDeckPage({ params }: { params: Promise<{ slug: string; id: string; entrantId: string }> }) {
  const { slug, id, entrantId } = await params;
  const session = await auth();
  const userId: string | null = session?.user?.id || null;
  if (!userId) redirect(`/signin?callbackUrl=/teams/${slug}/tournaments/${id}`);

  // B127: member OR linked entrant — a tournament participant sees other
  // entrants' decks under the same visibility rules as members.
  const access = await getTournamentAccess(slug, id, userId);
  if (!access || !access.canView) notFound();
  const t = access.tournament;
  const entrant = await loadEntrant(id, entrantId);
  if (!entrant) notFound();

  const [{ n: roundCount }] = await getDb()
    .select({ n: count() })
    .from(tournamentRounds)
    .where(eq(tournamentRounds.tournamentId, id));

  const visible = canSeeDeck({
    visibility: t.decklistVisibility,
    entrant,
    viewerUserId: userId,
    viewerIsOrganizer: access.organizer,
    roundCount: Number(roundCount),
  });

  const back = (
    <div style={{ marginBottom: 12 }}>
      <Link href={`/teams/${slug}/tournaments/${id}`} style={{ color: '#5db4ff', fontSize: 13, textDecoration: 'none' }}>
        ← {t.name}
      </Link>
    </div>
  );

  if (!visible) {
    return (
      <main style={mainStyle}>
        {back}
        <h1 style={h1Style}>Decklist is hidden</h1>
        <p style={{ fontSize: 13, color: '#a0a8b8', lineHeight: 1.5, marginTop: 8 }}>
          {t.decklistVisibility === 'hidden-until-start'
            ? 'Decklists for this tournament are hidden until round 1 is paired.'
            : 'Decklists for this tournament are visible only to the entrant and the organizer.'}
        </p>
      </main>
    );
  }

  const deck = entrant.deck as TournamentDeck | null;
  if (!deck) {
    return (
      <main style={mainStyle}>
        {back}
        <h1 style={h1Style}>No decklist registered</h1>
        <p style={{ fontSize: 13, color: '#a0a8b8', lineHeight: 1.5, marginTop: 8 }}>
          {entrant.displayName} hasn&apos;t registered a decklist yet.
        </p>
      </main>
    );
  }

  const totalMain = sumCounts(deck.deck);
  const totalSide = deck.sideboard ? sumCounts(deck.sideboard) : 0;

  return (
    <main style={mainStyle}>
      {back}
      <h1 style={h1Style}>{entrant.deckName || `${entrant.displayName}'s deck`}</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#a0a8b8' }}>{entrant.displayName}</span>
        <span style={{ fontSize: 12, color: '#6c7588' }}>
          {totalMain} cards{totalSide > 0 ? ` · ${totalSide} side` : ''}
        </span>
        {entrant.deckLink && (
          <a href={entrant.deckLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#5db4ff', textDecoration: 'none' }}>
            source ↗
          </a>
        )}
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {deck.leader && <BigCard card={deck.leader} isLeader />}
        {deck.secondleader && <BigCard card={deck.secondleader} isLeader />}
        {deck.base && <BigCard card={deck.base} />}
      </div>

      <DeckList title="Main deck" cards={deck.deck} />
      {totalSide > 0 && <DeckList title="Sideboard" cards={deck.sideboard} />}
    </main>
  );
}

const mainStyle: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: '32px 28px 80px',
  color: '#e6e6e6',
  fontFamily: 'var(--font-barlow), sans-serif',
};
const h1Style: React.CSSProperties = { margin: 0, fontSize: 26, fontWeight: 600 };

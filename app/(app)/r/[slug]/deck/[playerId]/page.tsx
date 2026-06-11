import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, users } from '@/lib/schema';
import { matchChips } from '@/lib/matchMetadata';
import { DeckList, BigCard, sumCounts } from '@/app/_components/DeckGrid';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { isSampleReplaySlug } from '@/lib/sampleReplays';
import { anonymizeDecks, anonByIdFromPlayers } from '@/lib/anonymizeReplay';
import { auth } from '@/auth';
import { canViewReplayIdentities } from '@/lib/altPerspective';
import type { DecksByUserId, UserDeck, DeckCardRef } from '@/lib/replayDecoder';

export const dynamic = 'force-dynamic';

// B58: per-replay, per-player deck page. Shareable URL, larger card art
// than the in-viewer DecksDisclosure, sideboard in its own section.
//
// We render server-side from the `decks` jsonb column directly — no need
// to fetch + decode the full replay payload, since the deck snapshot
// was extracted at upload time and stored on the row.

interface PageProps {
  params: Promise<{ slug: string; playerId: string }>;
}

export default async function DeckPage({ params }: PageProps) {
  const { slug, playerId } = await params;

  const db = getDb();
  const rows = await db
    .select({ replay: replays, ownerName: users.name })
    .from(replays)
    .leftJoin(users, eq(users.id, replays.userId))
    .where(eq(replays.slug, slug))
    .limit(1);
  if (rows.length === 0) notFound();
  const { replay, ownerName: rawOwnerName } = rows[0];

  // B122: full deck lists are private — only the uploader or a teammate may see
  // them. Curated samples (B107) are anonymized but keep the demo decklist.
  const isSample = isSampleReplaySlug(slug);
  const session = await auth();
  const viewerUserId = (session?.user as any)?.id ?? null;
  const canView = isSample ? false : await canViewReplayIdentities(replay as any, { sessionUserId: viewerUserId, installToken: null });
  if (!isSample && !canView) {
    return (
      <main style={mainStyle}>
        <BackLink slug={slug} />
        <h1 style={h1Style}>Deck list is private</h1>
        <p style={{ fontSize: 13, color: '#a0a8b8', lineHeight: 1.5, marginTop: 8 }}>
          Deck lists are only visible to the player who recorded this replay and
          their teammates. You can still <Link href={`/r/${slug}`} style={{ color: '#5db4ff', textDecoration: 'none' }}>watch the replay →</Link>
        </p>
      </main>
    );
  }

  // identity anonymization: samples → "Player N" + drop deck title + uploader name.
  const anonymize = isSample; // authorized viewers see real names; samples stay anon.
  const ownerName = anonymize ? null : rawOwnerName;
  let decks = (replay.decks as DecksByUserId | null) || null;
  if (anonymize && decks) {
    const ordered = orderPlayersOwnerFirst((replay as any).players, (replay as any).ownerPlayerId);
    decks = anonymizeDecks(decks, anonByIdFromPlayers(ordered as any[])) as DecksByUserId;
  }
  const deck = decks?.[playerId] || null;
  if (!decks) {
    // The replay row exists but no deck snapshot was captured. Friendly
    // empty state (most likely an older replay uploaded pre-B42).
    return (
      <main style={mainStyle}>
        <BackLink slug={slug} />
        <h1 style={h1Style}>Deck snapshot unavailable</h1>
        <p style={{ fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
          No deck snapshot was captured for this replay. Replays recorded
          before the karabuddy extension started capturing deck data
          don&apos;t have one. Newer replays will show the full deck here.
        </p>
      </main>
    );
  }
  if (!deck) notFound();

  const match = (replay.match as any) || null;
  const chips = matchChips(match);
  const hasFullDeck = Array.isArray(deck.deck) && deck.deck.length > 0;
  const totalMain = hasFullDeck ? sumCounts(deck.deck!) : null;
  const totalSide = deck.sideboard ? sumCounts(deck.sideboard) : 0;

  return (
    <main style={mainStyle}>
      <BackLink slug={slug} />
      <h1 style={h1Style}>{deck.name || `${deck.username || 'Player'}'s deck`}</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#a0a8b8' }}>
          {deck.username || 'Unknown player'}
        </span>
        {hasFullDeck && (
          <span style={{ fontSize: 12, color: '#6c7588' }}>
            {totalMain} cards{totalSide > 0 ? ` · ${totalSide} side` : ''}
          </span>
        )}
        {ownerName && (
          <span style={{ fontSize: 12, color: '#6c7588' }}>
            uploaded by {ownerName}
          </span>
        )}
        {chips.map((c) => (
          <span key={c} style={chipStyle}>{c}</span>
        ))}
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {deck.leader && <BigCard card={deck.leader} isLeader />}
        {deck.base && <BigCard card={deck.base} />}
      </div>

      {!hasFullDeck ? (
        <div style={noticeStyle}>
          Full list not available — karabast only shares the local player&apos;s
          full deck. This player&apos;s leader and base are shown above.
        </div>
      ) : (
        <>
          <DeckList title="Main deck" cards={deck.deck!} />
          {totalSide > 0 && deck.sideboard && (
            <DeckList title="Sideboard" cards={deck.sideboard} />
          )}
        </>
      )}
    </main>
  );
}

function BackLink({ slug }: { slug: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Link
        href={`/r/${slug}`}
        style={{ color: '#5db4ff', fontSize: 13, textDecoration: 'none' }}
      >
        ← View replay
      </Link>
    </div>
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
const chipStyle: React.CSSProperties = {
  background: 'rgba(77, 157, 255, 0.12)',
  border: '1px solid rgba(77, 157, 255, 0.3)',
  color: '#a7d2ff',
  borderRadius: 999,
  padding: '2px 10px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};
const noticeStyle: React.CSSProperties = {
  marginTop: 24,
  padding: '14px 18px',
  background: 'rgba(224, 198, 74, 0.08)',
  border: '1px dashed rgba(224, 198, 74, 0.35)',
  borderRadius: 8,
  color: '#e0c64a',
  fontSize: 13,
  lineHeight: 1.5,
};

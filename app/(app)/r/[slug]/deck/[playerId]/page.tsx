import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, users } from '@/lib/schema';
import { cardImageUrl } from '@/lib/cardImage';
import { matchChips } from '@/lib/matchMetadata';
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
  const { replay, ownerName } = rows[0];

  const decks = (replay.decks as DecksByUserId | null) || null;
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

function DeckList({ title, cards }: { title: string; cards: DeckCardRef[] }) {
  const sorted = [...cards].sort((a, b) => {
    const ac = a.cost ?? 99;
    const bc = b.cost ?? 99;
    if (ac !== bc) return ac - bc;
    return a.id.localeCompare(b.id);
  });
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: '#e6e6e6', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title}
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
        {sorted.map((c, i) => (
          <BigCard key={`${c.id}-${i}`} card={c} />
        ))}
      </div>
    </section>
  );
}

function BigCard({ card, isLeader = false }: { card: DeckCardRef; isLeader?: boolean }) {
  const setId = parseSetId(card.id);
  const url = setId ? cardImageUrl({ set: setId.set, number: setId.number }, isLeader) : null;
  return (
    <a
      href={`https://swudb.com/card/${card.id}`}
      target="_blank"
      rel="noreferrer"
      title={card.id + (card.cost != null ? ` · cost ${card.cost}` : '')}
      style={{
        position: 'relative',
        aspectRatio: isLeader ? '1.4' : '0.71',
        background: '#0b0b12',
        border: '1px solid #2e333c',
        borderRadius: 6,
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'block',
        textDecoration: 'none',
        color: '#e6e6e6',
        minHeight: 100,
      }}
    >
      {card.count > 1 && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            background: 'rgba(0,0,0,0.78)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          ×{card.count}
        </span>
      )}
    </a>
  );
}

function sumCounts(cards: DeckCardRef[]): number {
  return cards.reduce((acc, c) => acc + (c.count || 0), 0);
}

function parseSetId(id: string): { set: string; number: number } | null {
  const m = /^([A-Z]+)_?(\d+)$/.exec(id);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  if (!Number.isFinite(n)) return null;
  return { set: m[1], number: n };
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

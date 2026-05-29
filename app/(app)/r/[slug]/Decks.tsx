'use client';

// B42: render captured deck snapshots from a replay's lobbyState capture.
// Local player has full leader/base/deck/sideboard; opponent typically
// only has leader/base (karabast masks the rest). Cards are grouped by
// card-cost so the layout reads more like a deckbuilder list.

import { cardImageUrl } from '@/lib/cardImage';
import type { DecksByUserId, UserDeck, DeckCardRef } from '@/lib/replayDecoder';

interface Props {
  decks: DecksByUserId | null;
  localPlayerId: string | null;
}

export function Decks({ decks, localPlayerId }: Props) {
  if (!decks || Object.keys(decks).length === 0) {
    return (
      <div style={{ padding: '14px 22px', fontSize: 12, color: '#6c7588', fontStyle: 'italic' }}>
        No deck snapshot for this replay. (Replays captured before deck-snapshot support landed don&apos;t have one.)
      </div>
    );
  }
  // Render local player first if known; otherwise iteration order.
  const orderedIds = Object.keys(decks);
  if (localPlayerId && orderedIds.includes(localPlayerId)) {
    orderedIds.sort((a, b) => (a === localPlayerId ? -1 : b === localPlayerId ? 1 : 0));
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '14px 22px' }}>
      {orderedIds.map((pid) => (
        <DeckBlock
          key={pid}
          deck={decks[pid]}
          isLocal={pid === localPlayerId}
        />
      ))}
    </div>
  );
}

function DeckBlock({ deck, isLocal }: { deck: UserDeck; isLocal: boolean }) {
  const hasFullDeck = Array.isArray(deck.deck) && deck.deck.length > 0;
  const totalMain = hasFullDeck ? sumCounts(deck.deck!) : null;
  const totalSide = deck.sideboard ? sumCounts(deck.sideboard) : 0;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#e6e6e6' }}>
          {deck.username || 'Unknown player'}
        </span>
        {isLocal && (
          <span style={{ fontSize: 10, color: '#5da9ff', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
            You
          </span>
        )}
        {hasFullDeck ? (
          <span style={{ fontSize: 11, color: '#6c7588' }}>
            {totalMain} cards{totalSide > 0 ? ` · ${totalSide} side` : ''}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: '#e0c64a', fontStyle: 'italic' }}>
            Leader + base only (karabast doesn&apos;t share the opponent&apos;s full list)
          </span>
        )}
        {deck.name && (
          <span style={{ fontSize: 11, color: '#a0a8b8', fontStyle: 'italic' }}>
            “{deck.name}”
          </span>
        )}
      </header>

      <div style={{ display: 'flex', gap: 6 }}>
        {deck.leader && <CardThumb card={deck.leader} isLeader />}
        {deck.base && <CardThumb card={deck.base} />}
      </div>

      {hasFullDeck && (
        <DeckList title="Main deck" cards={deck.deck!} />
      )}
      {totalSide > 0 && deck.sideboard && (
        <DeckList title="Sideboard" cards={deck.sideboard} />
      )}
    </section>
  );
}

function DeckList({ title, cards }: { title: string; cards: DeckCardRef[] }) {
  // Sort by cost asc, then by id for stable ordering. Matches karabast's
  // deckbuilder display order.
  const sorted = [...cards].sort((a, b) => {
    const ac = a.cost ?? 99;
    const bc = b.cost ?? 99;
    if (ac !== bc) return ac - bc;
    return a.id.localeCompare(b.id);
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 10, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 4 }}>
        {sorted.map((c, i) => (
          <CardThumb key={`${c.id}-${i}`} card={c} />
        ))}
      </div>
    </div>
  );
}

function CardThumb({ card, isLeader = false }: { card: DeckCardRef; isLeader?: boolean }) {
  const setId = parseSetIdLocal(card.id);
  const url = setId ? cardImageUrl({ set: setId.set, number: setId.number }, isLeader) : null;
  return (
    <a
      href={`https://swudb.com/card/${card.id}`}
      target="_blank"
      rel="noreferrer"
      title={card.id + (card.cost != null ? ` · cost ${card.cost}` : '')}
      style={{
        position: 'relative',
        aspectRatio: '1.4',
        background: '#0b0b12',
        border: '1px solid #2e333c',
        borderRadius: 4,
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'block',
        textDecoration: 'none',
        color: '#e6e6e6',
      }}
    >
      {card.count > 1 && (
        <span
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            background: 'rgba(0,0,0,0.78)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            padding: '1px 5px',
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

// SET_NNN → { set, number }. Mirrors lib/cardImage.ts but local to the
// thumb renderer; the cards in lobbyState come as `id` strings.
function parseSetIdLocal(id: string): { set: string; number: number } | null {
  const m = /^([A-Z]+)_?(\d+)$/.exec(id);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  if (!Number.isFinite(n)) return null;
  return { set: m[1], number: n };
}

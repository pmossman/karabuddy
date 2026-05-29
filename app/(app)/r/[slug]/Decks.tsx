'use client';

// B42: render captured deck snapshots from a replay's lobbyState capture.
// Local player has full leader/base/deck/sideboard; opponent typically
// only has leader/base (karabast masks the rest). Cards are grouped by
// card-cost so the layout reads more like a deckbuilder list.

import Link from 'next/link';
import { cardImageUrl } from '@/lib/cardImage';
import type { DecksByUserId, UserDeck, DeckCardRef } from '@/lib/replayDecoder';

interface Props {
  decks: DecksByUserId | null;
  localPlayerId: string | null;
  // B58: when provided, each player block gets a "View full page →" link
  // to /r/[slug]/deck/[playerId] for the shareable dedicated view.
  replaySlug?: string;
}

export function Decks({ decks, localPlayerId, replaySlug }: Props) {
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
          fullPageHref={replaySlug ? `/r/${replaySlug}/deck/${pid}` : null}
        />
      ))}
    </div>
  );
}

export function DeckBlock({ deck, isLocal, fullPageHref }: { deck: UserDeck; isLocal: boolean; fullPageHref: string | null }) {
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
            Full list not available (karabast doesn&apos;t share the opponent&apos;s full deck)
          </span>
        )}
        {deck.name && (
          <span style={{ fontSize: 11, color: '#a0a8b8', fontStyle: 'italic' }}>
            “{deck.name}”
          </span>
        )}
        {fullPageHref && (
          <Link
            href={fullPageHref}
            style={{ marginLeft: 'auto', fontSize: 11, color: '#5da9ff', textDecoration: 'none', fontWeight: 600 }}
          >
            View full page →
          </Link>
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

export function DeckList({ title, cards }: { title: string; cards: DeckCardRef[] }) {
  // Sort by cost asc, then by id for stable ordering. Matches karabast's
  // deckbuilder display order.
  const sorted = [...cards].sort((a, b) => {
    const ac = a.cost ?? 99;
    const bc = b.cost ?? 99;
    if (ac !== bc) return ac - bc;
    return a.id.localeCompare(b.id);
  });
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 11, color: '#a0a8b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
        {title}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
        {sorted.map((c, i) => (
          <CardThumb key={`${c.id}-${i}`} card={c} />
        ))}
      </div>
    </section>
  );
}

export function CardThumb({ card, isLeader = false }: { card: DeckCardRef; isLeader?: boolean }) {
  const setId = parseSetIdLocal(card.id);
  const url = setId ? cardImageUrl({ set: setId.set, number: setId.number }, isLeader) : null;
  return (
    <a
      href={`https://swudb.com/card/${card.id}`}
      target="_blank"
      rel="noreferrer"
      title={card.id + (card.cost != null ? ` · cost ${card.cost}` : '')}
      // Padding-bottom reserves space for the count badge that hangs
      // below the card art, matching karabast's deck-view layout.
      style={{
        position: 'relative',
        display: 'block',
        textDecoration: 'none',
        color: '#e6e6e6',
        paddingBottom: 16,
      }}
    >
      <div
        style={{
          aspectRatio: isLeader ? '1.4' : '0.71',
          background: '#0b0b12',
          border: '1px solid #2e333c',
          borderRadius: 6,
          backgroundImage: url ? `url(${url})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          minHeight: 100,
        }}
      />
      <span
        // karabast-style count badge: circular, dark, hangs over the
        // bottom-center edge of the card. Always rendered (even for
        // count === 1) — matches karabast's deck-view affordance, makes
        // copy counts scannable at a glance.
        style={{
          position: 'absolute',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: '#0a0c10',
          border: '2px solid #2e333c',
          color: '#fff',
          fontSize: 14,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
        }}
      >
        {card.count}
      </span>
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

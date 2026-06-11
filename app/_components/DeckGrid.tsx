import { cardImageUrl } from '@/lib/cardImage';

// B124: shared card-grid pieces for rendering a decklist of {id: 'SET_NNN',
// count} refs — extracted from app/(app)/r/[slug]/deck/[playerId]/page.tsx so
// tournament decklists render identically to replay deck snapshots. Server-safe
// (no client hooks); cards link out to swudb for full text.

export interface DeckGridCard {
  id: string;
  count: number;
  cost?: number | null;
}

export function DeckList({ title, cards }: { title: string; cards: DeckGridCard[] }) {
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

export function BigCard({ card, isLeader = false }: { card: DeckGridCard; isLeader?: boolean }) {
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

export function sumCounts(cards: DeckGridCard[]): number {
  return cards.reduce((acc, c) => acc + (c.count || 0), 0);
}

export function parseSetId(id: string): { set: string; number: number } | null {
  const m = /^([A-Z]+)_?(\d+)$/.exec(id);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  if (!Number.isFinite(n)) return null;
  return { set: m[1], number: n };
}

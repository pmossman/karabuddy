'use client';

import { useEffect, useState } from 'react';
import { CardSearch, type SelectedCard } from '@/app/_components/CardSearch';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B226: the card finder, as ONE self-contained module mounted by ReplayFilters
// so every replay surface (team grid + personal library) gets identical
// behaviour. Pick a card + an event (played / resourced / drawn / discarded) →
// the browser narrows to replays where the RECORDER did that with the card, and
// each result deep-links to the frame. Scope is the only difference between
// surfaces (a `team` slug vs the signed-in viewer's own replays) and it's just
// a query param — never a fork.

const CARD_EVENTS = [
  { key: 'played', label: 'Played', verb: 'the play' },
  { key: 'resourced', label: 'Resourced', verb: 'the resource' },
  { key: 'drawn', label: 'Drawn', verb: 'the draw' },
  { key: 'discarded', label: 'Discarded', verb: 'the discard' },
] as const;
type CardEventKey = typeof CARD_EVENTS[number]['key'];

export interface CardFinder {
  active: boolean;                       // a card is selected
  frames: Record<string, number> | null; // slug → jump frame (null = loading)
  label: string;                         // the jump verb ("the play" / …)
  /** Keep only rows that match the active card+event (identity when inactive). */
  filter: <T extends { slug: string }>(rows: T[]) => T[];
  /** The toolbar controls (card search + event toggle + count). */
  bar: React.ReactNode;
}

// `teamSlug` present → team scope; absent → the signed-in viewer's own replays.
// `enabled` gates whether the finder renders at all (off for anonymous / public
// surfaces where "the recorder is you" doesn't apply).
export function useCardFinder({ teamSlug, enabled }: { teamSlug?: string; enabled: boolean }): CardFinder {
  const [card, setCard] = useState<SelectedCard | null>(null);
  const [event, setEvent] = useState<CardEventKey>('played');
  const [frames, setFrames] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !card) { setFrames(null); return; }
    let dead = false;
    setLoading(true);
    (async () => {
      try {
        const teamQ = teamSlug ? `&team=${encodeURIComponent(teamSlug)}` : '';
        const res = await fetch(`/api/card-plays?cardId=${encodeURIComponent(card.cardId)}&event=${event}${teamQ}`);
        const j = await res.json();
        if (!dead) setFrames(j.ok ? j.plays : {});
      } catch {
        if (!dead) setFrames({});
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [enabled, card, event, teamSlug]);

  const verb = CARD_EVENTS.find((e) => e.key === event)!.verb;
  const active = enabled && !!card;

  const filter = <T extends { slug: string }>(rows: T[]): T[] =>
    (active && frames ? rows.filter((r) => r.slug in frames) : rows);

  const bar = enabled ? (
    <CardFinderBar
      card={card} setCard={setCard}
      event={event} setEvent={setEvent}
      loading={loading} verb={verb}
    />
  ) : null;

  return { active, frames, label: verb, filter, bar };
}

function CardFinderBar({
  card, setCard, event, setEvent, loading, verb,
}: {
  card: SelectedCard | null; setCard: (c: SelectedCard | null) => void;
  event: CardEventKey; setEvent: (e: CardEventKey) => void;
  loading: boolean; verb: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <CardSearch value={card} onChange={setCard} testId="card-search" />
      {card && (
        <>
          <div data-testid="card-event-toggle" style={{ display: 'inline-flex', gap: 2, background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, padding: 3 }}>
            {CARD_EVENTS.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => setEvent(e.key)}
                style={{
                  background: event === e.key ? '#4d9dff' : 'transparent',
                  color: event === e.key ? '#fff' : '#a0a8b8',
                  border: 0, borderRadius: 6, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
          <span data-testid="card-play-count" style={{ fontSize: 12.5, color: '#8a93a3' }}>
            {loading ? 'searching…' : `↳ jump to ${verb}`}
          </span>
        </>
      )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { type DecksByUserId, type Frame, extractSeenCards } from '@/lib/replayDecoder';
import { DeckBlock, DeckList } from './Decks';

// B64: large-overlay deck viewer. Replaces the broken in-sidebar
// DecksDisclosure (which pushed sibling content offscreen and couldn't
// scroll independently). Tabbed per-player so the full opponent deck
// (when we have it — usually just leader+base) is one click away.

interface Props {
  open: boolean;
  onClose: () => void;
  decks: DecksByUserId;
  localPlayerId: string | null;
  replaySlug: string;
  // B65: decoded frames used to compute "Seen during play" for the
  // opponent tab (karabast only shares the local player's full deck;
  // we infer opponent cards from what hit their visible zones).
  frames: Frame[] | null;
}

export function DecksModal({ open, onClose, decks, localPlayerId, replaySlug, frames }: Props) {
  // Local-player tab is the default; otherwise fall back to first id in
  // the decks object.
  const orderedIds = useMemo(() => {
    const ids = Object.keys(decks);
    if (localPlayerId && ids.includes(localPlayerId)) {
      ids.sort((a, b) => (a === localPlayerId ? -1 : b === localPlayerId ? 1 : 0));
    }
    return ids;
  }, [decks, localPlayerId]);

  // Initial active tab: prefer the local player's deck. Postgres jsonb
  // doesn't preserve insertion order, so falling back to `Object.keys[0]`
  // can land on the opponent — explicitly check localPlayerId first.
  const [activeId, setActiveId] = useState<string>(() => {
    if (localPlayerId && decks[localPlayerId]) return localPlayerId;
    return orderedIds[0] || '';
  });
  // Once the user manually picks a tab, don't override their choice from
  // the localPlayerId-resolved effect below.
  const userPickedRef = useRef(false);

  // If localPlayerId resolves AFTER mount (POV detection runs once the
  // gamestate decodes), promote the local tab — unless the user already
  // picked one explicitly.
  useEffect(() => {
    if (userPickedRef.current) return;
    if (localPlayerId && decks[localPlayerId] && activeId !== localPlayerId) {
      setActiveId(localPlayerId);
    }
  }, [localPlayerId, decks, activeId]);

  // If the deck set changes out from under us (different replay), reset.
  useEffect(() => {
    if (!orderedIds.includes(activeId)) {
      setActiveId(orderedIds[0] || '');
    }
  }, [orderedIds, activeId]);

  // Esc dismisses; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Memoize the seen-cards scan — it walks every frame, which on long
  // replays is non-trivial. Only recomputes when the inputs do.
  const seenCards = useMemo(() => {
    if (!frames || !activeId || activeId === localPlayerId) return [];
    return extractSeenCards(frames, activeId);
  }, [frames, activeId, localPlayerId]);

  if (!open) return null;
  const activeDeck = activeId ? decks[activeId] : null;
  const isOpponentTab = activeId && activeId !== localPlayerId;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Replay decks"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1100px, 95vw)',
          height: 'min(800px, 90vh)',
          background: '#11141a',
          border: '1px solid #2e333c',
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#e6e6e6',
          fontFamily: 'var(--font-barlow), sans-serif',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid #2e333c',
            gap: 12,
          }}
        >
          <div role="tablist" style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0, overflowX: 'auto' }}>
            {orderedIds.map((pid) => {
              const deck = decks[pid];
              const isActive = pid === activeId;
              const isLocal = pid === localPlayerId;
              return (
                <button
                  key={pid}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  onClick={() => { userPickedRef.current = true; setActiveId(pid); }}
                  style={{
                    background: isActive ? 'rgba(74, 124, 255, 0.15)' : 'transparent',
                    color: isActive ? '#e6e6e6' : '#a0a8b8',
                    border: '1px solid ' + (isActive ? 'rgba(74, 124, 255, 0.45)' : '#2e333c'),
                    borderRadius: 4,
                    padding: '6px 12px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {deck.username || 'Unknown'}{isLocal ? ' · You' : ''}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {activeId && (
              <Link
                href={`/r/${replaySlug}/deck/${activeId}`}
                style={{ fontSize: 12, color: '#5da9ff', textDecoration: 'none', fontWeight: 600 }}
              >
                View full page →
              </Link>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'transparent',
                color: '#a0a8b8',
                border: 0,
                fontSize: 22,
                lineHeight: 1,
                cursor: 'pointer',
                padding: 4,
                fontFamily: 'inherit',
              }}
            >
              ×
            </button>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 28 }}>
          {activeDeck && (
            <DeckBlock
              deck={activeDeck}
              isLocal={activeId === localPlayerId}
              // The dedicated-page link lives in the modal header; no
              // need to render it inside DeckBlock again.
              fullPageHref={null}
            />
          )}
          {isOpponentTab && seenCards.length > 0 && (
            <DeckList title={`Seen during play (${seenCards.length} unique)`} cards={seenCards} />
          )}
        </div>
      </div>
    </div>
  );
}

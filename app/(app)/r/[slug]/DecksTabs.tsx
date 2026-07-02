'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { type DecksByUserId, type DeckCardRef, decodeReplay, extractSeenCards } from '@/lib/replayDecoder';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { DeckBlock } from './Decks';

// Shared tabbed per-player deck viewer — the body of the in-viewer Decks view,
// ALSO used full-page at /r/[slug]/deck/[playerId]. Tabs switch players; the
// opponent tab renders its "seen during play" cards (decoded client-side from
// the viewer's frames in the modal, server-side on the page) as the main grid,
// so it runs the same fit-to-screen solver as a full deck. `seenByPlayerId` is a
// pre-computed playerId→cards map (serializable, so a server page can pass it).
export function DecksTabs({
  decks,
  localPlayerId,
  initialPlayerId,
  seenByPlayerId,
  payloadBlobUrl,
  replaySlug,
  showFullPageLink = false,
  headerEnd,
}: {
  decks: DecksByUserId;
  localPlayerId: string | null;
  initialPlayerId?: string | null;
  // Pre-computed seen-cards map (the modal builds it from the viewer's frames).
  seenByPlayerId?: Record<string, DeckCardRef[]>;
  // OR a payload blob URL to lazily fetch + decode client-side (the deck page) —
  // the same client-side path the viewer uses, which works in prod and tests
  // where a server-side blob read wouldn't.
  payloadBlobUrl?: string;
  replaySlug?: string;
  showFullPageLink?: boolean;
  headerEnd?: React.ReactNode;
}) {
  // Local-player tab is the default; otherwise fall back to first id.
  const orderedIds = useMemo(() => {
    const ids = Object.keys(decks);
    if (localPlayerId && ids.includes(localPlayerId)) {
      ids.sort((a, b) => (a === localPlayerId ? -1 : b === localPlayerId ? 1 : 0));
    }
    return ids;
  }, [decks, localPlayerId]);

  // Postgres jsonb doesn't preserve insertion order, so resolve explicitly:
  // an explicit initialPlayerId (deck page lands on a player) wins, else local.
  const [activeId, setActiveId] = useState<string>(() => {
    if (initialPlayerId && decks[initialPlayerId]) return initialPlayerId;
    if (localPlayerId && decks[localPlayerId]) return localPlayerId;
    return orderedIds[0] || '';
  });
  // An explicit initialPlayerId is a deliberate choice — don't let the late-
  // localPlayerId promote (modal POV detection) override it.
  const userPickedRef = useRef<boolean>(!!initialPlayerId);

  // If localPlayerId resolves AFTER mount (POV detection in the viewer), promote
  // the local tab — unless the user (or initialPlayerId) already picked one.
  useEffect(() => {
    if (userPickedRef.current) return;
    if (localPlayerId && decks[localPlayerId] && activeId !== localPlayerId) {
      setActiveId(localPlayerId);
    }
  }, [localPlayerId, decks, activeId]);

  // If the deck set changes out from under us (different replay), reset.
  useEffect(() => {
    if (!orderedIds.includes(activeId)) setActiveId(orderedIds[0] || '');
  }, [orderedIds, activeId]);

  const isOpponentTab = !!activeId && activeId !== localPlayerId;

  // Deck page: no pre-computed map, but a payload URL — fetch + decode it
  // client-side (once, on the first opponent tab) and extract every opponent's
  // seen cards. Mirrors the viewer's client-side decode.
  const [clientSeen, setClientSeen] = useState<Record<string, DeckCardRef[]> | null>(null);
  useEffect(() => {
    if (seenByPlayerId || !payloadBlobUrl || clientSeen || !isOpponentTab) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(payloadBlobUrl);
        if (!res.ok) { if (!cancelled) setClientSeen({}); return; }
        const { frames } = decodeReplay(await res.json());
        if (cancelled) return;
        const map: Record<string, DeckCardRef[]> = {};
        for (const id of Object.keys(decks)) {
          if (id !== localPlayerId) map[id] = extractSeenCards(frames, id);
        }
        setClientSeen(map);
      } catch {
        if (!cancelled) setClientSeen({});
      }
    })();
    return () => { cancelled = true; };
  }, [seenByPlayerId, payloadBlobUrl, clientSeen, isOpponentTab, decks, localPlayerId]);

  const seen = (isOpponentTab && (seenByPlayerId?.[activeId] ?? clientSeen?.[activeId])) || [];
  const activeDeck = activeId ? decks[activeId] : null;
  const narrow = useMediaQuery('(max-width: 640px)');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: narrow ? '12px 14px' : '14px 18px',
          borderBottom: '1px solid #2e333c',
          gap: 12,
        }}
      >
        {/* Tabs WRAP instead of horizontally scrolling on narrow widths. */}
        <div role="tablist" style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
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
                  background: isActive ? 'rgba(77, 157, 255, 0.15)' : 'transparent',
                  color: isActive ? '#e6e6e6' : '#a0a8b8',
                  border: '1px solid ' + (isActive ? 'rgba(77, 157, 255, 0.45)' : '#2e333c'),
                  borderRadius: 4,
                  padding: '6px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {deck.username || 'Unknown'}{isLocal ? ' · You' : ''}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {showFullPageLink && activeId && replaySlug && (
            <Link
              href={`/r/${replaySlug}/deck/${activeId}`}
              style={{ fontSize: 12, color: '#5db4ff', textDecoration: 'none', fontWeight: 600 }}
            >
              View full page →
            </Link>
          )}
          {headerEnd}
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: narrow ? 14 : 22, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {activeDeck && (
          <DeckBlock
            deck={activeDeck}
            isLocal={activeId === localPlayerId}
            fullPageHref={null}
            // Opponent tab: feed the "seen during play" cards in as the main grid
            // so they run the same fit-to-screen solver as a full deck.
            seenCards={seen.length > 0 ? seen : undefined}
          />
        )}
      </div>
    </div>
  );
}

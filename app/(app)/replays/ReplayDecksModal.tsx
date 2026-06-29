'use client';

import { useEffect, useState } from 'react';
import type { DecksByUserId } from '@/lib/replayDecoder';
import { DecksTabs } from '@/app/(app)/r/[slug]/DecksTabs';
import { ErrorNote } from '@/app/_components/StatusUi';
import { Modal } from '@/app/_components/Modal';

// B100: lightweight decks viewer reachable from the row kebab menu, so you can
// eyeball a replay's decks (and jump to each player's dedicated deck page)
// without opening the full viewer. Decks aren't carried in the list payload
// (too heavy × 100 rows) — fetched lazily once opened. Shares <DecksTabs> with
// the in-viewer modal + the deck page (tabbed per-player; opponent "seen during
// play" lazily decoded client-side from the payload).
export function ReplayDecksModal({
  replaySlug,
  title,
  localPlayerId,
  onClose,
}: {
  replaySlug: string;
  title: string;
  localPlayerId: string | null;
  onClose: () => void;
}) {
  const [decks, setDecks] = useState<DecksByUserId | null>(null);
  const [payloadBlobUrl, setPayloadBlobUrl] = useState<string | undefined>(undefined);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/replays/${replaySlug}`);
        const body = await res.json();
        if (cancelled) return;
        if (!body.ok) { setState('error'); return; }
        setDecks((body.data?.decks as DecksByUserId | null) ?? null);
        // Opponent "seen during play" is decoded client-side from the payload;
        // skip encrypted replays (ciphertext needs the team key).
        setPayloadBlobUrl(body.data?.encrypted ? undefined : (body.data?.payloadBlobUrl as string | undefined));
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [replaySlug]);

  const hasDecks = !!decks && Object.keys(decks).length > 0;

  return (
    <Modal open onClose={onClose} ariaLabel="Replay decks" width="min(1600px, 96vw)" maxHeight="95vh">
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #2e333c', gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ background: 'transparent', color: '#a0a8b8', border: 0, fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4, fontFamily: 'inherit' }}
        >
          ×
        </button>
      </header>
      <div data-testid="decks-modal" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {state === 'loading' && <p style={muted}>Loading decks…</p>}
        {state === 'error' && <ErrorNote style={{ padding: '14px 22px' }}>Couldn&apos;t load decks.</ErrorNote>}
        {state === 'ready' && !hasDecks && <p style={muted}>No deck snapshot for this replay.</p>}
        {state === 'ready' && hasDecks && (
          <DecksTabs
            decks={decks!}
            localPlayerId={localPlayerId}
            payloadBlobUrl={payloadBlobUrl}
            replaySlug={replaySlug}
            showFullPageLink
          />
        )}
      </div>
    </Modal>
  );
}

const muted: React.CSSProperties = { fontSize: 12, color: '#6c7588', fontStyle: 'italic', padding: '14px 22px' };

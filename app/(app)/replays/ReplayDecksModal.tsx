'use client';

import { useEffect, useState } from 'react';
import type { DecksByUserId } from '@/lib/replayDecoder';
import { Decks } from '@/app/(app)/r/[slug]/Decks';
import { ErrorNote } from '@/app/_components/StatusUi';

// B100: lightweight decks viewer reachable from the row kebab menu, so you
// can eyeball a replay's decks (and jump to each player's dedicated deck
// page) without opening the full viewer. Decks aren't carried in the list
// payload (too heavy × 100 rows) — fetched lazily once opened.
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
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/replays/${replaySlug}`);
        const body = await res.json();
        if (cancelled) return;
        if (!body.ok) { setState('error'); return; }
        setDecks((body.data?.decks as DecksByUserId | null) ?? null);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [replaySlug]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 220,
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
        data-testid="decks-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 95vw)',
          maxHeight: '90vh',
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
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {state === 'loading' && <p style={muted}>Loading decks…</p>}
          {state === 'error' && <ErrorNote style={{ padding: '14px 22px' }}>Couldn&apos;t load decks.</ErrorNote>}
          {state === 'ready' && <Decks decks={decks} localPlayerId={localPlayerId} replaySlug={replaySlug} />}
        </div>
      </div>
    </div>
  );
}

const muted: React.CSSProperties = { fontSize: 12, color: '#6c7588', fontStyle: 'italic', padding: '14px 22px' };

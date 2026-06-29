'use client';

import { useMemo } from 'react';
import { type DecksByUserId, type Frame, type DeckCardRef, extractSeenCards } from '@/lib/replayDecoder';
import { Modal } from '@/app/_components/Modal';
import { DecksTabs } from './DecksTabs';

// B64: large-overlay deck viewer. Tabbed per-player so the full opponent deck
// (when we have it — usually just leader+base + "seen during play") is one click
// away. The tab body is the shared <DecksTabs>, reused full-page on the deck page.

interface Props {
  open: boolean;
  onClose: () => void;
  decks: DecksByUserId;
  localPlayerId: string | null;
  replaySlug: string;
  // B65: decoded frames used to compute "Seen during play" for the opponent tab
  // (karabast only shares the local player's full deck; we infer opponent cards
  // from what hit their visible zones).
  frames: Frame[] | null;
  // B122: anonymized viewer (non-uploader/teammate) — hide the dedicated
  // deck-page link (decklists are uploader/teammate-only; only "seen" cards show).
  anonymize?: boolean;
}

export function DecksModal({ open, onClose, decks, localPlayerId, replaySlug, frames, anonymize }: Props) {
  // Build the seen-cards map from the already-decoded viewer frames (free to
  // reuse here). The deck page builds the same map server-side instead.
  const seenByPlayerId = useMemo(() => {
    if (!frames) return undefined;
    const map: Record<string, DeckCardRef[]> = {};
    for (const id of Object.keys(decks)) {
      if (id !== localPlayerId) map[id] = extractSeenCards(frames, id);
    }
    return map;
  }, [frames, decks, localPlayerId]);

  return (
    <Modal open={open} onClose={onClose} ariaLabel="Replay decks" width="min(1600px, 96vw)" maxHeight="95vh">
      <DecksTabs
        decks={decks}
        localPlayerId={localPlayerId}
        seenByPlayerId={seenByPlayerId}
        replaySlug={replaySlug}
        showFullPageLink={!anonymize}
        headerEnd={
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', color: '#a0a8b8', border: 0, fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4, fontFamily: 'inherit' }}
          >
            ×
          </button>
        }
      />
    </Modal>
  );
}

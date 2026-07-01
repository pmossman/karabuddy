'use client';

import { tokens } from '@/app/_theme/karabuddyTokens';
import { DecksTabs } from '../DecksTabs';

// B216 redesign — the Decks rail feature. Reuses the canonical <DecksTabs>
// (the same tabbed deck experience used everywhere) so there's no new deck
// renderer; it lazily decodes seen-cards from the payload blob. Lives in a
// FeaturePanel → full-screen mobile / docked desktop.
export function DecksFeature({ decks, localPlayerId, payloadBlobUrl, replaySlug, onOpenSideboard, sideboardFromGame }: {
  decks: Record<string, any> | null;
  localPlayerId: string | null;
  payloadBlobUrl?: string;
  replaySlug: string;
  // B150: present on games with a prior game in the match → re-open the sideboard splash.
  onOpenSideboard?: () => void;
  sideboardFromGame?: number | null;
}) {
  if (!decks || Object.keys(decks).length === 0) {
    return <div style={{ padding: '28px 18px', textAlign: 'center', color: tokens.color.textMuted, fontSize: 13 }}>No decklists available for this replay.</div>;
  }
  return (
    <div style={{ padding: '10px 12px 20px' }}>
      {onOpenSideboard && (
        <button type="button" onClick={onOpenSideboard}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginBottom: 12, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#eaf9ff', background: 'rgba(77,210,255,0.14)', border: `1px solid ${tokens.led.on}` }}>
          <span aria-hidden style={{ fontSize: 15 }}>⇄</span> Sideboard changes{sideboardFromGame ? ` from Game ${sideboardFromGame}` : ''}
        </button>
      )}
      <DecksTabs
        decks={decks as any}
        localPlayerId={localPlayerId}
        payloadBlobUrl={payloadBlobUrl}
        replaySlug={replaySlug}
        showFullPageLink
      />
    </div>
  );
}

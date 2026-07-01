'use client';

import { tokens } from '@/app/_theme/karabuddyTokens';
import { DecksTabs } from '../DecksTabs';

// B216 redesign — the Decks rail feature. Reuses the canonical <DecksTabs>
// (the same tabbed deck experience used everywhere) so there's no new deck
// renderer; it lazily decodes seen-cards from the payload blob. Lives in a
// FeaturePanel → full-screen mobile / docked desktop.
export function DecksFeature({ decks, localPlayerId, payloadBlobUrl, replaySlug }: {
  decks: Record<string, any> | null;
  localPlayerId: string | null;
  payloadBlobUrl?: string;
  replaySlug: string;
}) {
  if (!decks || Object.keys(decks).length === 0) {
    return <div style={{ padding: '28px 18px', textAlign: 'center', color: tokens.color.textMuted, fontSize: 13 }}>No decklists available for this replay.</div>;
  }
  return (
    <div style={{ padding: '10px 12px 20px' }}>
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

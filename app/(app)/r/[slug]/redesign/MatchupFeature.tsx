'use client';

import type { ReactNode } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { MatchupInfo, type MatchupReplay } from '../MatchupInfo';
import type { MatchMeta } from '@/lib/replayDecoder';
import type { SeriesInfo } from '../SeriesNav';

// B216 redesign — the Matchup (Info) rail feature. De-cluttering removed the old
// matchup FAB + the TagSidebar header, which is where all player/leader/W-L/
// format context lived — this restores it. Reuses the shared <MatchupInfo>
// (B196) so there's no third copy, plus optional companion actions (decks,
// resourcing) the old MatchupPanel offered.
export function MatchupFeature({
  replay, matchMeta, installToken, isOwner, anonymize, series, onOpenResourcing, onOpenDecks,
}: {
  replay: MatchupReplay;
  matchMeta: MatchMeta | null;
  installToken: string;
  isOwner: boolean;
  anonymize?: boolean;
  series?: SeriesInfo | null;
  onOpenResourcing?: () => void;
  onOpenDecks?: () => void;
}) {
  return (
    <div style={{ padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <MatchupInfo
        replay={replay}
        matchMeta={matchMeta}
        installToken={installToken}
        isOwner={isOwner}
        anonymize={anonymize}
        series={series}
        variant="panel"
      />
      {(onOpenDecks || onOpenResourcing) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {onOpenDecks && <LinkRow label="View decks →" onClick={onOpenDecks} />}
          {onOpenResourcing && <LinkRow label="⚡ Resourcing report" onClick={onOpenResourcing} />}
        </div>
      )}
    </div>
  );
}

function LinkRow({ label, onClick }: { label: string; onClick: () => void }): ReactNode {
  return (
    <button type="button" onClick={onClick}
      style={{ textAlign: 'left', background: tokens.color.surface, border: `1px solid ${tokens.color.border}`, color: tokens.color.accent, borderRadius: 8, padding: '10px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
      {label}
    </button>
  );
}

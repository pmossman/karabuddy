'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { MatchupInfo, type MatchupReplay } from '../MatchupInfo';
import { MatchupHistory, type OpponentHistory } from './MatchupHistory';
import { ReplayMatchup } from '@/app/_components/ReplayMatchup';
import type { MatchMeta } from '@/lib/replayDecoder';
import type { SeriesInfo } from '../SeriesNav';

// B216 redesign — the Matchup (Info) rail feature. De-cluttering removed the old
// matchup FAB + the TagSidebar header, which is where all player/leader/W-L/
// format context lived — this restores it. Reuses the shared <MatchupInfo>
// (B196) so there's no third copy, plus (owner-only) history vs the same opponent.
export function MatchupFeature({
  replay, matchMeta, installToken, isOwner, anonymize, series, opponentHistory, onOpenResourcing, onOpenDecks,
}: {
  replay: MatchupReplay;
  matchMeta: MatchMeta | null;
  installToken: string;
  isOwner: boolean;
  anonymize?: boolean;
  series?: SeriesInfo | null;
  opponentHistory?: OpponentHistory | null;
  onOpenResourcing?: () => void;
  onOpenDecks?: () => void;
}) {
  const hasSeries = !!series && series.games.length > 1;
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
        // Series → swap the pill nav for full per-game summary rows and drop the single
        // current-game matchup (it's now one of the rows).
        seriesSlot={hasSeries ? <SeriesGames series={series!} /> : undefined}
        hideCurrentMatchup={hasSeries}
      />
      {opponentHistory && opponentHistory.groups.length > 0 && <MatchupHistory history={opponentHistory} />}
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

// B216: the series as a list of full replay-summary rows (leader/base art + W/L),
// one per game. The current game is highlighted; the others link to their replay
// with ?panel=info so the Matchup view is already open on arrival — hopping between
// games of the series feels instantaneous. (redesign=1 stays on the URL until the
// redesign ships by default.)
function SeriesGames({ series }: { series: SeriesInfo }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: tokens.color.textMuted }}>Series</span>
      {series.games.map((g) => {
        const isCurrent = g.gameNumber === series.current;
        const body = (
          <>
            <span style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 800, letterSpacing: '0.02em', color: isCurrent ? tokens.color.accent : tokens.color.textSecondary, minWidth: 46 }}>Game {g.gameNumber}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ReplayMatchup players={g.players ?? null} ownerPlayerId={g.ownerPlayerId ?? null} winners={g.winners ?? null} thumb={30} showNames={false} />
            </div>
          </>
        );
        const rowStyle: React.CSSProperties = {
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10,
          border: `1px solid ${isCurrent ? 'rgba(77,210,255,0.55)' : tokens.color.border}`,
          background: isCurrent ? 'rgba(77,210,255,0.10)' : 'rgba(255,255,255,0.02)',
          textDecoration: 'none', color: 'inherit',
        };
        if (isCurrent) return <div key={g.slug} aria-current="page" style={rowStyle}>{body}</div>;
        return (
          <Link key={g.slug} href={`/r/${g.slug}?redesign=1&panel=info`} prefetch={false} data-testid={`series-game-${g.gameNumber}`}
            style={{ ...rowStyle, cursor: 'pointer' }}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}

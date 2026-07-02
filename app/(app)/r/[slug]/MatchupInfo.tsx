'use client';

// B196 (viewer-unify stage 2): the ONE matchup-identity block — chips, the
// editable title, series rows (via seriesSlot), labels, and the leader/base
// player thumbs. Rendered by the redesign's Matchup view (B216 removed the other
// callers — the legacy TagSidebar header + mobile MatchupPanel).

import type { ReactNode } from 'react';
import { useState } from 'react';
import { matchChips, matchupVs } from '@/lib/matchMetadata';
import { playerHandle } from '@/lib/players';
import { copyToClipboard } from '@/lib/clipboard';
import { LeaderBasePair } from '@/app/_components/LeaderBasePair';
import type { MatchMeta } from '@/lib/replayDecoder';
import { EditableTitle } from './EditableTitle';
import type { SeriesInfo } from './seriesTypes';
import { LabelsRow } from './LabelsRow';
import { ResultBadge } from './ResultBadge';

export interface MatchupReplay {
  slug: string;
  displayName?: string | null;
  labels?: string[] | null;
  players: any;
  winners?: string[] | null;
}

// B203: copyToClipboard / playerUsername / defaultTitleFor moved to lib/
// (clipboard.ts, players.playerHandle, matchMetadata.matchupVs) so server code +
// every surface share one copy. This client component just consumes them now.

// B113: copy a link to the CURRENT frame so it unfurls into that board state.
// Lifted out of TagSidebar so the mobile MatchupPanel can offer it too (the
// caller passes the live currentIndex + the collapsed→original frame mapper).
export function useShareMoment(replaySlug: string, currentIndex: number, toOriginalFrame: (i: number) => number) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const f = toOriginalFrame(currentIndex) + 1; // 1-based original frame
    const url = `${window.location.origin}/r/${replaySlug}${f > 1 ? `?f=${f}` : ''}`;
    await copyToClipboard(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return { copied, share };
}

const chipStyle: React.CSSProperties = {
  background: 'rgba(77, 157, 255, 0.12)',
  border: '1px solid rgba(77, 157, 255, 0.3)',
  color: '#a7d2ff',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

function MatchupPlayer({ player, winners }: { player: any; winners?: string[] | null }) {
  if (!player) return <div style={{ flex: 1, minWidth: 0 }} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
      <LeaderBasePair
        leader={player.leader}
        base={player.base}
        orientation="row"
        width={44}
        height={30}
        gap={2}
        radius={3}
        fallback="initials"
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
        <ResultBadge playerId={player.id} winners={winners} />
        <span style={{ fontSize: 11, color: '#d6d6d6', fontWeight: 600, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {playerHandle(player)}
        </span>
      </div>
    </div>
  );
}

export function MatchupInfo({
  replay, matchMeta, installToken, isOwner, anonymize, series, share, seriesSlot, hideCurrentMatchup,
}: {
  replay: MatchupReplay;
  matchMeta: MatchMeta | null;
  installToken: string;
  isOwner: boolean;
  anonymize?: boolean;
  series?: SeriesInfo | null;
  share?: ReactNode;
  // B216: a series replaces the single current-game matchup with full per-game
  // summary rows (seriesSlot + hideCurrentMatchup — the current game is a row).
  seriesSlot?: ReactNode;
  hideCurrentMatchup?: boolean;
}) {
  const players = (replay.players as any[]) || [];
  const [p1, p2] = players;
  const chips = matchChips(matchMeta);
  return (
    <>
      {chips.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {chips.map((label) => (
            <span key={`m-${label}`} style={chipStyle}>{label}</span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <EditableTitle
          replaySlug={replay.slug}
          installToken={installToken}
          initialDisplayName={replay.displayName ?? null}
          defaultText={matchupVs(replay, { anonymize }) + (series ? ` — Game ${series.current}` : '')}
          canEdit={isOwner}
        />
      </div>
      {seriesSlot}
      {(isOwner || (Array.isArray(replay.labels) && replay.labels.length > 0)) && (
        <LabelsRow
          replaySlug={replay.slug}
          installToken={installToken}
          initialLabels={Array.isArray(replay.labels) ? replay.labels : []}
          canEdit={isOwner}
        />
      )}
      {!hideCurrentMatchup && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1, minWidth: 0 }}>
            <MatchupPlayer player={p1} winners={replay.winners} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#6c7588', flex: '0 0 auto', paddingTop: 11 }}>VS</span>
            <MatchupPlayer player={p2} winners={replay.winners} />
          </div>
          {share}
        </div>
      )}
    </>
  );
}

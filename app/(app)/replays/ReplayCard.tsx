'use client';

import Link from 'next/link';
import { matchChips } from '@/lib/matchMetadata';
import { formatTimestamp } from '@/lib/datetime';
import { playerHandle, deckLabel } from '@/lib/players';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ShareBadge } from './ShareBadge';
import { RowActions } from './RowActions';
import { CommentCountButton } from './CommentCountButton';
import { PrivateMatchup } from '@/app/_components/PrivateMatchup';
import { MatchupRow } from '@/app/_components/MatchupRow';
import { useReplaySelection, SelectBox } from './selection';

interface ReplayRow {
  slug: string;
  gameId: string;
  userId: string | null;
  players: any;
  durationMs: number;
  actionCount: number;
  createdAt: string;
  // B42: match metadata. Null for replays uploaded by pre-B42 extension
  // versions; new replays carry { gameFormat, cardPool, gamesToWinMode, ... }.
  match?: {
    gameFormat?: string | null;
    cardPool?: string | null;
    gamesToWinMode?: string | null;
    gameType?: string | null;
  } | null;
  // B53: user-set display name + labels. Both null when never edited.
  displayName?: string | null;
  labels?: string[] | null;
  // B89: teams this replay is shared with. Empty/absent = unlisted.
  sharedTeams?: { slug: string; name: string }[];
  // B59-followup: recorder POV playerId — used by the manage modal to default
  // the decks view to the owner's deck.
  ownerPlayerId?: string | null;
  // B100: total comments on the replay. Absent on grids that don't fetch it
  // (anonymous library).
  commentCount?: number;
  // B100: viewer owns this replay (lets the owner un-share from the team grid).
  isMine?: boolean;
  // B128: both players' recordings exist — "⇄ both POVs" badge.
  doubleSided?: boolean;
  // B149: this is the owner's replay with an open team review request — a badge
  // showing reviewer progress in the "My replays" tab.
  reviewRequest?: { requested: boolean; reviewerCount: number } | null;
  // B170 / ADR 0010: private (encrypted) replay — the matchup is decrypted
  // client-side from the summary (PrivateMatchup); players/winners are empty/null
  // on the row.
  encrypted?: boolean;
  teamKeyId?: string | null;
  encryptedSummary?: string | null;
  winners?: string[] | null;
}

// B42 chip labels live in lib/matchMetadata.ts; see the shared
// matchChips() helper used everywhere.

export function ReplayCard({ replay, canManage, gameNumber }: { replay: ReplayRow; canManage: boolean; gameNumber?: number }) {
  const players = (replay.players as any[]) || [];
  const [p1, p2] = players;
  const sel = useReplaySelection();
  const canSelect = !!sel?.selectMode && sel.selectable(replay);
  const isSel = !!sel?.selected.has(replay.slug);

  return (
    <div
      style={{
        position: 'relative',
        background: tokens.surface.panel,
        border: `1px solid ${isSel ? 'rgba(77,210,255,0.7)' : tokens.surface.panelBorder}`,
        borderRadius: tokens.radius.lg,
        boxShadow: isSel ? '0 0 0 1px rgba(77,210,255,0.55), 0 0 12px rgba(77,210,255,0.18)' : tokens.surface.panelShadow,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Select mode: a full-card overlay makes the whole card a toggle (mobile-
          friendly), with the LED checkbox showing the state in the corner. */}
      {canSelect && (
        <>
          <button
            type="button"
            aria-label={isSel ? 'Deselect replay' : 'Select replay'}
            aria-pressed={isSel}
            onClick={() => sel!.toggle(replay.slug)}
            style={{ position: 'absolute', inset: 0, zIndex: 3, background: isSel ? 'rgba(77,210,255,0.06)' : 'transparent', border: 0, cursor: 'pointer', borderRadius: tokens.radius.lg, padding: 0 }}
          />
          <span style={{ position: 'absolute', top: 10, left: 10, zIndex: 4 }}>
            <SelectBox checked={isSel} onToggle={() => sel!.toggle(replay.slug)} label={isSel ? 'Deselect replay' : 'Select replay'} />
          </span>
        </>
      )}
      <Link href={`/r/${replay.slug}`} prefetch={false} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {replay.encrypted ? (
          // B170: private replay — decrypt the matchup client-side (leaders/bases
          // + result). The deck/name sub-lines come from the same summary, so the
          // single PrivateMatchup stands in for the whole matchup block.
          <PrivateMatchup row={replay as any} thumb={44} />
        ) : (
          <>
            <MatchupRow p1={p1} p2={p2} />
            {/* B53: user-set display name takes precedence over the auto
                deck-text. The auto deck-text moves to a smaller sub-line. */}
            {replay.displayName ? (
              <>
                <div style={{ fontSize: 14, color: '#e6e6e6', lineHeight: 1.3, fontWeight: 700 }}>
                  {replay.displayName}
                </div>
                <div style={{ fontSize: 12, color: '#a0a8b8', lineHeight: 1.3 }}>
                  {deckLabel(p1, { withSet: true })} vs {deckLabel(p2, { withSet: true })}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: '#d6d6d6', lineHeight: 1.35, fontWeight: 600 }}>
                {deckLabel(p1, { withSet: true })} vs {deckLabel(p2, { withSet: true })}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#a0a8b8', lineHeight: 1.3 }}>
              {playerHandle(p1)} vs {playerHandle(p2)}
            </div>
          </>
        )}
        {/* B53: user-set labels as small chips below the names. */}
        {Array.isArray(replay.labels) && replay.labels.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {replay.labels.map((l) => (
              <span
                key={l}
                style={{
                  background: 'rgba(160, 196, 255, 0.08)',
                  border: '1px solid rgba(160, 196, 255, 0.2)',
                  color: '#a7d2ff',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: 999,
                }}
              >
                {l}
              </span>
            ))}
          </div>
        )}
        <ShareBadge sharedTeams={replay.sharedTeams} isPublic={(replay as any).isPublic} />
        <div style={{ fontSize: 12, color: '#6c7588', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* B129: position within the Bo3 series (rendered inside series groups). */}
          {gameNumber != null && (
            <span
              data-testid="game-number-chip"
              style={{
                background: 'rgba(77, 157, 255, 0.12)',
                border: '1px solid rgba(77, 157, 255, 0.4)',
                color: '#a7d2ff',
                borderRadius: 999,
                padding: '1px 8px',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Game {gameNumber}
            </span>
          )}
          <span>{formatTimestamp(replay.createdAt)} · {replay.actionCount || 0} actions · {formatDuration(replay.durationMs || 0)}</span>
          {replay.doubleSided && (
            <span
              data-testid="double-sided-chip"
              title="Both players recorded — view with both hands face up"
              style={{
                background: 'rgba(77, 210, 255, 0.12)',
                border: '1px solid rgba(77, 210, 255, 0.4)',
                color: '#4dd2ff',
                borderRadius: 999,
                padding: '1px 8px',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              ⇄ both POVs
            </span>
          )}
          {replay.reviewRequest?.requested && (
            <span
              data-testid="review-request-chip"
              title={replay.reviewRequest.reviewerCount > 0 ? `Reviewed by ${replay.reviewRequest.reviewerCount}` : 'Awaiting team review'}
              style={{
                background: replay.reviewRequest.reviewerCount > 0 ? 'rgba(107, 217, 104, 0.12)' : 'rgba(160, 168, 184, 0.12)',
                border: `1px solid ${replay.reviewRequest.reviewerCount > 0 ? 'rgba(107, 217, 104, 0.4)' : 'rgba(160, 168, 184, 0.32)'}`,
                color: replay.reviewRequest.reviewerCount > 0 ? '#7fd97f' : '#a0a8b8',
                borderRadius: 999, padding: '1px 8px', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.04em', textTransform: 'uppercase',
              }}
            >
              {replay.reviewRequest.reviewerCount > 0 ? `🔍 reviewed ×${replay.reviewRequest.reviewerCount}` : '🔍 in review'}
            </span>
          )}
          {matchChips(replay.match).map((label) => (
            <span
              key={label}
              style={{
                background: 'rgba(77, 157, 255, 0.12)',
                border: '1px solid rgba(77, 157, 255, 0.3)',
                color: '#a7d2ff',
                borderRadius: 999,
                padding: '1px 8px',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </Link>
      <div style={{ display: 'flex', gap: 6, paddingTop: 8, borderTop: '1px solid #2e333c', alignItems: 'center', justifyContent: 'space-between' }}>
        <div><CommentCountButton replay={replay} variant="card" /></div>
        <RowActions replay={replay} canManage={canManage} />
      </div>
    </div>
  );
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(r).padStart(2, '0')}s`;
}

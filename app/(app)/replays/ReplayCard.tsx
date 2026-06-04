'use client';

import Link from 'next/link';
import { cardImageUrl } from '@/lib/cardImage';
import { matchChips } from '@/lib/matchMetadata';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ShareBadge } from './ShareBadge';
import { RowActions } from './RowActions';
import { CommentCountButton } from './CommentCountButton';

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
}

// B42 chip labels live in lib/matchMetadata.ts; see the shared
// matchChips() helper used everywhere.

export function ReplayCard({ replay, canManage }: { replay: ReplayRow; canManage: boolean }) {
  const players = (replay.players as any[]) || [];
  const [p1, p2] = players;

  return (
    <div
      style={{
        background: tokens.surface.panel,
        border: `1px solid ${tokens.surface.panelBorder}`,
        borderRadius: tokens.radius.lg,
        boxShadow: tokens.surface.panelShadow,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <Link href={`/r/${replay.slug}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
          <Matchup player={p1} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#6c7588' }}>VS</span>
          <Matchup player={p2} />
        </div>
        {/* B53: user-set display name takes precedence over the auto
            deck-text. The auto deck-text moves to a smaller sub-line. */}
        {replay.displayName ? (
          <>
            <div style={{ fontSize: 14, color: '#e6e6e6', lineHeight: 1.3, fontWeight: 700 }}>
              {replay.displayName}
            </div>
            <div style={{ fontSize: 12, color: '#a0a8b8', lineHeight: 1.3 }}>
              {deckText(p1)} vs {deckText(p2)}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: '#d6d6d6', lineHeight: 1.35, fontWeight: 600 }}>
            {deckText(p1)} vs {deckText(p2)}
          </div>
        )}
        <div style={{ fontSize: 12, color: '#a0a8b8', lineHeight: 1.3 }}>
          {nameText(p1)} vs {nameText(p2)}
        </div>
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
        <ShareBadge sharedTeams={replay.sharedTeams} />
        <div style={{ fontSize: 12, color: '#6c7588', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{formatDate(replay.createdAt)} · {replay.actionCount || 0} actions · {formatDuration(replay.durationMs || 0)}</span>
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

function Matchup({ player }: { player: any }) {
  if (!player) return <div style={{ flex: 1 }} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, alignItems: 'center', minWidth: 0 }}>
      <CardImg src={cardImageUrl(player.leader, true)} alt={player.leader?.name} />
      <CardImg src={cardImageUrl(player.base, false)} alt={player.base?.name} />
    </div>
  );
}

function CardImg({ src, alt }: { src: string | null; alt?: string }) {
  if (!src) {
    return (
      <div style={{ width: 90, height: 64, borderRadius: 4, background: '#0a0c10', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c7588', fontSize: 10, textAlign: 'center', padding: 4, boxSizing: 'border-box' }}>
        {alt || '—'}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt || ''} loading="lazy" style={{ width: 90, height: 64, objectFit: 'contain', borderRadius: 4, background: '#0a0c10' }} />;
}

function deckText(p: any) {
  if (!p) return 'Unknown';
  const l = p.leader?.name || 'Unknown';
  const b = p.base?.name || 'Unknown';
  const ls = p.leader?.set ? ` (${p.leader.set})` : '';
  return `${l}${ls} / ${b}`;
}

function nameText(p: any) {
  const u: string | undefined = p?.username;
  if (!u || /^anonymous\s/i.test(u)) return 'anon';
  return u;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' });
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(r).padStart(2, '0')}s`;
}

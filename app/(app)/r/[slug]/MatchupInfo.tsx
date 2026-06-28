'use client';

// B196 (viewer-unify stage 2): the ONE matchup-identity block — chips, the
// editable title, Bo3 series nav, labels, and the leader/base player thumbs.
// Previously this content was duplicated between the desktop sidebar header
// (TagSidebar) and the mobile MatchupPanel (MobileLandscapePanels), which is
// how they drifted (different default-title anonymize handling, two copies of
// defaultTitleFor/playerUsername, etc.). Both now render this, parameterized by
// `variant` for the small layout differences (thumb size, gaps). Share stays
// placed by each caller (desktop: inline beside the players via the `share`
// slot; mobile: in the panel's own header), so neither layout moves.

import type { ReactNode } from 'react';
import { useState } from 'react';
import { matchChips } from '@/lib/matchMetadata';
import { cardImageUrl } from '@/lib/cardImage';
import type { MatchMeta } from '@/lib/replayDecoder';
import { EditableTitle } from './EditableTitle';
import { SeriesNav, type SeriesInfo } from './SeriesNav';
import { LabelsRow } from './LabelsRow';
import { ResultBadge } from './ResultBadge';

export interface MatchupReplay {
  slug: string;
  displayName?: string | null;
  labels?: string[] | null;
  players: any;
  winners?: string[] | null;
}

// Robust clipboard copy with a non-secure-context fallback. Shared so the
// viewer's "share this moment" works the same on desktop + mobile.
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
}

export function playerUsername(p: any): string {
  const u: string | undefined = p?.username;
  if (!u || /^anonymous\s/i.test(u)) return 'anon';
  return u;
}

// The "username vs username" string the replay browser uses when no display
// name is set. B122: anonymized viewers identify by leader matchup, not handles.
export function defaultTitleFor(replay: { players: any }, anonymize?: boolean): string {
  const players = Array.isArray(replay.players) ? replay.players : [];
  const [p1, p2] = players;
  if (!p1 && !p2) return 'Replay';
  if (anonymize) {
    const lead = (p: any) => p?.leader?.name || 'Unknown';
    return `${lead(p1)} vs ${lead(p2)}`;
  }
  return `${playerUsername(p1)} vs ${playerUsername(p2)}`;
}

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

function Thumb({ src, alt, w, h }: { src: string | null; alt?: string; w: number; h: number }) {
  if (!src) {
    return (
      <div style={{ width: w, height: h, borderRadius: 3, background: '#0a0c10', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c7588', fontSize: 8, textAlign: 'center', padding: 2, boxSizing: 'border-box', flex: '0 0 auto' }}>
        {(alt || '—').slice(0, 4)}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt || ''} loading="lazy" style={{ width: w, height: h, objectFit: 'contain', borderRadius: 3, background: '#0a0c10', display: 'block', flex: '0 0 auto' }} />;
}

function MatchupPlayer({ player, winners, variant }: { player: any; winners?: string[] | null; variant: 'sidebar' | 'panel' }) {
  if (!player) return <div style={{ flex: 1, minWidth: 0 }} />;
  const panel = variant === 'panel';
  const w = panel ? 44 : 32;
  const h = panel ? 30 : 32;
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: panel ? 4 : 3, flex: 1, minWidth: 0 }}
      title={`${player.leader?.name || '?'} / ${player.base?.name || '?'} — ${playerUsername(player)}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: panel ? 2 : 4 }}>
        <Thumb src={cardImageUrl(player.leader, true)} alt={player.leader?.name} w={w} h={h} />
        <Thumb src={cardImageUrl(player.base, false)} alt={player.base?.name} w={w} h={h} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
        <ResultBadge playerId={player.id} winners={winners} />
        <span style={{ fontSize: 11, color: panel ? '#d6d6d6' : '#a0a8b8', fontWeight: panel ? 600 : 400, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {playerUsername(player)}
        </span>
      </div>
    </div>
  );
}

export function MatchupInfo({
  replay, matchMeta, installToken, isOwner, anonymize, series, variant, share,
}: {
  replay: MatchupReplay;
  matchMeta: MatchMeta | null;
  installToken: string;
  isOwner: boolean;
  anonymize?: boolean;
  series?: SeriesInfo | null;
  variant: 'sidebar' | 'panel';
  // Desktop tucks the Share control inline beside the players; mobile renders
  // its own in the panel header, so it passes nothing here.
  share?: ReactNode;
}) {
  const players = (replay.players as any[]) || [];
  const [p1, p2] = players;
  const chips = matchChips(matchMeta);
  const panel = variant === 'panel';
  return (
    <>
      {chips.length > 0 && (
        <div style={{ display: 'flex', gap: panel ? 4 : 6, flexWrap: 'wrap' }}>
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
          defaultText={defaultTitleFor(replay, anonymize) + (series ? ` — Game ${series.current}` : '')}
          canEdit={isOwner}
        />
      </div>
      {series && <SeriesNav series={series} />}
      {(isOwner || (Array.isArray(replay.labels) && replay.labels.length > 0)) && (
        <LabelsRow
          replaySlug={replay.slug}
          installToken={installToken}
          initialLabels={Array.isArray(replay.labels) ? replay.labels : []}
          canEdit={isOwner}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: panel ? 8 : 6, flex: 1, minWidth: 0 }}>
          <MatchupPlayer player={p1} winners={replay.winners} variant={variant} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#6c7588', flex: '0 0 auto', paddingTop: 11 }}>VS</span>
          <MatchupPlayer player={p2} winners={replay.winners} variant={variant} />
        </div>
        {share}
      </div>
    </>
  );
}

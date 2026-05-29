'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cardImageUrl } from '@/lib/cardImage';

interface ReplayRow {
  slug: string;
  gameId: string;
  userId: string | null;
  players: any;
  durationMs: number;
  actionCount: number;
  visibility: string;
  createdAt: string;
  // B42: match metadata. Null for replays uploaded by pre-B42 extension
  // versions; new replays carry { gameFormat, cardPool, gamesToWinMode, ... }.
  match?: {
    gameFormat?: string | null;
    cardPool?: string | null;
    gamesToWinMode?: string | null;
    gameType?: string | null;
  } | null;
}

// B42: pretty labels for the format chip on the card teaser.
const FORMAT_LABEL: Record<string, string> = {
  premier: 'Premier', eternal: 'Eternal', open: 'Open', limited: 'Limited',
};
const POOL_LABEL: Record<string, string> = {
  current: 'Current', nextSet: 'Next Set', unlimited: 'Unlimited',
};
const MODE_LABEL: Record<string, string> = {
  bestOfOne: 'Bo1', bestOfThree: 'Bo3',
};

function formatChipParts(match: ReplayRow['match']): string[] {
  if (!match) return [];
  const parts: string[] = [];
  if (match.gameFormat && FORMAT_LABEL[match.gameFormat]) parts.push(FORMAT_LABEL[match.gameFormat]);
  if (match.cardPool && POOL_LABEL[match.cardPool] && match.cardPool !== 'current') parts.push(POOL_LABEL[match.cardPool]);
  if (match.gamesToWinMode && MODE_LABEL[match.gamesToWinMode]) parts.push(MODE_LABEL[match.gamesToWinMode]);
  return parts;
}

export function ReplayCard({ replay, canManage }: { replay: ReplayRow; canManage: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [visibility, setVisibility] = useState(replay.visibility);

  const players = (replay.players as any[]) || [];
  const [p1, p2] = players;

  const toggleVisibility = async () => {
    const next = visibility === 'public' ? 'unlisted' : 'public';
    const res = await fetch(`/api/replays/${replay.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: next }),
    });
    const body = await res.json();
    if (!body.ok) {
      alert(`Failed to update: ${body.error || 'unknown'}`);
      return;
    }
    setVisibility(next);
    startTransition(() => router.refresh());
  };

  const remove = async () => {
    if (!confirm('Delete this replay? This cannot be undone.')) return;
    const res = await fetch(`/api/replays/${replay.slug}`, { method: 'DELETE' });
    const body = await res.json();
    if (!body.ok) {
      alert(`Failed to delete: ${body.error || 'unknown'}`);
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <div
      style={{
        background: 'rgba(17,20,26,0.6)',
        border: '1px solid #2e333c',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        opacity: isPending ? 0.5 : 1,
      }}
    >
      <Link href={`/r/${replay.slug}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
          <Matchup player={p1} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#6c7588' }}>VS</span>
          <Matchup player={p2} />
        </div>
        <div style={{ fontSize: 13, color: '#d6d6d6', lineHeight: 1.35, fontWeight: 600 }}>
          {deckText(p1)} vs {deckText(p2)}
        </div>
        <div style={{ fontSize: 12, color: '#a0a8b8', lineHeight: 1.3 }}>
          {nameText(p1)} vs {nameText(p2)}
        </div>
        <div style={{ fontSize: 12, color: '#6c7588', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{formatDate(replay.createdAt)} · {replay.actionCount || 0} actions · {formatDuration(replay.durationMs || 0)}</span>
          {formatChipParts(replay.match).map((label) => (
            <span
              key={label}
              style={{
                background: 'rgba(74, 124, 255, 0.12)',
                border: '1px solid rgba(74, 124, 255, 0.3)',
                color: '#a0c4ff',
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
      {canManage && (
        <div style={{ display: 'flex', gap: 6, paddingTop: 8, borderTop: '1px solid #2e333c' }}>
          <button
            type="button"
            onClick={toggleVisibility}
            disabled={isPending}
            style={{
              background: 'transparent',
              border: '1px solid #4a4e56',
              color: visibility === 'public' ? '#6bd968' : '#a0a8b8',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              cursor: isPending ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {visibility === 'public' ? '✓ Public' : 'Make public'}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={isPending}
            style={{
              background: 'transparent',
              border: '1px solid #5a2a2a',
              color: '#ff6b6b',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              cursor: isPending ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              marginLeft: 'auto',
            }}
          >
            Delete
          </button>
        </div>
      )}
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

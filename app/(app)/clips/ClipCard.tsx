'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cardImageUrl } from '@/lib/cardImage';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { deckLabel } from '@/lib/players';
import { formatTimestamp } from '@/lib/datetime';
import type { SerializedClipRow } from '@/lib/clipRow';

// B142: one clip in the browser grid — the parent-replay matchup (leaders/bases)
// + the clip's title / length / creator, linking to the reel at /c/[slug].
export function ClipCard({ clip, showCreator }: { clip: SerializedClipRow; showCreator: boolean }) {
  const players = (clip.players as any[]) || [];
  const [p1, p2] = players;
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const del = async () => {
    if (busy || !confirm('Delete this clip? This can’t be undone.')) return;
    setBusy(true);
    const res = await fetch(`/api/clips/${clip.clipSlug}`, { method: 'DELETE' });
    if (res.ok) router.refresh();
    else { setBusy(false); alert('Could not delete the clip.'); }
  };

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
        opacity: busy ? 0.5 : 1,
      }}
    >
      <Link href={`/c/${clip.clipSlug}`} prefetch={false} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
          <Matchup player={p1} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#6c7588' }}>VS</span>
          <Matchup player={p2} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden style={{ flex: '0 0 auto', color: '#4d9dff', display: 'flex' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
          <span style={{ fontSize: 14, color: '#fff', lineHeight: 1.3, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {clip.title || 'Untitled clip'}
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#a0a8b8', lineHeight: 1.3 }}>
          {deckLabel(p1)} vs {deckLabel(p2)}
        </div>
        <div style={{ fontSize: 12, color: '#6c7588', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{clip.frameCount} frame{clip.frameCount === 1 ? '' : 's'} · from frame {clip.startFrame + 1}</span>
          <span>· {formatTimestamp(clip.clipCreatedAt)}</span>
          {showCreator && clip.creatorName && <span>· by {clip.creatorName}</span>}
        </div>
      </Link>
      {clip.canDelete && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid #2e333c' }}>
          <button
            type="button"
            onClick={del}
            disabled={busy}
            style={{
              background: 'transparent', border: '1px solid rgba(255,107,107,0.4)', color: '#ff8a8a',
              borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
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

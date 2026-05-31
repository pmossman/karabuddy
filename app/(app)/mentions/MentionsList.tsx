'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MentionedComment } from '@/app/(app)/r/[slug]/MentionInput';
import { tokens } from '@/app/_theme/karabuddyTokens';

interface MentionRow {
  id: string;
  replaySlug: string;
  frameIndex: number;
  authorName: string;
  comment: string;
  createdAt: string;
  replayPlayers: any;
  replayMatch: any;
}

// B55d: client-fetched mentions list. Each row is clickable; URL uses
// `?f=N` (1-based frame param wired in B48) so the viewer lands on the
// exact frame the tag is on.
export function MentionsList() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<MentionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/me/mentions');
        const body = await res.json();
        if (cancelled) return;
        if (!body.ok) {
          setError(body.error || 'failed to load');
          setState('error');
          return;
        }
        setRows(body.data || []);
        setState('ready');
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'network error');
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state === 'loading') {
    return <div style={{ fontSize: 12, color: '#6c7588' }}>Loading…</div>;
  }
  if (state === 'error') {
    return <div style={{ fontSize: 12, color: '#ff7a7a' }}>{error}</div>;
  }
  if (rows.length === 0) {
    return (
      <div style={{ padding: 24, border: '1px dashed #2e333c', borderRadius: 8, textAlign: 'center', fontSize: 13, color: '#a0a8b8' }}>
        No mentions yet. When a teammate @-mentions you on a replay tag, it&apos;ll show up here.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/r/${r.replaySlug}?f=${r.frameIndex + 1}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 14,
            background: tokens.surface.panel,
            border: `1px solid ${tokens.surface.panelBorder}`,
            borderLeft: `2px solid ${tokens.led.on}`,
            borderRadius: tokens.radius.md,
            boxShadow: tokens.surface.panelShadow,
            color: '#e6e6e6',
            textDecoration: 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#5db4ff', fontWeight: 600 }}>{r.authorName}</span>
            <span style={{ fontSize: 11, color: '#6c7588' }}>{formatRelative(r.createdAt)} · frame {r.frameIndex + 1}</span>
          </div>
          <div style={{ fontSize: 13, color: '#d6d6d6', lineHeight: 1.4, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
            <MentionedComment text={r.comment || '(no comment)'} />
          </div>
          <div style={{ fontSize: 11, color: '#6c7588' }}>{matchupText(r.replayPlayers)}</div>
        </Link>
      ))}
    </div>
  );
}

function matchupText(players: any): string {
  if (!Array.isArray(players) || players.length < 2) return '';
  const [p1, p2] = players;
  const a = p1?.username || p1?.leader?.name || 'p1';
  const b = p2?.username || p2?.leader?.name || 'p2';
  return `${a} vs ${b}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return new Date(iso).toLocaleDateString();
}

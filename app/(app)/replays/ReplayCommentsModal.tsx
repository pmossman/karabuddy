'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

// B100: lightweight comments viewer reachable by clicking a replay's 💬
// count in the browser — read the discussion without opening the full
// viewer. Tags are fetched lazily (they aren't in the list payload).

interface TagRow {
  id: string;
  frameIndex: number;
  authorName: string;
  comment: string;
  parentTagId: string | null;
  createdAt: string;
}

export function ReplayCommentsModal({
  replaySlug,
  title,
  onClose,
}: {
  replaySlug: string;
  title: string;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/replays/${replaySlug}`);
        const body = await res.json();
        if (cancelled) return;
        if (!body.ok) { setState('error'); return; }
        setTags((body.data?.tags as TagRow[]) ?? []);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [replaySlug]);

  // Top-level comments ordered by frame, each with its replies (B78) nested
  // underneath in creation order.
  const threads = useMemo(() => {
    const all = tags ?? [];
    const repliesByParent = new Map<string, TagRow[]>();
    for (const t of all) {
      if (t.parentTagId) {
        const arr = repliesByParent.get(t.parentTagId) ?? [];
        arr.push(t);
        repliesByParent.set(t.parentTagId, arr);
      }
    }
    const tops = all.filter((t) => !t.parentTagId);
    tops.sort((a, b) => (a.frameIndex - b.frameIndex) || cmpDate(a, b));
    for (const arr of repliesByParent.values()) arr.sort(cmpDate);
    return tops.map((t) => ({ tag: t, replies: repliesByParent.get(t.id) ?? [] }));
  }, [tags]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 220,
        background: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Replay comments"
        data-testid="comments-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 95vw)',
          maxHeight: '85vh',
          background: '#11141a',
          border: '1px solid #2e333c',
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#e6e6e6',
          fontFamily: 'var(--font-barlow), sans-serif',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #2e333c', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
            <div style={{ fontSize: 11, color: '#6c7588', marginTop: 2 }}>Comments</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', color: '#a0a8b8', border: 0, fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4, fontFamily: 'inherit' }}
          >
            ×
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'loading' && <Muted>Loading comments…</Muted>}
          {state === 'error' && <Muted error>Couldn&apos;t load comments.</Muted>}
          {state === 'ready' && threads.length === 0 && <Muted>No comments on this replay yet.</Muted>}
          {state === 'ready' && threads.map(({ tag, replies }) => (
            <div key={tag.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Comment tag={tag} replaySlug={replaySlug} />
              {replies.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 14, borderLeft: '2px solid #2e333c', marginLeft: 4 }}>
                  {replies.map((rep) => <Comment key={rep.id} tag={rep} replaySlug={replaySlug} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Comment({ tag, replaySlug }: { tag: TagRow; replaySlug: string }) {
  return (
    <div style={{ background: 'rgba(17, 20, 26, 0.5)', border: '1px solid #2e333c', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#e6e6e6' }}>{tag.authorName}</span>
        {/* Frame deeplink — jump straight to the tagged moment if you do want
            the viewer. Secondary; reading the text doesn't require it. */}
        <Link href={`/r/${replaySlug}?f=${tag.frameIndex}`} prefetch={false} style={{ fontSize: 10.5, color: '#5db4ff', textDecoration: 'none', fontWeight: 600 }}>
          Frame {tag.frameIndex} →
        </Link>
        <span style={{ fontSize: 10.5, color: '#6c7588', marginLeft: 'auto' }}>{shortDate(tag.createdAt)}</span>
      </div>
      <div style={{ fontSize: 13, color: '#d6d6d6', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {tag.comment || <span style={{ color: '#6c7588', fontStyle: 'italic' }}>(no text)</span>}
      </div>
    </div>
  );
}

function Muted({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return <div style={{ fontSize: 13, color: error ? '#ff7a7a' : '#6c7588', fontStyle: 'italic', padding: '6px 4px' }}>{children}</div>;
}

function cmpDate(a: TagRow, b: TagRow): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

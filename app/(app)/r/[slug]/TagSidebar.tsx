'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Frame } from '@/lib/replayDecoder';
import { cardImageUrl } from '@/lib/cardImage';
import { getOrCreateInstallToken, getOrCreateAuthorName } from '@/lib/installToken';

interface ReplayRow {
  slug: string;
  players: any;
  durationMs: number;
  actionCount: number;
}

interface TagRow {
  id: string;
  replaySlug: string;
  frameIndex: number;
  authorToken: string;
  authorName: string;
  comment: string;
  createdAt: string;
}

type StepMode = 'action' | 'frame';

interface Props {
  replay: ReplayRow;
  frames: Frame[] | null;
  currentIndex: number;
  onStep: (dir: 1 | -1) => void;
  onJump: (i: number) => void;
  tags: TagRow[];
  setTags: React.Dispatch<React.SetStateAction<TagRow[]>>;
  playerUsernames: Set<string>;
  mode: StepMode;
  setMode: (m: StepMode) => void;
}

const TAG_PLAYER = '#6bd968';
const TAG_REVIEWER = '#e0c64a';

const tagColor = (authorName: string, players: Set<string>) =>
  players.has(authorName) ? TAG_PLAYER : TAG_REVIEWER;

export function TagSidebar({ replay, frames, currentIndex, onStep, onJump, tags, setTags, playerUsernames, mode, setMode }: Props) {
  const [installToken, setInstallToken] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setInstallToken(getOrCreateInstallToken());
    setAuthorName(getOrCreateAuthorName());
  }, []);

  const playersArr = (replay.players as any[]) || [];
  const [p1, p2] = playersArr;

  const tagsByFrame = useMemo(() => {
    const m = new Map<number, TagRow[]>();
    for (const t of tags) {
      const list = m.get(t.frameIndex) || [];
      list.push(t);
      m.set(t.frameIndex, list);
    }
    return m;
  }, [tags]);

  const submitTag = async () => {
    if (!installToken || !frames) return;
    const res = await fetch(`/api/replays/${replay.slug}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installToken,
        authorName,
        frameIndex: currentIndex,
        comment: draft,
      }),
    });
    const body = await res.json();
    if (!body.ok) {
      alert(`Failed to add tag: ${body.error || 'unknown'}`);
      return;
    }
    setTags((prev) => [
      ...prev,
      {
        id: body.id,
        replaySlug: replay.slug,
        frameIndex: currentIndex,
        authorToken: installToken,
        authorName,
        comment: draft,
        createdAt: new Date().toISOString(),
      },
    ]);
    setDraft('');
    setFormOpen(false);
  };

  const deleteTag = async (id: string) => {
    if (!confirm('Delete this tag?')) return;
    const res = await fetch(`/api/replays/${replay.slug}/tags/${id}`, {
      method: 'DELETE',
      headers: { 'X-Install-Token': installToken },
    });
    const body = await res.json();
    if (!body.ok) {
      alert(`Failed to delete: ${body.error || 'unknown'}`);
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== id));
  };

  const updateComment = async (id: string, comment: string) => {
    const res = await fetch(`/api/replays/${replay.slug}/tags/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
      body: JSON.stringify({ comment }),
    });
    const body = await res.json();
    if (!body.ok) {
      alert(`Failed to update: ${body.error || 'unknown'}`);
      return;
    }
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, comment } : t)));
  };

  const jumpToAdjacent = (dir: 1 | -1) => {
    const sorted = tags.map((t) => t.frameIndex).sort((a, b) => a - b);
    const target =
      dir > 0
        ? sorted.find((i) => i > currentIndex)
        : [...sorted].reverse().find((i) => i < currentIndex);
    if (target != null) onJump(target);
  };

  const tagsAtCurrent = tagsByFrame.get(currentIndex) || [];

  return (
    <aside
      style={{
        width: 360,
        flex: '0 0 360px',
        background: 'rgba(17, 20, 26, 0.95)',
        borderRight: '1px solid #2e333c',
        color: '#e6e6e6',
        font: '12px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <header style={{ padding: '16px 22px 12px', borderBottom: '1px solid #2e333c', flex: '0 0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Matchup player={p1} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#6c7588' }}>VS</span>
          <Matchup player={p2} />
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: '#a0a8b8', lineHeight: 1.4 }}>
          {p1?.username || 'anon'} vs {p2?.username || 'anon'}
          {' · '}
          {replay.actionCount} actions
        </div>
      </header>

      <section style={{ padding: '12px 22px', borderBottom: '1px solid #2e333c', flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Navigation</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <FooterBtn onClick={() => onStep(-1)}>←</FooterBtn>
          <FooterBtn onClick={() => onStep(1)}>→</FooterBtn>
          <span style={{ fontSize: 12, color: '#d6d6d6', fontWeight: 600, marginLeft: 6 }}>
            {frames ? `Frame ${currentIndex + 1} / ${frames.length}` : '…'}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Step by</div>
          <ModeSegmented mode={mode} setMode={setMode} />
          <div style={{ fontSize: 11, color: '#6c7588', fontStyle: 'italic' }}>
            Hold ⇧ + ← → to step by {mode === 'action' ? 'Frame' : 'Action'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <FooterBtn onClick={() => jumpToAdjacent(-1)} variant="ghost">‹ Prev tag</FooterBtn>
          <FooterBtn onClick={() => jumpToAdjacent(1)} variant="ghost">Next tag ›</FooterBtn>
        </div>
      </section>

      <section style={{ padding: '14px 22px', borderBottom: '1px solid #2e333c', flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <FooterBtn variant="outline" onClick={() => setFormOpen((v) => !v)} alignSelf>
          + Tag this frame
        </FooterBtn>
        {formOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, background: 'rgba(74, 124, 255, 0.08)', border: '1px solid rgba(74, 124, 255, 0.3)', borderRadius: 6 }}>
            <div style={{ fontSize: 11, color: '#a0a8b8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: tagColor(authorName, playerUsernames) }} />
              <span>Tagging as {authorName}</span>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Your note about this moment…"
              rows={2}
              style={{
                background: '#11141a',
                color: '#e6e6e6',
                border: '1px solid #2e333c',
                borderRadius: 4,
                padding: '6px 8px',
                font: '12px var(--font-barlow), -apple-system, sans-serif',
                resize: 'vertical',
                outline: 'none',
                minHeight: 50,
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  submitTag();
                } else if (e.key === 'Escape') {
                  setFormOpen(false);
                }
              }}
            />
            <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end' }}>
              <FooterBtn variant="ghost" onClick={() => setFormOpen(false)}>Cancel</FooterBtn>
              <FooterBtn onClick={submitTag}>Save tag</FooterBtn>
            </div>
          </div>
        )}
      </section>

      <section style={{ flex: '1 1 auto', overflowY: 'auto', padding: '14px 22px' }}>
        {tagsAtCurrent.length > 0 && (
          <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' }}>This frame</div>
            {tagsAtCurrent.map((t) => {
              const c = tagColor(t.authorName, playerUsernames);
              return (
                <div key={t.id} style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', borderLeft: `4px solid ${c}` }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: c, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t.authorName}&apos;s note
                  </div>
                  <div style={{ fontSize: 13, color: '#e6e6e6', lineHeight: 1.4, whiteSpace: 'pre-wrap', marginTop: 4 }}>
                    {t.comment || '(no comment)'}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>All tags ({tags.length})</div>
        {tags.length === 0 ? (
          <div style={{ fontSize: 11, color: '#6c7588', fontStyle: 'italic' }}>No tags yet. Click &quot;+ Tag this frame&quot; to add one.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...tags].sort((a, b) => a.frameIndex - b.frameIndex).map((t) => {
              const isCurrent = t.frameIndex === currentIndex;
              const isOwn = t.authorToken === installToken;
              const c = tagColor(t.authorName, playerUsernames);
              return (
                <TagRowView
                  key={t.id}
                  tag={t}
                  color={c}
                  isCurrent={isCurrent}
                  isOwn={isOwn}
                  onJumpTo={() => onJump(t.frameIndex)}
                  onDelete={() => deleteTag(t.id)}
                  onUpdate={(comment) => updateComment(t.id, comment)}
                />
              );
            })}
          </div>
        )}
      </section>
    </aside>
  );
}

function Matchup({ player }: { player: any }) {
  if (!player) return <div style={{ flex: 1, minWidth: 0 }} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0, alignItems: 'center' }}>
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
  return (
    <img
      src={src}
      alt={alt || ''}
      loading="lazy"
      style={{ width: 90, height: 64, objectFit: 'contain', borderRadius: 4, background: '#0a0c10' }}
    />
  );
}

function ModeSegmented({ mode, setMode }: { mode: StepMode; setMode: (m: StepMode) => void }) {
  const seg: React.CSSProperties = {
    background: 'transparent',
    color: '#a0a8b8',
    border: 0,
    padding: '0 10px',
    font: '600 11px var(--font-barlow), sans-serif',
    cursor: 'pointer',
    lineHeight: '22px',
  };
  const sel: React.CSSProperties = { background: '#4a7cff', color: 'white' };
  return (
    <div style={{ display: 'inline-flex', alignSelf: 'flex-start', border: '1px solid #4a4e56', borderRadius: 4, overflow: 'hidden', height: 22 }}>
      <button type="button" style={{ ...seg, ...(mode === 'action' ? sel : {}) }} onClick={() => setMode('action')}>Action</button>
      <button type="button" style={{ ...seg, ...(mode === 'frame' ? sel : {}) }} onClick={() => setMode('frame')}>Frame</button>
    </div>
  );
}

function FooterBtn({
  children,
  onClick,
  variant = 'primary',
  alignSelf = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'ghost' | 'outline';
  alignSelf?: boolean;
}) {
  const base: React.CSSProperties = {
    border: 0,
    borderRadius: 4,
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    lineHeight: 1.2,
  };
  if (variant === 'ghost') {
    base.background = 'transparent';
    base.border = '1px solid #4a4e56';
    base.color = '#a0a8b8';
  } else if (variant === 'outline') {
    base.background = 'transparent';
    base.border = '1px solid #4a7cff';
    base.color = '#5da9ff';
  } else {
    base.background = '#4a7cff';
    base.color = 'white';
  }
  if (alignSelf) base.alignSelf = 'flex-start';
  return (
    <button type="button" style={base} onClick={onClick}>
      {children}
    </button>
  );
}

function TagRowView({
  tag,
  color,
  isCurrent,
  isOwn,
  onJumpTo,
  onDelete,
  onUpdate,
}: {
  tag: TagRow;
  color: string;
  isCurrent: boolean;
  isOwn: boolean;
  onJumpTo: () => void;
  onDelete: () => void;
  onUpdate: (comment: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.comment);
  return (
    <div
      onClick={() => !editing && onJumpTo()}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 4,
        background: isCurrent ? 'rgba(74, 124, 255, 0.12)' : 'rgba(255,255,255,0.025)',
        borderLeft: `3px solid ${color}`,
        opacity: isCurrent ? 1 : 0.45,
        cursor: editing ? 'text' : 'pointer',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: '#a0a8b8', display: 'flex', gap: 8 }}>
          <span style={{ color, fontWeight: 600 }}>{tag.authorName}</span>
          <span style={{ color: '#4a4e56' }}>·</span>
          <span>frame {tag.frameIndex + 1}</span>
        </div>
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#11141a',
              color: '#e6e6e6',
              border: '1px solid #4a7cff',
              borderRadius: 4,
              padding: '4px 6px',
              font: '12px inherit',
              resize: 'vertical',
              outline: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                onUpdate(draft.trim());
                setEditing(false);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(tag.comment);
                setEditing(false);
              }
            }}
            onBlur={() => {
              onUpdate(draft.trim());
              setEditing(false);
            }}
          />
        ) : (
          <div
            style={{ fontSize: 12, color: tag.comment ? '#d6d6d6' : '#6c7588', lineHeight: 1.35, wordWrap: 'break-word', whiteSpace: 'pre-wrap', cursor: isOwn ? 'text' : 'pointer' }}
            onClick={(e) => {
              if (isOwn) {
                e.stopPropagation();
                setEditing(true);
              }
            }}
          >
            {tag.comment || (isOwn ? '(click to add comment)' : '(no comment)')}
          </div>
        )}
      </div>
      {isOwn && !editing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete this tag"
          style={{ background: 'transparent', border: 0, color: '#6c7588', cursor: 'pointer', padding: '0 4px', fontSize: 13, lineHeight: 1 }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { ReplayCommentsModal } from './ReplayCommentsModal';
import { matchupTitle } from '@/lib/matchMetadata';

// B100: the 💬 comment count, clickable to read the discussion inline (a
// ReplayCommentsModal) instead of having to open the full viewer. Used on
// the grid card footer and the table's Comments column.

interface CountRow {
  slug: string;
  players: any;
  displayName?: string | null;
  commentCount?: number;
}

export function CommentCountButton({ replay, variant }: { replay: CountRow; variant: 'card' | 'table' }) {
  const [open, setOpen] = useState(false);
  const count = replay.commentCount ?? 0;

  if (count <= 0) {
    // Table keeps a placeholder so the column doesn't look empty; the card
    // simply omits the chip (it sat in the meta line).
    return variant === 'table' ? <span style={{ color: '#6c7588' }}>—</span> : null;
  }

  const title = matchupTitle(replay);

  return (
    <>
      <button
        type="button"
        data-testid={`replay-comment-count-${replay.slug}`}
        title={`${count} ${count === 1 ? 'comment' : 'comments'} — click to read`}
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent',
          border: 0,
          padding: variant === 'table' ? '2px 4px' : 0,
          margin: 0,
          color: '#a7d2ff',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        💬 {count}
      </button>
      {open && (
        <ReplayCommentsModal replaySlug={replay.slug} title={title} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

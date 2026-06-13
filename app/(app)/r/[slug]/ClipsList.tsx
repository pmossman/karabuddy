'use client';

import React from 'react';
import Link from 'next/link';

export interface ClipSummary {
  slug: string;
  startFrame: number; // ORIGINAL space (display as 1-based)
  endFrame: number;
  title: string | null;
  createdAt: string;
}

// B138: the list of a replay's clips, surfaced inside the matchup info (the
// desktop sidebar AND the mobile ⓘ panel). Each row links to that clip's reel.
// Caller supplies the section chrome/heading; this renders just the rows.
export function ClipsList({ clips }: { clips: ClipSummary[] }) {
  if (clips.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {clips.map((c) => {
        const len = c.endFrame - c.startFrame + 1;
        return (
          <Link
            key={c.slug}
            href={`/c/${c.slug}`}
            prefetch={false}
            data-testid="clip-list-item"
            style={{
              display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none',
              borderRadius: 6, padding: '7px 8px', color: '#d4d9e2',
            }}
          >
            <span aria-hidden style={{ flex: '0 0 auto', color: '#4d9dff', display: 'flex' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.title || 'Untitled clip'}
              </span>
              <span style={{ fontSize: 10.5, color: '#8b93a5' }}>
                {len} frame{len === 1 ? '' : 's'} · from frame {c.startFrame + 1}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

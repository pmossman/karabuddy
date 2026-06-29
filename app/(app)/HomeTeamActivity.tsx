'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MentionedComment } from '@/app/(app)/r/[slug]/MentionInput';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { relativeTime } from '@/lib/datetime';
import { matchupTitle } from '@/lib/matchMetadata';
import { Loading, Muted } from '@/app/_components/StatusUi';

// B70: per-team activity sections for the home page. One section per
// team the signed-in user belongs to, each a compact preview of that
// team's discussion feed + a stable link into the full team page.
// Reuses the existing /api/teams/[slug]/discussion endpoint so there's
// no server-side query duplication.

interface TeamRef {
  slug: string;
  name: string;
}

interface DiscussionItem {
  slug: string;
  players: any;
  displayName: string | null;
  latestTag: {
    comment: string;
    authorName: string;
    frameIndex: number;
    createdAt: string;
  };
  tagCount: number;
}

const ROWS_PER_TEAM = 3;

export function HomeTeamActivity({ teams }: { teams: TeamRef[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {teams.map((t) => (
        <TeamActivitySection key={t.slug} team={t} />
      ))}
    </div>
  );
}

function TeamActivitySection({ team }: { team: TeamRef }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<DiscussionItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/teams/${team.slug}/discussion`);
        const body = await res.json();
        if (cancelled) return;
        if (!body.ok) {
          setState('error');
          return;
        }
        setItems((body.data || []).slice(0, ROWS_PER_TEAM));
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [team.slug]);

  return (
    <section
      data-testid="home-team-section"
      style={{
        background: tokens.surface.panel,
        border: `1px solid ${tokens.surface.panelBorder}`,
        borderRadius: tokens.radius.lg,
        boxShadow: tokens.surface.panelShadow,
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid #2e333c',
        }}
      >
        <Link
          href={`/teams/${team.slug}`}
          style={{ fontSize: 15, fontWeight: 700, color: '#e6e6e6', textDecoration: 'none' }}
        >
          {team.name}
        </Link>
        <Link
          href={`/teams/${team.slug}`}
          style={{ fontSize: 12, fontWeight: 600, color: '#5db4ff', textDecoration: 'none' }}
        >
          View team →
        </Link>
      </header>

      <div style={{ padding: 12 }}>
        {state === 'loading' && <Loading label="activity" />}
        {state === 'error' && <Muted style={{ lineHeight: 1.5 }}>Couldn’t load activity.</Muted>}
        {state === 'ready' && items.length === 0 && (
          <Muted style={{ lineHeight: 1.5 }}>No discussion yet — tag a moment on a team replay to start one.</Muted>
        )}
        {state === 'ready' && items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((item) => (
              <ActivityRow key={item.slug} item={item} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ActivityRow({ item }: { item: DiscussionItem }) {
  const href = `/r/${item.slug}?f=${(item.latestTag.frameIndex || 0) + 1}`;
  return (
    <Link
      href={href}
      prefetch={false}
      data-testid="home-activity-row"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '10px 12px',
        background: 'rgba(77, 157, 255, 0.05)',
        borderLeft: '3px solid rgba(77, 157, 255, 0.4)',
        borderRadius: 4,
        textDecoration: 'none',
        color: '#e6e6e6',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#a7d2ff' }}>{matchupTitle(item)}</div>
      <div style={{ fontSize: 13, color: '#e6e6e6', lineHeight: 1.4 }}>
        <MentionedComment text={item.latestTag.comment || '(no comment)'} />
      </div>
      <div style={{ fontSize: 11, color: tokens.color.textMuted }}>
        {item.latestTag.authorName} · {relativeTime(item.latestTag.createdAt)} · {item.tagCount}{' '}
        {item.tagCount === 1 ? 'tag' : 'tags'}
      </div>
    </Link>
  );
}

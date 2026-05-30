'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MentionedComment } from '@/app/(app)/r/[slug]/MentionInput';

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
        background: 'rgba(17, 20, 26, 0.6)',
        border: '1px solid #2e333c',
        borderRadius: 10,
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
          style={{ fontSize: 12, fontWeight: 600, color: '#5a8cff', textDecoration: 'none' }}
        >
          View team →
        </Link>
      </header>

      <div style={{ padding: 12 }}>
        {state === 'loading' && <Muted>Loading activity…</Muted>}
        {state === 'error' && <Muted>Couldn’t load activity.</Muted>}
        {state === 'ready' && items.length === 0 && (
          <Muted>No discussion yet — tag a moment on a team replay to start one.</Muted>
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
      data-testid="home-activity-row"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '10px 12px',
        background: 'rgba(74, 124, 255, 0.05)',
        borderLeft: '3px solid rgba(74, 124, 255, 0.4)',
        borderRadius: 4,
        textDecoration: 'none',
        color: '#e6e6e6',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#a0c4ff' }}>{matchupText(item)}</div>
      <div style={{ fontSize: 13, color: '#e6e6e6', lineHeight: 1.4 }}>
        <MentionedComment text={item.latestTag.comment || '(no comment)'} />
      </div>
      <div style={{ fontSize: 11, color: '#6c7588' }}>
        {item.latestTag.authorName} · {timeAgo(item.latestTag.createdAt)} · {item.tagCount}{' '}
        {item.tagCount === 1 ? 'tag' : 'tags'}
      </div>
    </Link>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: '#6c7588', lineHeight: 1.5 }}>{children}</div>;
}

function matchupText(item: DiscussionItem): string {
  if (item.displayName) return item.displayName;
  const players = Array.isArray(item.players) ? item.players : [];
  const [p1, p2] = players;
  return `${nameText(p1)} vs ${nameText(p2)}`;
}

function nameText(p: any) {
  const u: string | undefined = p?.username;
  if (!u || /^anonymous\s/i.test(u)) return 'anon';
  return u;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

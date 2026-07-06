'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LeaderBasePair } from '@/app/_components/LeaderBasePair';
import { MentionedComment } from '@/app/(app)/r/[slug]/MentionInput';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { relativeTime } from '@/lib/datetime';
import { matchupTitle } from '@/lib/matchMetadata';
import { ErrorNote, Loading } from '@/app/_components/StatusUi';

// B61: Discussion feed for /teams/[slug]. Sits above the inventory.
// Surfaces replays with active tag activity; rows are stable click
// targets that land in the viewer at the latest-tagged frame.

interface Participant {
  userId: string | null;
  name: string;
  image: string | null;
}

interface DiscussionItem {
  slug: string;
  players: any;
  displayName: string | null;
  latestTag: {
    id: string;
    comment: string;
    authorName: string;
    authorImage: string | null;
    userId: string | null;
    frameIndex: number;
    createdAt: string;
    mentions: { userIds: string[]; teamSlugs: string[] } | null;
  };
  tagCount: number;
  participants: Participant[];
}

const MAX_BUBBLES = 5;

export function TeamDiscussion({ teamSlug }: { teamSlug: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<DiscussionItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/teams/${teamSlug}/discussion`);
        const body = await res.json();
        if (cancelled) return;
        if (!body.ok) {
          setError(body.error || 'failed to load');
          setState('error');
          return;
        }
        setItems(body.data || []);
        setState('ready');
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'network error');
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [teamSlug]);

  if (state === 'loading') {
    return <Loading label="discussion" />;
  }
  if (state === 'error') {
    return <ErrorNote>{error}</ErrorNote>;
  }
  if (items.length === 0) {
    return (
      <div style={{ fontSize: 12, color: '#a0a8b8', padding: '14px 16px', border: '1px dashed #2e333c', borderRadius: 8, lineHeight: 1.5 }}>
        No discussion yet — tag a moment on a team replay to start one.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((item) => (
        <DiscussionRow key={item.slug} item={item} />
      ))}
    </div>
  );
}

function DiscussionRow({ item }: { item: DiscussionItem }) {
  const players = Array.isArray(item.players) ? item.players : [];
  const [p1, p2] = players;
  // Frame URL is 1-based (B48).
  const href = `/r/${item.slug}?f=${(item.latestTag.frameIndex || 0) + 1}`;

  return (
    <Link
      href={href}
      prefetch={false}
      data-testid="discussion-item"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        background: tokens.surface.panel,
        border: `1px solid ${tokens.surface.panelBorder}`,
        borderRadius: tokens.radius.md,
        boxShadow: tokens.surface.panelShadow,
        textDecoration: 'none',
        color: '#e6e6e6',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <PlayerThumbs player={p1} />
          <span style={{ fontSize: 10, color: '#6c7588', fontWeight: 700, letterSpacing: '0.08em' }}>VS</span>
          <PlayerThumbs player={p2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a7d2ff' }}>
            {matchupTitle(item)}
          </div>
        </div>
        <ParticipantBubbles participants={item.participants} />
      </div>

      <div style={{
        padding: '10px 12px',
        background: 'rgba(77, 157, 255, 0.06)',
        borderLeft: '3px solid rgba(77, 157, 255, 0.45)',
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        <div style={{ fontSize: 11, color: '#a0a8b8' }}>
          <span style={{ fontWeight: 600, color: '#d6d6d6' }}>{item.latestTag.authorName}</span>
          {' · frame '}{(item.latestTag.frameIndex || 0) + 1}
        </div>
        <div style={{ fontSize: 13, color: '#e6e6e6', lineHeight: 1.4 }}>
          <MentionedComment text={item.latestTag.comment || '(no comment)'} />
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#6c7588' }}>
        {item.tagCount} {item.tagCount === 1 ? 'tag' : 'tags'} · last activity {relativeTime(item.latestTag.createdAt)}
      </div>
    </Link>
  );
}

function ParticipantBubbles({ participants }: { participants: Participant[] }) {
  const shown = participants.slice(0, MAX_BUBBLES);
  const overflow = participants.length - shown.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <div
          key={(p.userId || p.name) + ':' + i}
          data-testid="participant-bubble"
          title={p.name}
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: p.image ? '#0a0c10' : '#2e333c',
            border: '2px solid #11141a',
            marginLeft: i === 0 ? 0 : -8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            color: '#a7d2ff',
            overflow: 'hidden',
          }}
        >
          {p.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            (p.name || '?').charAt(0).toUpperCase()
          )}
        </div>
      ))}
      {overflow > 0 && (
        <div style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: '#2e333c',
          border: '2px solid #11141a',
          marginLeft: -8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          color: '#a0a8b8',
        }}>
          +{overflow}
        </div>
      )}
    </div>
  );
}

function PlayerThumbs({ player }: { player: any }) {
  return <LeaderBasePair leader={player?.leader} base={player?.base} orientation="overlap" width={38} height={27} fit="cover" radius={2} />;
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { TacticalHeading } from '@/app/_components/TacticalHeading';

// B149 / ADR 0009: the requester's "your review requests" home block. Lists the
// review requests YOU opened (across your teams), each with how many teammates
// have reviewed it + who — so you learn it was done without hunting the team tab.
// Self-fetches /api/me/review-requests; renders nothing when you have none.
interface RequestRow {
  slug: string;
  teamSlug: string;
  teamName: string;
  displayName: string | null;
  ownLeader?: { name?: string } | null;
  oppLeader?: { name?: string } | null;
  reviewers: { userId: string; name: string | null; reviewedAt: string }[];
  reviewerCount: number;
}

function matchup(r: RequestRow): string {
  if (r.displayName) return r.displayName;
  return `${r.ownLeader?.name ?? '?'} vs ${r.oppLeader?.name ?? '?'}`;
}

export function HomeReviewRequests() {
  const [rows, setRows] = useState<RequestRow[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/me/review-requests')
      .then((r) => r.json())
      .then((b) => { if (live && b?.ok) setRows(b.data || []); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, []);

  if (!rows || rows.length === 0) return null;

  return (
    <section data-testid="home-review-requests" style={{ marginBottom: 36 }}>
      <TacticalHeading>Your review requests</TacticalHeading>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r) => (
        <Link
          key={`${r.slug}:${r.teamSlug}`}
          href={`/r/${r.slug}`}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            padding: '10px 12px', textDecoration: 'none',
            background: tokens.color.surface, border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.md,
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#cdd4e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {matchup(r)}
            </span>
            <span style={{ fontSize: 11.5, color: '#8a93a6' }}>review · {r.teamName}</span>
          </span>
          <span
            style={{
              flexShrink: 0, fontSize: 11.5, fontWeight: 700,
              color: r.reviewerCount > 0 ? '#7fd97f' : '#8a93a6',
            }}
            title={r.reviewers.map((x) => x.name || 'someone').join(', ')}
          >
            {r.reviewerCount > 0 ? `✓ reviewed by ${r.reviewerCount}` : 'awaiting review'}
          </span>
        </Link>
      ))}
      </div>
    </section>
  );
}

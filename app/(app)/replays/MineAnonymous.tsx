'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MineEmpty } from './MineEmpty';
import { ReplayFilters } from './ReplayFilters';
import { requestInstallTokenFromExtension } from '@/lib/extensionBridge';

// B54: anonymous-but-extension-installed view of /replays?tab=mine.
// Probes the extension via the existing bridge for its install token,
// then fetches `GET /api/replays?owner=<token>` and renders the same
// ReplayCards the signed-in path uses. No account required to see your
// own captures.
//
// Loading order:
//   1. probing — asking the extension for its token
//   2. fetching — token known, fetching replays
//   3. ready — replays in hand
//   4. no-extension — bridge never answered; fall through to MineEmpty
export function MineAnonymous() {
  const [state, setState] = useState<'probing' | 'fetching' | 'ready' | 'no-extension'>('probing');
  const [replays, setReplays] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await requestInstallTokenFromExtension(1800);
      if (cancelled) return;
      if (!token) {
        setState('no-extension');
        return;
      }
      setState('fetching');
      try {
        const res = await fetch(`/api/replays?owner=${encodeURIComponent(token)}`);
        const body = await res.json();
        if (cancelled) return;
        if (body.ok && Array.isArray(body.data)) {
          setReplays(body.data);
          setState('ready');
        } else {
          // API failure: treat as no-extension state (user gets the install /
          // try-again card). Better than blank silence.
          setState('no-extension');
        }
      } catch {
        if (cancelled) return;
        setState('no-extension');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state === 'no-extension') {
    return <MineEmpty />;
  }

  if (state === 'probing' || state === 'fetching') {
    return (
      <div style={{ marginTop: 32, padding: 32, border: '1px dashed #2e333c', borderRadius: 8, textAlign: 'center', color: '#6c7588', fontSize: 13 }}>
        {state === 'probing' ? 'Looking for the KaraBuddy extension…' : 'Loading your replays…'}
      </div>
    );
  }

  if (replays.length === 0) {
    return <MineEmpty />;
  }

  return (
    <>
      <div
        style={{
          marginTop: 18,
          padding: '10px 14px',
          background: 'rgba(77, 157, 255, 0.08)',
          border: '1px solid rgba(77, 157, 255, 0.25)',
          borderRadius: 8,
          fontSize: 12,
          color: '#a7d2ff',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span>
          Viewing as an unclaimed extension install.{' '}
          <Link href="/signin?callbackUrl=/replays" style={{ color: '#5db4ff', textDecoration: 'underline' }}>
            Sign in
          </Link>{' '}
          to attribute these to an account (they&apos;ll auto-link).
        </span>
      </div>
      <ReplayFilters
        rows={replays.map((r) => ({
          slug: r.slug,
          gameId: r.gameId,
          userId: r.userId,
          players: r.players,
          durationMs: r.durationMs,
          actionCount: r.actionCount,
          createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(r.createdAt).toISOString(),
          match: r.match ?? null,
          displayName: r.displayName ?? null,
          labels: r.labels ?? null,
        }))}
        canManage={true}
        emptyState={<MineEmpty />}
      />
    </>
  );
}

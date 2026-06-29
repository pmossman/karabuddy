'use client';

import { useEffect, useState } from 'react';
import { ReplayFilters } from '@/app/(app)/replays/ReplayFilters';
import { ErrorNote, Loading } from '@/app/_components/StatusUi';

// B133: the public browser — replays whose uploaders explicitly published
// them. Rows arrive serialized + ANONYMIZED (Player1/Player2, no uploader
// name) from /api/replays/public; reusing ReplayFilters gives the tab the
// same filter / grouping / series controls as every other browser view.
export function PublicReplays() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/replays/public');
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
    return <Loading label="public replays" />;
  }
  if (state === 'error') {
    return <ErrorNote>{error}</ErrorNote>;
  }

  return (
    <ReplayFilters
      rows={rows}
      canManage={false}
      emptyState={
        <div style={{ fontSize: 13, color: '#6c7588', padding: '24px 0' }}>
          No public replays yet. Owners publish a replay from its Share menu —
          the game and its (anonymized) comments become visible to everyone.
        </div>
      }
    />
  );
}

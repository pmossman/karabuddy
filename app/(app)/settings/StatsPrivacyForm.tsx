'use client';

import { useState } from 'react';
import { LedToggle } from '@/app/_components/LedToggle';

// B101: opt in/out of the GLOBAL stats corpus. Default included (opt-out);
// global aggregates are anonymized + min-N gated. Personal/team scopes are
// unaffected by this setting. PATCHes /api/me/settings.
export function StatsPrivacyForm({ initialExcluded }: { initialExcluded: boolean }) {
  const [included, setIncluded] = useState(!initialExcluded);
  const [status, setStatus] = useState<{ kind: 'idle' | 'error'; text?: string }>({ kind: 'idle' });

  const toggle = async () => {
    const next = !included;
    setIncluded(next); // optimistic
    const res = await fetch('/api/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excludeFromGlobalStats: !next }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { setIncluded(!next); setStatus({ kind: 'error', text: body.error || 'failed' }); return; }
    setStatus({ kind: 'idle' });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <LedToggle variant="inline" checked={included} onChange={() => toggle()} label="Include my games in community (global) stats" />
      {status.kind === 'error' && <span style={{ fontSize: 12, color: '#ff6b6b' }}>{status.text}</span>}
    </div>
  );
}

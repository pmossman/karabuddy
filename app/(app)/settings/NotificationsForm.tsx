'use client';

import { useState } from 'react';
import { LedToggle } from '@/app/_components/LedToggle';

// B81/B99: global Discord-notifications switch — the strictly-opt-in master.
// Defaults OFF (no DMs until enabled); gates both direct + team mentions.
// PATCHes /api/me/notifications.
// notifyMentions skips a user entirely when this is on (overrides per-team prefs).
export function NotificationsForm({ initialDisabled }: { initialDisabled: boolean }) {
  const [enabled, setEnabled] = useState(!initialDisabled);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'error'; text?: string }>({ kind: 'idle' });

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next); // optimistic
    setStatus({ kind: 'saving' });
    const res = await fetch('/api/me/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationsDisabled: !next }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) {
      setEnabled(!next); // revert
      setStatus({ kind: 'error', text: body.error || 'failed' });
      return;
    }
    setStatus({ kind: 'idle' });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <LedToggle
        variant="inline"
        checked={enabled}
        onChange={() => toggle()}
        label="Send me Discord notifications when I’m @-mentioned"
      />
      {status.kind === 'error' && <span style={{ fontSize: 12, color: '#ff6b6b' }}>{status.text}</span>}
    </div>
  );
}

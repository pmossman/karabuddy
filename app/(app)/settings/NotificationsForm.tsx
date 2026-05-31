'use client';

import { useState } from 'react';

// B81: global Discord-notifications kill switch. PATCHes /api/me/notifications.
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
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <input type="checkbox" checked={enabled} onChange={toggle} />
      <span style={{ fontSize: 14 }}>Send me Discord notifications when I&apos;m @-mentioned</span>
      {status.kind === 'error' && <span style={{ fontSize: 12, color: '#ff6b6b' }}>{status.text}</span>}
    </label>
  );
}

'use client';

import { useState } from 'react';
import { LedToggle } from '@/app/_components/LedToggle';

// B81/B99: global Discord-notifications switch (strictly-opt-in master, gates
// mention DMs) + B194: a dedicated "review I requested was finished" DM toggle.
// Each PATCHes its own field on /api/me/notifications; both only fire DMs when a
// Discord account is connected.
export function NotificationsForm({ initialDisabled, initialReviewDm }: { initialDisabled: boolean; initialReviewDm: boolean }) {
  const [mentions, setMentions] = useState(!initialDisabled);
  const [reviewDm, setReviewDm] = useState(initialReviewDm);
  const [error, setError] = useState<string | null>(null);

  const patch = async (field: 'notificationsDisabled' | 'reviewDmEnabled', value: boolean, revert: () => void) => {
    setError(null);
    const res = await fetch('/api/me/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { revert(); setError(body.error || 'failed'); }
  };

  const toggleMentions = () => {
    const next = !mentions; setMentions(next);
    patch('notificationsDisabled', !next, () => setMentions(!next));
  };
  const toggleReviewDm = () => {
    const next = !reviewDm; setReviewDm(next);
    patch('reviewDmEnabled', next, () => setReviewDm(!next));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LedToggle variant="inline" checked={mentions} onChange={toggleMentions} label="Send me Discord notifications when I’m @-mentioned" />
      <LedToggle variant="inline" checked={reviewDm} onChange={toggleReviewDm} label="DM me when a teammate finishes a review I requested" />
      {error && <span style={{ fontSize: 12, color: '#ff6b6b' }}>{error}</span>}
    </div>
  );
}

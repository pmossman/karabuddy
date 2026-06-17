'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { tokens } from '@/app/_theme/karabuddyTokens';

// Owner-only control on a team member's row: hand the team over to that member.
// Two-step (confirm) since the acting owner steps down to a regular member.
export function TransferOwnerButton({ slug, targetUserId, targetName }: { slug: string; targetUserId: string; targetName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transfer = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${slug}/members/${targetUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'owner' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error || `failed (${res.status})`); return; }
      setConfirming(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (confirming) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {error && <span style={{ color: '#ff8a8a', fontSize: 11 }}>{error}</span>}
        <span style={{ fontSize: 11, color: '#a0a8b8' }}>Make {targetName} owner? You&apos;ll become a member.</span>
        <button type="button" data-testid="transfer-confirm" onClick={transfer} disabled={busy} style={primary}>
          {busy ? '…' : 'Confirm'}
        </button>
        <button type="button" onClick={() => { setConfirming(false); setError(null); }} disabled={busy} style={ghost}>Cancel</button>
      </span>
    );
  }
  return (
    <button type="button" data-testid="transfer-owner" onClick={() => setConfirming(true)} style={ghost}>
      Make owner
    </button>
  );
}

const base: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
};
const ghost: React.CSSProperties = { ...base, background: 'transparent', border: `1px solid ${tokens.color.border}`, color: '#a0a8b8' };
const primary: React.CSSProperties = { ...base, background: tokens.button.bg, border: `1px solid ${tokens.color.primary}`, color: tokens.color.accent };

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ClaimForm({
  prefilledToken,
  confirmLabel = 'Claim',
}: {
  prefilledToken?: string;
  confirmLabel?: string;
}) {
  const router = useRouter();
  const [token, setToken] = useState(prefilledToken || '');
  const [status, setStatus] = useState<{ kind: 'idle' | 'pending' | 'ok' | 'error'; text?: string }>({ kind: 'idle' });

  const submit = async () => {
    if (!token.trim()) return;
    setStatus({ kind: 'pending' });
    const res = await fetch('/api/me/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.trim() }),
    });
    const body = await res.json();
    if (!body.ok) {
      setStatus({ kind: 'error', text: body.error || 'failed' });
      return;
    }
    setStatus({
      kind: 'ok',
      text: `Linked. ${body.claimedReplays} replay(s) and ${body.claimedTags} tag(s) claimed.`,
    });
    setTimeout(() => router.push('/replays'), 1200);
  };

  return (
    <div>
      {!prefilledToken && (
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="kbx_..."
          autoComplete="off"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#11141a',
            border: '1px solid #2e333c',
            borderRadius: 6,
            color: '#e6e6e6',
            padding: '10px 12px',
            font: '13px monospace',
            outline: 'none',
            marginBottom: 12,
          }}
        />
      )}
      <button
        type="button"
        onClick={submit}
        disabled={status.kind === 'pending' || !token.trim()}
        style={{
          background: '#4a7cff',
          color: 'white',
          border: 0,
          borderRadius: 6,
          padding: '10px 18px',
          fontSize: 13,
          fontWeight: 600,
          cursor: status.kind === 'pending' || !token.trim() ? 'not-allowed' : 'pointer',
          opacity: status.kind === 'pending' || !token.trim() ? 0.5 : 1,
          fontFamily: 'inherit',
        }}
      >
        {status.kind === 'pending' ? 'Linking…' : confirmLabel}
      </button>
      {status.kind === 'ok' && (
        <p style={{ marginTop: 12, fontSize: 12, color: '#6bd968' }}>{status.text}</p>
      )}
      {status.kind === 'error' && (
        <p style={{ marginTop: 12, fontSize: 12, color: '#ff6b6b' }}>{status.text}</p>
      )}
    </div>
  );
}

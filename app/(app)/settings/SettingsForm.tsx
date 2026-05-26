'use client';

import { useState } from 'react';

export function SettingsForm({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'ok' | 'error'; text?: string }>({ kind: 'idle' });

  const submit = async () => {
    setStatus({ kind: 'saving' });
    const res = await fetch('/api/me/karabast-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: value }),
    });
    const body = await res.json();
    if (!body.ok) {
      setStatus({ kind: 'error', text: body.error || 'failed' });
      return;
    }
    const extra =
      body.claimedReplays || body.claimedTags
        ? ` Claimed ${body.claimedReplays} replay(s) and ${body.claimedTags} tag(s).`
        : '';
    setStatus({ kind: 'ok', text: 'Saved.' + extra });
  };

  return (
    <div>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. ReprintConfiscate"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: '#11141a',
          border: '1px solid #2e333c',
          borderRadius: 6,
          color: '#e6e6e6',
          padding: '10px 12px',
          font: '14px inherit',
          outline: 'none',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button
          type="button"
          onClick={submit}
          disabled={status.kind === 'saving'}
          style={{
            background: '#4a7cff',
            color: 'white',
            border: 0,
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: status.kind === 'saving' ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {status.kind === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {status.kind === 'ok' && (
          <span style={{ fontSize: 12, color: '#6bd968' }}>{status.text}</span>
        )}
        {status.kind === 'error' && (
          <span style={{ fontSize: 12, color: '#ff6b6b' }}>{status.text}</span>
        )}
      </div>
    </div>
  );
}

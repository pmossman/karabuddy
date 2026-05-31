'use client';

import { useState } from 'react';

// B75: per-user minimum-actions-per-player threshold for the extension's
// auto-uploads. PATCHes /api/me/settings; the extension reads it on record
// start and skips uploading matches where either player took fewer actions.
export function UploadThresholdForm({ initial }: { initial: number }) {
  const [value, setValue] = useState(String(initial));
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'ok' | 'error'; text?: string }>({ kind: 'idle' });

  const submit = async () => {
    setStatus({ kind: 'saving' });
    const res = await fetch('/api/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minUploadActions: Number(value) }),
    });
    const body = await res.json();
    if (!body.ok) {
      setStatus({ kind: 'error', text: body.error || 'failed' });
      return;
    }
    setValue(String(body.minUploadActions));
    setStatus({ kind: 'ok', text: `Saved — minimum ${body.minUploadActions} action(s) per player.` });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <input
        type="number"
        min={1}
        max={50}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{
          width: 90,
          background: '#11141a',
          border: '1px solid #2e333c',
          borderRadius: 6,
          color: '#e6e6e6',
          padding: '10px 12px',
          font: '14px inherit',
          outline: 'none',
        }}
      />
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
      {status.kind === 'ok' && <span style={{ fontSize: 12, color: '#6bd968' }}>{status.text}</span>}
      {status.kind === 'error' && <span style={{ fontSize: 12, color: '#ff6b6b' }}>{status.text}</span>}
    </div>
  );
}

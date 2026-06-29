'use client';

import { useState } from 'react';
import { Button, TextField } from '@mui/material';
import { ErrorNote } from '@/app/_components/StatusUi';

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
      <TextField
        type="number"
        size="small"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        slotProps={{ htmlInput: { min: 1, max: 50 } }}
        sx={{ width: 100 }}
      />
      <Button variant="contained" onClick={submit} disabled={status.kind === 'saving'}>
        {status.kind === 'saving' ? 'Saving…' : 'Save'}
      </Button>
      {status.kind === 'ok' && <span style={{ fontSize: 12, color: '#6bd968' }}>{status.text}</span>}
      {status.kind === 'error' && <ErrorNote>{status.text}</ErrorNote>}
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { openKeyManager } from '@/lib/companion';

// B170 / ADR 0010: opens the extension's trusted key-management page (keys.html)
// from anywhere in the webapp — settings, team settings, the viewer gate. The
// key never touches the webapp; this just asks the extension (via the bridge) to
// surface its own UI. Falls back to install guidance when no extension answers.
export function ManageKeysButton({ label = 'Manage team keys' }: { label?: string }) {
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setUnreachable(false);
    setBusy(true);
    const ok = await openKeyManager();
    setBusy(false);
    if (!ok) setUnreachable(true);
  };

  return (
    <div>
      <button
        onClick={open}
        disabled={busy}
        style={{
          cursor: 'pointer',
          padding: '9px 16px',
          fontSize: 13,
          fontWeight: 600,
          borderRadius: 6,
          border: '1px solid rgba(77,210,255,0.55)',
          background: 'rgba(77,210,255,0.12)',
          color: '#9fe6ff',
          fontFamily: 'inherit',
        }}
      >
        🔑 {busy ? 'Opening…' : label}
      </button>
      {unreachable && (
        <p style={{ margin: '8px 0 0', fontSize: 12.5, color: '#ffb020', lineHeight: 1.5 }}>
          Couldn’t reach the KaraBuddy extension. <Link href="/install" style={{ color: '#5db4ff' }}>Install or enable it</Link>, then try again — keys are managed inside the extension, never on this page.
        </p>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipsBrowser } from './ClipsBrowser';
import { requestInstallTokenFromExtension } from '@/lib/extensionBridge';
import type { SerializedClipRow } from '@/lib/clipRow';

// B142: anonymous My Clips — clips made under the extension's install token,
// before signing in. Probe the bridge for the token, then fetch /api/me/clips
// with the X-Install-Token header. No teams / On-My-Replays without an account.
export function MyClipsAnonymous() {
  const [state, setState] = useState<'probing' | 'fetching' | 'ready' | 'none'>('probing');
  const [rows, setRows] = useState<SerializedClipRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await requestInstallTokenFromExtension(1800);
      if (cancelled) return;
      if (!token) { setState('none'); return; }
      setState('fetching');
      try {
        const res = await fetch('/api/me/clips?scope=created', { headers: { 'X-Install-Token': token } });
        const body = await res.json();
        if (cancelled) return;
        if (body.ok && Array.isArray(body.data)) { setRows(body.data); setState('ready'); }
        else setState('none');
      } catch {
        if (!cancelled) setState('none');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state === 'probing' || state === 'fetching') {
    return (
      <div style={{ marginTop: 32, padding: 32, border: '1px dashed #2e333c', borderRadius: 8, textAlign: 'center', color: '#6c7588', fontSize: 13 }}>
        {state === 'probing' ? 'Looking for the KaraBuddy extension…' : 'Loading your clips…'}
      </div>
    );
  }

  // No clips (or no extension): the page descriptor above already explains
  // clips + the sign-in nudge, so render nothing rather than repeat it.
  if (state === 'none' || rows.length === 0) return null;

  return (
    <>
      <div style={{
        marginTop: 18, marginBottom: 4, padding: '10px 14px', background: 'rgba(77, 157, 255, 0.08)',
        border: '1px solid rgba(77, 157, 255, 0.25)', borderRadius: 8, fontSize: 12, color: '#a7d2ff',
      }}>
        Viewing clips from an unclaimed extension install.{' '}
        <Link href="/signin?callbackUrl=/clips" style={{ color: '#5db4ff', textDecoration: 'underline' }}>Sign in</Link>{' '}
        to attribute them to an account.
      </div>
      <ClipsBrowser rows={rows} showCreator={false} emptyLabel="No clips yet." />
    </>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { requestInstallTokenFromExtension } from '@/lib/extensionBridge';
import { glowButtonStyle } from '@/app/_components/glowButton';

// Empty state for /replays?tab=mine when a signed-in user has zero replays
// attributed to their account. Probes the bridge to see if the KaraBuddy
// extension is installed on this browser:
//   - Token detected → user installed the extension but hasn't linked it
//     to this account yet. Offer "Link this extension" → /claim?token=...
//   - No token       → either no extension or it hasn't loaded yet. Point
//     them at the install walkthrough.
//
// Avoids the previous nag where a fresh user sees their (correctly empty)
// replays page and has no idea why the extension's captures aren't showing
// up. The /claim flow itself is idempotent — re-linking a claimed token
// is a no-op — so we don't bother gating on "already claimed?" first.
export function MineEmpty() {
  const [token, setToken] = useState<string | null | 'pending'>('pending');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await requestInstallTokenFromExtension(1800);
      if (cancelled) return;
      setToken(t);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      style={{
        marginTop: 32,
        padding: 32,
        border: '1px dashed #2e333c',
        borderRadius: 8,
        textAlign: 'center',
        color: '#a0a8b8',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <div style={{ fontSize: 14 }}>No replays attributed to this account yet.</div>

      {token === 'pending' && (
        <div style={{ fontSize: 12, color: '#6c7588' }}>Looking for the KaraBuddy extension…</div>
      )}

      {token && token !== 'pending' && (
        <>
          <div style={{ fontSize: 13, color: '#d6e7ff', maxWidth: 480 }}>
            We detected the KaraBuddy extension on this browser. Link it to attribute the matches it&apos;s captured to your account.
          </div>
          <Link
            href={`/claim?token=${encodeURIComponent(token)}`}
            style={{ ...glowButtonStyle, padding: '10px 18px' }}
          >
            Link this extension →
          </Link>
        </>
      )}

      {token === null && (
        <>
          <div style={{ fontSize: 13, color: '#d6e7ff', maxWidth: 520 }}>
            Install the KaraBuddy chrome extension on karabast.net and your matches will start appearing here automatically.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link
              href="/install"
              style={{ ...glowButtonStyle, padding: '10px 18px' }}
            >
              Install walkthrough
            </Link>
            <button
              type="button"
              onClick={() => {
                setToken('pending');
                requestInstallTokenFromExtension(1800).then(setToken);
              }}
              style={{
                background: 'transparent',
                color: '#a0a8b8',
                border: '1px solid #4a4e56',
                borderRadius: 6,
                padding: '10px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Try detect again
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#6c7588', marginTop: 4 }}>
            Already installed? Reload this page — Chrome only injects the extension into tabs opened after it loaded.
          </div>
        </>
      )}
    </div>
  );
}

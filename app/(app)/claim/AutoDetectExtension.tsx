'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestInstallTokenFromExtension } from '@/lib/extensionBridge';

// On mount: probe the karabuddy extension via postMessage. If it answers
// with a token, push the user to /claim?token=… so the confirm-page-with-
// counts experience kicks in. If no answer (extension absent / disabled /
// not yet running on this tab), show actionable install + setup steps.
export function AutoDetectExtension() {
  const router = useRouter();
  const [state, setState] = useState<'probing' | 'missing'>('probing');

  useEffect(() => {
    if (state !== 'probing') return;
    let cancelled = false;
    (async () => {
      const token = await requestInstallTokenFromExtension(1800);
      if (cancelled) return;
      if (token) {
        router.replace(`/claim?token=${encodeURIComponent(token)}`);
      } else {
        setState('missing');
      }
    })();
    return () => { cancelled = true; };
  }, [router, state]);

  if (state === 'probing') {
    return (
      <p style={muted}>Looking for the KaraBuddy extension on this browser…</p>
    );
  }

  return (
    <>
      <p style={muted}>
        We couldn&apos;t detect the KaraBuddy extension on this browser.
      </p>
      <p style={muted}>
        If you haven&apos;t installed it yet,{' '}
        <a
          href="https://github.com/pmossman/karabast-extension"
          target="_blank"
          rel="noreferrer"
          style={link}
        >
          install the KaraBuddy chrome extension
        </a>{' '}
        and then come back here.
      </p>
      <p style={muted}>
        If you just installed or reloaded it,{' '}
        <strong>reload this page</strong> — Chrome only injects the extension into pages opened
        after it loaded.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" onClick={() => window.location.reload()} style={primary}>
          Reload page
        </button>
        <button type="button" onClick={() => setState('probing')} style={secondary}>
          Try detect again
        </button>
      </div>
    </>
  );
}

const primary: React.CSSProperties = {
  background: '#4d9dff',
  color: 'white',
  border: 0,
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const secondary: React.CSSProperties = {
  background: 'transparent',
  color: '#a0a8b8',
  border: '1px solid #4a4e56',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const muted: React.CSSProperties = { fontSize: 13, color: '#a0a8b8', lineHeight: 1.55, margin: '0 0 16px' };
const link: React.CSSProperties = { color: '#5db4ff', textDecoration: 'none' };

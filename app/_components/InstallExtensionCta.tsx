'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { requestInstallTokenFromExtension } from '@/lib/extensionBridge';

// B121: onboarding CTA for visitors WITHOUT the karabuddy extension — most often
// someone whose first experience is a shared replay link. We detect the
// extension by probing its page bridge (it replies with an install token iff
// installed in THIS browser, linked or not — i.e. "can they record?"). Only when
// the probe comes back empty do we surface the CTA, so users who already have
// the extension never see it (and there's no flash — we render nothing until the
// probe resolves). Links to the /install page.
//
// Two variants: a compact header button (app chrome) and a dismissible top
// banner (the replay viewer, which has no global header).

const BANNER_DISMISS_KEY = 'karabuddy:installCtaDismissed';

export function InstallExtensionCta({ variant }: { variant: 'header' | 'banner' }) {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (variant === 'banner') {
      try { if (localStorage.getItem(BANNER_DISMISS_KEY)) { setDismissed(true); return; } } catch {}
    }
    let alive = true;
    requestInstallTokenFromExtension(1500).then((token) => {
      if (alive && !token) setShow(true); // no extension in this browser → onboard
    });
    return () => { alive = false; };
  }, [variant]);

  if (!show || dismissed) return null;

  if (variant === 'header') {
    return (
      <Link
        href="/install"
        title="Record replays of your own karabast matches"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'linear-gradient(180deg, #4d9dff, #3b7fe0)',
          border: '1px solid #6cb0ff',
          boxShadow: '0 0 10px rgba(77, 157, 255, 0.3)',
          color: '#fff', textDecoration: 'none',
          fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, whiteSpace: 'nowrap',
        }}
      >
        <span aria-hidden>🎬</span> Install extension
      </Link>
    );
  }

  // Banner — a slim dismissible bar at the very top of the replay viewer.
  const dismiss = () => {
    try { localStorage.setItem(BANNER_DISMISS_KEY, '1'); } catch {}
    setDismissed(true);
  };
  return (
    <div
      style={{
        position: 'relative',
        flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
        padding: '8px 34px', flexWrap: 'wrap',
        background: 'linear-gradient(180deg, rgba(77,157,255,0.16), rgba(77,157,255,0.08))',
        borderBottom: '1px solid rgba(77,157,255,0.35)',
        color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif', fontSize: 13,
      }}
    >
      <span style={{ fontWeight: 600 }}>Want to record replays of your own matches?</span>
      <Link
        href="/install"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'linear-gradient(180deg, #4d9dff, #3b7fe0)', border: '1px solid #6cb0ff',
          boxShadow: '0 0 10px rgba(77,157,255,0.3)', color: '#fff', textDecoration: 'none',
          fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 8,
        }}
      >
        <span aria-hidden>🎬</span> Install the extension →
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          position: 'absolute', right: 10,
          background: 'transparent', border: 0, color: '#9aa3b2', fontSize: 18, lineHeight: 1,
          cursor: 'pointer', padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}

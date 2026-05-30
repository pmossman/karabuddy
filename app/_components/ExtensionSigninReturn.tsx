'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';

// B69: when the extension bubble opened a sign-in popup, callback URL
// is `/?fromExtension=1`. Once the user signs in, this component sees
// the flag + the authed session, notifies the opener tab so the
// bubble's whoami block can refresh, then closes the popup. Mounted at
// (app) layout level so it fires regardless of which page Auth.js
// happens to land the user on after sign-in.
//
// No-op when the flag isn't present (any non-popup page load) OR when
// there's no `window.opener` (user navigated here directly).
export function ExtensionSigninReturn() {
  const search = useSearchParams();
  const { status } = useSession();

  useEffect(() => {
    if (search.get('fromExtension') !== '1') return;
    if (status !== 'authenticated') return;
    if (typeof window === 'undefined' || !window.opener) return;
    try {
      window.opener.postMessage({ type: 'karabuddy:signedIn' }, '*');
    } catch {
      // Cross-origin postMessage failed — opener-poll fallback in the
      // bubble's popup-open code will still catch the manual close
      // when we call window.close() below.
    }
    // Brief delay so the user sees the "you're signed in" page before
    // the window pops away — feels less abrupt than an instant close.
    const t = setTimeout(() => {
      try { window.close(); } catch {}
    }, 600);
    return () => clearTimeout(t);
  }, [search, status]);

  return null;
}

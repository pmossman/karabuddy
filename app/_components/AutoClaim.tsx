'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { requestInstallTokenFromExtension } from '@/lib/extensionBridge';
import { Toast } from './Toast';

// B54/B68: silently link the extension's install token to the user's
// account on sign-in. Many-tokens-per-user supported by the schema, so
// users can have one row per install across all their browsers/devices.
//
// Two discovery paths run in parallel — whichever resolves first wins:
//   1. PROACTIVE — karabuddy-bridge.js posts `karabuddy:available
//      InstallToken` on every karabuddy.app page load. We listen.
//   2. EXPLICIT — we also `requestInstallTokenFromExtension()` with a
//      3s budget as a backstop in case the bridge already posted
//      before we mounted (or there's a postMessage race).
//
// Either path leads to the same idempotent POST /api/me/claim. The
// per-(user, token) sessionStorage dedup just keeps the success toast
// from re-firing on every navigation; server is idempotent regardless.
export function AutoClaim() {
  const { data: session, status } = useSession();
  const userId: string | null = ((session?.user as any)?.id as string | undefined) || null;
  const claimedTokensRef = useRef<Set<string>>(new Set());
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !userId) return;
    let cancelled = false;

    const tryClaim = async (token: string) => {
      if (cancelled || !token) return;
      // In-memory de-dupe per mount: even if the bridge announces +
      // the explicit request both resolve with the same token, we
      // only fire once.
      if (claimedTokensRef.current.has(token)) return;
      claimedTokensRef.current.add(token);

      const dedupKey = `karabuddy:autoClaim:${userId}:${token}`;
      const alreadyToasted = sessionStorage.getItem(dedupKey) === '1';
      try {
        const res = await fetch('/api/me/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const body = await res.json();
        if (cancelled || !body.ok) return;
        sessionStorage.setItem(dedupKey, '1');
        const n = body.claimedReplays || 0;
        if (!alreadyToasted && n > 0) {
          setToastMsg(`Linked ${n} replay${n === 1 ? '' : 's'} from this extension to your account.`);
        }
      } catch {
        // Allow a retry on next navigation — keep the token out of the
        // in-memory dedup set so the next mount can re-attempt.
        claimedTokensRef.current.delete(token);
      }
    };

    // PROACTIVE path: bridge posts immediately on every load.
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window) return;
      const data: any = e.data;
      if (!data || data.type !== 'karabuddy:availableInstallToken') return;
      const token = typeof data.token === 'string' ? data.token : null;
      if (token) tryClaim(token);
    };
    window.addEventListener('message', onMessage);

    // EXPLICIT path: catches the page-mounted-before-bridge case.
    (async () => {
      const token = await requestInstallTokenFromExtension(3000);
      if (token) tryClaim(token);
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
    };
  }, [status, userId]);

  if (!toastMsg) return null;
  return <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />;
}

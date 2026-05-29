'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { requestInstallTokenFromExtension } from '@/lib/extensionBridge';
import { Toast } from './Toast';

// B54: silently link the extension's install token to the user's account
// on sign-in. Mounted at (app) layout level so it runs on every authenticated
// page load — the actual claim only fires when:
//   1. There's an active session (we know who to claim to)
//   2. The extension is installed on this browser (bridge returns a token)
//   3. We haven't already claimed THIS (token, userId) pair in this browser
//      (sessionStorage dedup to avoid re-firing on every navigation)
//
// On success: brief one-time toast "Linked N replays from this extension".
// On failure: silent — claim is idempotent so retrying later is fine.
export function AutoClaim() {
  const { data: session, status } = useSession();
  const userId: string | null = ((session?.user as any)?.id as string | undefined) || null;
  const attemptingRef = useRef(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !userId) return;
    if (attemptingRef.current) return;
    attemptingRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const token = await requestInstallTokenFromExtension(1800);
        if (cancelled || !token) return;

        // Per-(user, token) sessionStorage dedup. Suppresses the toast on
        // subsequent navigations in the same tab. Re-firing in a new tab
        // is harmless — the server's onConflictDoUpdate makes claim
        // idempotent — but it'd re-show the toast which feels spammy.
        const dedupKey = `karabuddy:autoClaim:${userId}:${token}`;
        if (sessionStorage.getItem(dedupKey)) return;

        const res = await fetch('/api/me/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const body = await res.json();
        if (cancelled) return;
        if (body.ok) {
          sessionStorage.setItem(dedupKey, '1');
          const n = body.claimedReplays || 0;
          if (n > 0) {
            setToastMsg(`Linked ${n} replay${n === 1 ? '' : 's'} from this extension to your account.`);
          }
        }
      } catch {
        // Silent — claim is idempotent and any retry later will work.
      } finally {
        attemptingRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [status, userId]);

  if (!toastMsg) return null;
  return <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />;
}

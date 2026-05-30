'use client';

import { useEffect, useState } from 'react';
import { Toast } from './Toast';

// B69b: the heavy lifting moved into karabuddy-bridge.js (the content
// script). Because content-script fetches to same-origin URLs inherit
// the page's cookies, the bridge can POST /api/me/claim directly —
// removing every React-mount / postMessage / cookie-timing race that
// the old AutoClaim was working around.
//
// This component's remaining job: render the success toast when the
// bridge reports a non-trivial backfill. Listens for the new
// `karabuddy:claimResult` event and de-dupes via sessionStorage so
// re-firing on every nav doesn't re-show the toast.
export function AutoClaim() {
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window) return;
      const data: any = e.data;
      if (!data || data.type !== 'karabuddy:claimResult') return;
      const token: string | undefined = typeof data.token === 'string' ? data.token : undefined;
      const n: number = typeof data.claimedReplays === 'number' ? data.claimedReplays : 0;
      if (!token || n <= 0) return;
      const dedupKey = `karabuddy:autoClaimToast:${token}:${n}`;
      if (sessionStorage.getItem(dedupKey) === '1') return;
      sessionStorage.setItem(dedupKey, '1');
      setToastMsg(`Linked ${n} replay${n === 1 ? '' : 's'} from this extension to your account.`);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!toastMsg) return null;
  return <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />;
}

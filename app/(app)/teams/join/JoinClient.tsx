'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export function JoinClient({ code }: { code: string }) {
  const router = useRouter();
  const [state, setState] = useState<'joining' | 'error'>('joining');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/teams/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const body = await res.json();
        if (cancelled) return;
        if (!body.ok) {
          setError(body.error || 'failed to join');
          setState('error');
          return;
        }
        router.replace(`/teams/${body.slug}`);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'network error');
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [code, router]);

  return (
    <main style={{ maxWidth: 520, margin: '0 auto', padding: '32px 28px 80px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      {state === 'joining' && (
        <>
          <h1 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 600 }}>Joining team…</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#a0a8b8' }}>One moment.</p>
        </>
      )}
      {state === 'error' && (
        <>
          <h1 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 600 }}>Couldn&apos;t join</h1>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: '#ff7a7a' }}>{error}</p>
          <Link href="/teams" style={{ color: '#5db4ff', fontSize: 13 }}>← All teams</Link>
        </>
      )}
    </main>
  );
}

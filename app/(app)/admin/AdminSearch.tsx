'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { MUTED } from './ui';

// Debounced directory search. Pushes ?q= (preserving the active sort) to the URL
// so the server component re-queries. Not a native checkbox/radio — a plain text
// input is fine under the no-native-form-controls guard.
export function AdminSearch({ initial, sort, placeholder }: { initial: string; sort: string; placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(initial);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (q.trim()) p.set('q', q.trim());
      if (sort) p.set('sort', sort);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [q, sort, pathname, router]);

  return (
    <div style={{ position: 'relative', maxWidth: 420 }}>
      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: MUTED, fontSize: 14, pointerEvents: 'none' }}>⌕</span>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '9px 12px 9px 32px', fontSize: 13.5, fontFamily: 'inherit',
          background: '#0d1016', border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: 9, color: '#e6ebf2', outline: 'none',
        }}
      />
    </div>
  );
}

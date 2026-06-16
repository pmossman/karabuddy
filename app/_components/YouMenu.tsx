'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// "You" menu — the ambient PERSONAL axis. Always present for a signed-in user,
// next to the avatar. Picking an item never changes the active team: these are
// personal surfaces (my replays / clips / stats / mentions), scope carried by
// the links. Same menu idiom as SessionMenu / the switcher.
export const YOU_ITEMS: { href: string; label: string }[] = [
  { href: '/replays?tab=mine', label: 'My replays' },
  { href: '/clips', label: 'My clips' },
  { href: '/stats?scope=personal', label: 'My stats' },
  { href: '/mentions', label: 'My mentions' },
];

export function YouMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 8,
          cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600,
          color: open ? '#ffffff' : '#a0a8b8',
          background: open ? 'rgba(77,157,255,0.12)' : 'transparent',
          border: `1px solid ${open ? '#4d9dff' : 'transparent'}`,
        }}
      >
        You
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.7 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: 190,
            background: '#11141a', border: '1px solid #2e333c', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: 6, zIndex: 60,
            display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          {YOU_ITEMS.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              role="menuitem"
              prefetch={false}
              onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '8px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#d6d6d6', textDecoration: 'none' }}
            >
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

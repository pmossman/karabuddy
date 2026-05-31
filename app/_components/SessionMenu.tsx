'use client';

import { signOut, useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';

// Avatar dropdown — click the avatar for account actions (Settings, Sign out),
// the way modern webapps do it. Guests get a "Sign in" pill. (`compact` kept
// for call-site compatibility; the trigger is always the avatar now.)
export function SessionMenu({ compact = false }: { compact?: boolean }) {
  void compact;
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (status === 'loading') return <div style={{ fontSize: 11, color: '#6c7588' }}>…</div>;

  if (!session?.user) {
    return (
      <a href="/signin" style={{ fontSize: 12, color: '#5db4ff', textDecoration: 'none', padding: '4px 10px', border: '1px solid #4a4e56', borderRadius: 6, fontWeight: 600, whiteSpace: 'nowrap' }}>
        Sign in
      </a>
    );
  }

  const u = session.user;
  const label = u.name || u.email || '';
  const initials = label.replace(/@.*/, '').trim().slice(0, 2).toUpperCase() || '?';
  const item: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13, color: '#d6d6d6', textDecoration: 'none', borderRadius: 6, background: 'transparent', border: 0, cursor: 'pointer', fontFamily: 'inherit' };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', background: u.image ? 'transparent' : '#2e333c', border: open ? '2px solid #5a8cff' : '2px solid transparent', padding: 0, cursor: 'pointer', overflow: 'hidden' }}
      >
        {u.image
          ? <img src={u.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 11, fontWeight: 700, color: '#d6d6d6' }}>{initials}</span>}
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: 210, background: '#11141a', border: '1px solid #2e333c', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: 6, zIndex: 60 }}>
          <div style={{ padding: '6px 10px 10px', borderBottom: '1px solid #2e333c', marginBottom: 4 }}>
            <div style={{ fontSize: 11, color: '#6c7588' }}>Signed in as</div>
            <div style={{ fontSize: 13, color: '#e6e6e6', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{label}</div>
          </div>
          <a href="/settings" role="menuitem" style={item} onClick={() => setOpen(false)}>Settings</a>
          <button type="button" role="menuitem" style={item} onClick={() => signOut({ callbackUrl: window.location.href })}>Sign out</button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { TeamRef } from '@/lib/activeTeam';

// Team switcher — top-left, beside the logo. Lists the caller's teams (only
// teams; personal is the ambient "You" menu) + a create/join affordance.
// Picking a team persists it (POST /api/me/active-team writes the kb_team
// cookie) then routes to that team's dashboard. Same menu idiom as
// SessionMenu / the hamburger: outside-click + Escape + close on nav.
export function TeamSwitcher({ active, teams }: { active: TeamRef; teams: TeamRef[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
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

  async function pick(slug: string) {
    setOpen(false);
    if (slug !== active.slug) {
      // Persist the active team before navigating so a reload (and every
      // other page's link-scope) reflects the switch. Server re-validates
      // membership; we don't block the nav on a non-200.
      await fetch('/api/me/active-team', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      }).catch(() => {});
    }
    router.push(`/teams/${slug}`);
    router.refresh();
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch team"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: 220,
          padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
          background: open ? 'rgba(77,157,255,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${open ? '#4d9dff' : '#2e333c'}`,
          color: '#e6e6e6', font: 'inherit',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {active.name}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.7, flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', left: 0, top: 'calc(100% + 8px)', minWidth: 220,
            background: '#11141a', border: '1px solid #2e333c', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: 6, zIndex: 60,
            display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          <div style={{ padding: '4px 10px 6px', fontSize: 10, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
            Teams
          </div>
          {teams.map((t) => {
            const isActive = t.slug === active.slug;
            return (
              <button
                key={t.slug}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => pick(t.slug)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                  boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                  fontSize: 13, fontWeight: 600, fontFamily: 'inherit', border: 0,
                  color: isActive ? '#ffffff' : '#d6d6d6',
                  background: isActive ? 'rgba(77,157,255,0.12)' : 'transparent',
                }}
              >
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: isActive ? '#4dd2ff' : '#3a3f48', boxShadow: isActive ? '0 0 6px #4dd2ff' : 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              </button>
            );
          })}
          <div style={{ borderTop: '1px solid #2e333c', marginTop: 4, paddingTop: 4 }}>
            <Link
              href="/teams"
              role="menuitem"
              prefetch={false}
              onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '8px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#5db4ff', textDecoration: 'none' }}
            >
              Create or join a team →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

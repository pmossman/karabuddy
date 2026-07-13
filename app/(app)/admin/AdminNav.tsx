'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { PRIMARY, MUTED } from './ui';

// Section sub-nav for /admin. Active tab tracks the path (Overview is exact;
// Users/Teams match their subtree so detail pages keep their tab lit).
const TABS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/admin', label: 'Overview', match: (p) => p === '/admin' },
  { href: '/admin/users', label: 'Users', match: (p) => p.startsWith('/admin/users') },
  { href: '/admin/teams', label: 'Teams', match: (p) => p.startsWith('/admin/teams') },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <div style={{ borderBottom: `1px solid ${tokens.surface.panelBorder}`, background: 'rgba(10,13,18,0.6)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: '#e6ebf2', letterSpacing: '0.04em', marginRight: 14, padding: '14px 0' }}>UNDER THE HOOD</span>
        {TABS.map((t) => {
          const active = t.match(path);
          return (
            <Link key={t.href} href={t.href} style={{
              padding: '14px 14px', fontSize: 13, fontWeight: 700, textDecoration: 'none',
              color: active ? PRIMARY : MUTED, borderBottom: `2px solid ${active ? PRIMARY : 'transparent'}`, marginBottom: -1,
            }}>{t.label}</Link>
          );
        })}
      </div>
    </div>
  );
}

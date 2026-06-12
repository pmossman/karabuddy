'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Header nav item that highlights itself when the current route is in its
// section (e.g. /teams highlights on /teams AND /teams/<slug>). Client-only so
// it can read the pathname; the surrounding Header stays a server component.
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      // Header nav points at force-dynamic pages — viewport prefetch would
      // invoke every one of them on every page load.
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      style={{
        color: active ? '#ffffff' : '#a0a8b8',
        fontSize: 13,
        fontWeight: 600,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        paddingBottom: 3,
        borderBottom: `2px solid ${active ? '#4d9dff' : 'transparent'}`,
      }}
    >
      {children}
    </Link>
  );
}

'use client';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { HeaderBar } from '@/app/_components/HeaderBar';
import { Sidebar } from '@/app/_components/Sidebar';
import { Footer } from '@/app/_components/Footer';
import type { TeamRef } from '@/lib/activeTeam';

// The app shell decides the chrome around every (app) page:
//   - Signed-in user WITH an active team, on a normal page → left-sidebar shell.
//   - Otherwise (signed-out, no-team, or the immersive replay viewer at /r/*) →
//     the classic sticky top header, so nothing regresses there.
// Route-aware, so it's a client component (the layout that renders it stays a
// server component and resolves the auth/team props).
export function AppShell({
  signedIn,
  hasLinkedExtension,
  active,
  teams,
  children,
}: {
  signedIn: boolean;
  hasLinkedExtension: boolean;
  active: TeamRef | null;
  teams: TeamRef[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isViewer = pathname.startsWith('/r/');
  const useSidebar = !!active && !isViewer;

  if (useSidebar && active) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', minHeight: '100vh' }}>
        {/* useSearchParams (active-link highlighting) needs a Suspense boundary;
            the fallback reserves the column width so the layout doesn't jump. */}
        <Suspense fallback={<div style={{ width: 248, flexShrink: 0 }} />}>
          <Sidebar active={active} teams={teams} hasLinkedExtension={hasLinkedExtension} />
        </Suspense>
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          <main style={{ flex: '1 1 auto' }}>{children}</main>
          <Footer />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header
        data-kb-header=""
        style={{
          position: 'sticky', top: 0, zIndex: 50,
          background: 'rgba(17, 20, 26, 0.85)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #2e333c',
        }}
      >
        <HeaderBar signedIn={signedIn} hasLinkedExtension={hasLinkedExtension} active={active} teams={teams} />
      </header>
      <div style={{ flex: '1 1 auto' }}>{children}</div>
      <Footer />
    </div>
  );
}

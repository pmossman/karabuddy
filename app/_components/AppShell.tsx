'use client';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { HeaderBar } from '@/app/_components/HeaderBar';
import { Sidebar, FULL_WIDTH, VIEWER_BAR_H } from '@/app/_components/Sidebar';
import { Footer } from '@/app/_components/Footer';
import type { TeamRef } from '@/lib/activeTeam';
import type { LastReplayRef } from '@/lib/lastReplay';

// The app shell decides the chrome around every (app) page:
//   - Signed-in user → left-sidebar shell on EVERY page (replay viewer + clips
//     included). The viewer drops the footer to stay immersive/full-bleed.
//   - Signed-out → the classic top header (public/marketing + anonymous shared-
//     replay viewing, where an app nav makes less sense).
// Route-aware, so it's a client component (the layout that renders it stays a
// server component and resolves the auth/team props).
export function AppShell({
  signedIn,
  hasLinkedExtension,
  active,
  teams,
  lastReplay,
  children,
}: {
  signedIn: boolean;
  hasLinkedExtension: boolean;
  active: TeamRef | null;
  teams: TeamRef[];
  lastReplay: LastReplayRef | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isViewer = pathname.startsWith('/r/');

  if (signedIn && isViewer) {
    // Immersive viewer: a slim in-flow top bar (home logo + menu) so nothing
    // covers the board, and the nav opens as a translucent slide-over. The
    // board reserves --kb-header-h for the bar so there's no overflow/gap.
    return (
      <div style={{ ['--kb-header-h' as string]: `${VIEWER_BAR_H}px`, display: 'flex', flexDirection: 'column', minHeight: '100vh' } as React.CSSProperties}>
        <Suspense fallback={<div style={{ height: VIEWER_BAR_H, flexShrink: 0 }} />}>
          <Sidebar active={active} teams={teams} hasLinkedExtension={hasLinkedExtension} lastReplay={lastReplay} variant="overlay" />
        </Suspense>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>{children}</div>
      </div>
    );
  }

  if (signedIn) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', minHeight: '100vh' }}>
        {/* useSearchParams (active-link highlighting) needs a Suspense boundary;
            the fallback reserves the column width so the layout doesn't jump. */}
        <Suspense fallback={<div className="kb-sb-reserve" style={{ width: FULL_WIDTH, flexShrink: 0 }} />}>
          <Sidebar active={active} teams={teams} hasLinkedExtension={hasLinkedExtension} lastReplay={lastReplay} />
        </Suspense>
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          <main style={{ flex: '1 1 auto', minWidth: 0 }}>{children}</main>
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

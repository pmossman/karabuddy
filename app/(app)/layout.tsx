import { Suspense } from 'react';
import { Header } from '@/app/_components/Header';
import { Footer } from '@/app/_components/Footer';
import { AutoClaim } from '@/app/_components/AutoClaim';
import { ExtensionSigninReturn } from '@/app/_components/ExtensionSigninReturn';
import { KaraBuddyThemeProvider } from '@/app/_components/KaraBuddyThemeProvider';

// Wraps every "regular" page (homepage, /replays, /settings, /signin,
// /claim, /privacy) with the persistent header + footer. The replay
// viewer at /r/[slug] intentionally lives outside this group so it can
// render full-bleed with its own sidebar.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <KaraBuddyThemeProvider>
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header />
      <div style={{ flex: '1 1 auto' }}>{children}</div>
      <Footer />
      {/* B54: on every authenticated page load, silently link the
          extension's install token to the user's account (if not already).
          Suppresses re-runs in the same tab via sessionStorage; idempotent
          server-side, so cross-tab re-fires are harmless. */}
      <AutoClaim />
      {/* B69: when the extension's "Sign in" popup brought the user here
          via `?fromExtension=1`, notify the opener and close the window
          once the session is established. Wrapped in Suspense because
          useSearchParams needs it during the App Router build. */}
      <Suspense fallback={null}>
        <ExtensionSigninReturn />
      </Suspense>
    </div>
    </KaraBuddyThemeProvider>
  );
}

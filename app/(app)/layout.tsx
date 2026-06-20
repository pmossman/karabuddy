import { Suspense } from 'react';
import { auth } from '@/auth';
import { userHasLinkedExtension } from '@/lib/userResolution';
import { resolveActiveTeam } from '@/lib/activeTeam';
import { getMyLastReplay } from '@/lib/lastReplay';
import { AppShell } from '@/app/_components/AppShell';
import { ActiveTeamProvider } from '@/app/_components/ActiveTeamContext';
import { AutoClaim } from '@/app/_components/AutoClaim';
import { ExtensionSigninReturn } from '@/app/_components/ExtensionSigninReturn';
import { KaraBuddyThemeProvider } from '@/app/_components/KaraBuddyThemeProvider';

// Wraps every "regular" page with the app chrome. The chrome itself is chosen
// by <AppShell> (route-aware): a signed-in member with an active team gets the
// left-sidebar shell; everyone else (signed-out, no-team) and the immersive
// replay viewer at /r/[slug] get the classic top header. We resolve the
// auth/active-team props here (server) and hand them down.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const signedIn = !!session?.user;
  const userId: string | null = session?.user?.id ?? null;
  const [hasLinkedExtension, { active, teams }, lastReplay] = await Promise.all([
    userHasLinkedExtension(userId),
    resolveActiveTeam(userId),
    userId ? getMyLastReplay(userId) : Promise.resolve(null),
  ]);

  return (
    <KaraBuddyThemeProvider>
      <ActiveTeamProvider active={active} teams={teams}>
        <AppShell signedIn={signedIn} hasLinkedExtension={hasLinkedExtension} active={active} teams={teams} lastReplay={lastReplay}>
          {children}
        </AppShell>
      </ActiveTeamProvider>
      {/* B54: silently link the extension's install token to the account. */}
      <AutoClaim />
      {/* B69: extension "Sign in" return handshake. Suspense for useSearchParams. */}
      <Suspense fallback={null}>
        <ExtensionSigninReturn />
      </Suspense>
    </KaraBuddyThemeProvider>
  );
}

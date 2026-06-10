import { auth } from '@/auth';
import { userHasLinkedExtension } from '@/lib/userResolution';
import { HeaderBar } from '@/app/_components/HeaderBar';

// Persistent header — KARA/buddy mark always links home, nav exposes
// signed-in entry points, SessionMenu is the always-on avatar/sign-out.
// Lives in the (app) route group's layout so it appears on every page
// except the immersive replay viewer at /r/[slug].
//
// Server component: resolves the session + linked-extension flag, then hands
// off to the client <HeaderBar> which owns the responsive layout (centered
// inline nav on desktop, hamburger below the breakpoint — B121-followup).
export async function Header() {
  const session = await auth();
  const signedIn = !!session?.user;

  // B121-followup: a signed-in user who already has ≥1 linked extension has
  // obviously onboarded — suppress the install CTA, regardless of the per-browser
  // bridge probe (which doesn't run on the :3001 dev origin and can race the
  // extension's document_idle injection on prod).
  const hasLinkedExtension = await userHasLinkedExtension((session?.user as any)?.id ?? null);

  return (
    <header
      data-kb-header=""
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'rgba(17, 20, 26, 0.85)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid #2e333c',
      }}
    >
      <HeaderBar signedIn={signedIn} hasLinkedExtension={hasLinkedExtension} />
    </header>
  );
}

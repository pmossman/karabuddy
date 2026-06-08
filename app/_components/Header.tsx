import Link from 'next/link';
import { auth } from '@/auth';
import { SessionMenu } from '@/app/_components/SessionMenu';
import { NavLink } from '@/app/_components/NavLink';

// Persistent header — KARA/buddy mark always links home, nav exposes
// signed-in entry points, SessionMenu is the always-on avatar/sign-out.
// Lives in the (app) route group's layout so it appears on every page
// except the immersive replay viewer at /r/[slug].
export async function Header() {
  const session = await auth();
  const signedIn = !!session?.user;
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
      <div
        style={{
          // 3-column grid (1fr auto 1fr) keeps the primary nav centered
          // regardless of the logo / avatar widths on either side.
          padding: '12px 28px',
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <Link
          href="/"
          style={{
            textDecoration: 'none',
            color: 'inherit',
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 6,
            lineHeight: 1,
            userSelect: 'none',
            justifySelf: 'start',
          }}
        >
          <span
            style={{
              // KARA stays Barlow — deliberately matches the "KARABAST"
              // wordmark so the connection to karabast.net is clear. Only
              // "BUDDY" carries the HUD treatment.
              fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
              fontWeight: 400,
              fontSize: 22,
              letterSpacing: 0,
              textTransform: 'uppercase',
              color: '#e6e6e6',
            }}
          >
            KARA
          </span>
          <span
            style={{
              // Squared "space-HUD" display face (Orbitron) — angular and
              // geometric, the Star-Wars-esque readout look.
              fontFamily: 'var(--font-logo), var(--font-barlow), sans-serif',
              fontWeight: 700,
              fontSize: 15,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              // Electric cyan→azure gradient — ties the mark to the two accents
              // (signal cyan + primary blue) the rest of the UI uses.
              background: 'linear-gradient(90deg, #4dd2ff 0%, #4d9dff 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              WebkitTextFillColor: 'transparent',
            }}
          >
            buddy
          </span>
        </Link>
        {/* Centered primary nav: Replays / Stats / Teams. */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 24, justifySelf: 'center' }}>
          {signedIn && <NavLink href="/replays">Replays</NavLink>}
          <NavLink href="/stats">Stats</NavLink>
          {signedIn && <NavLink href="/teams">Teams</NavLink>}
        </nav>
        {/* Right cluster: Mentions inbox + the always-on avatar menu (Settings /
            Sign out). Kept off the primary nav so the three centered items stay clean. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, justifySelf: 'end' }}>
          {signedIn && <NavLink href="/mentions">Mentions</NavLink>}
          <SessionMenu compact />
        </div>
      </div>
    </header>
  );
}

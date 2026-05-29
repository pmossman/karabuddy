import Link from 'next/link';
import { auth } from '@/auth';
import { SessionMenu } from '@/app/_components/SessionMenu';

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
          padding: '12px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
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
          }}
        >
          <span
            style={{
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
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontStyle: 'italic',
              fontWeight: 600,
              fontSize: 19,
              letterSpacing: '-0.01em',
              color: '#5a8cff',
            }}
          >
            buddy
          </span>
        </Link>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <NavLink href="/replays?tab=public">Browse</NavLink>
          {signedIn && <NavLink href="/replays?tab=mine">My replays</NavLink>}
          {signedIn && <NavLink href="/teams">Teams</NavLink>}
          {signedIn && <NavLink href="/mentions">Mentions</NavLink>}
          {signedIn && <NavLink href="/settings">Settings</NavLink>}
          <SessionMenu compact />
        </nav>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{ color: '#a0a8b8', fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
    >
      {children}
    </Link>
  );
}

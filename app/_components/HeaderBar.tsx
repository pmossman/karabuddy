'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavLink } from '@/app/_components/NavLink';
import { SessionMenu } from '@/app/_components/SessionMenu';
import { InstallExtensionCta } from '@/app/_components/InstallExtensionCta';

// Top header bar for SIGNED-OUT visitors (public/marketing + anonymous shared-
// replay viewing). Signed-in users get the left-sidebar AppShell instead, so
// this bar only ever carries the GLOBAL discovery nav (Replays/Clips/Stats/
// Teams) — never team/personal surfaces. Wide viewports show the inline nav;
// below the breakpoint it collapses behind a hamburger.
const BREAKPOINT = 720; // px — below this the inline nav is hidden, hamburger shown

export function HeaderBar({ hasLinkedExtension }: { hasLinkedExtension: boolean }) {
  const [open, setOpen] = useState(false);
  // Ref spans BOTH the hamburger button and its dropdown so a click on the
  // toggle counts as "inside" — otherwise the outside-click handler closes the
  // menu and the button's onClick immediately reopens it (flicker).
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close the menu on navigation (the header persists across client nav).
  useEffect(() => { setOpen(false); }, [pathname]);

  // Dismiss on outside-click / Escape (mirrors SessionMenu).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const showInstall = !hasLinkedExtension;

  return (
    <div
      style={{
        // flex space-between keeps the logo hard-left and the cluster hard-right;
        // the centered nav is absolutely centered so it never shifts the cluster.
        position: 'relative',
        padding: '12px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}
    >
      {/* Inline styles can't express breakpoints, so drive the desktop/mobile
          swap from classes (matches the replay viewer's <style> pattern). */}
      <style>{`
        .kb-desktop-nav, .kb-desktop-cluster { display: flex; }
        .kb-hamburger { display: none; }
        @media (max-width: ${BREAKPOINT}px) {
          .kb-desktop-nav, .kb-desktop-cluster { display: none !important; }
          .kb-hamburger { display: inline-flex !important; }
        }
      `}</style>

      {/* Left: brand mark. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <Link
          href="/"
          prefetch={false}
          style={{
            textDecoration: 'none', color: 'inherit', display: 'inline-flex',
            alignItems: 'baseline', gap: 6, lineHeight: 1, userSelect: 'none',
          }}
        >
          <span style={{ fontFamily: 'var(--font-barlow), -apple-system, sans-serif', fontWeight: 400, fontSize: 22, letterSpacing: 0, textTransform: 'uppercase', color: '#e6e6e6' }}>
            KARA
          </span>
          <span
            style={{
              fontFamily: 'var(--font-logo), var(--font-barlow), sans-serif', fontWeight: 700, fontSize: 15,
              textTransform: 'uppercase', letterSpacing: '0.1em',
              background: 'linear-gradient(90deg, #4dd2ff 0%, #4d9dff 100%)',
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
            }}
          >
            buddy
          </span>
        </Link>
      </div>

      {/* Centered global discovery nav — desktop only, taken out of flow so it's
          centered on the bar regardless of the logo / cluster widths. */}
      <nav
        className="kb-desktop-nav"
        style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          alignItems: 'center', gap: 24,
        }}
      >
        <NavLink href="/replays">Replays</NavLink>
        <NavLink href="/clips">Clips</NavLink>
        <NavLink href="/stats">Stats</NavLink>
        <NavLink href="/teams">Teams</NavLink>
      </nav>

      {/* Right cluster: install CTA + avatar; secondary bits collapse into the
          hamburger on mobile. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="kb-desktop-cluster" style={{ alignItems: 'center', gap: 14 }}>
          {showInstall && <InstallExtensionCta variant="header" />}
        </span>
        <SessionMenu compact />

        {/* Hamburger + its dropdown share one ref'd, relatively-positioned wrapper
            so clicking the toggle isn't treated as an outside-click. */}
        <div ref={menuRef} className="kb-hamburger" style={{ position: 'relative' }}>
          <button
            type="button"
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
              background: open ? 'rgba(77,157,255,0.12)' : 'transparent',
              border: `1px solid ${open ? '#4d9dff' : '#2e333c'}`, borderRadius: 8,
              color: '#e6e6e6', cursor: 'pointer', padding: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? (
                <>
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>

          {open && (
            <div
              role="menu"
              style={{
                position: 'absolute', top: 'calc(100% + 10px)', right: 0, minWidth: 220,
                background: '#11141a', border: '1px solid #2e333c', borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: 8, zIndex: 60,
                display: 'flex', flexDirection: 'column', gap: 4,
              }}
            >
              <MenuLink href="/replays">Replays</MenuLink>
              <MenuLink href="/clips">Clips</MenuLink>
              <MenuLink href="/stats">Stats</MenuLink>
              <MenuLink href="/teams">Teams</MenuLink>
              {showInstall && (
                <div style={{ paddingTop: 4, marginTop: 4, borderTop: '1px solid #2e333c' }}>
                  <InstallExtensionCta variant="header" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Larger, full-width tap targets for the dropdown (the inline NavLink underline
// treatment reads oddly stacked).
function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      prefetch={false}
      role="menuitem"
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'block', padding: '9px 12px', borderRadius: 6,
        fontSize: 14, fontWeight: 600, textDecoration: 'none',
        color: active ? '#ffffff' : '#d6d6d6',
        background: active ? 'rgba(77,157,255,0.12)' : 'transparent',
      }}
    >
      {children}
    </Link>
  );
}

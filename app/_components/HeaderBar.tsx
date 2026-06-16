'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { NavLink } from '@/app/_components/NavLink';
import { SessionMenu } from '@/app/_components/SessionMenu';
import { TeamSwitcher } from '@/app/_components/TeamSwitcher';
import { YouMenu, YOU_ITEMS } from '@/app/_components/YouMenu';
import { InstallExtensionCta } from '@/app/_components/InstallExtensionCta';
import type { TeamRef } from '@/lib/activeTeam';

// Responsive header bar. Wide viewports get the team switcher hard-left, the
// active-team nav centered, and the right cluster (You menu + avatar); below
// the breakpoint everything collapses behind a hamburger.
//
// Team-centric revamp: the CENTER nav is the active team's surfaces (when a
// team is active); the PERSONAL surfaces live in the always-present "You" menu.
// Scope is carried by the links, so the underlying pages mostly don't read the
// cookie. Signed-out / no-team users keep the global discovery nav.
const BREAKPOINT = 720; // px — below this the inline nav is hidden, hamburger shown

export function HeaderBar({
  signedIn,
  hasLinkedExtension,
  active,
  teams,
}: {
  signedIn: boolean;
  hasLinkedExtension: boolean;
  active: TeamRef | null;
  teams: TeamRef[];
}) {
  const [open, setOpen] = useState(false);
  // Ref spans BOTH the hamburger button and its dropdown so a click on the
  // toggle counts as "inside" — otherwise the outside-click handler closes the
  // menu and the button's onClick immediately reopens it (flicker).
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

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

  // Active-team center nav. Tab links share /teams/<slug> with Dashboard, so
  // only Dashboard highlights cleanly off the pathname — good enough for now.
  const teamNav = active
    ? [
        { href: `/teams/${active.slug}`, label: 'Dashboard' },
        { href: `/teams/${active.slug}?tab=replays`, label: 'Replays' },
        { href: `/teams/${active.slug}?tab=review`, label: 'Reviews' },
        { href: `/teams/${active.slug}?tab=tournaments`, label: 'Tournaments' },
        { href: `/stats?scope=team&team=${active.slug}`, label: 'Stats' },
      ]
    : [];

  async function switchTeam(slug: string) {
    setOpen(false);
    if (slug !== active?.slug) {
      await fetch('/api/me/active-team', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      }).catch(() => {});
    }
    router.push(`/teams/${slug}`);
    router.refresh();
  }

  return (
    <div
      style={{
        // flex space-between guarantees the logo sits hard-left and the cluster
        // hard-right; the centered nav is taken out of flow (absolutely centered)
        // so it never shifts the cluster off the right edge.
        position: 'relative',
        padding: '12px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}
    >
      {/* Media-query rules: inline styles can't express breakpoints, so drive the
          desktop/mobile swap from classes (matches the <style> pattern used in the
          replay viewer). */}
      <style>{`
        .kb-desktop-nav, .kb-desktop-cluster, .kb-desktop-switcher { display: flex; }
        .kb-hamburger { display: none; }
        @media (max-width: ${BREAKPOINT}px) {
          .kb-desktop-nav, .kb-desktop-cluster, .kb-desktop-switcher { display: none !important; }
          .kb-hamburger { display: inline-flex !important; }
        }
      `}</style>

      {/* Left: brand mark + (when a team is active) the team switcher. */}
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
        {active && (
          <span className="kb-desktop-switcher">
            <TeamSwitcher active={active} teams={teams} />
          </span>
        )}
      </div>

      {/* Centered primary nav — desktop only, taken out of flow so it's centered
          on the bar regardless of the logo / cluster widths. When a team is
          active it's the team surfaces; otherwise the global discovery nav. */}
      <nav
        className="kb-desktop-nav"
        style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          alignItems: 'center', gap: 24,
        }}
      >
        {active ? (
          teamNav.map((t) => (
            <TeamNavLink key={t.label} href={t.href} active={pathname === `/teams/${active.slug}` && t.label === 'Dashboard'}>
              {t.label}
            </TeamNavLink>
          ))
        ) : (
          <>
            {/* Shown to everyone with no active team (signed-out + no-team users):
                public replay/clip discovery, the teams pitch, global stats. */}
            <NavLink href="/replays">Replays</NavLink>
            <NavLink href="/clips">Clips</NavLink>
            <NavLink href="/stats">Stats</NavLink>
            <NavLink href="/teams">Teams</NavLink>
          </>
        )}
      </nav>

      {/* Right cluster. The avatar is always visible; the You menu rides beside
          it for signed-in users; secondary bits collapse into the hamburger on
          mobile. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="kb-desktop-cluster" style={{ alignItems: 'center', gap: 14 }}>
          {showInstall && <InstallExtensionCta variant="header" />}
          {signedIn && <YouMenu />}
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
              {active ? (
                <>
                  {/* Team switch list */}
                  <MenuSection>Team</MenuSection>
                  {teams.map((t) => (
                    <button
                      key={t.slug}
                      type="button"
                      role="menuitemradio"
                      aria-checked={t.slug === active.slug}
                      onClick={() => switchTeam(t.slug)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                        boxSizing: 'border-box', padding: '9px 12px', borderRadius: 6, cursor: 'pointer',
                        fontSize: 14, fontWeight: 600, fontFamily: 'inherit', border: 0,
                        color: t.slug === active.slug ? '#ffffff' : '#d6d6d6',
                        background: t.slug === active.slug ? 'rgba(77,157,255,0.12)' : 'transparent',
                      }}
                    >
                      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: t.slug === active.slug ? '#4dd2ff' : '#3a3f48' }} />
                      {t.name}
                    </button>
                  ))}
                  <MenuLink href="/teams">Create or join a team →</MenuLink>

                  {/* Active-team nav */}
                  <Divider />
                  {teamNav.map((t) => (
                    <MenuLink key={t.label} href={t.href}>{t.label}</MenuLink>
                  ))}

                  {/* Personal (You) */}
                  <Divider />
                  <MenuSection>You</MenuSection>
                  {YOU_ITEMS.map((it) => (
                    <MenuLink key={it.href} href={it.href}>{it.label}</MenuLink>
                  ))}
                </>
              ) : (
                <>
                  <MenuLink href="/replays">Replays</MenuLink>
                  <MenuLink href="/clips">Clips</MenuLink>
                  <MenuLink href="/stats">Stats</MenuLink>
                  <MenuLink href="/teams">Teams</MenuLink>
                  {signedIn && (
                    <>
                      <Divider />
                      <MenuSection>You</MenuSection>
                      {YOU_ITEMS.map((it) => (
                        <MenuLink key={it.href} href={it.href}>{it.label}</MenuLink>
                      ))}
                    </>
                  )}
                </>
              )}
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

// Centered team-nav item. Like NavLink but the caller computes `active` (tab
// links share a pathname, so it can't be derived from usePathname alone).
function TeamNavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
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

function Divider() {
  return <div style={{ borderTop: '1px solid #2e333c', margin: '4px 0' }} />;
}

function MenuSection({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '4px 12px 2px', fontSize: 10, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
      {children}
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

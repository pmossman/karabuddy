'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { InstallExtensionCta } from '@/app/_components/InstallExtensionCta';
import type { TeamRef } from '@/lib/activeTeam';

// Left-nav app shell for signed-in users with an active team. Holds the team
// switcher, the active team's surfaces (TEAM group), the ambient personal
// surfaces (YOU group), and an account footer. On desktop it's a fixed column;
// below the breakpoint it collapses into a slim top bar + slide-in drawer.
//
// Scope is carried by the links, so the underlying pages mostly don't read the
// active-team cookie — switching teams is the only write (POST /api/me/active-team).
const BREAKPOINT = 860; // px — below this the column becomes a top bar + drawer
const WIDTH = 248;

interface NavItem {
  href: string;
  label: string;
  active: boolean;
}

export function Sidebar({
  active,
  teams,
  hasLinkedExtension,
}: {
  active: TeamRef;
  teams: TeamRef[];
  hasLinkedExtension: boolean;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer on navigation.
  useEffect(() => { setDrawerOpen(false); }, [pathname, sp]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const onTeam = pathname === `/teams/${active.slug}`;
  const tab = sp.get('tab');
  const scope = sp.get('scope');

  const teamItems: NavItem[] = [
    { href: `/teams/${active.slug}`, label: 'Dashboard', active: onTeam && (!tab || tab === 'overview') },
    { href: `/teams/${active.slug}?tab=replays`, label: 'Replays', active: onTeam && tab === 'replays' },
    { href: `/teams/${active.slug}?tab=review`, label: 'Reviews', active: onTeam && tab === 'review' },
    { href: `/teams/${active.slug}?tab=tournaments`, label: 'Tournaments', active: onTeam && tab === 'tournaments' },
    { href: `/teams/${active.slug}?tab=members`, label: 'Members', active: onTeam && tab === 'members' },
    { href: `/teams/${active.slug}?tab=settings`, label: 'Team settings', active: onTeam && tab === 'settings' },
  ];

  const youItems: NavItem[] = [
    { href: '/replays?tab=mine', label: 'My replays', active: pathname === '/replays' && tab === 'mine' },
    { href: '/stats?scope=personal', label: 'My stats', active: pathname === '/stats' && scope !== 'team' },
    { href: '/clips', label: 'My clips', active: pathname === '/clips' || pathname.startsWith('/clips/') },
    { href: '/mentions', label: 'Mentions', active: pathname.startsWith('/mentions') },
  ];

  const nav = (
    <SidebarBody
      active={active}
      teams={teams}
      teamItems={teamItems}
      youItems={youItems}
      hasLinkedExtension={hasLinkedExtension}
    />
  );

  return (
    <>
      <style>{`
        .kb-sb-desktop { display: flex; }
        .kb-sb-mobilebar { display: none; }
        @media (max-width: ${BREAKPOINT}px) {
          .kb-sb-desktop { display: none !important; }
          .kb-sb-mobilebar { display: flex !important; }
        }
      `}</style>

      {/* Desktop: fixed-width sticky column. */}
      <aside
        className="kb-sb-desktop"
        style={{
          flexDirection: 'column', width: WIDTH, flexShrink: 0,
          position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
          background: 'rgba(13, 16, 22, 0.92)', borderRight: '1px solid #21262f',
        }}
      >
        {nav}
      </aside>

      {/* Mobile: slim top bar + slide-in drawer. */}
      <div
        className="kb-sb-mobilebar"
        style={{
          position: 'sticky', top: 0, zIndex: 50, alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '10px 16px', background: 'rgba(13,16,22,0.95)', backdropFilter: 'blur(10px)',
          borderBottom: '1px solid #21262f',
        }}
      >
        <button
          type="button"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34,
            background: 'transparent', border: '1px solid #2e333c', borderRadius: 8, color: '#e6e6e6', cursor: 'pointer', padding: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Logo slug={active.slug} />
        <AccountAvatar />
      </div>

      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.55)', display: 'flex' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="menu"
            style={{
              width: WIDTH, maxWidth: '82vw', height: '100%', overflowY: 'auto',
              background: '#0d1016', borderRight: '1px solid #21262f', animation: 'kb-slide-in 0.16s ease-out',
            }}
          >
            <style>{`@keyframes kb-slide-in { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
            {nav}
          </div>
        </div>
      )}
    </>
  );
}

function SidebarBody({
  active,
  teams,
  teamItems,
  youItems,
  hasLinkedExtension,
}: {
  active: TeamRef;
  teams: TeamRef[];
  teamItems: NavItem[];
  youItems: NavItem[];
  hasLinkedExtension: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', padding: '14px 12px' }}>
      <div style={{ padding: '4px 8px 10px' }}>
        <Logo slug={active.slug} />
      </div>

      <div style={{ padding: '0 4px 10px' }}>
        <TeamSwitcherInline active={active} teams={teams} />
      </div>

      <NavGroup label="Team">
        {teamItems.map((it) => <NavRow key={it.label} item={it} />)}
      </NavGroup>

      <div style={{ height: 1, background: '#21262f', margin: '10px 8px' }} />

      <NavGroup label="You">
        {youItems.map((it) => <NavRow key={it.label} item={it} />)}
      </NavGroup>

      <div style={{ flex: '1 1 auto' }} />

      {!hasLinkedExtension && (
        <div style={{ padding: '10px 8px' }}>
          <InstallExtensionCta variant="header" />
        </div>
      )}

      <div style={{ height: 1, background: '#21262f', margin: '6px 8px' }} />
      <AccountFooter />
    </div>
  );
}

function Logo({ slug }: { slug: string }) {
  return (
    <Link
      href={`/teams/${slug}`}
      prefetch={false}
      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'baseline', gap: 6, lineHeight: 1, userSelect: 'none' }}
    >
      <span style={{ fontFamily: 'var(--font-barlow), -apple-system, sans-serif', fontWeight: 400, fontSize: 20, textTransform: 'uppercase', color: '#e6e6e6' }}>KARA</span>
      <span
        style={{
          fontFamily: 'var(--font-logo), var(--font-barlow), sans-serif', fontWeight: 700, fontSize: 14,
          textTransform: 'uppercase', letterSpacing: '0.1em',
          background: 'linear-gradient(90deg, #4dd2ff 0%, #4d9dff 100%)',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
        }}
      >buddy</span>
    </Link>
  );
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ padding: '6px 12px 4px', fontSize: 10, color: '#5b6472', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</div>
    </div>
  );
}

function NavRow({ item }: { item: NavItem }) {
  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={item.active ? 'page' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderRadius: 7,
        fontSize: 13.5, fontWeight: 600, textDecoration: 'none', position: 'relative',
        color: item.active ? '#ffffff' : '#aab1bf',
        background: item.active ? 'rgba(77,210,255,0.10)' : 'transparent',
        boxShadow: item.active ? 'inset 2px 0 0 #4dd2ff' : 'none',
      }}
    >
      <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: item.active ? '#4dd2ff' : '#3a414c', boxShadow: item.active ? '0 0 6px #4dd2ff' : 'none' }} />
      {item.label}
    </Link>
  );
}

// Full-width team switcher for the sidebar top (same persistence behavior as the
// header switcher — POST /api/me/active-team then route to the dashboard).
function TeamSwitcherInline({ active, teams }: { active: TeamRef; teams: TeamRef[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function pick(slug: string) {
    setOpen(false);
    if (slug !== active.slug) {
      await fetch('/api/me/active-team', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug }) }).catch(() => {});
    }
    router.push(`/teams/${slug}`);
    router.refresh();
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch team"
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer',
          padding: '8px 10px', borderRadius: 8, font: 'inherit', color: '#e6e6e6',
          background: open ? 'rgba(77,157,255,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${open ? '#4d9dff' : '#2a303a'}`,
        }}
      >
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: '#4dd2ff', boxShadow: '0 0 6px #4dd2ff' }} />
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active.name}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.6, flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)', zIndex: 80,
            background: '#11141a', border: '1px solid #2e333c', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          {teams.map((t) => {
            const isActive = t.slug === active.slug;
            return (
              <button
                key={t.slug}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => pick(t.slug)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', boxSizing: 'border-box',
                  padding: '8px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', border: 0,
                  color: isActive ? '#ffffff' : '#d6d6d6', background: isActive ? 'rgba(77,157,255,0.12)' : 'transparent',
                }}
              >
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: isActive ? '#4dd2ff' : '#3a3f48', boxShadow: isActive ? '0 0 6px #4dd2ff' : 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              </button>
            );
          })}
          <div style={{ borderTop: '1px solid #2e333c', marginTop: 4, paddingTop: 4 }}>
            <Link href="/teams" role="menuitem" prefetch={false} onClick={() => setOpen(false)} style={{ display: 'block', padding: '8px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#5db4ff', textDecoration: 'none' }}>
              Create or join a team →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountAvatar() {
  const { data: session } = useSession();
  const u = session?.user;
  if (!u) return <div style={{ width: 30 }} />;
  const label = u.name || u.email || '';
  const initials = label.replace(/@.*/, '').trim().slice(0, 2).toUpperCase() || '?';
  return (
    <div title={label} style={{ width: 30, height: 30, borderRadius: '50%', overflow: 'hidden', background: u.image ? 'transparent' : '#2e333c', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {u.image
        ? <img src={u.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontSize: 11, fontWeight: 700, color: '#d6d6d6' }}>{initials}</span>}
    </div>
  );
}

function AccountFooter() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const u = session?.user;
  if (!u) return null;
  const label = u.name || u.email || '';
  const initials = label.replace(/@.*/, '').trim().slice(0, 2).toUpperCase() || '?';
  const item: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13, color: '#d6d6d6', textDecoration: 'none', borderRadius: 6, background: 'transparent', border: 0, cursor: 'pointer', fontFamily: 'inherit' };

  return (
    <div ref={ref} style={{ position: 'relative', padding: '4px 4px 0' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', cursor: 'pointer',
          padding: '8px 8px', borderRadius: 8, font: 'inherit', color: '#e6e6e6',
          background: open ? 'rgba(77,157,255,0.10)' : 'transparent', border: '1px solid transparent',
        }}
      >
        <span style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: u.image ? 'transparent' : '#2e333c', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {u.image
            ? <img src={u.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: 11, fontWeight: 700, color: '#d6d6d6' }}>{initials}</span>}
        </span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.6, flexShrink: 0 }}>
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', left: 4, right: 4, bottom: 'calc(100% + 6px)', background: '#11141a', border: '1px solid #2e333c', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: 6, zIndex: 80 }}>
          <a href="/settings" role="menuitem" style={item} onClick={() => setOpen(false)}>Settings</a>
          <button type="button" role="menuitem" style={item} onClick={() => signOut({ callbackUrl: window.location.href })}>Sign out</button>
        </div>
      )}
    </div>
  );
}

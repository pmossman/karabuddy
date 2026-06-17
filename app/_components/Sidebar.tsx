'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { InstallExtensionCta } from '@/app/_components/InstallExtensionCta';
import type { TeamRef } from '@/lib/activeTeam';

// Left-nav app shell for signed-in users. Holds the team switcher, the active
// team's surfaces (TEAM group), the ambient personal surfaces (YOU group), and
// an account footer. Three presentations:
//   - desktop FULL  (labels)            — width FULL_WIDTH
//   - desktop RAIL  (icons only)        — width RAIL_WIDTH, collapse toggle
//   - mobile        (slim bar + drawer; the drawer is always the full body)
// Collapse is persisted in the kb_nav cookie (read server-side, so no flash).
export const FULL_WIDTH = 248;
export const RAIL_WIDTH = 92;
const MOBILE_BP = 860; // px — below this the column becomes a top bar + drawer

type IconName =
  | 'dashboard' | 'replays' | 'reviews' | 'tournaments' | 'members' | 'settings'
  | 'stats' | 'clips' | 'mentions' | 'addTeam';

interface NavItem { href: string; label: string; icon: IconName; active: boolean }

function setNavCookie(rail: boolean) {
  document.cookie = `kb_nav=${rail ? 'rail' : 'full'}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function Sidebar({
  active,
  teams,
  hasLinkedExtension,
  collapsed: collapsedProp,
  lockCollapsed = false,
}: {
  active: TeamRef | null;
  teams: TeamRef[];
  hasLinkedExtension: boolean;
  collapsed: boolean;
  lockCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(collapsedProp);

  // The viewer locks the rail; everywhere else honors the cookie/prop.
  const isRail = lockCollapsed || collapsed;

  useEffect(() => { setDrawerOpen(false); }, [pathname, sp]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  function toggleCollapsed() {
    setCollapsed((v) => { const next = !v; setNavCookie(next); return next; });
  }

  const onTeam = active ? pathname === `/teams/${active.slug}` : false;
  const tab = sp.get('tab');
  const scope = sp.get('scope');

  const teamItems: NavItem[] = active ? [
    { href: `/teams/${active.slug}`, label: 'Dashboard', icon: 'dashboard', active: onTeam && (!tab || tab === 'overview') },
    { href: `/teams/${active.slug}?tab=replays`, label: 'Replays', icon: 'replays', active: onTeam && tab === 'replays' },
    { href: `/teams/${active.slug}?tab=review`, label: 'Reviews', icon: 'reviews', active: onTeam && tab === 'review' },
    { href: `/teams/${active.slug}?tab=tournaments`, label: 'Tournaments', icon: 'tournaments', active: onTeam && tab === 'tournaments' },
    { href: `/teams/${active.slug}?tab=members`, label: 'Members', icon: 'members', active: onTeam && tab === 'members' },
    { href: `/teams/${active.slug}?tab=settings`, label: 'Team settings', icon: 'settings', active: onTeam && tab === 'settings' },
  ] : [];

  const youItems: NavItem[] = [
    { href: '/replays?tab=mine', label: 'My replays', icon: 'replays', active: pathname === '/replays' && tab === 'mine' },
    { href: '/stats?scope=personal', label: 'My stats', icon: 'stats', active: pathname === '/stats' && scope !== 'team' },
    { href: '/clips', label: 'My clips', icon: 'clips', active: pathname === '/clips' || pathname.startsWith('/clips/') },
    { href: '/mentions', label: 'Mentions', icon: 'mentions', active: pathname.startsWith('/mentions') },
  ];

  const body = (railMode: boolean) => (
    <SidebarBody
      active={active}
      teams={teams}
      teamItems={teamItems}
      youItems={youItems}
      hasLinkedExtension={hasLinkedExtension}
      collapsed={railMode}
      lockCollapsed={lockCollapsed}
      onToggle={toggleCollapsed}
    />
  );

  return (
    <>
      <style>{`
        .kb-sb-desktop { display: flex; }
        .kb-sb-mobilebar { display: none; }
        @media (max-width: ${MOBILE_BP}px) {
          .kb-sb-desktop, .kb-sb-reserve { display: none !important; }
          .kb-sb-mobilebar { display: flex !important; }
        }
      `}</style>

      {/* Desktop: fixed-width sticky column (full or rail). */}
      <aside
        className="kb-sb-desktop"
        style={{
          flexDirection: 'column', width: isRail ? RAIL_WIDTH : FULL_WIDTH, flexShrink: 0,
          position: 'sticky', top: 0, height: '100vh', overflowY: 'auto', overflowX: 'hidden',
          background: 'rgba(13, 16, 22, 0.92)', borderRight: '1px solid #21262f',
          transition: 'width 0.14s ease',
        }}
      >
        {body(isRail)}
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
        <Logo slug={active?.slug ?? null} mark={false} />
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
              width: FULL_WIDTH, maxWidth: '82vw', height: '100%', overflowY: 'auto',
              background: '#0d1016', borderRight: '1px solid #21262f', animation: 'kb-slide-in 0.16s ease-out',
            }}
          >
            <style>{`@keyframes kb-slide-in { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
            {/* Drawer is always the full body — collapse is a desktop concept. */}
            {body(false)}
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
  collapsed,
  lockCollapsed,
  onToggle,
}: {
  active: TeamRef | null;
  teams: TeamRef[];
  teamItems: NavItem[];
  youItems: NavItem[];
  hasLinkedExtension: boolean;
  collapsed: boolean;
  lockCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', padding: collapsed ? '14px 8px' : '14px 12px' }}>
      <div style={{ padding: collapsed ? '4px 0 10px' : '4px 8px 10px', display: 'flex', justifyContent: 'center' }}>
        <Logo slug={active?.slug ?? null} mark={collapsed} />
      </div>

      <div style={{ padding: collapsed ? '0 0 10px' : '0 4px 10px' }}>
        {active
          ? <TeamSwitcherInline active={active} teams={teams} collapsed={collapsed} />
          : <CreateTeamButton collapsed={collapsed} />}
      </div>

      {teamItems.length > 0 && (
        <>
          <NavGroup label="Team" collapsed={collapsed}>
            {teamItems.map((it) => <NavRow key={it.label} item={it} collapsed={collapsed} />)}
          </NavGroup>
          <div style={{ height: 1, background: '#21262f', margin: collapsed ? '10px 6px' : '10px 8px' }} />
        </>
      )}

      <NavGroup label="You" collapsed={collapsed}>
        {youItems.map((it) => <NavRow key={it.label} item={it} collapsed={collapsed} />)}
      </NavGroup>

      <div style={{ flex: '1 1 auto' }} />

      {!hasLinkedExtension && !collapsed && (
        <div style={{ padding: '10px 8px' }}>
          <InstallExtensionCta variant="header" />
        </div>
      )}

      {/* Collapse toggle — hidden on the viewer (rail is locked) and on mobile. */}
      {!lockCollapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            display: 'flex', alignItems: 'center',
            flexDirection: collapsed ? 'column' : 'row', gap: collapsed ? 3 : 9,
            margin: collapsed ? '4px 0' : '4px 4px',
            padding: collapsed ? '8px 2px' : '8px 10px', justifyContent: collapsed ? 'center' : 'flex-start',
            borderRadius: 8, cursor: 'pointer', font: 'inherit', fontWeight: 600,
            fontSize: collapsed ? 9.5 : 12.5, color: '#8a93a3', background: 'transparent', border: '1px solid transparent',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            {collapsed
              ? <polyline points="9 18 15 12 9 6" />
              : <polyline points="15 18 9 12 15 6" />}
          </svg>
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      )}

      <div style={{ height: 1, background: '#21262f', margin: collapsed ? '6px 6px' : '6px 8px' }} />
      <AccountFooter collapsed={collapsed} />
    </div>
  );
}

function Logo({ slug, mark }: { slug: string | null; mark: boolean }) {
  const href = slug ? `/teams/${slug}` : '/';
  if (mark) {
    // Rail: KARA stacked over buddy.
    return (
      <Link href={href} prefetch={false} aria-label="KaraBuddy" title="KaraBuddy" style={{ textDecoration: 'none', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, gap: 1 }}>
        <span style={{ fontFamily: 'var(--font-barlow), -apple-system, sans-serif', fontWeight: 400, fontSize: 14, textTransform: 'uppercase', color: '#e6e6e6' }}>KARA</span>
        <span style={{ fontFamily: 'var(--font-logo), var(--font-barlow), sans-serif', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'linear-gradient(90deg, #4dd2ff 0%, #4d9dff 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' }}>buddy</span>
      </Link>
    );
  }
  return (
    <Link href={href} prefetch={false} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'baseline', gap: 6, lineHeight: 1, userSelect: 'none' }}>
      <span style={{ fontFamily: 'var(--font-barlow), -apple-system, sans-serif', fontWeight: 400, fontSize: 20, textTransform: 'uppercase', color: '#e6e6e6' }}>KARA</span>
      <span style={{ fontFamily: 'var(--font-logo), var(--font-barlow), sans-serif', fontWeight: 700, fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.1em', background: 'linear-gradient(90deg, #4dd2ff 0%, #4d9dff 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' }}>buddy</span>
    </Link>
  );
}

function NavGroup({ label, collapsed, children }: { label: string; collapsed: boolean; children: React.ReactNode }) {
  return (
    <div>
      {!collapsed && (
        <div style={{ padding: '6px 12px 4px', fontSize: 10, color: '#5b6472', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
          {label}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</div>
    </div>
  );
}

function NavRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  if (collapsed) {
    // Rail: icon with a small label beneath it.
    return (
      <Link
        href={item.href}
        prefetch={false}
        aria-current={item.active ? 'page' : undefined}
        title={item.label}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          padding: '8px 2px', borderRadius: 8, textDecoration: 'none', textAlign: 'center',
          color: item.active ? '#ffffff' : '#aab1bf',
          background: item.active ? 'rgba(77,210,255,0.10)' : 'transparent',
        }}
      >
        <Icon name={item.icon} active={item.active} />
        <span style={{ fontSize: 9.5, fontWeight: 600, lineHeight: 1.15, letterSpacing: '0.01em', color: item.active ? '#dff4ff' : '#8a93a3' }}>{item.label}</span>
      </Link>
    );
  }
  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={item.active ? 'page' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-start',
        padding: '8px 12px', borderRadius: 8, position: 'relative',
        fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
        color: item.active ? '#ffffff' : '#aab1bf',
        background: item.active ? 'rgba(77,210,255,0.10)' : 'transparent',
        boxShadow: item.active ? 'inset 2px 0 0 #4dd2ff' : 'none',
      }}
    >
      <Icon name={item.icon} active={item.active} />
      {item.label}
    </Link>
  );
}

function CreateTeamButton({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      href="/teams"
      prefetch={false}
      title={collapsed ? 'Create or join a team' : undefined}
      style={{
        display: 'flex', alignItems: 'center',
        flexDirection: collapsed ? 'column' : 'row', gap: collapsed ? 4 : 9,
        justifyContent: 'center', textAlign: 'center',
        padding: collapsed ? '8px 2px' : '8px 10px', borderRadius: 8, textDecoration: 'none',
        fontSize: collapsed ? 9.5 : 13, fontWeight: 600, color: '#5db4ff',
        background: 'rgba(77,157,255,0.08)', border: '1px solid rgba(77,157,255,0.25)',
      }}
    >
      <Icon name="addTeam" active={false} />
      {collapsed ? 'New team' : 'Create or join a team'}
    </Link>
  );
}

// Team switcher. Full: a labeled pill. Rail: a square team-initial button. Both
// open the same dropdown (POST /api/me/active-team then route to the dashboard).
function TeamSwitcherInline({ active, teams, collapsed }: { active: TeamRef; teams: TeamRef[]; collapsed: boolean }) {
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

  const initial = (active.name || '?').trim().slice(0, 1).toUpperCase();

  return (
    <div ref={ref} style={{ position: 'relative', display: collapsed ? 'flex' : 'block', flexDirection: collapsed ? 'column' : undefined, alignItems: collapsed ? 'center' : undefined, gap: collapsed ? 4 : undefined, justifyContent: 'center' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch team"
        title={collapsed ? active.name : undefined}
        style={collapsed ? {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, cursor: 'pointer',
          borderRadius: 9, font: '700 15px var(--font-barlow), sans-serif', color: '#0d1016',
          background: 'linear-gradient(135deg, #4dd2ff, #4d9dff)', border: open ? '2px solid #fff' : '2px solid transparent',
        } : {
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer',
          padding: '8px 10px', borderRadius: 8, font: 'inherit', color: '#e6e6e6',
          background: open ? 'rgba(77,157,255,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${open ? '#4d9dff' : '#2a303a'}`,
        }}
      >
        {collapsed ? initial : (
          <>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: '#4dd2ff', boxShadow: '0 0 6px #4dd2ff' }} />
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active.name}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.6, flexShrink: 0 }}><polyline points="6 9 12 15 18 9" /></svg>
          </>
        )}
      </button>

      {collapsed && (
        <span title={active.name} style={{ fontSize: 9.5, fontWeight: 600, color: '#8a93a3', maxWidth: RAIL_WIDTH - 18, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active.name}</span>
      )}

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', zIndex: 80,
            ...(collapsed ? { left: 'calc(100% + 8px)', top: 0, minWidth: 200 } : { left: 0, right: 0, top: 'calc(100% + 6px)' }),
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
                  whiteSpace: 'nowrap',
                }}
              >
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: isActive ? '#4dd2ff' : '#3a3f48', boxShadow: isActive ? '0 0 6px #4dd2ff' : 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
              </button>
            );
          })}
          <div style={{ borderTop: '1px solid #2e333c', marginTop: 4, paddingTop: 4 }}>
            <Link href="/teams" role="menuitem" prefetch={false} onClick={() => setOpen(false)} style={{ display: 'block', padding: '8px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#5db4ff', textDecoration: 'none', whiteSpace: 'nowrap' }}>
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
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={u.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontSize: 11, fontWeight: 700, color: '#d6d6d6' }}>{initials}</span>}
    </div>
  );
}

function AccountFooter({ collapsed }: { collapsed: boolean }) {
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
  const item: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13, color: '#d6d6d6', textDecoration: 'none', borderRadius: 6, background: 'transparent', border: 0, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
  const avatar = (
    <span style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: u.image ? 'transparent' : '#2e333c', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {u.image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={u.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontSize: 11, fontWeight: 700, color: '#d6d6d6' }}>{initials}</span>}
    </span>
  );

  return (
    <div ref={ref} style={{ position: 'relative', padding: collapsed ? '4px 0 0' : '4px 4px 0', display: collapsed ? 'flex' : 'block', justifyContent: 'center' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        title={collapsed ? label : undefined}
        style={collapsed ? {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 5, borderRadius: 999, cursor: 'pointer',
          background: open ? 'rgba(77,157,255,0.12)' : 'transparent', border: '1px solid transparent',
        } : {
          display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', cursor: 'pointer',
          padding: '8px 8px', borderRadius: 8, font: 'inherit', color: '#e6e6e6',
          background: open ? 'rgba(77,157,255,0.10)' : 'transparent', border: '1px solid transparent',
        }}
      >
        {avatar}
        {!collapsed && (
          <>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.6, flexShrink: 0 }}><polyline points="18 15 12 9 6 15" /></svg>
          </>
        )}
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', zIndex: 80, ...(collapsed ? { left: 'calc(100% + 8px)', bottom: 0, minWidth: 160 } : { left: 4, right: 4, bottom: 'calc(100% + 6px)' }), background: '#11141a', border: '1px solid #2e333c', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: 6 }}>
          <a href="/settings" role="menuitem" style={item} onClick={() => setOpen(false)}>Settings</a>
          <button type="button" role="menuitem" style={item} onClick={() => signOut({ callbackUrl: window.location.href })}>Sign out</button>
        </div>
      )}
    </div>
  );
}

// Minimal line icons (currentColor, 18px). Active rows brighten via the row's
// color, which these inherit through stroke=currentColor.
function Icon({ name, active }: { name: IconName; active: boolean }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { flexShrink: 0, color: active ? '#4dd2ff' : 'currentColor' } };
  switch (name) {
    case 'dashboard': return <svg {...common}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>;
    case 'replays': return <svg {...common}><polygon points="5 3 19 12 5 21 5 3" /></svg>;
    case 'reviews': return <svg {...common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
    case 'tournaments': return <svg {...common}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>;
    case 'members': return <svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    case 'settings': return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>;
    case 'stats': return <svg {...common}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>;
    case 'clips': return <svg {...common}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" /></svg>;
    case 'mentions': return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" /></svg>;
    case 'addTeam': return <svg {...common}><circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="16" y1="11" x2="22" y2="11" /></svg>;
  }
}

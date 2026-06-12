'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMediaQuery } from '@/lib/useMediaQuery';

// B117: the All-Replays hub scope switcher — "My replays" + a tab per team.
// B123-followup: responsive. On desktop it's an inline tab strip (familiar, all
// scopes visible at a glance). On mobile a horizontal tab row isn't obviously
// scrollable and overflows, so it becomes a tap-to-open **scope picker** (the
// standard context-switcher pattern): a button showing the current scope that
// opens a menu of every scope. Scales to any number of teams.
type Scope = { slug: string; name: string };

// B133: activeSlug additionally accepts the sentinel 'public' (the ?tab=public
// discovery scope — not a team).
export function LibraryTabs({ teams, activeSlug }: { teams: Scope[]; activeSlug: string | null }) {
  // SSR-safe: false on the server + first tick → desktop strip renders first,
  // then flips to the picker on mobile (no hydration mismatch).
  const isNarrow = useMediaQuery('(max-width: 720px)');
  return isNarrow
    ? <ScopePicker teams={teams} activeSlug={activeSlug} />
    : <ScopeStrip teams={teams} activeSlug={activeSlug} />;
}

// -- Desktop: inline tab strip ----------------------------------------------
function ScopeStrip({ teams, activeSlug }: { teams: Scope[]; activeSlug: string | null }) {
  return (
    <div role="tablist" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, borderBottom: '1px solid #2e333c', flexWrap: 'wrap' }}>
      <Tab href="/replays" active={!activeSlug}>My replays</Tab>
      {teams.map((t) => (
        <Tab key={t.slug} href={`/replays?team=${t.slug}`} active={activeSlug === t.slug}>{t.name}</Tab>
      ))}
      <Tab href="/replays?tab=public" active={activeSlug === 'public'}>🌐 Public</Tab>
    </div>
  );
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link role="tab" aria-selected={active} href={href} style={tabStyle(active)}>
      {children}
    </Link>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    fontSize: 14,
    fontWeight: 600,
    color: active ? '#e6e6e6' : '#828b99',
    textDecoration: 'none',
    borderBottom: `2px solid ${active ? '#4d9dff' : 'transparent'}`,
    marginBottom: -1,
    cursor: 'pointer',
    background: active ? 'rgba(77,157,255,0.10)' : 'transparent',
    borderRadius: '4px 4px 0 0',
    whiteSpace: 'nowrap',
  };
}

// -- Mobile: tap-to-open scope picker ---------------------------------------
function ScopePicker({ teams, activeSlug }: { teams: Scope[]; activeSlug: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeName = activeSlug === 'public'
    ? '🌐 Public'
    : activeSlug ? (teams.find((t) => t.slug === activeSlug)?.name ?? 'My replays') : 'My replays';

  // Close on navigation (the component persists across client nav) + outside
  // click / Escape.
  useEffect(() => { setOpen(false); }, [pathname, searchParams]);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', borderBottom: '1px solid #2e333c', paddingBottom: 10 }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch replay scope"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, maxWidth: '100%',
          padding: '8px 14px', background: 'rgba(77,157,255,0.10)', border: '1px solid rgba(77,157,255,0.4)',
          borderRadius: 8, color: '#e6e6e6', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeName}</span>
        <span aria-hidden style={{ fontSize: 10, color: '#a7d2ff', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30, minWidth: 220, maxWidth: '90vw',
            background: '#11141a', border: '1px solid #2e333c', borderRadius: 10, padding: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 2,
            maxHeight: '60vh', overflowY: 'auto',
          }}
        >
          <ScopeMenuItem href="/replays" active={!activeSlug} onSelect={() => setOpen(false)}>My replays</ScopeMenuItem>
          {teams.map((t) => (
            <ScopeMenuItem key={t.slug} href={`/replays?team=${t.slug}`} active={activeSlug === t.slug} onSelect={() => setOpen(false)}>
              {t.name}
            </ScopeMenuItem>
          ))}
          <ScopeMenuItem href="/replays?tab=public" active={activeSlug === 'public'} onSelect={() => setOpen(false)}>🌐 Public</ScopeMenuItem>
        </div>
      )}
    </div>
  );
}

function ScopeMenuItem({
  href, active, onSelect, children,
}: {
  href: string; active: boolean; onSelect: () => void; children: React.ReactNode;
}) {
  return (
    <Link
      role="menuitem"
      aria-current={active ? 'page' : undefined}
      href={href}
      onClick={onSelect}
      style={{
        display: 'block', padding: '9px 12px', borderRadius: 6, fontSize: 14, fontWeight: 600,
        textDecoration: 'none', color: active ? '#fff' : '#d6d6d6',
        background: active ? 'rgba(77,157,255,0.14)' : 'transparent', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {children}
    </Link>
  );
}

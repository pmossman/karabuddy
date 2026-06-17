'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMediaQuery } from '@/lib/useMediaQuery';

// The /replays scope switcher — PERSONAL + discovery only: "My replays" and the
// 🌐 Public browse. Team replays moved to the team page (TEAM section), so this
// page no longer carries per-team tabs. Desktop = inline strip; mobile = picker.
// `activeSlug` is null (My replays) | 'public'.
export function LibraryTabs({ activeSlug }: { activeSlug: string | null }) {
  const isNarrow = useMediaQuery('(max-width: 720px)');
  return isNarrow ? <ScopePicker activeSlug={activeSlug} /> : <ScopeStrip activeSlug={activeSlug} />;
}

function ScopeStrip({ activeSlug }: { activeSlug: string | null }) {
  return (
    <div role="tablist" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, borderBottom: '1px solid #2e333c', flexWrap: 'wrap' }}>
      <Tab href="/replays" active={!activeSlug}>My replays</Tab>
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
function ScopePicker({ activeSlug }: { activeSlug: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeName = activeSlug === 'public' ? '🌐 Public' : 'My replays';

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
          }}
        >
          <ScopeMenuItem href="/replays" active={!activeSlug} onSelect={() => setOpen(false)}>My replays</ScopeMenuItem>
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

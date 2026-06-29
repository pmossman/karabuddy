'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B206: the page scope-switcher — an underline tab strip on desktop, a
// tap-to-open picker on mobile. /replays (LibraryTabs) and /clips
// (ClipLibraryTabs) had byte-identical copies of this (incl. the click-away +
// Esc effect); they're now thin wrappers passing their own items.
export interface ScopeTab { key: string; label: string; href: string }

export function ScopeTabs({ items, active, ariaLabel }: { items: ScopeTab[]; active: string; ariaLabel: string }) {
  const isNarrow = useMediaQuery('(max-width: 720px)');
  return isNarrow
    ? <Picker items={items} active={active} ariaLabel={ariaLabel} />
    : <Strip items={items} active={active} />;
}

function tabStyle(activeTab: boolean): React.CSSProperties {
  return {
    padding: '8px 14px', fontSize: 14, fontWeight: 600,
    color: activeTab ? tokens.color.text : '#828b99', textDecoration: 'none',
    borderBottom: `2px solid ${activeTab ? tokens.color.primary : 'transparent'}`, marginBottom: -1,
    cursor: 'pointer', background: activeTab ? 'rgba(77,157,255,0.10)' : 'transparent',
    borderRadius: '4px 4px 0 0', whiteSpace: 'nowrap',
  };
}

function Strip({ items, active }: { items: ScopeTab[]; active: string }) {
  return (
    <div role="tablist" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, borderBottom: `1px solid ${tokens.color.border}`, flexWrap: 'wrap' }}>
      {items.map((it) => (
        <Link key={it.key} role="tab" aria-selected={active === it.key} href={it.href} style={tabStyle(active === it.key)}>
          {it.label}
        </Link>
      ))}
    </div>
  );
}

function Picker({ items, active, ariaLabel }: { items: ScopeTab[]; active: string; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeName = items.find((it) => it.key === active)?.label ?? items[0]?.label ?? '';

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
    <div ref={ref} style={{ position: 'relative', borderBottom: `1px solid ${tokens.color.border}`, paddingBottom: 10 }}>
      <button
        type="button" aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, maxWidth: '100%', padding: '8px 14px',
          background: 'rgba(77,157,255,0.10)', border: '1px solid rgba(77,157,255,0.4)', borderRadius: 8,
          color: tokens.color.text, fontSize: 15, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeName}</span>
        <span aria-hidden style={{ fontSize: 10, color: tokens.color.accent, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
      </button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30, minWidth: 220, maxWidth: '90vw',
          background: tokens.color.bg, border: `1px solid ${tokens.color.border}`, borderRadius: 10, padding: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '60vh', overflowY: 'auto',
        }}>
          {items.map((it) => (
            <Link
              key={it.key} role="menuitem" aria-current={active === it.key ? 'page' : undefined} href={it.href}
              onClick={() => setOpen(false)}
              style={{
                display: 'block', padding: '9px 12px', borderRadius: 6, fontSize: 14, fontWeight: 600, textDecoration: 'none',
                color: active === it.key ? '#fff' : '#d6d6d6', background: active === it.key ? 'rgba(77,157,255,0.14)' : 'transparent',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

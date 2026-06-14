'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMediaQuery } from '@/lib/useMediaQuery';

// B142: the /clips scope switcher — My Clips · On My Replays · a tab per team.
// Mirrors the replay browser's LibraryTabs (desktop strip / mobile picker).
// `active` is 'created' (My Clips) | 'on-my-replays' | a team slug.
type Scope = { slug: string; name: string };

export function ClipLibraryTabs({ teams, active }: { teams: Scope[]; active: string }) {
  const isNarrow = useMediaQuery('(max-width: 720px)');
  const items = buildItems(teams);
  return isNarrow ? <Picker items={items} active={active} /> : <Strip items={items} active={active} />;
}

type Item = { key: string; label: string; href: string };
function buildItems(teams: Scope[]): Item[] {
  return [
    { key: 'created', label: 'My Clips', href: '/clips' },
    { key: 'on-my-replays', label: 'On My Replays', href: '/clips?tab=on-my-replays' },
    ...teams.map((t) => ({ key: t.slug, label: t.name, href: `/clips?team=${t.slug}` })),
  ];
}

function Strip({ items, active }: { items: Item[]; active: string }) {
  return (
    <div role="tablist" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, borderBottom: '1px solid #2e333c', flexWrap: 'wrap' }}>
      {items.map((it) => (
        <Link key={it.key} role="tab" aria-selected={active === it.key} href={it.href} style={tabStyle(active === it.key)}>
          {it.label}
        </Link>
      ))}
    </div>
  );
}

function tabStyle(activeTab: boolean): React.CSSProperties {
  return {
    padding: '8px 14px', fontSize: 14, fontWeight: 600,
    color: activeTab ? '#e6e6e6' : '#828b99', textDecoration: 'none',
    borderBottom: `2px solid ${activeTab ? '#4d9dff' : 'transparent'}`, marginBottom: -1,
    cursor: 'pointer', background: activeTab ? 'rgba(77,157,255,0.10)' : 'transparent',
    borderRadius: '4px 4px 0 0', whiteSpace: 'nowrap',
  };
}

function Picker({ items, active }: { items: Item[]; active: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeName = items.find((it) => it.key === active)?.label ?? 'My Clips';

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
        type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Switch clip scope"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, maxWidth: '100%', padding: '8px 14px',
          background: 'rgba(77,157,255,0.10)', border: '1px solid rgba(77,157,255,0.4)', borderRadius: 8,
          color: '#e6e6e6', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeName}</span>
        <span aria-hidden style={{ fontSize: 10, color: '#a7d2ff', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
      </button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30, minWidth: 220, maxWidth: '90vw',
          background: '#11141a', border: '1px solid #2e333c', borderRadius: 10, padding: 6,
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

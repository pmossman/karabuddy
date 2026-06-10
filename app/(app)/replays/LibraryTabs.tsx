'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

// B117: the All-Replays hub scope switcher — "My replays" + a tab per team.
// B123: a single horizontally-scrollable row (never wraps) so many teams / long
// team names stay one tidy line at any viewport width instead of a ragged
// stacked block on mobile. The active scope is auto-centered on load (it may be
// off-screen to the right), and the scrollbar is hidden (the partially-clipped
// last tab is the scroll affordance).
export function LibraryTabs({
  teams,
  activeSlug,
}: {
  teams: { slug: string; name: string }[];
  activeSlug: string | null;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const active = activeRef.current;
    if (!strip || !active) return;
    // Center the active tab within the strip (no page scroll — we set scrollLeft
    // directly rather than scrollIntoView, which would scroll ancestors too).
    strip.scrollLeft = active.offsetLeft - strip.clientWidth / 2 + active.offsetWidth / 2;
  }, [activeSlug]);

  return (
    <>
      {/* Hide the horizontal scrollbar (cross-browser) — the strip still scrolls. */}
      <style>{'.kb-scope-strip{scrollbar-width:none;-ms-overflow-style:none}.kb-scope-strip::-webkit-scrollbar{display:none}'}</style>
      <div
        ref={stripRef}
        role="tablist"
        className="kb-scope-strip"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 4,
          borderBottom: '1px solid #2e333c',
          overflowX: 'auto',
          flexWrap: 'nowrap',
          scrollSnapType: 'x proximity',
        }}
      >
        <HubTab href="/replays" active={!activeSlug} innerRef={!activeSlug ? activeRef : undefined}>
          My replays
        </HubTab>
        {teams.map((t) => (
          <HubTab
            key={t.slug}
            href={`/replays?team=${t.slug}`}
            active={activeSlug === t.slug}
            innerRef={activeSlug === t.slug ? activeRef : undefined}
          >
            {t.name}
          </HubTab>
        ))}
      </div>
    </>
  );
}

function hubTabStyle(active: boolean): React.CSSProperties {
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
    scrollSnapAlign: 'start',
    flex: '0 0 auto',
  };
}

function HubTab({
  href,
  active,
  innerRef,
  children,
}: {
  href: string;
  active: boolean;
  innerRef?: React.Ref<HTMLAnchorElement>;
  children: React.ReactNode;
}) {
  return (
    <Link ref={innerRef} role="tab" aria-selected={active} href={href} style={hubTabStyle(active)}>
      {children}
    </Link>
  );
}

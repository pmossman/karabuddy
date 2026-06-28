'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// One disclosure pattern for the whole app: an anchored popover on desktop, a
// portal'd bottom sheet on mobile — so a menu's CONTENT lives in one place and
// renders right on both (viewer Share, bulk-replay Manage, …). The caller passes
// `asSheet` from its own breakpoint, a `trigger` render-prop, and the body.
//
// Desktop: anchored under the trigger, closes on click-away / Escape.
// Mobile: bottom sheet with a dim backdrop + a titled header, portal'd to <body>
// so a transformed/contained ancestor can't clip it (the bug that forced separate
// mobile UIs before). Closes on backdrop tap / Escape / Close.
export function ResponsiveMenu({
  asSheet, title, align = 'right', panelWidth = 300, bodyScroll = true, trigger, children,
}: {
  asSheet: boolean;
  title?: string;
  align?: 'left' | 'right';
  panelWidth?: number;
  // When false, the body is a plain flex column and the CHILDREN own scrolling +
  // any pinned footer (e.g. bulk Manage's staged-apply footer). Default true: the
  // menu scrolls the body itself — right for short content like the Share menu.
  bodyScroll?: boolean;
  trigger: (open: boolean, toggle: () => void) => React.ReactNode;
  // A render-prop gets `close` so an action inside can dismiss the menu.
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  const toggle = () => setOpen((v) => !v);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    // The sheet has its own backdrop; only the anchored popover needs click-away.
    let onDoc: ((e: MouseEvent) => void) | null = null;
    if (!asSheet) {
      onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
      document.addEventListener('mousedown', onDoc);
    }
    return () => { document.removeEventListener('keydown', onKey); if (onDoc) document.removeEventListener('mousedown', onDoc); };
  }, [open, asSheet]);

  const body = typeof children === 'function' ? (children as (c: () => void) => React.ReactNode)(close) : children;

  if (asSheet) {
    return (
      <>
        {trigger(open, toggle)}
        {open && typeof document !== 'undefined' && createPortal(
          <>
            <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.55)' }} />
            <div role="dialog" aria-modal="true" aria-label={title} style={sheetPanelStyle}>
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 8px', borderBottom: '1px solid #1c2128' }}>
                <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: '#9aa3b2', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
                <button type="button" onClick={close} style={navBtnStyle}>Close</button>
              </div>
              <div style={bodyScroll
                ? { overflowY: 'auto', minHeight: 0, flex: '1 1 auto', padding: '12px 14px max(14px, env(safe-area-inset-bottom))' }
                : { display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}>{body}</div>
            </div>
          </>,
          document.body,
        )}
      </>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      {trigger(open, toggle)}
      {open && (
        <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}
          style={{ ...(bodyScroll ? popoverPanelStyle : popoverPanelStyleFlex), [align]: 0, width: panelWidth }}>
          {body}
        </div>
      )}
    </div>
  );
}

const sheetPanelStyle: React.CSSProperties = {
  position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 301, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
  background: '#0f1318', borderTop: '1px solid #2e333c', borderTopLeftRadius: 16, borderTopRightRadius: 16,
  boxShadow: '0 -10px 40px rgba(0,0,0,0.55)', color: '#e6e6e6', font: '12px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
};
const popoverPanelStyle: React.CSSProperties = {
  position: 'absolute', top: 'calc(100% + 6px)', zIndex: 50, maxHeight: 'min(70vh, 560px)', overflowY: 'auto',
  background: '#1a1d24', border: '1px solid #2e333c', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
  padding: 10, color: '#e6e6e6', font: '12px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
};
// bodyScroll=false variant: a flex column (no self-scroll, no padding) so the
// children manage their own scroll region + pinned footer.
const popoverPanelStyleFlex: React.CSSProperties = {
  position: 'absolute', top: 'calc(100% + 6px)', zIndex: 50, maxHeight: 'min(70vh, 560px)',
  display: 'flex', flexDirection: 'column',
  background: '#1a1d24', border: '1px solid #2e333c', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
  color: '#e6e6e6', font: '12px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
};
const navBtnStyle: React.CSSProperties = { background: 'transparent', color: '#4dd2ff', border: 0, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };

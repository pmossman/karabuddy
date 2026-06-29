'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B204 (DRY overlays): the centered-modal shell. ~7 components hand-rolled the
// same thing — a fixed full-screen backdrop (click-away to close) wrapping a
// dark panel, an Esc handler, a body-scroll lock, and a × header — with ad-hoc
// z-indexes (60→1000). This is the centered sibling of ResponsiveMenu. It
// portals to <body> so a transformed/contained ancestor can't clip it.
//
// `title` renders the standard header (title + Close); omit it for modals that
// supply their own header chrome (e.g. the decks tabs). Children own the body
// layout/scroll below the optional header — the panel is a flex column.
export function Modal({
  open, onClose, title, ariaLabel, headerRight,
  width = 'min(560px, 96vw)', maxHeight = '88vh', height,
  lockScroll = true, z = 300, children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel?: string;
  headerRight?: ReactNode; // extra controls in the header, left of Close
  width?: string;
  maxHeight?: string;
  height?: string;
  lockScroll?: boolean;
  z?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    let prev: string | undefined;
    if (lockScroll && typeof document !== 'undefined') { prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    return () => {
      window.removeEventListener('keydown', onKey);
      if (lockScroll && typeof document !== 'undefined') document.body.style.overflow = prev ?? '';
    };
  }, [open, onClose, lockScroll]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      onClick={onClose}
      // B204: the modal portals to <body>, so a mousedown inside it would
      // otherwise register as "outside" to any click-away host (a Popover or
      // kebab menu) that opened it — closing the host (and unmounting the
      // modal) before the click lands. Stop mousedown from escaping the modal.
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: z, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || ariaLabel}
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxHeight, ...(height ? { height } : {}),
          display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
          background: tokens.color.bg, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.lg,
          color: tokens.color.text, fontFamily: 'var(--font-barlow), sans-serif', boxShadow: '0 16px 50px rgba(0,0,0,0.6)',
        }}
      >
        {title && (
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '14px 16px', borderBottom: `1px solid ${tokens.color.border}` }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{title}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {headerRight}
              <button type="button" onClick={onClose} style={{ background: 'transparent', border: 0, color: tokens.led.on, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
            </div>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

'use client';

import React, { useEffect, useRef, useState } from 'react';

// Lightweight click-outside / Escape-to-close popover anchored under a
// trigger button. Avoids pulling in a heavier UI lib for the handful of
// menus the viewer sidebar needs (Share, Settings — see TagSidebar B10).
//
// Renders inline (not portalled) — fine for the sidebar since the parent
// stacking context isn't clipped horizontally.

interface PopoverProps {
  trigger: (open: boolean, toggle: () => void) => React.ReactNode;
  children: React.ReactNode;
  // Where the popover sits relative to the trigger.
  align?: 'left' | 'right';
  // Optional accessible label for the popover panel.
  label?: string;
}

export function Popover({ trigger, children, align = 'left', label }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => setOpen((v) => !v);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      {trigger(open, toggle)}
      {open && (
        <div
          role="dialog"
          aria-label={label}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            [align === 'right' ? 'right' : 'left']: 0,
            zIndex: 50,
            minWidth: 200,
            background: '#1a1d24',
            border: '1px solid #2e333c',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            padding: 10,
            color: '#e6e6e6',
            font: '12px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  );
}

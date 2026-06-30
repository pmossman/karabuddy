'use client';

import { type ReactNode } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B216 redesign — the unified feature container. ONE component, two
// presentations driven by `mode`:
//   • desktop → a right-docked drawer (flex child beside the board)
//   • mobile  → a full-height overlay (board has no side real estate), so a
//               feature like Tags can breathe and show many items at once.
// The CHROME (header + scroll body) is identical across both — only the
// outer placement differs. Features render their own body as children.
export function FeaturePanel({
  open, mode, title, icon, onClose, headerRight, width = 380, children,
}: {
  open: boolean;
  mode: 'desktop' | 'mobile';
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  headerRight?: ReactNode;
  width?: number;
  children: ReactNode;
}) {
  if (!open) return null;

  const header = (
    <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: mode === 'mobile' ? '14px 16px' : '12px 16px', borderBottom: `1px solid ${tokens.color.border}` }}>
      {icon && <span aria-hidden style={{ display: 'inline-flex', color: tokens.led.on, fontSize: 18 }}>{icon}</span>}
      <span style={{ fontSize: mode === 'mobile' ? 16 : 14, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#fff' }}>{title}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        {headerRight}
        <button type="button" onClick={onClose} aria-label="Close" title="Close"
          style={{ background: 'transparent', border: 0, color: tokens.color.accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: mode === 'mobile' ? 22 : 18, lineHeight: 1, padding: mode === 'mobile' ? '4px 6px' : 0 }}>
          ✕
        </button>
      </div>
    </div>
  );

  const body = (
    <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable' }}>
      {children}
    </div>
  );

  if (mode === 'desktop') {
    // Docked column — a flex sibling of the board (rendered in the board row).
    return (
      <aside style={{ flex: `0 0 ${width}px`, width, maxWidth: '42vw', minHeight: 0, display: 'flex', flexDirection: 'column', background: tokens.color.bg, borderLeft: `1px solid ${tokens.color.border}`, color: tokens.color.text, fontFamily: 'var(--font-barlow), sans-serif' }}>
        {header}
        {body}
      </aside>
    );
  }

  // Mobile — full-height overlay sheet (portal-free; sits above the board via z).
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', background: tokens.color.surfaceSolid, backdropFilter: 'blur(2px)', color: tokens.color.text, fontFamily: 'var(--font-barlow), sans-serif', animation: 'kb-feature-in 180ms ease-out' }}>
      <style>{'@keyframes kb-feature-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'}</style>
      {header}
      {body}
    </div>
  );
}

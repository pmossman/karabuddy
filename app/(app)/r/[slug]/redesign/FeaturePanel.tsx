'use client';

import { useRef, type ReactNode } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B216 redesign — the unified feature container. ONE component, two glassy
// presentations driven by `mode`:
//   • desktop → a right-docked, RESIZABLE drawer (flex child beside the board)
//   • mobile  → a slide-out drawer covering most of the screen (backdrop behind)
// The chrome (header + optional sticky toolbar + scroll body) is identical across
// both; only placement differs. Features render their own body as children.
const GLASS_BG = 'rgba(13, 17, 25, 0.82)';
const GLASS_BLUR = 'blur(22px) saturate(1.3)';

export function FeaturePanel({
  open, mode, title, icon, onClose, headerRight, toolbar, hideHeader, width = 380, onWidthChange, resizable, children,
}: {
  open: boolean;
  mode: 'desktop' | 'mobile';
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  headerRight?: ReactNode;
  toolbar?: ReactNode;      // sticky row under the header (e.g. the view selector)
  // When true, drop the title/icon header — the toolbar (view selector) is the
  // top, with the close button tucked into its corner.
  hideHeader?: boolean;
  width?: number;
  onWidthChange?: (w: number) => void;
  resizable?: boolean;
  children: ReactNode;
}) {
  const cleanupRef = useRef<(() => void) | null>(null);
  if (!open) return null;

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX, sw = width;
    const move = (ev: PointerEvent) => {
      const next = Math.min(Math.max(300, sw - (ev.clientX - sx)), Math.round(window.innerWidth * 0.5));
      onWidthChange?.(next);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); cleanupRef.current = null; };
    cleanupRef.current = up;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const closeBtn = (
    <button type="button" onClick={onClose} aria-label="Close" title="Close"
      style={{ background: 'transparent', border: 0, color: tokens.color.accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: mode === 'mobile' ? 22 : 18, lineHeight: 1, padding: mode === 'mobile' ? '4px 6px' : '2px 4px' }}>✕</button>
  );

  const header = (
    <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: mode === 'mobile' ? '14px 16px' : '12px 16px', borderBottom: `1px solid ${tokens.color.border}` }}>
      {icon && <span aria-hidden style={{ display: 'inline-flex', color: tokens.led.on, fontSize: 18 }}>{icon}</span>}
      <span style={{ fontSize: mode === 'mobile' ? 16 : 14, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#fff' }}>{title}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>{headerRight}{closeBtn}</div>
    </div>
  );

  const inner = (
    <>
      {hideHeader ? (
        <div style={{ position: 'relative', flex: '0 0 auto', borderBottom: `1px solid ${tokens.color.border}` }}>
          {toolbar}
          <div style={{ position: 'absolute', top: 6, right: 8 }}>{closeBtn}</div>
        </div>
      ) : (
        <>
          {header}
          {toolbar && <div style={{ flex: '0 0 auto', borderBottom: `1px solid ${tokens.color.border}` }}>{toolbar}</div>}
        </>
      )}
      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable' }}>{children}</div>
    </>
  );

  if (mode === 'desktop') {
    return (
      <aside style={{ position: 'relative', flex: `0 0 ${width}px`, width, maxWidth: '50vw', minHeight: 0, display: 'flex', flexDirection: 'column', background: GLASS_BG, backdropFilter: GLASS_BLUR, WebkitBackdropFilter: GLASS_BLUR, borderLeft: `1px solid rgba(255,255,255,0.12)`, color: tokens.color.text, fontFamily: 'var(--font-barlow), sans-serif' }}>
        {resizable && (
          <div onPointerDown={startResize} title="Drag to resize" aria-label="Resize sidebar"
            style={{ position: 'absolute', left: -4, top: 0, bottom: 0, width: 9, cursor: 'ew-resize', zIndex: 5, touchAction: 'none' }} />
        )}
        {inner}
      </aside>
    );
  }

  // Mobile — a slide-out drawer covering most of the screen, board dimmed behind.
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(0,0,0,0.45)', animation: 'kb-fade-in 160ms ease-out' }} />
      <div role="dialog" aria-modal="true" aria-label={title}
        style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 92vw)', zIndex: 200, display: 'flex', flexDirection: 'column', background: GLASS_BG, backdropFilter: GLASS_BLUR, WebkitBackdropFilter: GLASS_BLUR, borderLeft: `1px solid rgba(255,255,255,0.14)`, color: tokens.color.text, fontFamily: 'var(--font-barlow), sans-serif', boxShadow: '-12px 0 44px rgba(0,0,0,0.5)', animation: 'kb-drawer-in 220ms cubic-bezier(0.22,1,0.36,1)' }}>
        <style>{'@keyframes kb-drawer-in{from{transform:translateX(100%)}to{transform:none}}@keyframes kb-fade-in{from{opacity:0}to{opacity:1}}'}</style>
        {inner}
      </div>
    </>
  );
}

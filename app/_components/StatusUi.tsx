import type { ReactNode, CSSProperties } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B203 (DRY foundations): the tiny status blocks that were inlined per-page
// dozens of times — a red error string (~27 sites, drifting between three
// reds), a muted "Loading…" line (~12 sites), and an empty-state note. One home
// so the copy + colors stay consistent.

// Inline error note (form/section errors). Renders nothing for a falsy message.
export function ErrorNote({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
  if (!children) return null;
  return <div style={{ fontSize: 12, color: tokens.color.dangerSoft, fontStyle: 'italic', lineHeight: 1.4, ...style }}>{children}</div>;
}

// Muted "Loading <label>…" line. Pass no label for a bare "Loading…".
export function Loading({ label, style }: { label?: string; style?: CSSProperties }) {
  return <div style={{ fontSize: 12, color: tokens.color.textMuted, ...style }}>{label ? `Loading ${label}…` : 'Loading…'}</div>;
}

// Muted inline text — the smallest shared primitive (footnotes, "no data yet").
export function Muted({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
  return <span style={{ fontSize: 12, color: tokens.color.textMuted, ...style }}>{children}</span>;
}

// Empty-state block: a centered/left muted message with optional icon + CTA.
export function EmptyState({ children, icon, cta, style }: { children?: ReactNode; icon?: ReactNode; cta?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '24px 0', color: tokens.color.textMuted, fontSize: 13, lineHeight: 1.5, ...style }}>
      {icon}
      <div>{children}</div>
      {cta}
    </div>
  );
}

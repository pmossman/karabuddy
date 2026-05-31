import type { CSSProperties, ReactNode } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// "Tactical dark" raised surface — a faint top-lit gradient + depth shadow,
// replacing the flat `rgba(17,20,26,0.6)` bordered cards. `accent` adds the
// cyan left signal-bar used on active/live rows (mirrors the extension's
// armed-share row + the "THIS BROWSER" linked-install row). Presentational +
// server-safe (no client hooks).
export function Panel({
  children,
  accent = false,
  padding = 20,
  style,
}: {
  children: ReactNode;
  accent?: boolean;
  padding?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: tokens.surface.panel,
        border: `1px solid ${tokens.surface.panelBorder}`,
        borderLeft: accent ? `2px solid ${tokens.led.on}` : `1px solid ${tokens.surface.panelBorder}`,
        borderRadius: tokens.radius.lg,
        boxShadow: accent
          ? `${tokens.surface.panelShadow}, 0 0 12px rgba(77, 210, 255, 0.12)`
          : tokens.surface.panelShadow,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

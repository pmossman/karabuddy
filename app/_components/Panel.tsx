import type { CSSProperties, ReactNode } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// "Tactical dark" raised surface — a faint top-lit gradient + depth shadow,
// replacing the flat `rgba(17,20,26,0.6)` bordered cards. With `hud` (default)
// it gets cyan corner-bracket ticks — the spaceship-console readout look.
// `accent` adds the cyan left signal-bar + glow for active/live panels.
// Presentational + server-safe (no client hooks).
export function Panel({
  children,
  accent = false,
  hud = true,
  padding = 20,
  style,
}: {
  children: ReactNode;
  accent?: boolean;
  hud?: boolean;
  padding?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: 'relative',
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
      {hud && <Corners />}
      {children}
    </div>
  );
}

// Four faint cyan corner brackets — the targeting-reticle / console-frame cue.
function Corners() {
  const c = 'rgba(77, 210, 255, 0.4)';
  const len = 9;
  const inset = 7;
  const base: CSSProperties = { position: 'absolute', width: len, height: len, pointerEvents: 'none' };
  return (
    <>
      <span aria-hidden style={{ ...base, top: inset, left: inset, borderTop: `1.5px solid ${c}`, borderLeft: `1.5px solid ${c}` }} />
      <span aria-hidden style={{ ...base, top: inset, right: inset, borderTop: `1.5px solid ${c}`, borderRight: `1.5px solid ${c}` }} />
      <span aria-hidden style={{ ...base, bottom: inset, left: inset, borderBottom: `1.5px solid ${c}`, borderLeft: `1.5px solid ${c}` }} />
      <span aria-hidden style={{ ...base, bottom: inset, right: inset, borderBottom: `1.5px solid ${c}`, borderRight: `1.5px solid ${c}` }} />
    </>
  );
}

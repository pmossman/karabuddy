import { tokens } from '@/app/_theme/karabuddyTokens';

// Tactical section header — monospace, letter-spaced uppercase with a small
// glowing cyan signal dot, mirroring the extension's "SHARE WITH TEAMS" labels.
// Use for chrome/section headers; readable Barlow stays for body + content
// (titles, prose, comments). Optional `action` renders right-aligned (e.g. a
// "View all →" link) — give it its own normal-case style so it doesn't inherit
// the heading's mono/uppercase. Server-safe.
export function TacticalHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <h2
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: action ? 'space-between' : 'flex-start',
        gap: 8,
        margin: '0 0 10px',
        font: `700 12px ${tokens.led.mono}`,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: tokens.color.text,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: tokens.led.on,
            boxShadow: tokens.led.dotGlow,
            flex: '0 0 auto',
          }}
        />
        {children}
      </span>
      {action}
    </h2>
  );
}

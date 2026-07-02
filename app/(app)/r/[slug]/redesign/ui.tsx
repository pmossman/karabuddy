import type { CSSProperties } from 'react';

// B216 redesign — tiny shared visual primitives, so the glassy surfaces and small
// badges can't drift apart. (Bigger shared pieces — icons, RailBtn — live in their
// own modules; this is just the style-level vocabulary.)

// The canonical glass panel: translucent + heavy blur. Used by the Tag HUD, the
// sideboard splash, and any other floating surface over the board.
export const GLASS: CSSProperties = {
  background: 'rgba(16, 20, 28, 0.55)',
  backdropFilter: 'blur(20px) saturate(1.4)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: '0 12px 44px rgba(0,0,0,0.5)',
};

// The attention pulse shared by the Play invite + the sideboard rail glow.
// Inject once per mounted chrome (a duplicate definition is harmless but noisy).
export const PULSE_KEYFRAMES =
  '@keyframes kb-play-pulse{0%,100%{box-shadow:0 0 7px 1px rgba(77,210,255,0.32)}50%{box-shadow:0 0 17px 5px rgba(77,210,255,0.55)}}';

// "New since your last visit" pill (feed + HUD).
export function NewBadge() {
  return (
    <span aria-hidden style={{ flex: '0 0 auto', background: 'rgba(86,199,255,0.18)', border: '1px solid rgba(86,199,255,0.5)', color: '#8fd6ff', borderRadius: 999, padding: '0 6px', fontSize: 9, fontWeight: 800, letterSpacing: '0.05em' }}>
      NEW
    </span>
  );
}

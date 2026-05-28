'use client';

// B46: gameboard-overlay frame navigation. Two slim chevron buttons pinned
// to the left and right edges of the viewport — easy to thumb-tap on mobile
// without obscuring much of the board. The right-edge button shifts left
// when the mobile drawer is open so it doesn't slide behind it.
//
// Rendered only when isMobile so desktop users keep the existing sidebar
// arrows + keyboard nav.
export function FrameNavOverlay({
  isMobile,
  drawerOpen,
  onStep,
  canPrev,
  canNext,
  drawerWidth,
}: {
  isMobile: boolean;
  drawerOpen: boolean;
  onStep: (dir: 1 | -1) => void;
  canPrev: boolean;
  canNext: boolean;
  drawerWidth: string;
}) {
  if (!isMobile) return null;

  // Respect iOS safe-area insets so the chevrons don't sit underneath the
  // home indicator or notch in landscape. env() falls back to the literal
  // 8px on browsers without safe-area support.
  const leftOffset = 'max(8px, env(safe-area-inset-left, 8px))';
  const rightOffset = drawerOpen
    ? `calc(${drawerWidth} + 8px)`
    : 'max(8px, env(safe-area-inset-right, 8px))';

  return (
    <>
      <ChevronButton
        side="left"
        offset={leftOffset}
        ariaLabel="Previous frame"
        disabled={!canPrev}
        onClick={() => onStep(-1)}
      >
        ‹
      </ChevronButton>
      <ChevronButton
        side="right"
        offset={rightOffset}
        ariaLabel="Next frame"
        disabled={!canNext}
        onClick={() => onStep(1)}
      >
        ›
      </ChevronButton>
    </>
  );
}

function ChevronButton({
  side,
  offset,
  ariaLabel,
  disabled,
  onClick,
  children,
}: {
  side: 'left' | 'right';
  offset: string;
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        position: 'fixed',
        [side]: offset,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 60,
        width: 36,
        // Tall enough for a comfortable thumb target without dominating
        // the gameboard. Vertically narrow profile keeps it out of the way.
        height: 84,
        background: 'rgba(36, 48, 68, 0.7)',
        color: disabled ? '#4a4e56' : '#d6e7ff',
        border: '1px solid rgba(74, 124, 255, 0.3)',
        borderRadius: 10,
        padding: 0,
        fontSize: 28,
        fontWeight: 400,
        lineHeight: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(6px)',
        transition: 'right 220ms cubic-bezier(0.4, 0, 0.2, 1), left 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 120ms ease',
      }}
    >
      {children}
    </button>
  );
}

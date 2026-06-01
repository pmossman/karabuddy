'use client';

import { useRef, useState } from 'react';

// B46/B66b/B100: gameboard-overlay frame navigation. Two slim chevron
// buttons at the left and right edges of the viewport, on every breakpoint.
//
// B100: on MOBILE the chevrons are pinned to the screen edges at vertical-
// center and never move — the old drawer-reactive offsets (shifting left of
// the drawer, jumping to 20% above the portrait sheet) are exactly what made
// them feel broken once the menu expanded. The mobile sheets carry a backdrop
// + their own prev/next-tag nav, so a chevron briefly under an open sheet is
// fine. On DESKTOP the docked sidebar still pushes the right chevron inward so
// it hugs the sidebar's left edge as it resizes.
//
// Desktop also gets a faint "← / →" keyboard hint adjacent to each chevron
// so users discover the shortcuts without hovering for the title tooltip.
export function FrameNavOverlay({
  leftOffset,
  rightOffset,
  verticalCenter,
  dragging,
  onStep,
  canPrev,
  canNext,
  showKeyboardHint,
}: {
  // Edge offsets + vertical centre are computed by the parent (ReplayViewer)
  // from the live review-sheet size, so the chevrons ride with the sheet.
  leftOffset: string;
  rightOffset: string;
  verticalCenter: string;
  // While the sheet is being dragged, suppress the slide transition so the
  // chevrons track the finger 1:1 instead of easing behind it.
  dragging?: boolean;
  onStep: (dir: 1 | -1) => void;
  canPrev: boolean;
  canNext: boolean;
  showKeyboardHint?: boolean;
}) {
  return (
    <>
      <ChevronButton
        side="left"
        offset={leftOffset}
        verticalCenter={verticalCenter}
        dragging={dragging}
        ariaLabel="Previous frame"
        disabled={!canPrev}
        onClick={() => onStep(-1)}
        keyboardHint={showKeyboardHint ? '←' : null}
      >
        ‹
      </ChevronButton>
      <ChevronButton
        side="right"
        offset={rightOffset}
        verticalCenter={verticalCenter}
        dragging={dragging}
        ariaLabel="Next frame"
        disabled={!canNext}
        onClick={() => onStep(1)}
        keyboardHint={showKeyboardHint ? '→' : null}
      >
        ›
      </ChevronButton>
    </>
  );
}

function ChevronButton({
  side,
  offset,
  verticalCenter,
  dragging,
  ariaLabel,
  disabled,
  onClick,
  keyboardHint,
  children,
}: {
  side: 'left' | 'right';
  offset: string;
  verticalCenter: string;
  dragging?: boolean;
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
  keyboardHint: string | null;
  children: React.ReactNode;
}) {
  // Press animation: briefly nudge the chevron in the step direction +
  // pulse the background. Reset via a short timeout so successive taps
  // re-trigger reliably. Pressed state is local to each button.
  const [pressed, setPressed] = useState(false);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerPress = () => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    setPressed(true);
    pressTimerRef.current = setTimeout(() => setPressed(false), 180);
  };
  const handleClick = () => {
    if (disabled) return;
    triggerPress();
    onClick();
  };

  // Direction of the nudge: left chevron pulls leftward when pressed,
  // right chevron pulls rightward — visual reinforcement of the action.
  const nudge = side === 'left' ? -6 : 6;
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        position: 'fixed',
        [side]: offset,
        top: verticalCenter,
        transform: `translateY(-50%) translateX(${pressed ? nudge : 0}px)`,
        zIndex: 90,
        width: 36,
        height: 84,
        background: pressed ? 'rgba(77, 157, 255, 0.45)' : 'rgba(36, 48, 68, 0.7)',
        color: disabled ? '#4a4e56' : '#d6e7ff',
        border: '1px solid rgba(77, 157, 255, 0.3)',
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
        transition: dragging
          ? 'opacity 120ms ease, transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1), background 160ms ease'
          : 'right 220ms cubic-bezier(0.4, 0, 0.2, 1), left 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 120ms ease, transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1), background 160ms ease',
      }}
    >
      {children}
      {keyboardHint && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            [side === 'left' ? 'right' : 'left']: -22,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 10,
            color: '#6c7588',
            fontWeight: 600,
            opacity: 0.7,
            pointerEvents: 'none',
            letterSpacing: '0.04em',
          }}
        >
          {keyboardHint}
        </span>
      )}
    </button>
  );
}

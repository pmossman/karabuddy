'use client';

import { useRef, useState } from 'react';

// B46/B66b/B100/B216: gameboard-overlay frame navigation — two slim frosted
// chevron buttons at the left and right edges of the viewport, on every
// breakpoint, pinned at vertical centre. The only geometry they react to is the
// docked desktop panel (the parent computes rightOffset from its width). Tag
// nav lives in the Tag HUD (plus the `[` / `]` shortcuts), not here.
// Exported so ReplayViewer can centre the chevrons on the chrome axis.
export const CHEVRON_W = 36;

export function FrameNavOverlay({
  leftOffset,
  rightOffset,
  verticalCenter,
  onStep,
  canPrev,
  canNext,
}: {
  leftOffset: string;
  rightOffset: string;
  verticalCenter: string;
  onStep: (dir: 1 | -1) => void;
  canPrev: boolean;
  canNext: boolean;
}) {
  return (
    <>
      <ChevronButton side="left" offset={leftOffset} verticalCenter={verticalCenter} ariaLabel="Previous frame" disabled={!canPrev} onClick={() => onStep(-1)}>
        ‹
      </ChevronButton>
      <ChevronButton side="right" offset={rightOffset} verticalCenter={verticalCenter} ariaLabel="Next frame" disabled={!canNext} onClick={() => onStep(1)}>
        ›
      </ChevronButton>
    </>
  );
}

function ChevronButton({
  side,
  offset,
  verticalCenter,
  ariaLabel,
  disabled,
  onClick,
  children,
}: {
  side: 'left' | 'right';
  offset: string;
  verticalCenter: string;
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  // Press animation: briefly nudge the chevron in the step direction +
  // pulse the background. Reset via a short timeout so successive taps
  // re-trigger reliably. Pressed state is local to each button.
  const [pressed, setPressed] = useState(false);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleClick = () => {
    if (disabled) return;
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    setPressed(true);
    pressTimerRef.current = setTimeout(() => setPressed(false), 180);
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
      title={ariaLabel}
      style={{
        position: 'fixed',
        [side]: offset,
        top: verticalCenter,
        transform: `translateY(-50%) translateX(${pressed ? nudge : 0}px)`,
        zIndex: 90,
        width: CHEVRON_W,
        height: 84,
        background: pressed ? 'rgba(77, 210, 255, 0.32)' : 'rgba(255,255,255,0.07)',
        color: disabled ? '#4a4e56' : '#d6e7ff',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 10,
        padding: 0,
        fontSize: 28,
        fontWeight: 400,
        lineHeight: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
        boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(16px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
        transition: 'right 220ms cubic-bezier(0.4, 0, 0.2, 1), left 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 120ms ease, transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1), background 160ms ease',
      }}
    >
      {children}
    </button>
  );
}

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
  onJumpTag,
  canPrevTag,
  canNextTag,
  showTagJump,
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
  // B132: jump to the previous/next ANNOTATED frame — a smaller companion
  // button under each chevron, rendered only when the replay has visible
  // tags. Same fixed edge positioning, so it works identically on mobile.
  onJumpTag?: (dir: 1 | -1) => void;
  canPrevTag?: boolean;
  canNextTag?: boolean;
  showTagJump?: boolean;
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
      {showTagJump && onJumpTag && (
        <>
          <ChevronButton
            side="left"
            offset={leftOffset}
            verticalCenter={`calc(${verticalCenter} + 72px)`}
            dragging={dragging}
            ariaLabel="Previous comment"
            disabled={!canPrevTag}
            onClick={() => onJumpTag(-1)}
            keyboardHint={showKeyboardHint ? '[' : null}
            compact
            testId="tag-jump-prev"
          >
            <TagJumpGlyph dir={-1} />
          </ChevronButton>
          <ChevronButton
            side="right"
            offset={rightOffset}
            verticalCenter={`calc(${verticalCenter} + 72px)`}
            dragging={dragging}
            ariaLabel="Next comment"
            disabled={!canNextTag}
            onClick={() => onJumpTag(1)}
            keyboardHint={showKeyboardHint ? ']' : null}
            compact
            testId="tag-jump-next"
          >
            <TagJumpGlyph dir={1} />
          </ChevronButton>
        </>
      )}
    </>
  );
}

// Speech bubble with a directional chevron inside — one centered glyph
// ("step to the adjacent frame that has a comment").
function TagJumpGlyph({ dir }: { dir: 1 | -1 }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 11.5a8.38 8.38 0 0 1-9 8.35 8.5 8.5 0 0 1-3.2-.6L3 21l1.75-5.8A8.38 8.38 0 0 1 4 11.5a8.5 8.5 0 1 1 17 0z" />
      <path d={dir > 0 ? 'M11 8.5l3.5 3-3.5 3' : 'M14 8.5l-3.5 3 3.5 3'} />
    </svg>
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
  compact,
  testId,
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
  // B132: the tag-jump companion is a shorter button (the full-height chevron
  // stays the dominant affordance).
  compact?: boolean;
  testId?: string;
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
      title={ariaLabel}
      data-testid={testId}
      style={{
        position: 'fixed',
        [side]: offset,
        top: verticalCenter,
        transform: `translateY(-50%) translateX(${pressed ? nudge : 0}px)`,
        zIndex: 90,
        width: 36,
        height: compact ? 40 : 84,
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
      {/* Keycap-styled hint so it reads as "press this key", not a stray
          glyph floating next to the button. */}
      {keyboardHint && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            [side === 'left' ? 'right' : 'left']: -28,
            top: '50%',
            transform: 'translateY(-50%)',
            minWidth: 18,
            boxSizing: 'border-box',
            padding: '3px 4px',
            fontSize: 10,
            lineHeight: 1,
            textAlign: 'center',
            color: '#8b94a6',
            fontWeight: 700,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            background: 'rgba(20, 26, 36, 0.85)',
            border: '1px solid #3a4150',
            borderBottomWidth: 2,
            borderRadius: 4,
            pointerEvents: 'none',
          }}
        >
          {keyboardHint}
        </span>
      )}
    </button>
  );
}

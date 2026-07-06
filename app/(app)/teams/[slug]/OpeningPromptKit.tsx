'use client';

// B221: the quiz's prompt chrome, LIFTED from karabast's open-source client
// (forceteki-client, MIT — Copyright (c) 2024 Dan Bastin and contributors; see
// app/_components/Gameboard/ATTRIBUTION.md for the standing notice). Adapted
// from src/app/_components/_sharedcomponents/Popup/{Popup.styles.ts,
// PopupVariant/SelectCardsPopup.tsx} and _styledcomponents/
// GradientBorderButton.tsx: the socket sendGameMessage plumbing is replaced
// with plain callbacks, and cards render from the catalog (lib/cardImage)
// instead of the live game state. The gradients, selection ring/dot, and
// button treatment are theirs — that's the point: the two quiz interactions
// should feel like karabast's own setup prompts.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cardImageUrl } from '@/lib/cardImage';

export interface QuizCardRef {
  id: string; // SET_NNN
  name: string | null;
  cost: number | null;
  set: string;
  number: number;
}

// Floating full-size card preview — the replay viewer / karabast board
// affordance: hover (desktop) or press-and-hold (touch) any card to read it.
// Rendered through a portal: the hand row scales via CSS transform, and a
// transformed ancestor breaks position:fixed.
function CardPreviewOverlay({ url, landscape, anchor }: { url: string; landscape?: boolean; anchor: DOMRect | null }) {
  // Anchor the preview ABOVE the hovered card (flip below only when there's
  // no headroom) — a screen-centered preview sat on the cursor and hid the
  // very hand being picked from.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(landscape ? 440 : 320, vw * (landscape ? 0.88 : 0.8));
  const h = landscape ? w / 1.4 : w * 1.4;
  let left = vw / 2 - w / 2;
  let top = vh / 2 - h / 2;
  if (anchor) {
    left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - w / 2), vw - w - 8);
    top = anchor.top - h - 14;
    if (top < 8) top = Math.min(anchor.bottom + 14, vh - h - 8);
  }
  return createPortal(
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      style={{
        position: 'fixed',
        left,
        top,
        width: w,
        height: h,
        objectFit: 'cover',
        borderRadius: 16,
        zIndex: 500,
        boxShadow: '0 16px 70px rgba(0,0,0,0.85)',
        pointerEvents: 'none',
      }}
    />,
    document.body,
  );
}

export function useCardPreview() {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const anchorRef = useRef<DOMRect | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  const handlers = {
    // Hover-preview only for real pointers: after a TAP the browser
    // synthesizes mouseenter on whatever ends up under the finger, which
    // stuck the preview open on touch screens.
    onMouseEnter: (e: React.MouseEvent) => {
      if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) return;
      clear();
      anchorRef.current = e.currentTarget.getBoundingClientRect();
      timer.current = setTimeout(() => setShow(true), 250);
    },
    onMouseLeave: () => { clear(); setShow(false); },
    onTouchStart: (e: React.TouchEvent) => {
      clear();
      suppressClick.current = false;
      anchorRef.current = e.currentTarget.getBoundingClientRect();
      timer.current = setTimeout(() => { setShow(true); suppressClick.current = true; }, 350);
    },
    onTouchMove: () => { clear(); setShow(false); },
    onTouchEnd: (e: React.TouchEvent) => {
      clear();
      setShow(false);
      // A long-press that showed the preview must not fall through as a tap
      // (it would toggle the card's selection on release).
      if (suppressClick.current) { e.preventDefault(); suppressClick.current = false; }
    },
    onTouchCancel: () => { clear(); setShow(false); },
  };
  return { show, anchor: anchorRef, handlers };
}

// forceteki contentStyle — the prompt window's dark gradient panel.
export const promptPanelStyle: CSSProperties = {
  padding: '1.25rem 1.5rem 1.5rem',
  borderRadius: 15,
  border: '2px solid transparent',
  background:
    'linear-gradient(#0F1F27, #030C13) padding-box, linear-gradient(to top, #30434B, #50717D) border-box',
};

// forceteki titleStyle / textStyle.
export const promptTitleStyle: CSSProperties = {
  color: 'white',
  fontSize: '1.1rem',
  fontWeight: 'bold',
  textAlign: 'center',
};
export const promptTextStyle: CSSProperties = { color: '#C7C7C7', textAlign: 'center' };

// forceteki GradientBorderButton (blue-to-grey gradient border, 15px radius),
// as a plain button so it works outside the board's MUI theme.
export function GradientBorderButton({
  onClick,
  disabled,
  danger,
  children,
  style,
  testId,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
  style?: CSSProperties;
  testId?: string;
}) {
  const fill = danger ? '#380707' : '#1E2D32';
  const edge = danger ? 'linear-gradient(to top, #C30101, #7D0807)' : 'linear-gradient(to top, #038FC3, #595A5B)';
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{
        borderRadius: 15,
        padding: '0.8rem 1.5rem',
        border: '2px solid transparent',
        background: `linear-gradient(${fill}, ${fill}) padding-box, ${edge} border-box`,
        color: disabled ? '#666666' : '#fff',
        fontSize: 14,
        fontWeight: 600,
        fontFamily: 'inherit',
        letterSpacing: '0.02em',
        cursor: disabled ? 'default' : 'pointer',
        filter: 'none',
        transition: 'filter 120ms ease',
        ...style,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.filter = 'brightness(1.2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
    >
      {children}
    </button>
  );
}

// One card in the prompt grid: catalog art, karabast's selection ring
// (#66E5FF) + the selection dot under selectable cards.
// Reveal verdicts, painted straight onto the hand: green = you both
// resourced it, red = only they did, gray = only you did.
export type PickVerdict = 'match' | 'theirs' | 'mine';
export const VERDICT_STYLE: Record<PickVerdict, { color: string; label: string }> = {
  match: { color: '#00E25B', label: 'Both picked' },
  // Yellow, deliberately not red: their pick isn't WRONG, it's the
  // difference worth discussing.
  theirs: { color: '#FFD60A', label: 'Their pick' },
  // Cyan = the game's own "your selection" color (stage-2 picks ring cyan) —
  // "yours" without any correctness implication. Symmetric with yellow.
  mine: { color: '#66E5FF', label: 'Your pick' },
};

export function QuizCard({
  card,
  selected,
  selectable,
  verdict,
  onClick,
  width = 104,
  testId,
  noPreview,
}: {
  card: QuizCardRef;
  selected?: boolean;
  selectable?: boolean;
  verdict?: PickVerdict;
  onClick?: () => void;
  width?: number;
  testId?: string;
  // Suppress the per-card hover preview (the Team-picks minis preview the
  // whole member hand instead — handled by the parent).
  noPreview?: boolean;
}) {
  const url = cardImageUrl({ set: card.set, number: card.number });
  const preview = useCardPreview();
  const { show, anchor } = preview;
  const handlers = noPreview ? {} : preview.handlers;
  const v = verdict ? VERDICT_STYLE[verdict] : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      {/* NOT the disabled attribute — a disabled button swallows the hover /
          touch events the full-size preview depends on. Click is guarded
          instead. */}
      <button
        type="button"
        data-testid={testId}
        onClick={selectable ? onClick : undefined}
        aria-pressed={selectable ? selected : undefined}
        aria-label={card.name ?? card.id}
        {...handlers}
        style={{
          position: 'relative',
          padding: 0,
          background: 'transparent',
          // forceteki selectedCardBorderStyle: cyan ring when selected;
          // verdict colors take over on the reveal.
          border: v ? `2px solid ${v.color}` : selected ? '2px solid #66E5FF' : '2px solid transparent',
          borderRadius: 10,
          boxShadow: v ? `0 0 11px 3px ${v.color}b0` : selected ? '0 0 9px 2px rgba(102,229,255,0.55)' : 'none',
          cursor: selectable ? 'pointer' : 'default',
          lineHeight: 0,
          transition: 'box-shadow 120ms ease, transform 120ms ease',
          transform: selected || v ? 'translateY(-4px)' : 'none',
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={card.name ?? card.id}
            // Background + border so a still-loading (or failed) card art
            // reads as a card back, not an invisible hole in the hand.
            style={{ width, aspectRatio: '1/1.4', objectFit: 'cover', borderRadius: 8, display: 'block', background: '#101720', border: '1px solid rgba(255,255,255,0.12)', boxSizing: 'border-box' }}
          />
        ) : (
          <div
            style={{
              width,
              aspectRatio: '1/1.4',
              borderRadius: 8,
              background: '#101720',
              color: '#8a93a3',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 6,
              textAlign: 'center',
            }}
          >
            {card.name ?? card.id}
          </div>
        )}
        {v && (
          <>
            <span
              style={{
                position: 'absolute',
                inset: 0,
                background: `${v.color}3d`,
                borderRadius: 8,
                pointerEvents: 'none',
              }}
            />
            <span
              style={{
                position: 'absolute',
                bottom: 6,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.85)',
                color: v.color,
                fontSize: Math.max(9, width * 0.08),
                fontWeight: 700,
                lineHeight: 1.4,
                padding: '1px 7px',
                borderRadius: 5,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              {v.label}
            </span>
          </>
        )}
      </button>
      {selectable !== undefined && (
        // forceteki selectedIndicatorStyle: the little dot under each pickable card.
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '100%',
            backgroundColor: selected ? '#66E5FF' : '#666666',
            transition: 'background-color 120ms ease',
          }}
        />
      )}
      {!noPreview && show && url && <CardPreviewOverlay url={url} anchor={anchor.current} />}
    </div>
  );
}

// forceteki selectableCardsContainer — the responsive prompt card grid.
export function QuizCardGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: '1rem',
        justifyContent: 'center',
      }}
    >
      {children}
    </div>
  );
}

// The board's Initiative pill (lifted look: Gameboard/Board/Board.tsx
// `initiativeWrapper`, in its setup/unclaimed state — translucent fill,
// holder-colored border + text). Colors are the board theme's
// --initiative-blue/--initiative-red literals; that theme is scoped to the
// gameboard and isn't loaded here.
export function InitiativePill({ mine, small }: { mine: boolean; small?: boolean }) {
  const color = mine ? '#00BAFF' : '#FF3231';
  return (
    <span
      style={{
        display: 'inline-block',
        borderRadius: 20,
        border: `${small ? 1.5 : 2}px solid ${color}`,
        background: 'rgba(0, 0, 0, 0.5)',
        color,
        padding: small ? '0px 8px' : '2px 12px',
        fontSize: small ? 10.5 : 12,
        fontWeight: 600,
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      Initiative
    </span>
  );
}

// A leader/base as it sits in the karabast board's CENTER COLUMN: the
// LANDSCAPE face (the leader's undeployed side; bases are landscape cards),
// with the board's black name plate overlaying the lower edge. Hover /
// press-hold shows the full-size preview.
export function SeatCard({
  card,
  kind,
  label,
  width = 150,
  testId,
}: {
  card: { set?: string; number?: number | string; name?: string } | null;
  kind: 'leader' | 'base';
  label?: string;
  width?: number;
  testId?: string;
}) {
  const url = card ? cardImageUrl(card, kind === 'leader') : null;
  const { show, anchor, handlers } = useCardPreview();
  return (
    <div data-testid={testId} style={{ position: 'relative', width, flexShrink: 0 }} {...handlers}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={card?.name ?? ''}
          title={card?.name ?? undefined}
          style={{
            width: '100%',
            aspectRatio: '1.4/1',
            objectFit: 'cover',
            borderRadius: Math.max(6, width * 0.045),
            border: '1px solid rgba(255,255,255,0.16)',
            boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
            display: 'block',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            aspectRatio: '1.4/1',
            borderRadius: 8,
            border: '1px dashed #2e333c',
            color: '#6c7588',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 4,
          }}
        >
          {card?.name ?? '?'}
        </div>
      )}
      {label && (
        <div
          style={{
            position: 'absolute',
            bottom: '8%',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.88)',
            color: '#fff',
            padding: '2px 10px',
            borderRadius: 6,
            fontSize: Math.max(10, width * 0.075),
            fontWeight: 700,
            whiteSpace: 'nowrap',
            maxWidth: '96%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </div>
      )}
      {show && url && <CardPreviewOverlay url={url} landscape anchor={anchor.current} />}
    </div>
  );
}

// The hand: a FLAT overlapping row, like karabast's own PlayerHand (no arc —
// their hand isn't curved). SELF-SCALING: it measures its container and
// scales the whole row down so six cards always fit (the mobile case)
// instead of overflowing.
export function HandRow({ children, cardWidth = 112, overlap = 14 }: { children: ReactNode[]; cardWidth?: number; overlap?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const n = children.length;
  const natural = cardWidth + Math.max(0, n - 1) * (cardWidth - overlap); // width incl. overlaps
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / (natural + 8)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [natural]);

  // Card height + selection-dot row + the selected-card lift — reserve the
  // SCALED height so the layout hugs the shrunken row.
  const naturalH = cardWidth * 1.4 + 26 + 10;
  return (
    // alignItems flex-start is load-bearing: without it the inner row is
    // STRETCHED to the scaled wrapper height, and its own flex-end alignment
    // then shoves the (unscaled-layout) cards upward out of the box — they
    // painted over whatever sat above the hand.
    <div ref={ref} style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', height: naturalH * scale }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top center', display: 'flex', alignItems: 'flex-end', paddingTop: 10 }}>
        {children.map((child, i) => (
          <div key={i} style={{ marginLeft: i === 0 ? 0 : -overlap, zIndex: i }}>
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}

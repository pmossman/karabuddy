'use client';

// B66: mobile gets two new chrome elements that don't exist on desktop:
//
//   - <StepModeOverlay>  — small floating pill next to the ☰ button,
//                          always visible so users can flip Action↔Frame
//                          stepping without opening any drawer.
//
//   - <MatchupPanel>     — slide-in panel that opens with the ☰ button
//                          alongside the tags drawer. Anchored LEFT in
//                          landscape (slides from the left edge) and
//                          TOP in portrait (slides from the top edge —
//                          portrait is too narrow for two horizontal
//                          panels, so we split vertically instead).
//                          Carries matchup thumbs + chips + the View-
//                          decks button so the tags drawer stays slim.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardImageUrl } from '@/lib/cardImage';
import { matchChips } from '@/lib/matchMetadata';
import { DecksModal } from './DecksModal';
import { EditableTitle } from './EditableTitle';
import { SeriesNav, type SeriesInfo } from './SeriesNav';
import { LabelsRow } from './LabelsRow';
import { SharePopover } from './SharePopover';
import { ResultBadge } from './ResultBadge';
import { useDragSize, Grabber } from './useDragSize';
import { ClipsList, type ClipSummary } from './ClipsList';
import type { DecksByUserId, MatchMeta, Frame } from '@/lib/replayDecoder';

interface ReplayShape {
  slug: string;
  displayName?: string | null;
  labels?: string[] | null;
  players: any;
  winners?: string[] | null;
}

// B-followup: the desktop playback pill collapses to just the play button so it
// doesn't sit as a wide bar over the board; a "More"/"Less" toggle slides the
// rest (speed / step-by / animate) out. Remembered across frames+visits.
const CONTROLS_OPEN_KEY = 'karabuddy:playbackControlsOpen';

export function StepModeOverlay({
  mode,
  setMode,
  animate,
  onToggleAnimate,
  playing,
  onTogglePlay,
  speed,
  speeds,
  onSetSpeed,
  landscape,
  drawerOpen,
  drawerWidth,
  portraitDrawerOpen,
  portraitBottom,
  dragging,
  pulse,
}: {
  mode: 'action' | 'frame';
  setMode: (m: 'action' | 'frame') => void;
  // B104: card-movement animation toggle lives in this same pill — it's the
  // natural home alongside the step-mode control (both govern how stepping
  // looks), instead of a separate top-level button cluttering the board.
  animate: boolean;
  onToggleAnimate: () => void;
  // B104: auto-play transport. Play/pause + a podcast-style speed-cycle button
  // anchor the pill (left) since they're the primary "watch the replay" action;
  // the step-mode + animate controls sit after a divider.
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  speeds: { label: string; value: number }[];
  onSetSpeed: (s: number) => void;
  // Landscape (desktop or mobile-landscape) parks it directly LEFT of
  // the ☰ menu button — hugs the sidebar/drawer outer edge so it
  // tracks open/close + resize. Portrait can't share that corner with
  // the player's hand cards — pin to bottom-center; when the bottom
  // drawer is open, lift it above the drawer's top edge.
  landscape: boolean;
  // When provided, shifts the overlay LEFT by drawerWidth so the
  // overlay stays alongside the sidebar instead of being covered by it.
  drawerOpen?: boolean;
  drawerWidth?: string;
  // Portrait drawer (bottom slide-up) → lift the overlay above it. B100:
  // `portraitBottom` carries the live sheet height so the pill rides up with
  // the sheet as it's dragged; `dragging` kills the transition during a drag.
  portraitDrawerOpen?: boolean;
  portraitBottom?: string;
  dragging?: boolean;
  // B121: glow/pulse the Play button to cue first-time viewers; cleared once
  // they press play (remembered across visits in the viewer).
  pulse?: boolean;
}) {
  // Collapsed by default → just the play button + a slide-out handle. Restore the
  // viewer's last choice on mount (avoids an SSR flash by reading post-hydrate).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { const v = window.localStorage.getItem(CONTROLS_OPEN_KEY); if (v != null) setOpen(v === '1'); } catch {}
  }, []);
  const toggleOpen = () =>
    setOpen((v) => { const n = !v; try { window.localStorage.setItem(CONTROLS_OPEN_KEY, n ? '1' : '0'); } catch {} return n; });

  const positionStyle: React.CSSProperties = landscape
    ? {
        bottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
        // Slot 50px LEFT of the ☰ button. When sidebar/drawer is open,
        // the ☰ button has already shifted past it, so step overlay
        // follows the same shift to stay adjacent.
        right: drawerOpen && drawerWidth
          ? `calc(${drawerWidth} + 12px + 50px)`
          : 'calc(max(12px, env(safe-area-inset-right, 12px)) + 50px)',
      }
    : {
        bottom: portraitDrawerOpen
          ? portraitBottom ?? 'calc(60vh + 12px)'
          : 'max(12px, env(safe-area-inset-bottom, 12px))',
        left: '50%',
        transform: 'translateX(-50%)',
      };
  return (
    <div
      data-testid="step-mode-overlay"
      style={{
        position: 'fixed',
        zIndex: 90,
        transition: dragging
          ? 'none'
          : 'right 220ms cubic-bezier(0.4, 0, 0.2, 1), bottom 220ms cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(17, 20, 26, 0.85)',
        border: '1px solid rgba(77, 157, 255, 0.4)',
        borderRadius: 6,
        padding: '4px 8px',
        backdropFilter: 'blur(6px)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.45)',
        ...positionStyle,
      }}
    >
      {/* Transport: play/pause + speed cycle. Primary, so it leads the pill. */}
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause (space)' : 'Play (space)'}
        style={{
          width: 26,
          height: 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: pulse ? 'rgba(77, 157, 255, 0.8)' : playing ? 'rgba(77, 157, 255, 0.55)' : 'rgba(77, 157, 255, 0.25)',
          color: '#fff',
          border: 0,
          borderRadius: '50%',
          padding: 0,
          cursor: 'pointer',
          flex: '0 0 auto',
          ...(pulse ? { animation: 'kb-play-pulse 1.6s ease-in-out infinite' } : {}),
        }}
      >
        {playing ? <PauseGlyph /> : <PlayGlyph />}
      </button>
      {/* Collapsible region: speed / step-by / animate. A grid 1fr→0fr animates
          to the exact content width; the inner clip + `inert` keep the hidden
          controls out of the tab order while collapsed. Right-anchored, so it
          unfurls leftward and the play button stays put at the edge. The cog
          (after this) stays pinned to the pill's right edge in both states. */}
      <div
        data-testid="playback-extra-controls"
        data-open={open ? '1' : '0'}
        style={{
          display: 'grid',
          gridTemplateColumns: open ? '1fr' : '0fr',
          opacity: open ? 1 : 0,
          transition: dragging
            ? 'none'
            : 'grid-template-columns 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease',
        }}
        inert={!open}
      >
        <div style={{ overflow: 'hidden', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <SpeedMenu speed={speed} speeds={speeds} onSetSpeed={onSetSpeed} />
          <span style={{ width: 1, alignSelf: 'stretch', margin: '2px 0', background: 'rgba(77, 157, 255, 0.25)' }} />
          {landscape && (
            <span style={{
              fontSize: 10,
              color: '#6c7588',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 700,
              fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
              whiteSpace: 'nowrap',
            }}>
              Step by:
            </span>
          )}
          <div style={{ display: 'flex', gap: 0 }}>
            <ModeButton active={mode === 'action'} onClick={() => setMode('action')}>Action</ModeButton>
            <ModeButton active={mode === 'frame'} onClick={() => setMode('frame')}>Frame</ModeButton>
          </div>
          <span style={{ width: 1, alignSelf: 'stretch', margin: '2px 0', background: 'rgba(77, 157, 255, 0.25)' }} />
          <button
            type="button"
            onClick={onToggleAnimate}
            aria-pressed={animate}
            title={animate ? 'Card animation on — tap to disable' : 'Card animation off — tap to enable'}
            style={{
              background: animate ? 'rgba(77, 157, 255, 0.4)' : 'transparent',
              color: animate ? '#fff' : '#6c7588',
              border: 0,
              padding: landscape ? '4px 8px' : '4px 7px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              borderRadius: 4,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flex: '0 0 auto',
            }}
          >
            <span style={{ fontSize: 12 }}>✦</span>
            {landscape && <span style={{ fontSize: 11 }}>Animate</span>}
          </button>
          <span style={{ width: 1, alignSelf: 'stretch', margin: '2px 0', background: 'rgba(77, 157, 255, 0.25)' }} />
        </div>
      </div>
      {/* Settings cog — pinned to the pill's far-right edge; lit while expanded. */}
      <CollapseToggle open={open} onClick={toggleOpen} />
      {/* B128: the Flip control moved to the dedicated double-sided bubble
          (PovBubble) alongside the auto-switch toggle. */}
    </div>
  );
}

// Small inline transport glyphs — crisp at any DPI, theme via currentColor.
function PlayGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" style={{ marginLeft: 1 }}>
      <path d="M2.5 1.5 L10 6 L2.5 10.5 Z" fill="currentColor" />
    </svg>
  );
}
function PauseGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.5" y="2" width="2.6" height="8" rx="0.6" fill="currentColor" />
      <rect x="6.9" y="2" width="2.6" height="8" rx="0.6" fill="currentColor" />
    </svg>
  );
}

// B104: speed picker. Tapping the rate chip opens a small pop-up list (above
// the pill, since it lives at the bottom edge) of every speed — pick one
// directly instead of cycling through them. Click-outside / Escape closes it.
function SpeedMenu({ speed, speeds, onSetSpeed }: { speed: number; speeds: { label: string; value: number }[]; onSetSpeed: (s: number) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // B173: the dropdown is portalled to <body> because the pill's collapse
  // animation needs `overflow: hidden` on the controls row — which clipped this
  // pop-up (it opens ABOVE the bottom-edge pill) into invisibility. Clicking only
  // flipped the caret; the list never showed, so the speed never changed. Fixed
  // coords from the button rect let it escape the clip + any stacking context.
  const [coords, setCoords] = useState<{ left: number; bottom: number } | null>(null);
  const place = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setCoords({ left: r.left + r.width / 2, bottom: window.innerHeight - r.top + 8 });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onReflow = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);
  const activeLabel = speeds.find((o) => o.value === speed)?.label ?? '1×';
  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', flex: '0 0 auto' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Playback speed: ${activeLabel}`}
        title="Playback speed"
        style={{
          height: 26,
          background: open ? 'rgba(77, 157, 255, 0.25)' : 'transparent',
          color: '#a7d2ff',
          border: 0,
          padding: '0 7px',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
          borderRadius: 4,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
        }}
      >
        {activeLabel}
        <span aria-hidden="true" style={{ fontSize: 8, opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none' }}>▲</span>
      </button>
      {open && coords && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label="Playback speed"
          style={{
            position: 'fixed',
            bottom: coords.bottom,
            left: coords.left,
            transform: 'translateX(-50%)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            padding: 4,
            background: 'rgba(17, 20, 26, 0.97)',
            border: '1px solid rgba(77, 157, 255, 0.4)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(6px)',
          }}
        >
          {speeds.map((o) => {
            const active = o.value === speed;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onSetSpeed(o.value); setOpen(false); }}
                style={{
                  minWidth: 84,
                  padding: '6px 14px',
                  background: active ? 'rgba(77, 157, 255, 0.4)' : 'transparent',
                  color: active ? '#fff' : '#a7d2ff',
                  border: 0,
                  borderRadius: 5,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
                  textAlign: 'left',
                  lineHeight: 1.1,
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// The expand/collapse handle for the desktop playback pill — a settings cog
// pinned to the pill's far-right edge (in both states). Lit while the controls
// are expanded so it reads as the active "more controls" affordance.
function CollapseToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={open ? 'Hide playback controls' : 'Show playback controls'}
      title={open ? 'Hide controls' : 'Show controls'}
      data-testid="controls-collapse-toggle"
      style={{
        width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: open ? 'rgba(77, 157, 255, 0.4)' : 'transparent',
        color: open ? '#fff' : '#a7d2ff',
        border: 0, borderRadius: 4, padding: 0, cursor: 'pointer', flex: '0 0 auto',
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
      </svg>
    </button>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: active ? 'rgba(77, 157, 255, 0.4)' : 'transparent',
        color: active ? '#fff' : '#a7d2ff',
        border: 0,
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        borderRadius: 4,
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

// B104: mobile playback-controls bubble. A round FAB (sliders glyph, lit while
// playing) that opens a compact panel above it — play/pause, speed, step-mode,
// animate — so the controls collapse off the cramped bottom edge into the same
// FAB+bubble pattern as the ☰ review and ⓘ matchup affordances.
export function MobileControlsFab({
  mode, setMode, animate, onToggleAnimate,
  playing, onTogglePlay, speed, speeds, onSetSpeed,
  bottom, right, dragging, pulse,
}: {
  mode: 'action' | 'frame';
  setMode: (m: 'action' | 'frame') => void;
  animate: boolean;
  onToggleAnimate: () => void;
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  speeds: { label: string; value: number }[];
  onSetSpeed: (s: number) => void;
  bottom: string;
  right: string;
  dragging?: boolean;
  // B121: pulse the Play button for first-time viewers (cleared on first play).
  pulse?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const sectionLabel: React.CSSProperties = {
    fontSize: 10, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.07em',
    fontWeight: 700, fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
  };
  return (
    <div
      ref={wrapRef}
      style={{
        position: 'fixed', bottom, right, zIndex: 91,
        transition: dragging ? 'none' : 'right 220ms cubic-bezier(0.4, 0, 0.2, 1), bottom 220ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {open && (
        <div
          role="dialog"
          aria-label="Playback controls"
          style={{
            position: 'absolute', bottom: 'calc(100% + 10px)', right: 0, width: 232,
            display: 'flex', flexDirection: 'column', gap: 13, padding: 14,
            background: 'rgba(17, 20, 26, 0.97)', border: '1px solid rgba(77, 157, 255, 0.4)',
            borderRadius: 12, boxShadow: '0 6px 22px rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={sectionLabel}>Speed</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {speeds.map((o) => {
                const active = o.value === speed;
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSetSpeed(o.value)}
                    style={{
                      flex: '1 0 auto', padding: '7px 10px', borderRadius: 6, border: 0, cursor: 'pointer',
                      background: active ? 'rgba(77, 157, 255, 0.4)' : 'rgba(255, 255, 255, 0.05)',
                      color: active ? '#fff' : '#a7d2ff', fontSize: 12, fontWeight: 700,
                      fontFamily: 'var(--font-barlow), -apple-system, sans-serif', lineHeight: 1,
                    }}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={sectionLabel}>Step by</span>
            <div style={{ display: 'inline-flex', alignSelf: 'flex-start', border: '1px solid rgba(77, 157, 255, 0.3)', borderRadius: 6, overflow: 'hidden' }}>
              <ModeButton active={mode === 'action'} onClick={() => setMode('action')}>Action</ModeButton>
              <ModeButton active={mode === 'frame'} onClick={() => setMode('frame')}>Frame</ModeButton>
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleAnimate}
            aria-pressed={animate}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid ' + (animate ? 'rgba(77, 157, 255, 0.5)' : 'rgba(255, 255, 255, 0.08)'),
              background: animate ? 'rgba(77, 157, 255, 0.18)' : 'transparent',
              color: animate ? '#d6e7ff' : '#8b93a5', fontSize: 12, fontWeight: 700,
              fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 13 }}>✦</span> Card animation</span>
            <span style={{ fontSize: 11, opacity: 0.9 }}>{animate ? 'On' : 'Off'}</span>
          </button>

          {/* B128: the Perspective control moved to the dedicated double-sided
              bubble (PovBubble) alongside the auto-switch toggle. */}
        </div>
      )}
      {/* Joined capsule: play/pause (always one tap) fused to the controls
          opener, so it's obvious the second half surfaces finer settings. */}
      <div
        style={{
          display: 'flex', alignItems: 'stretch', height: 38,
          borderRadius: 19, overflow: 'hidden',
          border: '1px solid rgba(77, 157, 255, 0.4)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.45)', backdropFilter: 'blur(6px)',
          background: 'rgba(36, 48, 68, 0.85)',
        }}
      >
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
          style={{
            width: 44, border: 0, padding: 0, cursor: 'pointer',
            background: pulse ? 'rgba(77, 157, 255, 0.7)' : playing ? 'rgba(77, 157, 255, 0.5)' : 'transparent',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 160ms ease',
            ...(pulse ? { animation: 'kb-play-pulse 1.6s ease-in-out infinite' } : {}),
          }}
        >
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <span aria-hidden="true" style={{ width: 1, background: 'rgba(77, 157, 255, 0.35)' }} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Playback settings"
          aria-expanded={open}
          title="Playback settings"
          style={{
            width: 40, border: 0, padding: 0, cursor: 'pointer',
            background: open ? 'rgba(77, 157, 255, 0.32)' : 'transparent',
            color: '#d6e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
            transition: 'background 160ms ease',
          }}
        >
          <SlidersGlyph />
          <span aria-hidden="true" style={{ fontSize: 7, opacity: 0.75, transform: open ? 'rotate(180deg)' : 'none' }}>▲</span>
        </button>
      </div>
    </div>
  );
}

// Horizontal-sliders "controls" glyph for the mobile playback FAB.
function SlidersGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="8" x2="20" y2="8" />
      <circle cx="9" cy="8" r="2.4" fill="#1a1d24" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="15" cy="16" r="2.4" fill="#1a1d24" />
    </svg>
  );
}

export function MatchupPanel({
  open,
  onClose,
  anchor,
  replay,
  matchMeta,
  decks,
  localPlayerId,
  frames,
  installToken,
  isOwner,
  anonymize,
  series,
  clips,
  onOpenResourcing,
  onOpenSideboard,
}: {
  open: boolean;
  onClose: () => void;
  // 'left' = landscape (slides from left edge, narrow column).
  // 'top'  = portrait  (slides from top edge, full width minus margins).
  anchor: 'left' | 'top';
  replay: ReplayShape;
  matchMeta: MatchMeta | null;
  decks: DecksByUserId | null;
  localPlayerId: string | null;
  frames: Frame[] | null;
  // B66e: title + labels edit affordances are now mirrored from the
  // desktop sidebar so mobile users can rename + re-tag without
  // bouncing out of the panel. Owner-gated client-side; server enforces.
  installToken: string;
  isOwner: boolean;
  // B122: anonymized viewer — leader-matchup default title + hide deck-page link.
  anonymize?: boolean;
  // B129: the games of this replay's Bo3 series — Game-N title suffix + hop pills.
  series?: SeriesInfo | null;
  // B138: clips already created on this replay → a Clips section in the panel.
  clips?: ClipSummary[];
  // B149: open the resourcing report (moved here from the review panel).
  onOpenResourcing?: () => void;
  // B150: open the sideboard-changes splash (swaps vs the previous game).
  onOpenSideboard?: () => void;
}) {
  const [decksOpen, setDecksOpen] = useState(false);
  const players = (replay.players as any[]) || [];
  const [p1, p2] = players;
  const chips = matchChips(matchMeta);

  // B100: draggable size, matching the review sheet. TOP (portrait) → height,
  // grabber on the BOTTOM edge (drag down grows → grow +1). LEFT (landscape)
  // → width, grabber on the RIGHT edge (drag right grows → grow +1).
  const top = anchor === 'top';
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const drag = useDragSize({
    axis: top ? 'y' : 'x',
    grow: 1,
    initial: top ? Math.round(vh * 0.42) : Math.min(300, Math.round(vw * 0.6)),
    min: top ? 140 : 200,
    // Reserve a fixed minimum board size (240px tall / 340px wide) so dragging
    // the matchup sheet open can't squish the board to a sliver.
    max: top ? Math.max(200, vh - 240) : Math.max(260, vw - 340),
    storageKey: top ? 'karabuddy:matchupSheetH' : 'karabuddy:matchupSheetW',
  });
  // Slide on transform; when CLOSED also flip visibility:hidden so the panel — and
  // its bottom-edge resize grabber — fully disappears rather than peeking above the
  // board (the closed transform alone left the grabber visible below the top offset).
  // Delay the hide until the slide-out finishes (220ms) so the animation still shows.
  const transition = drag.dragging
    ? 'none'
    : `transform 220ms cubic-bezier(0.4, 0, 0.2, 1), visibility 0s linear ${open ? '0s' : '220ms'}`;

  const anchorStyle: React.CSSProperties = top
    ? {
        left: 'max(8px, env(safe-area-inset-left, 8px))',
        right: 'max(8px, env(safe-area-inset-right, 8px))',
        height: drag.size,
        flexDirection: 'column',
        transform: open ? 'translateY(0)' : 'translateY(calc(-100% - 16px))',
      }
    : {
        left: 'max(8px, env(safe-area-inset-left, 8px))',
        width: drag.size,
        flexDirection: 'row',
        transform: open ? 'translateX(0)' : 'translateX(calc(-100% - 16px))',
      };

  return (
    <>
      <aside
        data-testid="match-panel"
        data-anchor={anchor}
        // B100: was auto-height; now an explicitly-sized, draggable sheet.
        // The aside is the non-scrolling frame (content scrolls inside) so the
        // grabber stays pinned to the resize edge regardless of scroll.
        style={{
          position: 'fixed',
          top: 'calc(var(--kb-header-h, 0px) + max(8px, env(safe-area-inset-top, 8px)))',
          maxHeight: 'calc(100vh - var(--kb-header-h, 0px) - 16px)',
          zIndex: 80,
          transition,
          visibility: open ? 'visible' : 'hidden',
          pointerEvents: open ? 'auto' : 'none',
          boxShadow: open ? '0 8px 24px rgba(0,0,0,0.45)' : 'none',
          background: 'rgba(17, 20, 26, 0.97)',
          border: '1px solid #2e333c',
          borderRadius: 10,
          color: '#e6e6e6',
          font: '12px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
          display: 'flex',
          overflow: 'hidden',
          ...anchorStyle,
        }}
      >
        <div style={{ flex: '1 1 auto', minWidth: 0, minHeight: 0, overflow: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <a href="/" style={{ color: '#a0a8b8', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>← karabuddy</a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* B194: the SAME SharePopover the desktop sidebar uses, as a bottom
                sheet here — so share lives in one component across both. */}
            <SharePopover replaySlug={replay.slug} installToken={installToken} isOwner={isOwner} asSheet />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close matchup panel"
              style={{ background: 'transparent', color: '#a0a8b8', border: 0, fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 0, width: 24, height: 24 }}
            >
              ×
            </button>
          </div>
        </div>

        {chips.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {chips.map((c) => (
              <span key={c} style={chipStyle}>{c}</span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <EditableTitle
            replaySlug={replay.slug}
            installToken={installToken}
            initialDisplayName={replay.displayName ?? null}
            defaultText={defaultTitleFor(replay, anonymize) + (series ? ` — Game ${series.current}` : '')}
            canEdit={isOwner}
          />
        </div>
        {/* B129: hop between the games of the same Bo3. */}
        {series && <SeriesNav series={series} />}

        {(isOwner || (Array.isArray(replay.labels) && replay.labels.length > 0)) && (
          <LabelsRow
            replaySlug={replay.slug}
            installToken={installToken}
            initialLabels={Array.isArray(replay.labels) ? replay.labels : []}
            canEdit={isOwner}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <MatchupPlayer player={p1} winners={replay.winners} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#6c7588', paddingTop: 11 }}>VS</span>
          <MatchupPlayer player={p2} winners={replay.winners} />
        </div>


        {onOpenSideboard && (
          <button
            type="button"
            onClick={() => { onClose(); onOpenSideboard(); }}
            style={{
              background: 'transparent',
              border: '1px solid #2e333c',
              borderRadius: 4,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 600,
              color: '#a7d2ff',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            ⇄ Sideboard changes
          </button>
        )}
        {onOpenResourcing && (
          <button
            type="button"
            onClick={onOpenResourcing}
            style={{
              background: 'transparent',
              border: '1px solid #2e333c',
              borderRadius: 4,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 600,
              color: '#a7d2ff',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            ⚡ Resourcing report
          </button>
        )}
        {decks && Object.keys(decks).length > 0 && (
          <button
            type="button"
            onClick={() => setDecksOpen(true)}
            style={{
              background: 'transparent',
              border: '1px solid #2e333c',
              borderRadius: 4,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 600,
              color: '#a7d2ff',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            View decks →
          </button>
        )}

        {clips && clips.length > 0 && (
          <div style={{ borderTop: '1px solid #2e333c', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, padding: '0 6px' }}>
              Clips · {clips.length}
            </span>
            <ClipsList clips={clips} />
          </div>
        )}
        </div>
        {/* Resize grabber on the edge nearest the board: bottom (top sheet)
            / right (left sheet). */}
        <Grabber
          orientation={top ? 'horizontal' : 'vertical'}
          dragging={drag.dragging}
          label="Drag to resize matchup panel"
          handleProps={drag.handleProps}
        />
      </aside>

      {decks && (
        <DecksModal
          open={decksOpen}
          onClose={() => setDecksOpen(false)}
          decks={decks}
          localPlayerId={localPlayerId}
          replaySlug={replay.slug}
          frames={frames}
          anonymize={anonymize}
        />
      )}
    </>
  );
}

function MatchupPlayer({ player, winners }: { player: any; winners?: string[] | null }) {
  if (!player) return <div style={{ flex: 1 }} />;
  const leaderImg = cardImageUrl(player.leader, true);
  const baseImg = cardImageUrl(player.base, false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 2 }}>
        <Thumb src={leaderImg} alt={player.leader?.name} />
        <Thumb src={baseImg} alt={player.base?.name} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
        <ResultBadge playerId={player.id} winners={winners} />
        <span style={{ fontSize: 11, fontWeight: 600, color: '#d6d6d6', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {playerUsername(player)}
        </span>
      </div>
    </div>
  );
}

function Thumb({ src, alt }: { src: string | null; alt?: string }) {
  if (!src) return <div style={thumbBoxStyle} title={alt || ''} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt || ''} loading="lazy" style={thumbImgStyle} />;
}

function playerUsername(p: any): string {
  const u: string | undefined = p?.username;
  if (!u || /^anonymous\s/i.test(u)) return 'anon';
  return u;
}

// Mirrors TagSidebar's defaultTitleFor — the same string the replay
// browser uses when no display name has been set.
function defaultTitleFor(replay: ReplayShape, anonymize?: boolean): string {
  const players = Array.isArray(replay.players) ? replay.players : [];
  const [p1, p2] = players;
  if (!p1 && !p2) return 'Replay';
  // B122: anonymized viewers identify the replay by leader matchup, not handles.
  if (anonymize) {
    const lead = (p: any) => p?.leader?.name || 'Unknown';
    return `${lead(p1)} vs ${lead(p2)}`;
  }
  return `${playerUsername(p1)} vs ${playerUsername(p2)}`;
}

const thumbImgStyle: React.CSSProperties = {
  width: 44,
  height: 30,
  objectFit: 'contain',
  borderRadius: 3,
  background: '#0a0c10',
  display: 'block',
};
const thumbBoxStyle: React.CSSProperties = { ...thumbImgStyle, border: '1px solid #2e333c' };

const chipStyle: React.CSSProperties = {
  background: 'rgba(77, 157, 255, 0.12)',
  border: '1px solid rgba(77, 157, 255, 0.3)',
  color: '#a7d2ff',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

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

import { useState } from 'react';
import { cardImageUrl } from '@/lib/cardImage';
import { matchChips } from '@/lib/matchMetadata';
import { DecksModal } from './DecksModal';
import { EditableTitle } from './EditableTitle';
import { LabelsRow } from './LabelsRow';
import { ResultBadge } from './ResultBadge';
import { useDragSize, Grabber } from './useDragSize';
import type { DecksByUserId, MatchMeta, Frame } from '@/lib/replayDecoder';

interface ReplayShape {
  slug: string;
  displayName?: string | null;
  labels?: string[] | null;
  players: any;
  winners?: string[] | null;
}

export function StepModeOverlay({
  mode,
  setMode,
  animate,
  onToggleAnimate,
  landscape,
  drawerOpen,
  drawerWidth,
  portraitDrawerOpen,
  portraitBottom,
  dragging,
}: {
  mode: 'action' | 'frame';
  setMode: (m: 'action' | 'frame') => void;
  // B104: card-movement animation toggle lives in this same pill — it's the
  // natural home alongside the step-mode control (both govern how stepping
  // looks), instead of a separate top-level button cluttering the board.
  animate: boolean;
  onToggleAnimate: () => void;
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
}) {
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
      <span style={{
        fontSize: 10,
        color: '#6c7588',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontWeight: 700,
        fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
      }}>
        Step by:
      </span>
      <div style={{ display: 'flex', gap: 0 }}>
        <ModeButton active={mode === 'action'} onClick={() => setMode('action')}>Action</ModeButton>
        <ModeButton active={mode === 'frame'} onClick={() => setMode('frame')}>Frame</ModeButton>
      </div>
      <span style={{ width: 1, alignSelf: 'stretch', margin: '2px 2px', background: 'rgba(77, 157, 255, 0.25)' }} />
      <button
        type="button"
        onClick={onToggleAnimate}
        aria-pressed={animate}
        title={animate ? 'Card animation on — click to disable' : 'Card animation off — click to enable'}
        style={{
          background: animate ? 'rgba(77, 157, 255, 0.4)' : 'transparent',
          color: animate ? '#fff' : '#6c7588',
          border: 0,
          padding: '4px 8px',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
          borderRadius: 4,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span style={{ fontSize: 11 }}>✦</span>
        <span style={{ fontSize: 11 }}>Animate</span>
      </button>
    </div>
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
  const transition = drag.dragging ? 'none' : 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)';

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="/" style={{ color: '#a0a8b8', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>← karabuddy</a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close matchup panel"
            style={{ background: 'transparent', color: '#a0a8b8', border: 0, fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 0, width: 24, height: 24 }}
          >
            ×
          </button>
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
            defaultText={defaultTitleFor(replay)}
            canEdit={isOwner}
          />
        </div>

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
function defaultTitleFor(replay: ReplayShape): string {
  const players = Array.isArray(replay.players) ? replay.players : [];
  const [p1, p2] = players;
  if (!p1 && !p2) return 'Replay';
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

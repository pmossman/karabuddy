'use client';

import React, { useLayoutEffect, useState } from 'react';
import { cardImageUrl } from '@/lib/cardImage';
import { GLASS } from './redesign/ui';
import type { SideboardChanges, SideboardChange, SideboardPlayerChanges } from '@/lib/sideboardDiff';

// B150: sideboard splash — what each player swapped vs the PREVIOUS game in this
// lobby. Overlays the board at frame 0 of a post-sideboard game (and re-openable
// on demand), mirroring the EndGameSummary pattern. Exact for the recording
// player; the opponent's masked deck simply doesn't appear.
//
// B216: card display aligned with the deck view — full card art in a grid, sized
// by a fit-to-space solver so images are as big as possible while every swap still
// fits without scrolling (falls back to scroll only when even the min size can't).
const IN_COLOR = '#6bd968';
const OUT_COLOR = '#ff6b6b';

const CARD_ASPECT = 0.71;      // width / height (portrait card)
const CARD_GAP = 8;            // gap between cards in a group grid
const COL_GAP = 24;            // gap between the IN and OUT columns
const GROUP_LABEL_H = 34;      // "IN"/"OUT" label + gap
const PLAYER_HEAD_H = 62;      // player name row + paddings + top border + block gap
const NO_CHANGE_H = 24;        // "kept the same deck" line
const HEADER_H = 118;          // splash header + grid padding (non-card vertical space)
const MIN_CARD_W = 84;
const MAX_CARD_W = 168;
// Copies are shown as a "pile": N-1 copies stacked behind the front card (SWU caps
// a deck at 3 of a card, so at most 2 behind). A fixed reserve (top+right) keeps
// every grid cell uniform regardless of how deep its pile is.
const STACK_OFF = 7;           // px each stacked copy is offset up + right
const STACK_MAX = 2;
const RESERVE = STACK_OFF * STACK_MAX;


interface PlayerCounts { inN: number; outN: number }

// "SET_NNN" → { set, number } for the art proxy.
function artFor(id: string): string | null {
  const m = /^([A-Za-z0-9]+)_(\d+)$/.exec(id);
  return m ? cardImageUrl({ set: m[1], number: m[2] }) : null;
}

// Largest uniform card width (px) such that every player fits within `availH`.
// IN and OUT sit SIDE BY SIDE (two columns), so a player's grid height is the
// TALLER of its two columns — this uses the modal's width and keeps cards big.
// Steps down from a sane max, mirroring the deck view's fit solver.
function solveCardWidth(gridW: number, availH: number, players: PlayerCounts[]): number {
  if (gridW <= 0 || availH <= 0) return MAX_CARD_W;
  for (let w = MAX_CARD_W; w >= MIN_CARD_W; w -= 2) {
    const cellW = w + RESERVE;               // pile reserve makes the cell bigger than the card
    const cellH = w / CARD_ASPECT + RESERVE;
    let h = 0;
    for (const p of players) {
      h += PLAYER_HEAD_H;
      if (p.inN === 0 && p.outN === 0) { h += NO_CHANGE_H; continue; }
      // Both groups present → they share the width in two columns; else full width.
      const both = p.inN > 0 && p.outN > 0;
      const colW = both ? (gridW - COL_GAP) / 2 : gridW;
      const cols = Math.max(1, Math.floor((colW + CARD_GAP) / (cellW + CARD_GAP)));
      const inRows = p.inN > 0 ? Math.ceil(p.inN / cols) : 0;
      const outRows = p.outN > 0 ? Math.ceil(p.outN / cols) : 0;
      const rows = both ? Math.max(inRows, outRows) : inRows + outRows;
      h += GROUP_LABEL_H + rows * (cellH + CARD_GAP);
    }
    if (h <= availH) return w;
  }
  return MIN_CARD_W;
}

// A "pile": the count as stacked copies (front card + count-1 offset behind it),
// the whole stack outlined in the group color so IN/OUT reads at a glance. The
// count is the depth of the pile, so the +N/−N badge is gone.
function SideCard({ change, color, w }: { change: SideboardChange; color: string; w: number }) {
  const url = artFor(change.id);
  const cardH = w / CARD_ASPECT;
  const behind = Math.min(Math.max(0, change.count - 1), STACK_MAX);
  const face = (front: boolean): React.CSSProperties => ({
    position: 'absolute', width: w, height: cardH, borderRadius: 8, overflow: 'hidden',
    border: `2px solid ${color}`, background: '#0b0e14',
    backgroundImage: url ? `url(${url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center',
    filter: front ? undefined : 'brightness(0.5)',
    boxShadow: front ? '0 3px 12px rgba(0,0,0,0.55)' : 'none',
  });
  return (
    <a href={`https://swudb.com/card/${change.id}`} target="_blank" rel="noreferrer"
      title={`${change.count}× ${change.internalName || change.id}`}
      style={{ position: 'relative', display: 'block', width: w + RESERVE, height: cardH + RESERVE, textDecoration: 'none' }}>
      {Array.from({ length: behind }, (_, i) => i + 1).map((k) => (
        <div key={k} style={{ ...face(false), left: k * STACK_OFF, bottom: k * STACK_OFF, zIndex: behind - k }} />
      ))}
      <div style={{ ...face(true), left: 0, bottom: 0, zIndex: behind + 1 }}>
        {!url && <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 4, textAlign: 'center', fontSize: 10, color: '#8b93a5' }}>{change.id}</span>}
      </div>
    </a>
  );
}

function CardGrid({ label, cards, color, w }: { label: string; cards: SideboardChange[]; color: string; w: number }) {
  if (cards.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color }}>{label}</span>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${w + RESERVE}px)`, gap: CARD_GAP, justifyContent: 'start' }}>
        {cards.map((c) => <SideCard key={`${label}-${c.id}`} change={c} color={color} w={w} />)}
      </div>
    </div>
  );
}

function PlayerBlock({ p, isLocal, w }: { p: SideboardPlayerChanges; isLocal: boolean; w: number }) {
  const leaderUrl = p.leader ? artFor(p.leader.id) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 14, borderTop: '1px solid #232834' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {leaderUrl && <img src={leaderUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', border: '1px solid #2e333c' }} />}
        <span style={{ fontSize: 14, fontWeight: 700, color: '#e6e9ef' }}>{p.username || 'Player'}{isLocal ? ' · You' : ''}</span>
      </div>
      {!p.changed ? (
        <div style={{ fontSize: 12.5, color: '#8b93a5', fontStyle: 'italic' }}>No sideboard changes — kept the same deck.</div>
      ) : (
        <div style={{ display: 'flex', gap: COL_GAP, alignItems: 'flex-start' }}>
          {p.in.length > 0 && <div style={{ flex: 1, minWidth: 0 }}><CardGrid label="IN" cards={p.in} color={IN_COLOR} w={w} /></div>}
          {p.out.length > 0 && <div style={{ flex: 1, minWidth: 0 }}><CardGrid label="OUT" cards={p.out} color={OUT_COLOR} w={w} /></div>}
        </div>
      )}
    </div>
  );
}

export function SideboardSplash({
  sideboard,
  currentGameNumber,
  localPlayerId,
  onClose,
}: {
  sideboard: SideboardChanges;
  currentGameNumber?: number | null;
  localPlayerId: string | null;
  onClose: () => void;
}) {
  // Local player first.
  const players = [...sideboard.players].sort((a, b) => (b.playerId === localPlayerId ? 1 : 0) - (a.playerId === localPlayerId ? 1 : 0));

  // Fit-to-space: measure the grid area, solve the largest card width that fits
  // all groups in the available height. Recompute on mount + resize.
  // Fit width is derived from the WINDOW (the modal is min(1040, 96vw); the grid
  // has 22px side padding) rather than a measured clientWidth — DOM measurement
  // read 0 on the first layout pass, so a deterministic calc is both correct and
  // race-free. Recompute on resize.
  const [cardW, setCardW] = useState(MIN_CARD_W);
  useLayoutEffect(() => {
    const counts: PlayerCounts[] = players.map((p) => ({ inN: p.changed ? p.in.length : 0, outN: p.changed ? p.out.length : 0 }));
    const measure = () => {
      const modalW = Math.min(1040, window.innerWidth * 0.96);
      const gridW = modalW - 44; // 22px padding each side
      const availH = window.innerHeight * 0.9 - HEADER_H; // dialog cap minus the non-card chrome
      setCardW(solveCardWidth(gridW, availH, counts));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideboard]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(6, 9, 14, 0.4)',
        animation: 'kb-egs-fade 200ms ease', padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-label="Sideboard changes"
        onClick={(e) => e.stopPropagation()}
        style={{
          ...GLASS,
          position: 'relative', width: 'min(1040px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          borderRadius: 18,
          color: '#e6e9ef', fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
          animation: 'kb-egs-pop 260ms cubic-bezier(0.34, 1.4, 0.5, 1)',
        }}
      >
        <button type="button" onClick={onClose} aria-label="Close sideboard"
          style={{ position: 'absolute', top: 10, right: 12, background: 'transparent', border: 0, color: '#8b93a5', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 4, zIndex: 1 }}>×</button>

        <div style={{ flex: '0 0 auto', textAlign: 'center', padding: '18px 20px 12px', borderBottom: '1px solid #1c2128' }}>
          <div style={{ fontSize: 24, lineHeight: 1, marginBottom: 4 }} aria-hidden="true">⇄</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Sideboarding</div>
          <div style={{ fontSize: 12, color: '#9aa3b4', marginTop: 2 }}>
            {currentGameNumber ? `Game ${currentGameNumber} · ` : ''}changes from Game {sideboard.fromGameNumber}
          </div>
        </div>

        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '4px 22px 20px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {players.map((p) => <PlayerBlock key={p.playerId} p={p} isLocal={p.playerId === localPlayerId} w={cardW} />)}
        </div>
      </div>
    </div>
  );
}

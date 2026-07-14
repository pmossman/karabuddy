'use client';

import React, { useLayoutEffect, useState } from 'react';
import { GLASS } from './redesign/ui';
import { CardPile, PileGrid, cardArtFromId, PILE_RESERVE, PILE_CARD_ASPECT } from '@/app/_components/CardPile';
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

const CARD_ASPECT = PILE_CARD_ASPECT; // width / height (portrait card)
const CARD_GAP = 8;            // gap between cards in a group grid
const COL_GAP = 24;            // gap between the IN and OUT columns
const GROUP_LABEL_H = 34;      // "IN"/"OUT" label + gap
const PLAYER_HEAD_H = 62;      // player name row + paddings + top border + block gap
const NO_CHANGE_H = 24;        // "kept the same deck" line
const HEADER_H = 118;          // splash header + grid padding (non-card vertical space)
const MIN_CARD_W = 84;
const MAX_CARD_W = 168;
// Copies are shown as a "pile" (see CardPile): the reserve keeps every grid cell
// uniform regardless of how deep its pile is.
const RESERVE = PILE_RESERVE;

interface PlayerCounts { inN: number; outN: number }

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

// Copies render as a "pile" (shared CardPile) — the count is the pile depth, so
// there's no +N/−N badge; the swudb link + a title tooltip stay.
function CardGrid({ label, cards, color, w }: { label: string; cards: SideboardChange[]; color: string; w: number }) {
  if (cards.length === 0) return null;
  return (
    <PileGrid label={label} color={color} w={w} gap={CARD_GAP}>
      {cards.map((c) => (
        <CardPile key={`${label}-${c.id}`} id={c.id} count={c.count} color={color} w={w}
          href={`https://swudb.com/card/${c.id}`} title={`${c.count}× ${c.internalName || c.id}`} name={c.internalName} />
      ))}
    </PileGrid>
  );
}

function PlayerBlock({ p, isLocal, w }: { p: SideboardPlayerChanges; isLocal: boolean; w: number }) {
  const leaderUrl = p.leader ? cardArtFromId(p.leader.id) : null;
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

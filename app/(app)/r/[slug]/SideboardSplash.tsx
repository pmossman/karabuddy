'use client';

import React, { useLayoutEffect, useState } from 'react';
import { cardImageUrl } from '@/lib/cardImage';
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
const ACCENT = '#4dd2ff';

const CARD_ASPECT = 0.71;      // width / height (portrait card)
const CARD_GAP = 8;            // gap between cards in a group grid
const BADGE_OVERHANG = 8;      // count badge hangs ~6px below the card's last row
const GROUP_LABEL_H = 34;      // "IN"/"OUT" label + gap + the inter-group gap
const PLAYER_HEAD_H = 62;      // player name row + paddings + top border + block gap
const HEADER_H = 118;          // splash header + grid padding (non-card vertical space)
const MIN_CARD_W = 72;
const MAX_CARD_W = 168;

// "SET_NNN" → { set, number } for the art proxy.
function artFor(id: string): string | null {
  const m = /^([A-Za-z0-9]+)_(\d+)$/.exec(id);
  return m ? cardImageUrl({ set: m[1], number: m[2] }) : null;
}

// Largest uniform card width (px) such that every player's IN/OUT groups fit
// within `availH` at container width `W`. Steps down from a sane max — mirrors the
// deck view's solveFitWidth, generalized over the splash's group structure.
function solveCardWidth(W: number, availH: number, groups: number[][]): number {
  if (W <= 0 || availH <= 0) return MAX_CARD_W;
  for (let w = MAX_CARD_W; w >= MIN_CARD_W; w -= 2) {
    const cols = Math.max(1, Math.floor((W + CARD_GAP) / (w + CARD_GAP)));
    const cardH = w / CARD_ASPECT;
    let h = 0;
    for (const player of groups) {
      h += PLAYER_HEAD_H;
      for (const count of player) {
        if (count === 0) continue;
        h += GROUP_LABEL_H + Math.ceil(count / cols) * (cardH + CARD_GAP) + BADGE_OVERHANG;
      }
    }
    if (h <= availH) return w;
  }
  return MIN_CARD_W;
}

function SideCard({ change, sign, color, w }: { change: SideboardChange; sign: '+' | '−'; color: string; w: number }) {
  const url = artFor(change.id);
  const badge = Math.max(20, Math.round(w * 0.28));
  return (
    <a href={`https://swudb.com/card/${change.id}`} target="_blank" rel="noreferrer"
      title={`${sign}${change.count} ${change.internalName || change.id}`}
      style={{ position: 'relative', display: 'block', width: w, textDecoration: 'none' }}>
      <div style={{
        aspectRatio: String(CARD_ASPECT), width: '100%', borderRadius: 8, overflow: 'hidden',
        border: `1px solid ${color}88`, background: '#0b0e14',
        backgroundImage: url ? `url(${url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center',
        boxShadow: `0 2px 10px rgba(0,0,0,0.4)`,
      }}>
        {!url && <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 4, textAlign: 'center', fontSize: 10, color: '#8b93a5' }}>{change.id}</span>}
      </div>
      <span style={{
        position: 'absolute', bottom: -6, right: -6, minWidth: badge, height: badge, padding: '0 5px',
        borderRadius: badge, background: color, color: '#0b0e14', border: '2px solid #0b0e14',
        fontSize: Math.max(11, Math.round(badge * 0.42)), fontWeight: 800, lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
      }}>{sign}{change.count}</span>
    </a>
  );
}

function CardGrid({ label, cards, color, sign, w }: { label: string; cards: SideboardChange[]; color: string; sign: '+' | '−'; w: number }) {
  if (cards.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color }}>{label}</span>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${w}px)`, gap: CARD_GAP, justifyContent: 'start' }}>
        {cards.map((c) => <SideCard key={`${label}-${c.id}`} change={c} sign={sign} color={color} w={w} />)}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <CardGrid label="IN" cards={p.in} color={IN_COLOR} sign="+" w={w} />
          <CardGrid label="OUT" cards={p.out} color={OUT_COLOR} sign="−" w={w} />
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
    const groups = players.map((p) => (p.changed ? [p.in.length, p.out.length] : [0]));
    const measure = () => {
      const modalW = Math.min(1040, window.innerWidth * 0.96);
      const gridW = modalW - 44; // 22px padding each side
      const availH = window.innerHeight * 0.9 - HEADER_H; // dialog cap minus the non-card chrome
      setCardW(solveCardWidth(gridW, availH, groups));
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
        background: 'rgba(6, 9, 14, 0.6)', backdropFilter: 'blur(3px)',
        animation: 'kb-egs-fade 200ms ease', padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-label="Sideboard changes"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', width: 'min(1040px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          background: 'linear-gradient(180deg, rgba(23,28,38,0.98), rgba(15,18,26,0.98))',
          border: `1px solid ${ACCENT}55`, borderRadius: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
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

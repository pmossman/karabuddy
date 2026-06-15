'use client';

import React from 'react';
import { cardImageUrl } from '@/lib/cardImage';
import type { SideboardChanges, SideboardChange, SideboardPlayerChanges } from '@/lib/sideboardDiff';

// B150: sideboard splash — what each player swapped vs the PREVIOUS game in this
// lobby. Overlays the board at frame 0 of a post-sideboard game (and re-openable
// on demand), mirroring the EndGameSummary pattern. Exact for the recording
// player; the opponent's masked deck simply doesn't appear.
const IN_COLOR = '#6bd968';
const OUT_COLOR = '#ff6b6b';
const ACCENT = '#4dd2ff';

// "SET_NNN" → { set, number } for the art proxy.
function artFor(id: string): string | null {
  const m = /^([A-Za-z0-9]+)_(\d+)$/.exec(id);
  return m ? cardImageUrl({ set: m[1], number: m[2] }) : null;
}

function CardChip({ change, sign, color }: { change: SideboardChange; sign: '+' | '−'; color: string }) {
  const url = artFor(change.id);
  return (
    <span
      title={`${sign}${change.count} ${change.internalName || change.id}`}
      style={{ position: 'relative', width: 46, height: 64, borderRadius: 5, flex: '0 0 auto', overflow: 'hidden', border: `1px solid ${color}66`, background: '#0b0e14' }}
    >
      {url ? (
        <img src={url} alt={change.internalName || change.id} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontSize: 8, color: '#8b93a5', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 2, textAlign: 'center' }}>{change.id}</span>
      )}
      <span style={{ position: 'absolute', bottom: 0, right: 0, background: color, color: '#0b0e14', fontSize: 10, fontWeight: 800, padding: '0 4px', borderTopLeftRadius: 5 }}>
        {sign}{change.count}
      </span>
    </span>
  );
}

function PlayerBlock({ p, isLocal }: { p: SideboardPlayerChanges; isLocal: boolean }) {
  const leaderUrl = p.leader ? artFor(p.leader.id) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0', borderTop: '1px solid #232834' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {leaderUrl && <img src={leaderUrl} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', border: '1px solid #2e333c' }} />}
        <span style={{ fontSize: 13, fontWeight: 700, color: '#e6e9ef' }}>{p.username || 'Player'}{isLocal ? ' · You' : ''}</span>
      </div>
      {!p.changed ? (
        <div style={{ fontSize: 12, color: '#8b93a5', fontStyle: 'italic' }}>No sideboard changes — kept the same deck.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {p.in.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: IN_COLOR }}>IN</span>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{p.in.map((c) => <CardChip key={`in-${c.id}`} change={c} sign="+" color={IN_COLOR} />)}</div>
            </div>
          )}
          {p.out.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: OUT_COLOR }}>OUT</span>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{p.out.map((c) => <CardChip key={`out-${c.id}`} change={c} sign="−" color={OUT_COLOR} />)}</div>
            </div>
          )}
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
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(6, 9, 14, 0.55)', backdropFilter: 'blur(3px)',
        animation: 'kb-egs-fade 200ms ease', padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-label="Sideboard changes"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', width: 'min(440px, 100%)', maxHeight: '100%', overflowY: 'auto',
          background: 'linear-gradient(180deg, rgba(23,28,38,0.98), rgba(15,18,26,0.98))',
          border: `1px solid ${ACCENT}55`, borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          padding: '18px 20px 16px', color: '#e6e9ef', fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
          animation: 'kb-egs-pop 260ms cubic-bezier(0.34, 1.4, 0.5, 1)',
        }}
      >
        <button type="button" onClick={onClose} aria-label="Close sideboard"
          style={{ position: 'absolute', top: 8, right: 10, background: 'transparent', border: 0, color: '#8b93a5', fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 4 }}>×</button>

        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 26, lineHeight: 1, marginBottom: 4 }} aria-hidden="true">⇄</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Sideboarding</div>
          <div style={{ fontSize: 12, color: '#9aa3b4', marginTop: 2 }}>
            {currentGameNumber ? `Game ${currentGameNumber} · ` : ''}changes from Game {sideboard.fromGameNumber}
          </div>
        </div>

        {players.map((p) => <PlayerBlock key={p.playerId} p={p} isLocal={p.playerId === localPlayerId} />)}
      </div>
    </div>
  );
}

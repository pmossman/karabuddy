import React from 'react';
import { cardImageUrl } from '@/lib/cardImage';

// B231: the "pile" card — a card shown with its copy-count as a physical stack
// (count-1 copies offset up+right behind the front card; SWU caps a deck at 3, so
// ≤2 behind). The whole stack is outlined in a group color so IN/OUT reads at a
// glance and the quantity is VISUAL, not a tiny badge. Extracted from the replay
// SideboardSplash (B150/B216) and shared with the team Sideboard Guides so both
// speak the same stacked-card language.

export const PILE_STACK_OFF = 7;              // px each stacked copy is offset up + right
export const PILE_STACK_MAX = 2;
export const PILE_RESERVE = PILE_STACK_OFF * PILE_STACK_MAX; // reserved cell padding so cells stay uniform
export const PILE_CARD_ASPECT = 0.71;         // width / height (portrait card)
export const PILE_GAP = 8;

// "SET_NNN" (or foil "SET_NNNF") → art url via the /card-art proxy.
export function cardArtFromId(id: string): string | null {
  const m = /^([A-Za-z0-9]+)_0*(\d+)/.exec(id);
  return m ? cardImageUrl({ set: m[1], number: m[2] }) : null;
}

export function CardPile({ id, count, color, w, href, title, name }: {
  id: string; count: number; color: string; w: number; href?: string; title?: string; name?: string | null;
}) {
  const url = cardArtFromId(id);
  const cardH = w / PILE_CARD_ASPECT;
  const behind = Math.min(Math.max(0, count - 1), PILE_STACK_MAX);
  const face = (front: boolean): React.CSSProperties => ({
    // border-box so the 2px border is inside `w` — otherwise the offset copies
    // extend past the reserved cell width and collide with adjacent content.
    position: 'absolute', width: w, height: cardH, boxSizing: 'border-box', borderRadius: 8, overflow: 'hidden',
    border: `2px solid ${color}`, background: '#0b0e14',
    backgroundImage: url ? `url(${url})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center',
    filter: front ? undefined : 'brightness(0.5)',
    boxShadow: front ? '0 3px 12px rgba(0,0,0,0.55)' : 'none',
  });
  const boxStyle: React.CSSProperties = { position: 'relative', display: 'block', width: w + PILE_RESERVE, height: cardH + PILE_RESERVE, textDecoration: 'none' };
  const inner = (
    <>
      {Array.from({ length: behind }, (_, i) => i + 1).map((k) => (
        <div key={k} style={{ ...face(false), left: k * PILE_STACK_OFF, bottom: k * PILE_STACK_OFF, zIndex: behind - k }} />
      ))}
      <div style={{ ...face(true), left: 0, bottom: 0, zIndex: behind + 1 }}>
        {!url && <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 4, textAlign: 'center', fontSize: 10, color: '#8b93a5' }}>{name || id}</span>}
      </div>
    </>
  );
  return href
    ? <a href={href} target="_blank" rel="noreferrer" title={title} style={boxStyle}>{inner}</a>
    : <div title={title} style={boxStyle}>{inner}</div>;
}

// label + auto-fill grid of piles. The caller sizes cards via `w` (a fit solver
// in the modal; a fixed size inline).
export function PileGrid({ label, color, w, gap = PILE_GAP, children }: { label?: React.ReactNode; color?: string; w: number; gap?: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label != null && <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color }}>{label}</span>}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${w + PILE_RESERVE}px)`, gap, justifyContent: 'start' }}>
        {children}
      </div>
    </div>
  );
}

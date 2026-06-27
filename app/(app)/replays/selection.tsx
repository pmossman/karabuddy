'use client';

import { createContext, useContext } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// Multi-select for the replay lists. ReplayFilters owns the state and provides
// this context; the row renderers (TableView rows + ReplayCard) consume it, so
// selection threads through all 4 view modes without prop-drilling. A row is
// only selectable when the viewer could act on it individually — `canManage`
// (personal library) OR `isMine` (the team grid, where you may only bulk-act on
// your own uploads).
export interface ReplaySelectionApi {
  selectMode: boolean;
  selected: Set<string>;
  toggle: (slug: string) => void;
  selectable: (row: { isMine?: boolean }) => boolean;
}

const Ctx = createContext<ReplaySelectionApi | null>(null);
export const ReplaySelectionProvider = Ctx.Provider;
export const useReplaySelection = () => useContext(Ctx);

// Icon-only LED checkbox for picking a row/card. Mirrors LedToggle's a11y
// (role=checkbox + aria-checked + keyboard) and LED look, but carries no visible
// label — a per-row control can't. NOT a native input (CI bans type=checkbox).
export function SelectBox({ checked, onToggle, label, size = 18 }: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  size?: number;
}) {
  const accent = checked ? tokens.led.on : tokens.led.off;
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: 4, flex: '0 0 auto', cursor: 'pointer',
        border: `1.5px solid ${accent}`,
        background: checked ? 'rgba(77,210,255,0.14)' : 'rgba(0,0,0,0.45)',
        boxShadow: checked ? tokens.led.ringGlow : tokens.led.ringInert,
        transition: 'background 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
      }}
    >
      {checked && (
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.4 6.4 L4.8 8.8 L9.6 3.2" stroke={tokens.led.on} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

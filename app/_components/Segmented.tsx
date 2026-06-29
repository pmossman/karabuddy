'use client';

import React from 'react';

// Shared single-select segmented button group. Two looks lived inline across the
// app and are preserved here as VARIANTS — the component deliberately does NOT
// unify them into one style:
//   - `track` (the /stats StatsClient look): a joined, overflow-hidden bar with a
//     tinted active segment. `size='md'` (default) is the StatsClient geometry;
//     `size='sm'` is a tighter version.
//   - `pill` (the /replays ViewSwitcher look): individually-bordered buttons in a
//     gap:4 row.
// Generic over the value type — strings OR a boolean (so an All/Internal yes-no
// toggle can use it); compare with === and key by String(v).

type Variant = 'track' | 'pill';
type Size = 'sm' | 'md';

function containerStyle(variant: Variant): React.CSSProperties {
  return variant === 'pill'
    ? { display: 'flex', gap: 4 }
    : { display: 'inline-flex', border: '1px solid #2e333c', borderRadius: 6, overflow: 'hidden' };
}

function buttonStyle(variant: Variant, size: Size, active: boolean): React.CSSProperties {
  if (variant === 'pill') {
    return {
      background: active ? 'rgba(77, 157, 255, 0.18)' : 'transparent',
      color: active ? '#e6e6e6' : '#a0a8b8',
      border: '1px solid ' + (active ? 'rgba(77, 157, 255, 0.5)' : '#2e333c'),
      borderRadius: 4,
      padding: size === 'sm' ? '3px 8px' : '4px 10px',
      fontSize: 11,
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: 'inherit',
    };
  }
  // track
  return {
    background: active ? 'rgba(77,157,255,0.22)' : 'transparent',
    color: active ? '#fff' : '#a0a8b8',
    border: 0,
    padding: size === 'sm' ? '6px 10px' : '6px 14px',
    fontSize: 12,
    fontWeight: size === 'sm' ? 600 : 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

export function Segmented<V extends string | boolean>({
  value,
  onChange,
  options,
  ariaLabel,
  variant = 'track',
  size = 'md',
}: {
  value: V;
  onChange: (v: V) => void;
  // [value, label] tuples — label is a ReactNode (counts / icons allowed).
  options: ReadonlyArray<readonly [V, React.ReactNode]>;
  ariaLabel?: string;
  variant?: Variant;
  size?: Size;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={containerStyle(variant)}>
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          style={buttonStyle(variant, size, v === value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

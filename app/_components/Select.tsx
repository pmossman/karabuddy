'use client';

import React from 'react';

// Shared styled native <select>. Extracted from the byte-for-byte copies that
// lived in /stats StatsClient (the `sm` look) and /clips ClipsBrowser (the
// larger `md` look) and reused by /replays ReplayFilters. Generic over the value
// type so callers keep their string-literal unions; `style` shallow-merges last
// as a per-site escape hatch (e.g. /replays' radius-4 / tighter padding).
const SELECT_BASE: React.CSSProperties = {
  background: '#11141a',
  color: '#e6e6e6',
  border: '1px solid #2e333c',
  fontFamily: 'inherit',
  cursor: 'pointer',
  maxWidth: 220,
};
const SELECT_SIZE: Record<'sm' | 'md', React.CSSProperties> = {
  sm: { borderRadius: 6, padding: '6px 10px', fontSize: 12 },
  md: { borderRadius: 8, padding: '8px 12px', fontSize: 14 },
};

export function Select<V extends string>({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  size = 'sm',
  style,
}: {
  value: V;
  onChange: (v: V) => void;
  // [value, label] tuples.
  options: ReadonlyArray<readonly [V, string]>;
  // When set, renders a leading <option value="">{placeholder}</option>.
  placeholder?: string;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as V)}
      aria-label={ariaLabel}
      style={{ ...SELECT_BASE, ...SELECT_SIZE[size], ...style }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(([v, label]) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </select>
  );
}

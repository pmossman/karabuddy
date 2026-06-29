'use client';

import React from 'react';

// Shared filter-toolbar primitives, extracted from the independently-built
// pieces in /stats StatsClient and /replays ReplayFilters. Like Select/Segmented,
// this deliberately does NOT unify the two sites' looks — it owns the shared
// CONTRACT (the {label, onClear} chip, the labelled Field) and parameterizes the
// genuine per-site visual differences so each surface stays byte-identical.
//
// Not extracted: each site's "Filters" disclosure toggle. They diverge too far
// (StatsClient = plain text "Filters (N)" + ▲/▼; ReplayFilters = funnel icon +
// cyan count BADGE + ▴/▾ + aria-label). A single component would need ~10 props
// and two structural branches for the count — a kitchen sink that would risk
// either look — so both stay bespoke at their call sites (a justified split).

// An active-filter chip: tap to reset that control to its default. The two sites'
// pills differ in nearly every visual property (fill/text/border opacity, radius,
// padding, row layout, the ✕ vs × glyph), so only the structural commons live in
// the base — each site passes its full skin via `style` and its glyph via
// `glyph`/`glyphStyle`.
export function FilterChip({
  label,
  onClear,
  style,
  glyph = '✕',
  glyphStyle,
  title,
}: {
  label: React.ReactNode;
  onClear: () => void;
  style?: React.CSSProperties;
  glyph?: React.ReactNode;
  glyphStyle?: React.CSSProperties;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      title={title}
      style={{ cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600, ...style }}
    >
      {label} <span style={{ color: '#6c7588', ...glyphStyle }}>{glyph}</span>
    </button>
  );
}

// A labelled control. `orientation` covers both sites' layouts exactly:
//   - `row` (the /stats look): an inline-flex `<span>` with an inline, colon-
//     suffixed label beside the control.
//   - `column` (the /replays look): a stacked `<label>` with an uppercase,
//     heavier label above the control (no colon).
// The colon and the wrapping element are tied to the orientation because that's
// how each site renders — they never mix.
export function Field({
  label,
  orientation,
  children,
}: {
  label: string;
  orientation: 'row' | 'column';
  children: React.ReactNode;
}) {
  if (orientation === 'row') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}:</span>
        {children}
      </span>
    );
  }
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

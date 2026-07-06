'use client';

import { useEffect, useRef, useState } from 'react';
import { dateRangeBounds, dateRangeLabel } from '@/lib/dateRange';

// Shared TIME filter (openings / replay browser / stats): rolling presets
// PLUS an explicit from/to date range — "Past 30 days" is not enough when
// you want "the week of the regional". Value grammar lives in
// lib/dateRange.ts ('' | '30d' | 'YYYY-MM-DD..YYYY-MM-DD', open ends ok) so
// URL params, filter memory, and the stats API all share it.
// Self-contained popover (outside-click + Esc), same interaction contract as
// <LeaderSelect> — rows must close the panel on select.

const PRESETS: Array<[string, string]> = [
  ['', 'Any time'],
  ['7d', 'Past 7 days'],
  ['30d', 'Past 30 days'],
  ['90d', 'Past 90 days'],
];

export function DateRangeSelect({
  value,
  onChange,
  ariaLabel,
  testId,
  fullWidth = false,
  anyLabel = 'Any time',
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  testId?: string;
  fullWidth?: boolean;
  anyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Seed the custom inputs from the current value when it IS a range.
    const m = value.match(/^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/);
    setFrom(m?.[1] ?? '');
    setTo(m?.[2] ?? '');
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyCustom = () => {
    if (!from && !to) return;
    const v = `${from}..${to}`;
    if (!dateRangeBounds(v).from && !dateRangeBounds(v).to) return;
    onChange(v);
    setOpen(false);
  };

  const active = value !== '';
  const dateInputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '5px 7px',
    background: '#10141b',
    border: '1px solid #2e333c',
    borderRadius: 6,
    color: '#e6e6e6',
    fontFamily: 'inherit',
    fontSize: 12.5,
    colorScheme: 'dark',
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: fullWidth ? 'block' : 'inline-block', width: fullWidth ? '100%' : undefined }}>
      <button
        type="button"
        data-testid={testId}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          background: '#161a21',
          border: `1px solid ${open ? '#4d9dff' : '#2e333c'}`,
          borderRadius: 8,
          color: active ? '#e6e6e6' : '#a0a8b8',
          fontFamily: 'inherit',
          fontSize: 13,
          cursor: 'pointer',
          minWidth: 130,
          width: fullWidth ? '100%' : undefined,
        }}
      >
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dateRangeLabel(value, anyLabel)}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ color: '#6c7588', flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 60,
            minWidth: 250,
            background: '#1a1d24',
            border: '1px solid #2e333c',
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
            padding: 4,
          }}
        >
          {PRESETS.map(([v, label]) => (
            <button
              key={v || 'any'}
              type="button"
              onClick={() => { onChange(v); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 10px',
                background: value === v ? 'rgba(77,157,255,0.14)' : 'transparent',
                border: 'none',
                borderRadius: 6,
                color: v ? '#e6e6e6' : '#a0a8b8',
                fontFamily: 'inherit',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { if (value !== v) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = value === v ? 'rgba(77,157,255,0.14)' : 'transparent'; }}
            >
              {v === '' ? anyLabel : label}
            </button>
          ))}
          <div style={{ borderTop: '1px solid #2e333c', margin: '4px 2px', paddingTop: 8, padding: '8px 8px 6px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6c7588', marginBottom: 6 }}>
              Custom range
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" data-testid={testId ? `${testId}-from` : undefined} style={dateInputStyle} />
              <span style={{ color: '#6c7588', fontSize: 11 }}>–</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" data-testid={testId ? `${testId}-to` : undefined} style={dateInputStyle} />
            </div>
            <button
              type="button"
              data-testid={testId ? `${testId}-apply` : undefined}
              onClick={applyCustom}
              disabled={!from && !to}
              style={{
                marginTop: 8,
                width: '100%',
                padding: '6px 0',
                background: 'rgba(77,157,255,0.12)',
                border: '1px solid #4d9dff',
                borderRadius: 6,
                color: '#cfe6ff',
                fontFamily: 'inherit',
                fontSize: 12.5,
                fontWeight: 700,
                cursor: !from && !to ? 'default' : 'pointer',
                opacity: !from && !to ? 0.5 : 1,
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

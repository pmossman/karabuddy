'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cardImageUrl } from '@/lib/cardImage';
import { AspectIcon } from './AspectIcon';

// Shared leader/base PICKER WITH ART (B221): a name-only dropdown is slow to
// scan — the card image is recognizable at a glance even tiny. Options carry
// an optional {set, number} art ref rendered as a small landscape thumb (the
// leader side for leaders; bases as-is). Same interaction contract as
// <Popover> (outside-click + Escape close), but self-contained so option rows
// can close the panel on select — Popover's children can't reach its toggle.
// Not built on the canonical <Select>: native select elements can't render
// image options. Registered in CONTEXT.md's canonical registry.

export interface LeaderSelectOption {
  value: string;
  label: string;
  art?: { set?: string; number?: number | string; name?: string } | null;
  artIsLeader?: boolean; // default true — the landscape leader side
  // Aspect icon instead of card art — for base-identity GROUPS (vanilla /
  // force-pair bases, lib/baseIdentity), where no single card IS the option.
  iconAspect?: string | null;
  // Force/splash base: renders the aspect icon + this glyph (lib/baseIdentity).
  overlay?: 'force' | 'splash' | null;
}

const ANY = '__all__';

// Fuzzy match: substring beats subsequence beats nothing. "lke" finds Luke.
function fuzzyScore(query: string, label: string): number {
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  if (!q) return 1;
  const sub = l.indexOf(q);
  if (sub >= 0) return 1000 - sub; // substring: earlier is better
  let qi = 0;
  for (let i = 0; i < l.length && qi < q.length; i++) if (l[i] === q[qi]) qi++;
  return qi === q.length ? 1 : -1; // full subsequence or no match
}

export function LeaderSelect({
  value,
  onChange,
  options,
  anyLabel,
  ariaLabel,
  testId,
  anyValue = ANY,
  fullWidth = false,
}: {
  value: string; // an option value, or `anyValue` for the any/cleared state
  onChange: (v: string) => void;
  options: LeaderSelectOption[];
  anyLabel: string; // the cleared state's label, e.g. 'Any deck'
  ariaLabel: string;
  testId?: string;
  // What "Any" means to the CALLER's state ('' for the URL-param filters).
  anyValue?: string;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0); // highlighted row among the filtered set
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHi(0);
      // Focus the search box — typing filters immediately.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  const current = value !== anyValue ? options.find((o) => o.value === value) : undefined;

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    return options
      .map((o) => ({ o, score: fuzzyScore(query.trim(), o.label) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.o.label.localeCompare(b.o.label))
      .map((x) => x.o);
  }, [options, query]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const thumb = (o?: LeaderSelectOption) => {
    if (o?.iconAspect) {
      return (
        <span style={{ width: 40, height: 29, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <AspectIcon aspect={o.iconAspect} size={20} overlay={o.overlay ?? null} />
        </span>
      );
    }
    const url = o?.art ? cardImageUrl(o.art, o.artIsLeader ?? true) : null;
    return url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        style={{ width: 40, height: 29, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(255,255,255,0.14)', flexShrink: 0, display: 'block' }}
      />
    ) : (
      <span style={{ width: 40, height: 29, borderRadius: 4, border: '1px dashed #2e333c', flexShrink: 0, display: 'inline-block' }} />
    );
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: fullWidth ? 'block' : 'inline-block', width: fullWidth ? '100%' : undefined }}>
      <button
        type="button"
        data-testid={testId}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 10px 5px 6px',
          background: '#161a21',
          border: `1px solid ${open ? '#4d9dff' : '#2e333c'}`,
          borderRadius: 8,
          color: '#e6e6e6',
          fontFamily: 'inherit',
          fontSize: 13,
          cursor: 'pointer',
          minWidth: 150,
          width: fullWidth ? '100%' : undefined,
        }}
      >
        {thumb(current)}
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: current ? '#e6e6e6' : '#a0a8b8' }}>
          {current ? current.label : anyLabel}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ color: '#6c7588', flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 60,
            minWidth: 240,
            maxHeight: 340,
            overflowY: 'auto',
            background: '#1a1d24',
            border: '1px solid #2e333c',
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
            padding: 4,
          }}
        >
          <input
            ref={inputRef}
            type="text"
            // autoFocus on mount — the setTimeout fallback alone raced fast
            // typists (keystrokes landed on body before focus).
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === 'Enter') {
                e.preventDefault();
                // Enter without a query just closes — never silently picks
                // the first row.
                if (!query.trim()) setOpen(false);
                else if (filtered.length > 0) pick(filtered[Math.min(hi, filtered.length - 1)].value);
              }
            }}
            placeholder="Type to filter…"
            aria-label={`Filter ${ariaLabel}`}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              margin: '2px 0 6px',
              padding: '6px 9px',
              background: '#10141b',
              border: '1px solid #2e333c',
              borderRadius: 6,
              color: '#e6e6e6',
              fontFamily: 'inherit',
              fontSize: 13,
              outline: 'none',
            }}
          />
          {!query.trim() && (
            <Row selected={value === anyValue} onClick={() => pick(anyValue)}>
              {thumb(undefined)}
              <span style={{ color: '#a0a8b8' }}>{anyLabel}</span>
            </Row>
          )}
          {filtered.map((o, i) => (
            <Row
              key={o.value}
              selected={o.value === value}
              highlighted={!!query.trim() && i === hi}
              onClick={() => pick(o.value)}
            >
              {thumb(o)}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
            </Row>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 12.5, color: '#6c7588' }}>No matches</div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ selected, highlighted, onClick, children }: { selected: boolean; highlighted?: boolean; onClick: () => void; children: React.ReactNode }) {
  const bg = highlighted ? 'rgba(255,255,255,0.10)' : selected ? 'rgba(77,157,255,0.14)' : 'transparent';
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        width: '100%',
        padding: '4px 8px',
        background: bg,
        border: 'none',
        borderRadius: 6,
        color: '#e6e6e6',
        fontFamily: 'inherit',
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { if (!selected && !highlighted) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = bg; }}
    >
      {children}
    </button>
  );
}

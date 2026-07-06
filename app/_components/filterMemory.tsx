'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Reusable FILTER MEMORY (B221, built site-generic): remembers the last few
// filter-sets a user actually USED on a filterable view (localStorage,
// per-device) and offers them back as one-click restore chips.
//
// Contract:
//   const mem = useFilterMemory<MyFilters>('openings:teamslug');
//   mem.remember(filters, 'Leia Organa · vs Boba Fett')  ← call at the
//     MEANINGFUL moment (starting a session, applying a search) — not on
//     every keystroke. Empty/default sets are the caller's job to skip.
//   <FilterMemoryMenu history={mem.history} onApply=... />
//
// Entries dedupe by value (re-using a set moves it to the front); the list
// caps at `max` (default 5).

export interface FilterMemoryEntry<T> {
  at: number;
  label: string;
  filters: T;
}

export function useFilterMemory<T>(key: string, opts: { max?: number } = {}) {
  const storageKey = `karabuddy:filters:${key}`;
  const max = opts.max ?? 5;
  const [history, setHistory] = useState<FilterMemoryEntry<T>[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHistory(parsed);
      }
    } catch {}
  }, [storageKey]);

  const remember = useCallback(
    (filters: T, label: string) => {
      setHistory((prev) => {
        const ser = JSON.stringify(filters);
        const next = [
          { at: Date.now(), label, filters },
          ...prev.filter((e) => JSON.stringify(e.filters) !== ser),
        ].slice(0, max);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [storageKey, max],
  );

  return { history, remember };
}

function timeAgo(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// One compact anchor instead of scattered pills: a "Recent" button opening a
// menu of remembered filter-sets (label + how long ago), click to apply.
// Self-contained popover (outside-click + Esc) — like <LeaderSelect>, rows
// must close the panel on select, which <Popover>'s children can't do.
export function FilterMemoryMenu<T>({
  history,
  onApply,
}: {
  history: FilterMemoryEntry<T>[];
  onApply: (filters: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
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

  if (history.length === 0) return null;
  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        data-testid="filter-memory-recent"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 12px',
          background: 'transparent',
          border: `1px solid ${open ? '#4d9dff' : '#2e333c'}`,
          borderRadius: 999,
          color: '#a0a8b8',
          fontFamily: 'inherit',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
        </svg>
        Recent
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, color: '#6c7588' }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Recent filters"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 60,
            minWidth: 260,
            maxWidth: 340,
            background: '#1a1d24',
            border: '1px solid #2e333c',
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
            padding: 4,
          }}
        >
          {history.map((e) => (
            <button
              key={e.at}
              type="button"
              role="menuitem"
              data-testid="filter-memory-chip"
              onClick={() => { onApply(e.filters); setOpen(false); }}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                width: '100%',
                padding: '7px 10px',
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                color: '#c8cdd8',
                fontFamily: 'inherit',
                fontSize: 12.5,
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(ev) => { ev.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</span>
              <span style={{ fontSize: 10.5, color: '#6c7588', flexShrink: 0 }}>{timeAgo(e.at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';

// Reusable FILTER MEMORY (B221, built site-generic): remembers the last few
// filter-sets a user actually USED on a filterable view (localStorage,
// per-device) and offers them back as one-click restore chips.
//
// Contract:
//   const mem = useFilterMemory<MyFilters>('openings:teamslug');
//   mem.remember(filters, 'Leia Organa · vs Boba Fett')  ← call at the
//     MEANINGFUL moment (starting a session, applying a search) — not on
//     every keystroke. Empty/default sets are the caller's job to skip.
//   <FilterMemoryChips history={mem.history} onApply=... />
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

export function FilterMemoryChips<T>({
  history,
  onApply,
}: {
  history: FilterMemoryEntry<T>[];
  onApply: (filters: T) => void;
}) {
  if (history.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#6c7588' }}>
        Recent
      </span>
      {history.map((e) => (
        <button
          key={e.at}
          type="button"
          data-testid="filter-memory-chip"
          onClick={() => onApply(e.filters)}
          title={new Date(e.at).toLocaleString()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 10px',
            background: 'transparent',
            border: '1px solid #2e333c',
            borderRadius: 999,
            color: '#a0a8b8',
            fontFamily: 'inherit',
            fontSize: 12,
            cursor: 'pointer',
            maxWidth: 280,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(ev) => { ev.currentTarget.style.borderColor = '#4d9dff'; ev.currentTarget.style.color = '#e6e6e6'; }}
          onMouseLeave={(ev) => { ev.currentTarget.style.borderColor = '#2e333c'; ev.currentTarget.style.color = '#a0a8b8'; }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
          </svg>
          {e.label}
        </button>
      ))}
    </div>
  );
}

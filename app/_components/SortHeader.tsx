'use client';

import React, { useMemo, useState } from 'react';

// Shared sortable-table primitives. Two table views (the /replays TableView and
// the /stats Leaders table) had their own copies of "sort state + a flip-on-
// re-click toggle + a clickable <th> that shows ▲/▼". This is the one extracted
// home. The hook owns the state + toggle rule; <SortHeader> is the clickable
// header cell. Comparators apply the direction sign themselves (so a comparator
// can do direction-INDEPENDENT null-sinking + tiebreaks — see /stats).

export type SortDir = 'asc' | 'desc';

export interface UseSortableOpts<T, K extends string> {
  initialKey: K;
  initialDir: SortDir;
  // Per-key comparator. Receives `dir` and is responsible for applying the sign
  // itself — this lets a comparator sink nulls / break ties independent of dir.
  comparators: Record<K, (a: T, b: T, dir: SortDir) => number>;
  // Keys whose "first click on a fresh column" should land on desc (e.g. dates,
  // counts go highest-first); everything else defaults to asc. Re-clicking the
  // active column always flips, regardless.
  descKeys?: K[];
}

export function useSortable<T, K extends string>(items: T[], opts: UseSortableOpts<T, K>) {
  const { initialKey, initialDir, comparators, descKeys } = opts;
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const onSort = (k: K) => {
    if (k === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir(descKeys?.includes(k) ? 'desc' : 'asc');
    }
  };

  // Never mutate `items`. Comparators are read fresh each time the memo re-runs;
  // `items` is in the dep list, so a new array (the common case for derived
  // inputs) re-sorts with the current comparators.
  const sorted = useMemo(
    () => [...items].sort((a, b) => comparators[sortKey](a, b, sortDir)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, sortKey, sortDir],
  );

  return { sorted, sortKey, sortDir, onSort };
}

export interface SortHeaderProps<K extends string> {
  k: K;
  current: K;
  dir: SortDir;
  onSort: (k: K) => void;
  align?: 'left' | 'right';
  // Show a ↕ on idle-but-sortable headers (the /stats convention); off elsewhere.
  neutralIndicator?: boolean;
  activeColor?: string;
  idleColor?: string;
  children: React.ReactNode;
  // Per-site extras (padding / borders / letter-spacing) merged over the
  // shared base, so each table keeps its exact look.
  style?: React.CSSProperties;
}

export function SortHeader<K extends string>({
  k, current, dir, onSort, align, neutralIndicator, activeColor, idleColor, children, style,
}: SortHeaderProps<K>) {
  const active = current === k;
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onSort(k)}
      style={{
        textAlign: align ?? 'left',
        color: active ? (activeColor ?? '#e6e6e6') : (idleColor ?? '#a0a8b8'),
        cursor: 'pointer',
        userSelect: 'none',
        textTransform: 'uppercase',
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}{active ? (dir === 'asc' ? ' ▲' : ' ▼') : (neutralIndicator ? ' ↕' : '')}
    </th>
  );
}

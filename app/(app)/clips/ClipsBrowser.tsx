'use client';

import { useMemo, useState } from 'react';
import { ClipCard } from './ClipCard';
import type { SerializedClipRow } from '@/lib/clipRow';

// B142: focused clip grid — title search + my-leader / opponent-leader filters +
// date sort over the rows the server handed for the active tab. Filtering is
// client-side (the rows are already loaded); only the tab/team lives in the URL.
export function ClipsBrowser({
  rows,
  showCreator,
  emptyLabel,
}: {
  rows: SerializedClipRow[];
  showCreator: boolean;
  emptyLabel: string;
}) {
  const [q, setQ] = useState('');
  const [mine, setMine] = useState('');
  const [vs, setVs] = useState('');
  const [sort, setSort] = useState<'new' | 'old'>('new');

  const mineLeaders = useMemo(() => leaderOptions(rows, (r) => r.ownLeader?.name), [rows]);
  const vsLeaders = useMemo(() => leaderOptions(rows, (r) => r.oppLeader?.name), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (needle && !(r.title || '').toLowerCase().includes(needle)) return false;
      if (mine && r.ownLeader?.name !== mine) return false;
      if (vs && r.oppLeader?.name !== vs) return false;
      return true;
    });
    out = [...out].sort((a, b) =>
      sort === 'new'
        ? b.clipCreatedAt.localeCompare(a.clipCreatedAt)
        : a.clipCreatedAt.localeCompare(b.clipCreatedAt),
    );
    return out;
  }, [rows, q, mine, vs, sort]);

  if (rows.length === 0) {
    return <p style={{ color: '#828b99', fontSize: 14, marginTop: 24 }}>{emptyLabel}</p>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clip titles…"
          style={inputStyle}
        />
        <Select value={mine} onChange={setMine} options={mineLeaders} placeholder="My leader" />
        <Select value={vs} onChange={setVs} options={vsLeaders} placeholder="Opponent leader" />
        <Select value={sort} onChange={(v) => setSort(v as 'new' | 'old')} options={['new', 'old']} labels={{ new: 'Newest', old: 'Oldest' }} />
      </div>
      {filtered.length === 0 ? (
        <p style={{ color: '#828b99', fontSize: 14 }}>No clips match these filters.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {filtered.map((c) => (
            <ClipCard key={c.clipSlug} clip={c} showCreator={showCreator} />
          ))}
        </div>
      )}
    </div>
  );
}

function leaderOptions(rows: SerializedClipRow[], pick: (r: SerializedClipRow) => string | null | undefined): string[] {
  const set = new Set<string>();
  for (const r of rows) { const n = pick(r); if (n) set.add(n); }
  return Array.from(set).sort();
}

const inputStyle: React.CSSProperties = {
  background: '#11141a', border: '1px solid #2e333c', borderRadius: 8, color: '#e6e6e6',
  padding: '8px 12px', fontSize: 14, fontFamily: 'inherit', minWidth: 180, flex: '1 1 180px', maxWidth: 280,
};

function Select({
  value, onChange, options, placeholder, labels,
}: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; labels?: Record<string, string>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, flex: '0 0 auto', minWidth: 150, maxWidth: 220, cursor: 'pointer' }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o} value={o}>{labels?.[o] ?? o}</option>
      ))}
    </select>
  );
}

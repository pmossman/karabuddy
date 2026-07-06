'use client';

import { useMemo, useState } from 'react';
import { ClipCard } from './ClipCard';
import { EmptyState } from '@/app/_components/StatusUi';
import { Select } from '@/app/_components/Select';
import { LeaderSelect, type LeaderSelectOption } from '@/app/_components/LeaderSelect';
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

  const mineLeaders = useMemo(() => leaderArtOptions(rows, (r) => r.ownLeader), [rows]);
  const vsLeaders = useMemo(() => leaderArtOptions(rows, (r) => r.oppLeader), [rows]);

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
    return <EmptyState>{emptyLabel}</EmptyState>;
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
        <LeaderSelect value={mine} onChange={setMine} options={mineLeaders} anyLabel="My leader" anyValue="" ariaLabel="Filter by my leader" />
        <LeaderSelect value={vs} onChange={setVs} options={vsLeaders} anyLabel="Opponent leader" anyValue="" ariaLabel="Filter by opponent leader" />
        <Select size="md" style={clipSelectStyle} value={sort} onChange={setSort} options={[['new', 'Newest'], ['old', 'Oldest']]} />
      </div>
      {filtered.length === 0 ? (
        <EmptyState>No clips match these filters.</EmptyState>
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

function leaderArtOptions(rows: SerializedClipRow[], pick: (r: SerializedClipRow) => any): LeaderSelectOption[] {
  const byName = new Map<string, any>();
  for (const r of rows) {
    const l = pick(r);
    if (l?.name && !byName.has(l.name)) byName.set(l.name, l);
  }
  return Array.from(byName.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, card]) => ({ value: name, label: name, art: card }));
}

const inputStyle: React.CSSProperties = {
  background: '#11141a', border: '1px solid #2e333c', borderRadius: 8, color: '#e6e6e6',
  padding: '8px 12px', fontSize: 14, fontFamily: 'inherit', minWidth: 180, flex: '1 1 180px', maxWidth: 280,
};

// The shared md Select already carries this site's bg/border/radius/padding/font
// + maxWidth:220 + cursor; this only re-adds the flex sizing the inputStyle copy
// used to contribute (don't grow to fill; floor at 150px).
const clipSelectStyle: React.CSSProperties = { flex: '0 0 auto', minWidth: 150 };

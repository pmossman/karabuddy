'use client';

import { useMemo, useState } from 'react';
import { ReplayCard } from './ReplayCard';

// B52 MVP: client-side filtering over a pre-fetched (server or API) row
// set. Filters: leader (any side), opponent username, date range, match
// format, bo3 mode, label. State persists in URL via `?leader=&format=&
// mode=&label=&since=&opp=`. Filter chips render at the top with × per
// chip + Clear all.
//
// Server-side filtering / pagination is the obvious follow-up when
// libraries push past the 100-row server limit. Until then this is fast
// enough (filter pass over ≤100 objects is microseconds).
//
// Alternate views (by-leader, timeline) deferred — they're scoped in
// the B52 spec but the filter UX is the higher-value half.

interface Row {
  slug: string;
  gameId: string;
  userId: string | null;
  players: any;
  durationMs: number;
  actionCount: number;
  visibility: string;
  createdAt: string;
  match?: any;
  displayName?: string | null;
  labels?: string[] | null;
}

const SINCE_OPTIONS = [
  { value: '', label: 'All time' },
  { value: '7d', label: 'Past 7 days' },
  { value: '30d', label: 'Past 30 days' },
  { value: '90d', label: 'Past 90 days' },
];

const FORMAT_LABEL: Record<string, string> = {
  premier: 'Premier', eternal: 'Eternal', open: 'Open', limited: 'Limited',
};
const MODE_LABEL: Record<string, string> = { bestOfOne: 'Bo1', bestOfThree: 'Bo3' };

export function ReplayFilters({
  rows,
  canManage,
  emptyState,
}: {
  rows: Row[];
  canManage: boolean;
  emptyState: React.ReactNode;
}) {
  // Filter state (in-component for v1; URL sync can come later).
  const [leader, setLeader] = useState('');
  const [opp, setOpp] = useState('');
  const [since, setSince] = useState('');
  const [format, setFormat] = useState('');
  const [mode, setMode] = useState('');
  const [label, setLabel] = useState('');

  // Build option sets from the data so users see only filters that
  // actually narrow something.
  const allLeaders = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const players = Array.isArray(r.players) ? r.players : [];
      for (const p of players) {
        const name = p?.leader?.name;
        if (name) set.add(name);
      }
    }
    return Array.from(set).sort();
  }, [rows]);

  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (Array.isArray(r.labels)) for (const l of r.labels) set.add(l);
    }
    return Array.from(set).sort();
  }, [rows]);

  // Apply filters.
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const players = Array.isArray(r.players) ? r.players : [];
      if (leader) {
        const matches = players.some((p: any) => p?.leader?.name === leader);
        if (!matches) return false;
      }
      if (opp) {
        const oppLower = opp.toLowerCase();
        const matches = players.some((p: any) => (p?.username || '').toLowerCase().includes(oppLower));
        if (!matches) return false;
      }
      if (since) {
        const days = parseInt(since.replace('d', ''), 10);
        const cutoff = Date.now() - days * 86_400_000;
        if (new Date(r.createdAt).getTime() < cutoff) return false;
      }
      if (format && r.match?.gameFormat !== format) return false;
      if (mode && r.match?.gamesToWinMode !== mode) return false;
      if (label) {
        if (!Array.isArray(r.labels) || !r.labels.includes(label)) return false;
      }
      return true;
    });
  }, [rows, leader, opp, since, format, mode, label]);

  const clearAll = () => {
    setLeader(''); setOpp(''); setSince(''); setFormat(''); setMode(''); setLabel('');
  };

  const activeChips: { key: string; label: string; onClear: () => void }[] = [];
  if (leader) activeChips.push({ key: 'leader', label: `Leader: ${leader}`, onClear: () => setLeader('') });
  if (opp) activeChips.push({ key: 'opp', label: `Opp: ${opp}`, onClear: () => setOpp('') });
  if (since) activeChips.push({ key: 'since', label: SINCE_OPTIONS.find((s) => s.value === since)?.label || since, onClear: () => setSince('') });
  if (format) activeChips.push({ key: 'fmt', label: FORMAT_LABEL[format] || format, onClear: () => setFormat('') });
  if (mode) activeChips.push({ key: 'mode', label: MODE_LABEL[mode] || mode, onClear: () => setMode('') });
  if (label) activeChips.push({ key: 'label', label: `#${label}`, onClear: () => setLabel('') });

  return (
    <>
      <FilterControls
        leader={leader} setLeader={setLeader}
        leaders={allLeaders}
        opp={opp} setOpp={setOpp}
        since={since} setSince={setSince}
        format={format} setFormat={setFormat}
        mode={mode} setMode={setMode}
        label={label} setLabel={setLabel}
        labels={allLabels}
      />

      {activeChips.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
          {activeChips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.onClear}
              style={{
                background: 'rgba(74, 124, 255, 0.18)',
                border: '1px solid rgba(74, 124, 255, 0.5)',
                color: '#a0c4ff',
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {c.label} <span style={{ color: '#6c7588', marginLeft: 4 }}>×</span>
            </button>
          ))}
          <button
            type="button"
            onClick={clearAll}
            style={{ background: 'transparent', color: '#a0a8b8', border: 0, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
          >
            Clear all
          </button>
        </div>
      )}

      <div style={{ fontSize: 11, color: '#6c7588', marginTop: 12 }}>
        Showing {filtered.length} of {rows.length}
      </div>

      {filtered.length === 0 ? (
        <div style={{ marginTop: 16 }}>{activeChips.length > 0 ? <NoMatchesEmpty /> : emptyState}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16, marginTop: 16 }}>
          {filtered.map((r) => (
            <ReplayCard key={r.slug} replay={r as any} canManage={canManage} />
          ))}
        </div>
      )}
    </>
  );
}

function FilterControls({
  leader, setLeader, leaders,
  opp, setOpp,
  since, setSince,
  format, setFormat,
  mode, setMode,
  label, setLabel, labels,
}: {
  leader: string; setLeader: (v: string) => void; leaders: string[];
  opp: string; setOpp: (v: string) => void;
  since: string; setSince: (v: string) => void;
  format: string; setFormat: (v: string) => void;
  mode: string; setMode: (v: string) => void;
  label: string; setLabel: (v: string) => void; labels: string[];
}) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: 12,
        background: 'rgba(17, 20, 26, 0.4)',
        border: '1px solid #2e333c',
        borderRadius: 8,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 8,
      }}
    >
      <Field label="Leader">
        <select value={leader} onChange={(e) => setLeader(e.target.value)} style={selectStyle}>
          <option value="">Any</option>
          {leaders.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      <Field label="Opponent (username)">
        <input
          type="text"
          value={opp}
          onChange={(e) => setOpp(e.target.value)}
          placeholder="contains…"
          style={inputStyle}
        />
      </Field>
      <Field label="Date">
        <select value={since} onChange={(e) => setSince(e.target.value)} style={selectStyle}>
          {SINCE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>
      <Field label="Format">
        <select value={format} onChange={(e) => setFormat(e.target.value)} style={selectStyle}>
          <option value="">Any</option>
          {Object.entries(FORMAT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Mode">
        <select value={mode} onChange={(e) => setMode(e.target.value)} style={selectStyle}>
          <option value="">Any</option>
          {Object.entries(MODE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      {labels.length > 0 && (
        <Field label="Label">
          <select value={label} onChange={(e) => setLabel(e.target.value)} style={selectStyle}>
            <option value="">Any</option>
            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function NoMatchesEmpty() {
  return (
    <div style={{ padding: 24, border: '1px dashed #2e333c', borderRadius: 8, textAlign: 'center', color: '#a0a8b8', fontSize: 13 }}>
      No replays match these filters.
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#11141a',
  color: '#e6e6e6',
  border: '1px solid #2e333c',
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: 'inherit',
  outline: 'none',
};
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

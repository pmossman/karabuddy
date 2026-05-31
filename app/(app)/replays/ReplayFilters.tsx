'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ReplayCard } from './ReplayCard';
import { cardImageUrl } from '@/lib/cardImage';
import { FORMAT_LABEL, MODE_LABEL } from '@/lib/matchMetadata';
import { ResultBadge } from '@/app/(app)/r/[slug]/ResultBadge';

// B52 MVP shipped local-state filters. B52-followup added URL persistence
// + by-leader / timeline views + reuse on /teams/[slug]. This pass:
//   - Renamed "Cards" → "Grid".
//   - New **Table** view, now the default — info-dense, sortable headers,
//     scales better than the grid as libraries grow.
//   - Opponent input is now a `<datalist>` combobox (type-to-filter over
//     usernames seen in the row set), and explicitly opts out of LastPass
//     / 1Password autofill so password managers don't render their icon
//     over the field.

interface Row {
  slug: string;
  gameId: string;
  userId: string | null;
  players: any;
  durationMs: number;
  actionCount: number;
  createdAt: string;
  match?: any;
  displayName?: string | null;
  labels?: string[] | null;
  // Uploader display name (joined server-side). Null = anonymous upload.
  ownerName?: string | null;
  // B59: winning playerIds on the replay. Null for pre-B59 uploads or
  // games that ended without a winner signal.
  winners?: string[] | null;
  // B59-followup: the recorder POV's playerId — the owner's player in
  // this replay. Combined with `winners` it answers "did I win?".
  ownerPlayerId?: string | null;
  // B89: teams this replay is shared with. Empty/absent = unlisted
  // (link-accessible but not surfaced to any team). Drives the Shared /
  // Unlisted tabs + the per-card share badge.
  sharedTeams?: { slug: string; name: string }[];
}

type ResultFilter = '' | 'wins' | 'losses';

// B89: Shared vs Unlisted are mutually exclusive states (a replay either has
// team shares or it doesn't); the tabs make that split explicit so "who can
// see this?" is never ambiguous.
type ShareTab = 'all' | 'shared' | 'unlisted';
const SHARE_TABS: readonly ShareTab[] = ['all', 'shared', 'unlisted'] as const;
const parseTab = (raw: string | null): ShareTab =>
  SHARE_TABS.includes(raw as ShareTab) ? (raw as ShareTab) : 'all';
const isShared = (r: Row): boolean => (r.sharedTeams?.length ?? 0) > 0;

type ViewMode = 'table' | 'grid' | 'by-leader' | 'timeline';
const VIEW_MODES: readonly ViewMode[] = ['table', 'grid', 'by-leader', 'timeline'] as const;
const DEFAULT_VIEW: ViewMode = 'table';

const SINCE_OPTIONS = [
  { value: '', label: 'All time' },
  { value: '7d', label: 'Past 7 days' },
  { value: '30d', label: 'Past 30 days' },
  { value: '90d', label: 'Past 90 days' },
];

function parseView(raw: string | null): ViewMode {
  return VIEW_MODES.includes(raw as ViewMode) ? (raw as ViewMode) : DEFAULT_VIEW;
}

export function ReplayFilters({
  rows,
  canManage,
  emptyState,
  showShareTabs = false,
}: {
  rows: Row[];
  canManage: boolean;
  emptyState: React.ReactNode;
  // B89: Shared/Unlisted tabs + per-card share badges only make sense on the
  // personal library (where a replay may or may not be team-shared). Off on
  // the team grid (everything there is shared with that team) and the
  // anonymous library (no account → no shares).
  showShareTabs?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [leader, setLeader] = useState(() => searchParams.get('leader') || '');
  const [opp, setOpp] = useState(() => searchParams.get('opp') || '');
  const [since, setSince] = useState(() => searchParams.get('since') || '');
  const [format, setFormat] = useState(() => searchParams.get('format') || '');
  const [mode, setMode] = useState(() => searchParams.get('mode') || '');
  const [label, setLabel] = useState(() => searchParams.get('label') || '');
  const [result, setResult] = useState<ResultFilter>(() => {
    const v = searchParams.get('result') || '';
    return v === 'wins' || v === 'losses' ? v : '';
  });
  const [view, setView] = useState<ViewMode>(() => parseView(searchParams.get('view')));
  // URL key is `share` (not `tab`) to avoid colliding with the team page's
  // own `?tab=` navigation — ReplayFilters is reused there.
  const [tab, setTab] = useState<ShareTab>(() => (showShareTabs ? parseTab(searchParams.get('share')) : 'all'));
  // Filters live behind a toggle so the toolbar stays uncluttered; active
  // filters still show as removable chips when collapsed. Auto-open if the URL
  // arrives with filters applied (deep-link) so they're immediately visible.
  const [filtersOpen, setFiltersOpen] = useState(() =>
    ['leader', 'opp', 'since', 'format', 'mode', 'label', 'result'].some((k) => !!searchParams.get(k)),
  );

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const setOrDelete = (key: string, val: string) => {
      if (val) params.set(key, val); else params.delete(key);
    };
    if (showShareTabs) setOrDelete('share', tab === 'all' ? '' : tab);
    setOrDelete('leader', leader);
    setOrDelete('opp', opp);
    setOrDelete('since', since);
    setOrDelete('format', format);
    setOrDelete('mode', mode);
    setOrDelete('label', label);
    setOrDelete('result', result);
    setOrDelete('view', view === DEFAULT_VIEW ? '' : view);
    const next = params.toString();
    if (next !== searchParams.toString()) {
      router.replace(`${pathname}${next ? `?${next}` : ''}`, { scroll: false });
    }
  }, [showShareTabs, tab, leader, opp, since, format, mode, label, result, view, pathname, router, searchParams]);

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

  // Opponent combobox suggestions — every username seen across the row set,
  // skipping the "anonymous-XXX"-style autogenerated handles. Filter logic
  // still uses substring match, so typing freely also works.
  const allUsernames = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const players = Array.isArray(r.players) ? r.players : [];
      for (const p of players) {
        const u: string | undefined = p?.username;
        if (u && !/^anonymous\s/i.test(u)) set.add(u);
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

  // Tab counts are over the full row set (independent of the in-tab filters),
  // so each tab advertises its true size.
  const tabCounts = useMemo(() => {
    let shared = 0;
    for (const r of rows) if (isShared(r)) shared++;
    return { all: rows.length, shared, unlisted: rows.length - shared };
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (tab === 'shared' && !isShared(r)) return false;
      if (tab === 'unlisted' && isShared(r)) return false;
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
      if (result) {
        // Require a winner signal AND a known owner player to answer
        // "did I win?". Pre-B59 rows + games-without-winners drop out
        // when the filter is on (deliberate — Any leaves them in).
        const winners = Array.isArray(r.winners) ? r.winners : null;
        if (!winners || !r.ownerPlayerId) return false;
        const won = winners.includes(r.ownerPlayerId);
        if (result === 'wins' && !won) return false;
        if (result === 'losses' && won) return false;
      }
      return true;
    });
  }, [rows, tab, leader, opp, since, format, mode, label, result]);

  const clearAll = () => {
    setLeader(''); setOpp(''); setSince(''); setFormat(''); setMode(''); setLabel(''); setResult('');
  };

  const activeChips: { key: string; label: string; onClear: () => void }[] = [];
  if (leader) activeChips.push({ key: 'leader', label: `Leader: ${leader}`, onClear: () => setLeader('') });
  if (opp) activeChips.push({ key: 'opp', label: `Opp: ${opp}`, onClear: () => setOpp('') });
  if (since) activeChips.push({ key: 'since', label: SINCE_OPTIONS.find((s) => s.value === since)?.label || since, onClear: () => setSince('') });
  if (format) activeChips.push({ key: 'fmt', label: FORMAT_LABEL[format] || format, onClear: () => setFormat('') });
  if (mode) activeChips.push({ key: 'mode', label: MODE_LABEL[mode] || mode, onClear: () => setMode('') });
  if (label) activeChips.push({ key: 'label', label: `#${label}`, onClear: () => setLabel('') });
  if (result) activeChips.push({ key: 'result', label: result === 'wins' ? 'Wins' : 'Losses', onClear: () => setResult('') });

  return (
    <>
      {showShareTabs && <ShareTabs tab={tab} setTab={setTab} counts={tabCounts} />}

      {/* Toolbar: collapsible Filters toggle + active-filter chips on the left,
          result count + view switcher on the right. Filters panel is hidden by
          default to keep the browser uncluttered. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <FiltersToggle open={filtersOpen} count={activeChips.length} onClick={() => setFiltersOpen((v) => !v)} />
          {activeChips.map((c) => (
            <button key={c.key} type="button" onClick={c.onClear} style={chipButtonStyle}>
              {c.label} <span style={{ color: '#6c7588', marginLeft: 4 }}>×</span>
            </button>
          ))}
          {activeChips.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              style={{ background: 'transparent', color: '#a0a8b8', border: 0, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
            >
              Clear all
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 11, color: '#6c7588', whiteSpace: 'nowrap' }}>
            Showing {filtered.length} of {rows.length}
          </span>
          <ViewSwitcher view={view} setView={setView} />
        </div>
      </div>

      {filtersOpen && (
        <FilterControls
          leader={leader} setLeader={setLeader}
          leaders={allLeaders}
          opp={opp} setOpp={setOpp}
          usernames={allUsernames}
          since={since} setSince={setSince}
          format={format} setFormat={setFormat}
          mode={mode} setMode={setMode}
          label={label} setLabel={setLabel}
          labels={allLabels}
          result={result} setResult={setResult}
        />
      )}

      {filtered.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          {activeChips.length > 0 ? <NoMatchesEmpty /> : tab !== 'all' ? <TabEmpty tab={tab} /> : emptyState}
        </div>
      ) : view === 'table' ? (
        <TableView rows={filtered} />
      ) : view === 'by-leader' ? (
        <ByLeaderGroups rows={filtered} canManage={canManage} />
      ) : view === 'timeline' ? (
        <TimelineGroups rows={filtered} canManage={canManage} />
      ) : (
        <CardGrid rows={filtered} canManage={canManage} />
      )}
    </>
  );
}

function CardGrid({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16, marginTop: 16 }}>
      {rows.map((r) => (
        <ReplayCard key={r.slug} replay={r as any} canManage={canManage} />
      ))}
    </div>
  );
}

function ByLeaderGroups({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const players = Array.isArray(r.players) ? r.players : [];
      const name = players[0]?.leader?.name || '(unknown leader)';
      const arr = m.get(name);
      if (arr) arr.push(r); else m.set(name, [r]);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {groups.map(([leaderName, group]) => (
        <section key={leaderName}>
          <h2
            data-testid="leader-group-heading"
            style={{ fontSize: 14, fontWeight: 600, color: '#e6e6e6', margin: '0 0 10px', display: 'flex', gap: 8, alignItems: 'baseline' }}
          >
            {leaderName}
            <span style={{ fontSize: 11, color: '#6c7588', fontWeight: 400 }}>{group.length}</span>
          </h2>
          <CardGrid rows={group} canManage={canManage} />
        </section>
      ))}
    </div>
  );
}

function TimelineGroups({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const d = new Date(r.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const arr = m.get(key);
      if (arr) arr.push(r); else m.set(key, [r]);
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {groups.map(([day, group]) => (
        <section key={day}>
          <h2
            data-testid="timeline-day-heading"
            style={{ fontSize: 14, fontWeight: 600, color: '#e6e6e6', margin: '0 0 10px', display: 'flex', gap: 8, alignItems: 'baseline' }}
          >
            {day}
            <span style={{ fontSize: 11, color: '#6c7588', fontWeight: 400 }}>{group.length}</span>
          </h2>
          <CardGrid rows={group} canManage={canManage} />
        </section>
      ))}
    </div>
  );
}

// -- Table view --------------------------------------------------------------

type SortKey = 'date' | 'replay' | 'leader' | 'format' | 'mode' | 'length' | 'member';

function matchupText(r: Row): string {
  if (r.displayName) return r.displayName;
  const players = Array.isArray(r.players) ? r.players : [];
  const [p1, p2] = players;
  return `${nameText(p1)} vs ${nameText(p2)}`;
}

function nameText(p: any) {
  const u: string | undefined = p?.username;
  if (!u || /^anonymous\s/i.test(u)) return 'anon';
  return u;
}

function leaderText(r: Row): string {
  const players = Array.isArray(r.players) ? r.players : [];
  return players[0]?.leader?.name || '';
}

function formatChipText(match: Row['match']): string {
  if (!match) return '';
  return [
    match.gameFormat ? FORMAT_LABEL[match.gameFormat] : '',
    match.gamesToWinMode ? MODE_LABEL[match.gamesToWinMode] : '',
  ].filter(Boolean).join(' / ');
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(r).padStart(2, '0')}s`;
}

function formatDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' });
}

function TableView({ rows }: { rows: Row[] }) {
  // Default: newest first (matches the grid's pre-existing order).
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const val = (r: Row): string | number => {
      switch (sortKey) {
        case 'date': return new Date(r.createdAt).getTime();
        case 'replay': return matchupText(r).toLowerCase();
        case 'leader': return leaderText(r).toLowerCase();
        case 'format': return (r.match?.gameFormat || '').toLowerCase();
        case 'mode': return (r.match?.gamesToWinMode || '').toLowerCase();
        case 'length': return r.durationMs || 0;
        case 'member': return (r.ownerName || '').toLowerCase();
      }
    };
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  const onHeaderClick = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      // Sensible defaults: dates go newest first; everything else ascending.
      setSortDir(k === 'date' || k === 'length' ? 'desc' : 'asc');
    }
  };

  return (
    <div style={{ marginTop: 16, overflowX: 'auto', border: '1px solid #2e333c', borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#d6d6d6' }}>
        <thead>
          <tr style={{ background: 'rgba(17,20,26,0.6)' }}>
            <SortHeader k="date" current={sortKey} dir={sortDir} onClick={onHeaderClick}>Date</SortHeader>
            <SortHeader k="replay" current={sortKey} dir={sortDir} onClick={onHeaderClick}>Replay</SortHeader>
            <SortHeader k="member" current={sortKey} dir={sortDir} onClick={onHeaderClick}>Member</SortHeader>
            <SortHeader k="format" current={sortKey} dir={sortDir} onClick={onHeaderClick}>Format</SortHeader>
            <PlainHeader>Labels</PlainHeader>
            <SortHeader k="length" current={sortKey} dir={sortDir} onClick={onHeaderClick}>Length</SortHeader>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.slug} style={{ borderTop: '1px solid #2e333c' }}>
              <td style={cellStyle}>{formatDateShort(r.createdAt)}</td>
              <td style={cellStyle} data-testid="replay-cell">
                <ReplayCellLink replay={r} />
              </td>
              <td style={cellStyle} data-testid="member-cell">{r.ownerName || '—'}</td>
              <td style={cellStyle}>{formatChipText(r.match) || '—'}</td>
              <td style={cellStyle}>
                {Array.isArray(r.labels) && r.labels.length > 0 ? (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {r.labels.map((l) => (
                      <span key={l} style={labelChipStyle}>{l}</span>
                    ))}
                  </div>
                ) : '—'}
              </td>
              <td style={cellStyle}>{formatDuration(r.durationMs || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Replay cell: leader+base mini thumbnails for each player, separated by
// "vs", with the matchup text below. Wrapped in <Link> so the whole cell
// (text + thumbs) navigates to /r/<slug>.
function ReplayCellLink({ replay }: { replay: Row }) {
  const players = Array.isArray(replay.players) ? replay.players : [];
  const [p1, p2] = players;
  return (
    <Link href={`/r/${replay.slug}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <PlayerThumbs player={p1} />
        <span style={{ fontSize: 10, color: '#6c7588', fontWeight: 700, letterSpacing: '0.08em' }}>VS</span>
        <PlayerThumbs player={p2} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <ResultBadge playerId={p1?.id} winners={replay.winners} />
        <span style={{ fontWeight: 600, color: '#a7d2ff' }}>{matchupText(replay)}</span>
        <ResultBadge playerId={p2?.id} winners={replay.winners} />
        <TableShareChip sharedTeams={replay.sharedTeams} />
      </div>
    </Link>
  );
}

// Compact share indicator for the table's Replay cell — a single chip
// ("Shared" with team count, or "Unlisted"). The grid/card view uses the
// richer per-team ShareBadge; the table stays dense.
function TableShareChip({ sharedTeams }: { sharedTeams?: { slug: string; name: string }[] }) {
  if (sharedTeams === undefined) return null;
  const n = sharedTeams.length;
  const shared = n > 0;
  return (
    <span
      data-testid="table-share-chip"
      title={shared ? `Shared with ${sharedTeams!.map((t) => t.name).join(', ')}` : 'Unlisted — link-accessible, not shared with a team'}
      style={{
        marginLeft: 6,
        fontSize: 9,
        fontWeight: 700,
        padding: '0 6px',
        borderRadius: 999,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        background: shared ? 'rgba(107, 217, 104, 0.1)' : 'rgba(108, 117, 136, 0.1)',
        border: `1px solid ${shared ? 'rgba(107, 217, 104, 0.35)' : '#2e333c'}`,
        color: shared ? '#7fd97f' : '#8a93a6',
      }}
    >
      {shared ? (n > 1 ? `Shared · ${n}` : 'Shared') : 'Unlisted'}
    </span>
  );
}

// Per-player leader + base stacked vertically. Tiny — meant for at-a-glance
// scanning down the table, not for reading card text.
function PlayerThumbs({ player }: { player: any }) {
  const leader = cardImageUrl(player?.leader, true);
  const base = cardImageUrl(player?.base, false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Thumb src={leader} alt={player?.leader?.name} />
      <Thumb src={base} alt={player?.base?.name} />
    </div>
  );
}

function Thumb({ src, alt }: { src: string | null; alt?: string }) {
  if (!src) {
    return <div style={thumbBoxStyle} title={alt || ''} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt || ''} loading="lazy" style={thumbImgStyle} />;
}

const thumbImgStyle: React.CSSProperties = {
  width: 38,
  height: 26,
  objectFit: 'contain',
  borderRadius: 2,
  background: '#0a0c10',
  display: 'block',
};
const thumbBoxStyle: React.CSSProperties = {
  ...thumbImgStyle,
  border: '1px solid #2e333c',
};

function SortHeader({
  k, current, dir, onClick, children,
}: {
  k: SortKey;
  current: SortKey;
  dir: 'asc' | 'desc';
  onClick: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  const active = current === k;
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{
        textAlign: 'left',
        padding: '8px 10px',
        fontSize: 11,
        fontWeight: 700,
        color: active ? '#e6e6e6' : '#a0a8b8',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={() => onClick(k)}
    >
      {children}
      {active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

function PlainHeader({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      style={{
        textAlign: 'left',
        padding: '8px 10px',
        fontSize: 11,
        fontWeight: 700,
        color: '#a0a8b8',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {children}
    </th>
  );
}

const cellStyle: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'middle' };
const labelChipStyle: React.CSSProperties = {
  background: 'rgba(160, 196, 255, 0.08)',
  border: '1px solid rgba(160, 196, 255, 0.2)',
  color: '#a7d2ff',
  fontSize: 10,
  fontWeight: 600,
  padding: '1px 6px',
  borderRadius: 999,
};

function ShareTabs({
  tab,
  setTab,
  counts,
}: {
  tab: ShareTab;
  setTab: (t: ShareTab) => void;
  counts: { all: number; shared: number; unlisted: number };
}) {
  const item = (t: ShareTab, label: string, count: number) => {
    const active = tab === t;
    return (
      <button
        key={t}
        type="button"
        data-testid={`replays-tab-${t}`}
        onClick={() => setTab(t)}
        aria-pressed={active}
        style={{
          background: 'transparent',
          color: active ? '#e6e6e6' : '#6c7588',
          border: 0,
          borderBottom: `2px solid ${active ? '#4d9dff' : 'transparent'}`,
          padding: '6px 4px',
          marginBottom: -1,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {label}
        <span style={{ fontSize: 11, fontWeight: 600, color: active ? '#a7d2ff' : '#4a4e56' }}>{count}</span>
      </button>
    );
  };
  return (
    <div role="tablist" style={{ display: 'flex', gap: 18, borderBottom: '1px solid #2e333c', marginTop: 4 }}>
      {item('all', 'All', counts.all)}
      {item('shared', 'Shared', counts.shared)}
      {item('unlisted', 'Unlisted', counts.unlisted)}
    </div>
  );
}

function TabEmpty({ tab }: { tab: ShareTab }) {
  const msg =
    tab === 'shared'
      ? 'No replays shared with a team yet. Open a replay and use Share → Share with team.'
      : 'No unlisted replays — every replay you have is shared with at least one team.';
  return (
    <div style={{ padding: 24, border: '1px dashed #2e333c', borderRadius: 8, textAlign: 'center', color: '#a0a8b8', fontSize: 13 }}>
      {msg}
    </div>
  );
}

function FiltersToggle({ open, count, onClick }: { open: boolean; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Filters"
      aria-expanded={open}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        background: open ? 'rgba(77, 157, 255, 0.12)' : 'transparent',
        color: open ? '#e6e6e6' : '#a0a8b8',
        border: '1px solid ' + (open ? 'rgba(77, 157, 255, 0.5)' : '#2e333c'),
        padding: '5px 12px',
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </svg>
      Filters
      {count > 0 && (
        <span style={{ background: '#4dd2ff', color: '#0a0c10', fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '0 6px', lineHeight: '15px', minWidth: 15, textAlign: 'center' }}>
          {count}
        </span>
      )}
      <span style={{ fontSize: 9 }}>{open ? '▴' : '▾'}</span>
    </button>
  );
}

function ViewSwitcher({ view, setView }: { view: ViewMode; setView: (v: ViewMode) => void }) {
  const item = (v: ViewMode, label: string) => (
    <button
      key={v}
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      style={{
        background: view === v ? 'rgba(77, 157, 255, 0.18)' : 'transparent',
        color: view === v ? '#e6e6e6' : '#a0a8b8',
        border: '1px solid ' + (view === v ? 'rgba(77, 157, 255, 0.5)' : '#2e333c'),
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
  return (
    <div role="group" style={{ display: 'flex', gap: 4 }}>
      {item('table', 'Table')}
      {item('grid', 'Grid')}
      {item('by-leader', 'By leader')}
      {item('timeline', 'Timeline')}
    </div>
  );
}

function FilterControls({
  leader, setLeader, leaders,
  opp, setOpp, usernames,
  since, setSince,
  format, setFormat,
  mode, setMode,
  label, setLabel, labels,
  result, setResult,
}: {
  leader: string; setLeader: (v: string) => void; leaders: string[];
  opp: string; setOpp: (v: string) => void; usernames: string[];
  since: string; setSince: (v: string) => void;
  format: string; setFormat: (v: string) => void;
  mode: string; setMode: (v: string) => void;
  label: string; setLabel: (v: string) => void; labels: string[];
  result: ResultFilter; setResult: (v: ResultFilter) => void;
}) {
  // Stable id for the <input list="..."> ↔ <datalist id="..."> pairing.
  const oppListId = useId();
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
        {/*
          Combobox: native <datalist> lets the user pick from prior opponents
          OR type freely to substring-filter. The autoComplete=off +
          data-lpignore + data-form-type attrs suppress LastPass / 1Password
          autofill icons — without them, password managers latch onto any
          text input that looks remotely username-y.
        */}
        {/* type="search" (not text): password managers don't attach their
            autofill icon to search fields — fixes LastPass latching onto this
            field — and it's semantically a filter/search input anyway. The
            data-* attrs stay as belt-and-suspenders for 1Password/LastPass. */}
        <input
          type="search"
          value={opp}
          onChange={(e) => setOpp(e.target.value)}
          placeholder="contains…"
          list={oppListId}
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          style={inputStyle}
        />
        <datalist id={oppListId}>
          {usernames.map((u) => <option key={u} value={u} />)}
        </datalist>
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
      <Field label="Result">
        <select value={result} onChange={(e) => setResult((e.target.value as ResultFilter) || '')} style={selectStyle}>
          <option value="">Any</option>
          <option value="wins">Wins</option>
          <option value="losses">Losses</option>
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
const chipButtonStyle: React.CSSProperties = {
  background: 'rgba(77, 157, 255, 0.18)',
  border: '1px solid rgba(77, 157, 255, 0.5)',
  color: '#a7d2ff',
  padding: '3px 10px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

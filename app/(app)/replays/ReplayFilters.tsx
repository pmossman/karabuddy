'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ReplayCard } from './ReplayCard';
import { RowActions } from './RowActions';
import { CommentCountButton } from './CommentCountButton';
import { cardImageUrl } from '@/lib/cardImage';
import { FORMAT_LABEL, MODE_LABEL } from '@/lib/matchMetadata';
import { ResultBadge } from '@/app/(app)/r/[slug]/ResultBadge';
import { ShareBadge } from './ShareBadge';
import { useMediaQuery } from '@/lib/useMediaQuery';

// B52 MVP shipped local-state filters. B52-followup added URL persistence
// + by-leader / timeline views + reuse on /teams/[slug]. B123-followup merged
// the old Table + Grid buttons into one adaptive **Replays** view (dense
// sortable table on desktop, cards on phones) so the two no longer read as
// redundant; the grouping views (By leader / Timeline) are unchanged.

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
  // B100: comments on the replay (total on the personal library; team-scoped
  // on the team grid), surfaced inline + clickable to read.
  commentCount?: number;
  // B100: viewer owns this replay — lets the owner manage it (un-share) from
  // the team grid where the grid-wide canManage is false.
  isMine?: boolean;
  // B116: perspective fields resolved server-side (lib/replayRow). `viewerPlayerId`
  // is "which side is mine/the-uploader's" for this row; ownLeader/oppLeader are
  // that side's vs the other side's leader. Drive the My-leader / Opponent-leader
  // filters + the matchup display. Null when the perspective can't be resolved.
  viewerPlayerId?: string | null;
  ownLeader?: { name?: string | null; set?: string | null; number?: number | null } | null;
  oppLeader?: { name?: string | null; set?: string | null; number?: number | null } | null;
  // B116: stable across a Bo3's games — drives series grouping. Null = singleton.
  lobbyId?: string | null;
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

// B123-followup: "Table" and "Grid" were the same data at two densities, which
// read as redundant (the table even collapses to cards on mobile). Merged into
// one adaptive `replays` view — the dense sortable table on desktop, cards on
// phones — alongside the two grouping views. Legacy ?view=table / ?view=grid map
// to `replays` for back-compat.
type ViewMode = 'replays' | 'by-leader' | 'timeline';
const VIEW_MODES: readonly ViewMode[] = ['replays', 'by-leader', 'timeline'] as const;
const DEFAULT_VIEW: ViewMode = 'replays';

const SINCE_OPTIONS = [
  { value: '', label: 'All time' },
  { value: '7d', label: 'Past 7 days' },
  { value: '30d', label: 'Past 30 days' },
  { value: '90d', label: 'Past 90 days' },
];

function parseView(raw: string | null): ViewMode {
  if (raw === 'by-leader' || raw === 'timeline') return raw;
  // Everything else — incl. the legacy 'table' / 'grid' / 'card' values and any
  // unknown/empty param — resolves to the adaptive default.
  return DEFAULT_VIEW;
}

export function ReplayFilters({
  rows,
  canManage,
  emptyState,
  showShareTabs = false,
  showUploaderFilter = false,
}: {
  rows: Row[];
  canManage: boolean;
  emptyState: React.ReactNode;
  // B89: Shared/Unlisted tabs + per-card share badges only make sense on the
  // personal library (where a replay may or may not be team-shared). Off on
  // the team grid (everything there is shared with that team) and the
  // anonymous library (no account → no shares).
  showShareTabs?: boolean;
  // B116: the "Uploaded by" (which team member) filter only makes sense on the
  // team grid; on the personal library every row is yours.
  showUploaderFilter?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // B123: a wide table can't fit a phone — below this width the Table view
  // degrades to the (already mobile-friendly) card layout so nothing is hidden
  // behind a horizontal scroll. SSR-safe: false on the server + first tick.
  const isNarrow = useMediaQuery('(max-width: 720px)');

  // B116: filter by the leader the viewer/uploader was playing (`mine`) and the
  // leader played against (`vs`) — replaces the old single leader + opponent-
  // username filters. `by` = which team member uploaded (team grid only).
  const [myLeader, setMyLeader] = useState(() => searchParams.get('mine') || '');
  const [vsLeader, setVsLeader] = useState(() => searchParams.get('vs') || '');
  const [uploadedBy, setUploadedBy] = useState(() => searchParams.get('by') || '');
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
    ['mine', 'vs', 'by', 'since', 'format', 'mode', 'label', 'result'].some((k) => !!searchParams.get(k)),
  );

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const setOrDelete = (key: string, val: string) => {
      if (val) params.set(key, val); else params.delete(key);
    };
    if (showShareTabs) setOrDelete('share', tab === 'all' ? '' : tab);
    setOrDelete('mine', myLeader);
    setOrDelete('vs', vsLeader);
    setOrDelete('by', uploadedBy);
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
  }, [showShareTabs, tab, myLeader, vsLeader, uploadedBy, since, format, mode, label, result, view, pathname, router, searchParams]);

  // B116: leader options split by perspective — leaders the viewer/uploader
  // played (`ownLeader`) vs leaders faced (`oppLeader`).
  const ownLeaders = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.ownLeader?.name) set.add(r.ownLeader.name);
    return Array.from(set).sort();
  }, [rows]);
  const oppLeaders = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.oppLeader?.name) set.add(r.oppLeader.name);
    return Array.from(set).sort();
  }, [rows]);

  // B116: uploader options for the team grid's "Uploaded by" filter.
  const uploaders = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.ownerName) set.add(r.ownerName);
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
      if (myLeader && r.ownLeader?.name !== myLeader) return false;
      if (vsLeader && r.oppLeader?.name !== vsLeader) return false;
      if (uploadedBy && r.ownerName !== uploadedBy) return false;
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
  }, [rows, tab, myLeader, vsLeader, uploadedBy, since, format, mode, label, result]);

  const clearAll = () => {
    setMyLeader(''); setVsLeader(''); setUploadedBy(''); setSince(''); setFormat(''); setMode(''); setLabel(''); setResult('');
  };

  const activeChips: { key: string; label: string; onClear: () => void }[] = [];
  if (myLeader) activeChips.push({ key: 'mine', label: `My leader: ${myLeader}`, onClear: () => setMyLeader('') });
  if (vsLeader) activeChips.push({ key: 'vs', label: `Vs: ${vsLeader}`, onClear: () => setVsLeader('') });
  if (uploadedBy) activeChips.push({ key: 'by', label: `By: ${uploadedBy}`, onClear: () => setUploadedBy('') });
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
          myLeader={myLeader} setMyLeader={setMyLeader} ownLeaders={ownLeaders}
          vsLeader={vsLeader} setVsLeader={setVsLeader} oppLeaders={oppLeaders}
          uploadedBy={uploadedBy} setUploadedBy={setUploadedBy} uploaders={uploaders}
          showUploaderFilter={showUploaderFilter}
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
      ) : view === 'by-leader' ? (
        <ByLeaderGroups rows={filtered} canManage={canManage} />
      ) : view === 'timeline' ? (
        <TimelineGroups rows={filtered} canManage={canManage} />
      ) : (
        // 'replays' — the dense sortable table on desktop, cards on phones (the
        // table can't fit a narrow viewport without horizontal scroll).
        isNarrow
          ? <CardGrid rows={filtered} canManage={canManage} group />
          : <TableView rows={filtered} canManage={canManage} showShareColumn={tab !== 'unlisted'} />
      )}
    </>
  );
}

function CardGrid({ rows, canManage, group = false }: { rows: Row[]; canManage: boolean; group?: boolean }) {
  // B116: when grouping is on (the flat Grid view), collapse Bo3 series into a
  // bordered cluster with a header; singletons render as plain cards. By-leader
  // / Timeline pass group=false (they already group by their own key).
  if (group) {
    const groups = buildSeriesGroups(rows).sort((a, b) =>
      new Date(b.rows[b.rows.length - 1].createdAt).getTime() - new Date(a.rows[a.rows.length - 1].createdAt).getTime(),
    );
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
        {groups.map((g) => g.isSeries ? (
          <div key={g.key} data-testid="series-group" style={{ border: '1px solid rgba(77,157,255,0.35)', borderRadius: 10, padding: 12, background: 'rgba(77,157,255,0.04)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#a7d2ff', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: 'rgba(77,157,255,0.18)', border: '1px solid rgba(77,157,255,0.5)', borderRadius: 999, padding: '1px 8px', fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Series</span>
              {seriesHeadline(g)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
              {g.rows.map((r) => <ReplayCard key={r.slug} replay={r as any} canManage={canManage} />)}
            </div>
          </div>
        ) : (
          <ReplayCard key={g.key} replay={g.rows[0] as any} canManage={canManage} />
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16, marginTop: 16 }}>
      {rows.map((r) => (
        <ReplayCard key={r.slug} replay={r as any} canManage={canManage} />
      ))}
    </div>
  );
}

// B123-followup: By-leader / Timeline are drill-downs, not long pre-expanded
// scrolls. Each group lists as a collapsible row (label + replay count, plus a
// leader thumbnail for by-leader); tapping one opens its replays. Single-open
// accordion keeps the list compact on mobile (the old all-expanded layout ran
// off-screen).
interface AccordionItem {
  key: string;
  label: string;
  rows: Row[];
  adornment?: React.ReactNode;
}

function AccordionGroups({
  items,
  canManage,
  testid,
  open: openProp,
  onOpenChange,
  rowId,
}: {
  items: AccordionItem[];
  canManage: boolean;
  testid: string;
  // Optional controlled mode: when onOpenChange is supplied the parent owns the
  // open key (e.g. the timeline calendar drives it); otherwise it's self-managed.
  open?: string | null;
  onOpenChange?: (key: string | null) => void;
  rowId?: (key: string) => string;
}) {
  const [openState, setOpenState] = useState<string | null>(null);
  const controlled = onOpenChange !== undefined;
  const open = controlled ? openProp ?? null : openState;
  const setOpen = (k: string | null) => { if (controlled) onOpenChange!(k); else setOpenState(k); };
  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it) => {
        const isOpen = open === it.key;
        return (
          <div
            key={it.key}
            id={rowId?.(it.key)}
            style={{
              border: `1px solid ${isOpen ? 'rgba(77,157,255,0.4)' : '#2e333c'}`,
              borderRadius: 10,
              background: isOpen ? 'rgba(77,157,255,0.04)' : 'transparent',
              overflow: 'hidden',
              scrollMarginTop: 12,
            }}
          >
            <button
              type="button"
              data-testid={testid}
              onClick={() => setOpen(isOpen ? null : it.key)}
              aria-expanded={isOpen}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', background: 'transparent', border: 0, cursor: 'pointer',
                color: '#e6e6e6', fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              {it.adornment}
              <span style={{ fontSize: 15, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.label}
              </span>
              <span style={{ fontSize: 12, color: '#a7d2ff', fontWeight: 700, background: 'rgba(77,157,255,0.12)', border: '1px solid rgba(77,157,255,0.3)', borderRadius: 999, padding: '1px 9px' }}>
                {it.rows.length}
              </span>
              <span aria-hidden style={{ fontSize: 10, color: '#6c7588', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
            </button>
            {isOpen && (
              <div style={{ padding: '0 12px 14px' }}>
                <CardGrid rows={it.rows} canManage={canManage} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ByLeaderGroups({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const items = useMemo<AccordionItem[]>(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      // B116: group by the viewer/uploader's OWN leader (perspective) so an
      // alt-recorded game lands under my leader, not my opponent's.
      const name = r.ownLeader?.name || '(unknown leader)';
      const arr = m.get(name);
      if (arr) arr.push(r); else m.set(name, [r]);
    }
    // Most-played first, then alphabetical.
    return Array.from(m.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([name, rs]) => {
        const rep = rs[0]?.ownLeader;
        const art = rep?.name ? cardImageUrl({ set: rep.set ?? undefined, number: rep.number ?? undefined }, true) : null;
        return { key: name, label: name, rows: rs, adornment: <LeaderThumb src={art} alt={name} /> };
      });
  }, [rows]);

  return <AccordionGroups items={items} canManage={canManage} testid="leader-group-heading" />;
}

// Small landscape leader thumbnail for the by-leader accordion rows.
function LeaderThumb({ src, alt }: { src: string | null; alt: string }) {
  if (!src) {
    return <div style={{ width: 48, height: 34, borderRadius: 4, background: '#0a0c10', border: '1px solid #2e333c', flex: '0 0 auto' }} title={alt} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" style={{ width: 48, height: 34, objectFit: 'cover', borderRadius: 4, background: '#0a0c10', flex: '0 0 auto' }} />;
}

function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmtDayKey = (y: number, m0: number, d: number) =>
  `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function TimelineGroups({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const items = useMemo<AccordionItem[]>(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const key = dayKeyOf(r.createdAt);
      const arr = m.get(key);
      if (arr) arr.push(r); else m.set(key, [r]);
    }
    return Array.from(m.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest day first
      .map(([day, rs]) => ({ key: day, label: day, rows: rs }));
  }, [rows]);

  const countByDay = useMemo(() => {
    const o: Record<string, number> = {};
    for (const it of items) o[it.key] = it.rows.length;
    return o;
  }, [items]);

  const [open, setOpen] = useState<string | null>(null);
  const rowId = (key: string) => `kb-day-${key}`;
  const pick = (day: string) => {
    setOpen(day);
    // Let the row mount/expand, then bring it just below the calendar.
    requestAnimationFrame(() => document.getElementById(rowId(day))?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <>
      <TimelineCalendar countByDay={countByDay} activeDay={open} onPick={pick} />
      <AccordionGroups
        items={items}
        canManage={canManage}
        testid="timeline-day-heading"
        open={open}
        onOpenChange={setOpen}
        rowId={rowId}
      />
    </>
  );
}

// B123-followup: a month calendar above the day list — each cell shows that
// day's replay count, and tapping a populated day opens it in the list below.
// A quick visual "when did I play" overview that scales better than scrolling
// the day list. Month nav is clamped to the range that actually has replays.
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function TimelineCalendar({
  countByDay,
  activeDay,
  onPick,
}: {
  countByDay: Record<string, number>;
  activeDay: string | null;
  onPick: (day: string) => void;
}) {
  // Data range (string sort works for YYYY-MM-DD). Default to the latest month.
  const { minYM, maxYM } = useMemo(() => {
    const keys = Object.keys(countByDay).sort();
    const toYM = (k: string) => { const [y, m] = k.split('-').map(Number); return { y, m: m - 1 }; };
    const now = new Date();
    if (keys.length === 0) return { minYM: { y: now.getFullYear(), m: now.getMonth() }, maxYM: { y: now.getFullYear(), m: now.getMonth() } };
    return { minYM: toYM(keys[0]), maxYM: toYM(keys[keys.length - 1]) };
  }, [countByDay]);

  const [ym, setYm] = useState(maxYM);
  const ymIndex = (v: { y: number; m: number }) => v.y * 12 + v.m;
  const atMin = ymIndex(ym) <= ymIndex(minYM);
  const atMax = ymIndex(ym) >= ymIndex(maxYM);
  const step = (delta: number) => {
    const idx = ymIndex(ym) + delta;
    setYm({ y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 });
  };

  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleString([], { month: 'long', year: 'numeric' });
  const startWeekday = new Date(ym.y, ym.m, 1).getDay();
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div style={{ marginTop: 16, border: '1px solid #2e333c', borderRadius: 10, padding: 12, maxWidth: 420 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <CalNavButton dir="prev" disabled={atMin} onClick={() => step(-1)} />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#e6e6e6' }}>{monthLabel}</span>
        <CalNavButton dir="next" disabled={atMax} onClick={() => step(1)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {WEEKDAYS.map((w, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#6c7588', padding: '2px 0' }}>{w}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const key = fmtDayKey(ym.y, ym.m, day);
          const count = countByDay[key] || 0;
          const isActive = activeDay === key;
          if (count === 0) {
            return (
              <div key={key} style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#4a4e56' }}>
                {day}
              </div>
            );
          }
          return (
            <button
              key={key}
              type="button"
              data-testid="calendar-day"
              aria-label={`${key}: ${count} replay${count === 1 ? '' : 's'}`}
              aria-pressed={isActive}
              onClick={() => onPick(key)}
              style={{
                aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                background: isActive ? 'rgba(77,157,255,0.28)' : 'rgba(77,157,255,0.12)',
                border: `1px solid ${isActive ? '#4d9dff' : 'rgba(77,157,255,0.3)'}`,
                color: '#e6e6e6',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1 }}>{day}</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#a7d2ff', lineHeight: 1 }}>{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CalNavButton({ dir, disabled, onClick }: { dir: 'prev' | 'next'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={dir === 'prev' ? 'Previous month' : 'Next month'}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: '1px solid #2e333c', borderRadius: 6,
        color: disabled ? '#3a3e46' : '#a0a8b8', cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12,
      }}
    >
      {dir === 'prev' ? '‹' : '›'}
    </button>
  );
}

// -- Bo3 / series grouping ----------------------------------------------------
// B116: replays that belong to the same match share a stable match.lobbyId
// (the lobby persists across a Bo3's games; quick games each get a unique one).
// Group by lobbyId; rows with no lobbyId are singletons (keyed by slug so they
// never collapse together). A group with 2+ games renders as a "series".

interface SeriesGroup {
  key: string;
  rows: Row[];        // games in play order (createdAt asc)
  isSeries: boolean;  // 2+ games sharing a lobby
}

function buildSeriesGroups(rows: Row[]): SeriesGroup[] {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.lobbyId || `__solo__${r.slug}`;
    const arr = m.get(key);
    if (arr) arr.push(r); else m.set(key, [r]);
  }
  return Array.from(m.entries()).map(([key, rs]) => ({
    key,
    rows: [...rs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    isSeries: rs.length > 1,
  }));
}

// W–L tally across a series from the viewer/uploader's perspective. Games with
// no winner signal are ignored (not counted as a loss).
function seriesRecord(group: SeriesGroup): { wins: number; losses: number } {
  let wins = 0, losses = 0;
  for (const r of group.rows) {
    const winners = Array.isArray(r.winners) ? r.winners : null;
    if (!winners || !r.viewerPlayerId) continue;
    if (winners.includes(r.viewerPlayerId)) wins++; else losses++;
  }
  return { wins, losses };
}

function seriesHeadline(group: SeriesGroup): string {
  const first = group.rows[0];
  const own = first?.ownLeader?.name;
  const opp = first?.oppLeader?.name;
  const matchup = own || opp ? `${own || '?'} vs ${opp || '?'}` : matchupText(first);
  const { wins, losses } = seriesRecord(group);
  const rec = wins + losses > 0 ? ` · ${wins}–${losses}` : '';
  return `Best of ${group.rows.length} · ${matchup}${rec}`;
}

// -- Table view --------------------------------------------------------------

type SortKey = 'date' | 'replay' | 'leader' | 'format' | 'mode' | 'length' | 'member' | 'shared' | 'comments';

// Sort/scan key for the "Shared with" column: joined team names (so teams
// group together), empty for unlisted (sorts to one end).
function sharedText(r: Row): string {
  return (r.sharedTeams || []).map((t) => t.name).join(', ').toLowerCase();
}

// B116: the matchup headline now leads with LEADERS (my leader vs opponent
// leader), from the row's perspective — usernames are secondary (rendered small
// below). A user-set displayName still wins.
function matchupText(r: Row): string {
  if (r.displayName) return r.displayName;
  const own = r.ownLeader?.name;
  const opp = r.oppLeader?.name;
  if (own || opp) return `${own || '?'} vs ${opp || '?'}`;
  // No perspective resolved (pre-B59 / anonymous): fall back to usernames.
  const players = Array.isArray(r.players) ? r.players : [];
  return `${nameText(players[0])} vs ${nameText(players[1])}`;
}

function nameText(p: any) {
  const u: string | undefined = p?.username;
  if (!u || /^anonymous\s/i.test(u)) return 'anon';
  return u;
}

// Own/opponent players in PERSPECTIVE order (viewer/uploader first). Falls back
// to the canonical owner-first order when no perspective is resolved.
function perspectivePlayers(r: Row): [any, any] {
  const players = Array.isArray(r.players) ? r.players : [];
  const vid = r.viewerPlayerId;
  if (vid) {
    const own = players.find((p: any) => p?.id === vid);
    const opp = players.find((p: any) => p?.id !== vid);
    if (own) return [own, opp];
  }
  return [players[0], players[1]];
}

function leaderText(r: Row): string {
  return r.ownLeader?.name || '';
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

function TableView({ rows, canManage = false, showShareColumn = true }: { rows: Row[]; canManage?: boolean; showShareColumn?: boolean }) {
  // Default: newest first (matches the grid's pre-existing order).
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // B116: group into Bo3 series (by lobbyId), then sort the GROUPS by the chosen
  // key (using each group's most-recent game as its representative) so a series'
  // games stay contiguous and in play order regardless of column sort.
  const groups = useMemo(() => {
    const val = (r: Row): string | number => {
      switch (sortKey) {
        case 'date': return new Date(r.createdAt).getTime();
        case 'replay': return matchupText(r).toLowerCase();
        case 'leader': return leaderText(r).toLowerCase();
        case 'format': return (r.match?.gameFormat || '').toLowerCase();
        case 'mode': return (r.match?.gamesToWinMode || '').toLowerCase();
        case 'length': return r.durationMs || 0;
        case 'member': return (r.ownerName || '').toLowerCase();
        case 'shared': return sharedText(r);
        case 'comments': return r.commentCount ?? 0;
      }
    };
    const rep = (g: SeriesGroup) => g.rows[g.rows.length - 1]; // most recent game
    return buildSeriesGroups(rows).sort((a, b) => {
      const va = val(rep(a)), vb = val(rep(b));
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  // Show the "Shared with" column only when share data is present (the personal
  // library passes it; the reused team grid doesn't → no empty column there) AND
  // the caller wants it (hidden on the Unlisted tab, where it'd be all "UNLISTED").
  const showShared = showShareColumn && rows.some((r) => r.sharedTeams !== undefined);
  // Comments column only where the count was fetched (personal library); the
  // reused team grid doesn't carry it → no empty column there.
  const showComments = rows.some((r) => r.commentCount !== undefined);
  // Columns: Date, Replay, [Shared], Member, Format, Labels, Length, [Comments],
  // actions = 7 fixed + the two optional ones. Used for the series header colSpan.
  const colCount = 7 + (showShared ? 1 : 0) + (showComments ? 1 : 0);

  const onHeaderClick = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      // Sensible defaults: dates / lengths / counts go highest-first; text asc.
      setSortDir(k === 'date' || k === 'length' || k === 'comments' ? 'desc' : 'asc');
    }
  };

  return (
    <div style={{ marginTop: 16, overflowX: 'auto', border: '1px solid #2e333c', borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#d6d6d6' }}>
        <thead>
          <tr style={{ background: 'rgba(17,20,26,0.6)' }}>
            <SortHeader k="date" current={sortKey} dir={sortDir} onClick={onHeaderClick}>Date</SortHeader>
            <SortHeader k="replay" current={sortKey} dir={sortDir} onClick={onHeaderClick}>Replay</SortHeader>
            {showShared && <SortHeader k="shared" current={sortKey} dir={sortDir} onClick={onHeaderClick}>Shared with</SortHeader>}
            <SortHeader k="member" current={sortKey} dir={sortDir} onClick={onHeaderClick}>Member</SortHeader>
            <SortHeader k="format" current={sortKey} dir={sortDir} onClick={onHeaderClick}>Format</SortHeader>
            <PlainHeader>Labels</PlainHeader>
            <SortHeader k="length" current={sortKey} dir={sortDir} onClick={onHeaderClick}>Length</SortHeader>
            {showComments && <SortHeader k="comments" current={sortKey} dir={sortDir} onClick={onHeaderClick}>Comments</SortHeader>}
            <PlainHeader>{''}</PlainHeader>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const gameRow = (r: Row, inSeries: boolean) => (
              <tr key={r.slug} style={{ borderTop: '1px solid #2e333c', ...(inSeries ? { boxShadow: 'inset 3px 0 0 rgba(77,157,255,0.5)' } : {}) }}>
                <td style={cellStyle}>{formatDateShort(r.createdAt)}</td>
                <td style={cellStyle} data-testid="replay-cell">
                  <ReplayCellLink replay={r} />
                </td>
                {showShared && (
                  <td style={cellStyle} data-testid="shared-cell">
                    <ShareBadge sharedTeams={r.sharedTeams} />
                  </td>
                )}
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
                {showComments && (
                  <td style={cellStyle}>
                    <CommentCountButton replay={r} variant="table" />
                  </td>
                )}
                <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <RowActions replay={r} canManage={canManage} />
                </td>
              </tr>
            );
            if (!g.isSeries) return gameRow(g.rows[0], false);
            return (
              <Fragment key={g.key}>
                <tr data-testid="series-group" style={{ borderTop: '1px solid #2e333c', background: 'rgba(77,157,255,0.06)' }}>
                  <td colSpan={colCount} style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#a7d2ff' }}>
                    <span style={{ background: 'rgba(77,157,255,0.18)', border: '1px solid rgba(77,157,255,0.5)', borderRadius: 999, padding: '1px 8px', fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', marginRight: 8 }}>Series</span>
                    {seriesHeadline(g)}
                  </td>
                </tr>
                {g.rows.map((r) => gameRow(r, true))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Replay cell: leader+base mini thumbnails for each player, separated by
// "vs", with the matchup text below. Wrapped in <Link> so the whole cell
// (text + thumbs) navigates to /r/<slug>.
function ReplayCellLink({ replay }: { replay: Row }) {
  // Perspective order: my/the-uploader's side first, opponent second.
  const [p1, p2] = perspectivePlayers(replay);
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
      </div>
      {/* B116: usernames demoted to small secondary text. */}
      <div style={{ fontSize: 10, color: '#6c7588' }}>{nameText(p1)} vs {nameText(p2)}</div>
    </Link>
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
      {item('replays', 'Replays')}
      {item('by-leader', 'By leader')}
      {item('timeline', 'Timeline')}
    </div>
  );
}

function FilterControls({
  myLeader, setMyLeader, ownLeaders,
  vsLeader, setVsLeader, oppLeaders,
  uploadedBy, setUploadedBy, uploaders, showUploaderFilter,
  since, setSince,
  format, setFormat,
  mode, setMode,
  label, setLabel, labels,
  result, setResult,
}: {
  myLeader: string; setMyLeader: (v: string) => void; ownLeaders: string[];
  vsLeader: string; setVsLeader: (v: string) => void; oppLeaders: string[];
  uploadedBy: string; setUploadedBy: (v: string) => void; uploaders: string[]; showUploaderFilter: boolean;
  since: string; setSince: (v: string) => void;
  format: string; setFormat: (v: string) => void;
  mode: string; setMode: (v: string) => void;
  label: string; setLabel: (v: string) => void; labels: string[];
  result: ResultFilter; setResult: (v: ResultFilter) => void;
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
      <Field label="My leader">
        <select value={myLeader} onChange={(e) => setMyLeader(e.target.value)} style={selectStyle}>
          <option value="">Any</option>
          {ownLeaders.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      <Field label="Opponent leader">
        <select value={vsLeader} onChange={(e) => setVsLeader(e.target.value)} style={selectStyle}>
          <option value="">Any</option>
          {oppLeaders.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      {showUploaderFilter && (
        <Field label="Uploaded by">
          <select value={uploadedBy} onChange={(e) => setUploadedBy(e.target.value)} style={selectStyle}>
            <option value="">Any member</option>
            {uploaders.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
      )}
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

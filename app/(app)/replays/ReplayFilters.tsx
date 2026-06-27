'use client';

import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ReplayCard } from './ReplayCard';
import { RowActions } from './RowActions';
import { ReplaySelectionProvider, SelectBox, useReplaySelection, type ReplaySelectionApi } from './selection';
import { LedToggle } from '@/app/_components/LedToggle';
import { CommentCountButton } from './CommentCountButton';
import { cardImageUrl } from '@/lib/cardImage';
import { FORMAT_LABEL, MODE_LABEL } from '@/lib/matchMetadata';
import { segmentMatches, bestOfLabel } from '@/lib/seriesGrouping';
import { ResultBadge } from '@/app/(app)/r/[slug]/ResultBadge';
import { PrivateMatchup } from '@/app/_components/PrivateMatchup';
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
  // B170 / ADR 0010: private (encrypted) replay — the server holds no plaintext
  // matchup (players=[]); the cell decrypts the summary client-side, or shows a
  // clean "🔒 Private" placeholder when the key/extension isn't there.
  encrypted?: boolean;
  teamKeyId?: string | null;
  encryptedSummary?: string | null;
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
  // B128: both players' recordings exist — the viewer can show both hands
  // face up / flip seats. Drives the "⇄ both POVs" badge.
  doubleSided?: boolean;
  // B133: owner published this replay (drives the Public share badge).
  isPublic?: boolean;
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
type ViewMode = 'replays' | 'by-leader' | 'by-member' | 'timeline';
const VIEW_MODES: readonly ViewMode[] = ['replays', 'by-leader', 'by-member', 'timeline'] as const;
const DEFAULT_VIEW: ViewMode = 'replays';

// Past-tense verbs for the bulk-op result line ("12 shared · 1 skipped").
const OP_VERB: Record<string, string> = {
  delete: 'deleted', publish: 'made public', unpublish: 'made unlisted', share: 'shared', unshare: 'unshared',
  'label-add': 'labeled', 'label-remove': 'unlabeled', 'review-request': 'review requested', 'review-cancel': 'review cancelled',
};

const SINCE_OPTIONS = [
  { value: '', label: 'All time' },
  { value: '7d', label: 'Past 7 days' },
  { value: '30d', label: 'Past 30 days' },
  { value: '90d', label: 'Past 90 days' },
];

function parseView(raw: string | null): ViewMode {
  if (raw === 'by-leader' || raw === 'by-member' || raw === 'timeline') return raw;
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
  pageSize,
  myTeams = [],
  teamSlug,
  onMutated,
}: {
  rows: Row[];
  canManage: boolean;
  emptyState: React.ReactNode;
  // Bulk multi-select. `myTeams` populates the "share with" picker (the teams
  // the viewer can share into); `teamSlug` is the team whose grid this is (team
  // tab) — the default unshare target. `onMutated` lets a client-fetched parent
  // (team/public grids) refetch after a bulk op; otherwise we router.refresh().
  myTeams?: { slug: string; name: string }[];
  teamSlug?: string;
  onMutated?: () => void;
  // B89: Shared/Unlisted tabs + per-card share badges only make sense on the
  // personal library (where a replay may or may not be team-shared). Off on
  // the team grid (everything there is shared with that team) and the
  // anonymous library (no account → no shares).
  showShareTabs?: boolean;
  // B116: the "Uploaded by" (which team member) filter only makes sense on the
  // team grid; on the personal library every row is yours.
  showUploaderFilter?: boolean;
  // B187: when set, render incrementally (N at a time) with a "Show more" button
  // instead of painting every card at once. The team grid surfaces a team's
  // entire shared history (hundreds–thousands of games), so it opts in. Off
  // (undefined) on the personal library → byte-identical behavior there.
  pageSize?: number;
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

  // Bulk multi-select state. `removed` is the optimistic post-op hide (deleted
  // rows, or rows unshared from THIS team's grid) so the list reacts instantly
  // before the server refetch lands.
  const [selectMode, setSelectMode] = useState(false);
  // The toolbar button + action bar flip on `selectMode` (cheap → instant). The
  // EXPENSIVE part — swapping ~100 cards for ~100 checklist rows + per-row
  // checkboxes — reads this deferred value, so it renders without blocking the
  // click's repaint (React keeps the button responsive and fills the list in).
  const deferredSelectMode = useDeferredValue(selectMode);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [opMsg, setOpMsg] = useState<string | null>(null);
  const selectable = useCallback((r: { isMine?: boolean }) => canManage || !!r.isMine, [canManage]);

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
      if (removed.has(r.slug)) return false; // optimistic post-bulk-op hide
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
  }, [rows, removed, tab, myLeader, vsLeader, uploadedBy, since, format, mode, label, result]);

  // B187: incremental render (opt-in via pageSize). Reset to the first page
  // whenever the filtered set changes so a new filter starts from the top.
  const [visibleCount, setVisibleCount] = useState(pageSize ?? Infinity);
  useEffect(() => { setVisibleCount(pageSize ?? Infinity); }, [filtered, pageSize]);
  const display = pageSize ? filtered.slice(0, visibleCount) : filtered;
  // B187 follow-up: the grouped views (by-leader / by-member / timeline) are
  // single-open, collapsed accordions — they paint only group headers until one
  // is expanded — so they render the FULL filtered set, NOT the `display` page.
  // Slicing them to the flat-grid's page made each group's count reflect only the
  // member's share of the recent N games (a member read "4" under All but "19"
  // under Internal) and hid older groups entirely. Only the flat grid/table — the
  // views that paint every card up front — need the incremental slice.
  const grouped = view === 'by-leader' || view === 'by-member' || view === 'timeline';

  // ---- Bulk multi-select: derived state + actions ----
  // "Select all matching" picks every ELIGIBLE row in the current filter set
  // (`filtered`), not just the loaded page — the whole point of the feature.
  const eligibleSlugs = useMemo(() => filtered.filter(selectable).map((r) => r.slug), [filtered, selectable]);
  const anySelectable = eligibleSlugs.length > 0;
  const toggleSel = useCallback((slug: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(slug)) n.delete(slug); else n.add(slug); return n; });
  }, []);
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); setOpMsg(null); };
  const selectionApi: ReplaySelectionApi = useMemo(
    () => ({ selectMode: deferredSelectMode, selected, toggle: toggleSel, selectable }),
    [deferredSelectMode, selected, toggleSel, selectable],
  );

  // Aggregate sharing/visibility state across the SELECTED replays so the bulk
  // share control (mirroring the single-replay popover) can show each toggle's
  // combined state — all / some / none.
  const selectedRows = useMemo(() => filtered.filter((r) => selected.has(r.slug)), [filtered, selected]);
  const shareCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of selectedRows) for (const t of r.sharedTeams ?? []) m[t.slug] = (m[t.slug] || 0) + 1;
    return m;
  }, [selectedRows]);
  const publicCount = useMemo(() => selectedRows.filter((r) => r.isPublic).length, [selectedRows]);
  // Teams to offer: the owner's teams, plus any team the selection is already
  // shared with (covers the team grid, where myTeams is empty but rows are shared).
  const shareTeams = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of myTeams) m.set(t.slug, t.name);
    for (const r of selectedRows) for (const t of r.sharedTeams ?? []) if (!m.has(t.slug)) m.set(t.slug, t.name);
    if (teamSlug && !m.has(teamSlug)) m.set(teamSlug, teamSlug);
    return Array.from(m, ([slug, name]) => ({ slug, name }));
  }, [myTeams, selectedRows, teamSlug]);

  const refresh = () => (onMutated ? onMutated() : router.refresh());
  // Stage-and-apply: the Manage sheet stages a draft and commits the whole list
  // of changes here, in order, in one go. Bulk writes are 100× the blast radius
  // of a single replay, so nothing mutates until the user hits Apply — and until
  // then they can Close to abandon (which preserves any pre-existing mixed state).
  const runBulkBatch = async (ops: { op: string; teamSlug?: string }[]) => {
    const slugs = [...selected];
    if (!slugs.length || !ops.length || busy) return;
    setBusy(true); setOpMsg(null);
    try {
      const leaving = new Set<string>();
      const bits: string[] = [];
      let skipped = 0, forbidden = 0, failed = false;
      for (const { op, teamSlug: ts } of ops) {
        const res = await fetch('/api/replays/bulk', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op, slugs, teamSlug: ts }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) { failed = true; continue; }
        const r = body.results as { ok: string[]; skipped: string[]; forbidden: string[]; notFound: string[] };
        if (body.applied > 0) bits.push(`${body.applied} ${OP_VERB[op] ?? 'updated'}`);
        skipped += r.skipped.length; forbidden += r.forbidden.length;
        // Rows that leave THIS surface drop out of the selection: deletes
        // (everywhere) + an unshare from the team whose grid we're viewing.
        if (op === 'delete' || (op === 'unshare' && !!teamSlug && ts === teamSlug)) r.ok.forEach((s) => leaving.add(s));
      }
      if (leaving.size) {
        setRemoved((prev) => new Set([...prev, ...leaving]));
        setSelected((prev) => { const n = new Set(prev); for (const s of leaving) n.delete(s); return n; });
      }
      if (skipped) bits.push(`${skipped} skipped`);
      if (forbidden) bits.push(`${forbidden} not yours`);
      if (failed && !bits.length) bits.push('Something went wrong');
      setOpMsg(bits.join(' · ') || 'No changes');
      refresh();
    } catch { setOpMsg('Something went wrong'); }
    finally { setBusy(false); }
  };

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
    <ReplaySelectionProvider value={selectionApi}>
      {showShareTabs && <ShareTabs tab={tab} setTab={setTab} counts={tabCounts} />}

      {/* Toolbar: collapsible Filters toggle + active-filter chips on the left,
          result count + view switcher on the right. Filters panel is hidden by
          default to keep the browser uncluttered. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <FiltersToggle open={filtersOpen} count={activeChips.length} onClick={() => setFiltersOpen((v) => !v)} />
          {anySelectable && (
            <button
              type="button"
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              aria-pressed={selectMode}
              style={selectButtonStyle(selectMode)}
            >
              {selectMode ? 'Done' : 'Select'}
            </button>
          )}
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
        {/* In select mode the view switcher + count step aside so the action bar
            sits directly under Filters · Done — selecting is a focused mode. */}
        {!selectMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', maxWidth: '100%', minWidth: 0 }}>
            <span style={{ fontSize: 11, color: '#6c7588', whiteSpace: 'nowrap' }}>
              Showing {filtered.length} of {rows.length}
            </span>
            {/* The segmented view switcher can be wider than a phone — let it scroll
                inside its own track instead of pushing the row off-screen. */}
            <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
              <ViewSwitcher view={view} setView={setView} showMember={showUploaderFilter} />
            </div>
          </div>
        )}
      </div>

      {selectMode && (
        <SelectionBar
          count={selected.size}
          eligible={eligibleSlugs.length}
          busy={busy}
          msg={opMsg}
          isNarrow={isNarrow}
          canDelete={canManage}
          teams={shareTeams}
          shareCounts={shareCounts}
          publicCount={publicCount}
          onSelectAll={() => setSelected(new Set(eligibleSlugs))}
          onClear={() => setSelected(new Set())}
          onApply={runBulkBatch}
          onDelete={() => { if (confirm(`Delete ${selected.size} replay${selected.size === 1 ? '' : 's'}? This can't be undone.`)) runBulkBatch([{ op: 'delete' }]); }}
        />
      )}

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
      ) : view === 'by-member' ? (
        <ByMemberGroups rows={filtered} canManage={canManage} />
      ) : view === 'timeline' ? (
        <TimelineGroups rows={filtered} canManage={canManage} />
      ) : (
        // 'replays' — the dense sortable table on desktop, cards on phones (the
        // table can't fit a narrow viewport without horizontal scroll). On a phone
        // IN SELECT MODE, swap the cards for a dense checklist that's built for
        // ticking many rows quickly. Desktop keeps the table (it has its own
        // checkbox column).
        isNarrow
          ? (deferredSelectMode ? <CompactSelectList rows={display} /> : <CardGrid rows={display} canManage={canManage} group />)
          : <TableView rows={display} canManage={canManage} showShareColumn={tab !== 'unlisted'} />
      )}

      {pageSize && !grouped && filtered.length > display.length && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <button
            type="button"
            onClick={() => setVisibleCount((v) => v + pageSize)}
            style={{ background: 'transparent', color: '#a0a8b8', border: '1px solid #2a3142', borderRadius: 8, padding: '8px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Show more ({filtered.length - display.length} more)
          </button>
        </div>
      )}
    </ReplaySelectionProvider>
  );
}

// Selection bar: count + select-all/clear + a "Manage" button that opens the
// SAME share/visibility control we use on a single replay (per-team toggles +
// review star + Public toggle + Delete) — applied to the whole selection, so
// bulk editing is consistent with single-replay editing instead of a new idiom.
function SelectionBar({
  count, eligible, busy, msg, isNarrow, canDelete, teams, shareCounts, publicCount,
  onSelectAll, onClear, onApply, onDelete,
}: {
  count: number; eligible: number; busy: boolean; msg: string | null; isNarrow: boolean; canDelete: boolean;
  teams: { slug: string; name: string }[]; shareCounts: Record<string, number>; publicCount: number;
  onSelectAll: () => void; onClear: () => void;
  onApply: (ops: { op: string; teamSlug?: string }[]) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const none = count === 0;
  return (
    <div style={selBarStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
        <strong style={{ fontSize: 13, color: '#e6e6e6', whiteSpace: 'nowrap' }}>{count} selected</strong>
        <button type="button" onClick={onSelectAll} disabled={count >= eligible} style={dim(selLinkStyle, count >= eligible)}>Select all {eligible}</button>
        <button type="button" onClick={onClear} disabled={none} style={dim(selLinkStyle, none)}>Clear</button>
        {msg && <span style={{ fontSize: 12, color: '#a7d2ff', whiteSpace: 'nowrap' }}>{msg}</span>}
      </div>
      <div style={{ position: 'relative', flex: '0 0 auto' }}>
        <button type="button" onClick={() => setOpen((v) => !v)} disabled={none || busy} aria-expanded={open} style={dim(selActionStyle, none || busy)}>Manage ▾</button>
        {open && (
          <ActionSheet variant={isNarrow ? 'sheet' : 'popover'} title={`Manage ${count} replay${count === 1 ? '' : 's'}`} onClose={() => setOpen(false)}>
            <BulkShareControls
              key={`${count}-${Object.values(shareCounts).join('.')}-${publicCount}`}
              count={count} busy={busy} canDelete={canDelete} teams={teams} shareCounts={shareCounts} publicCount={publicCount}
              onApply={(ops) => { onApply(ops); setOpen(false); }}
              onDelete={() => { onDelete(); setOpen(false); }}
            />
          </ActionSheet>
        )}
      </div>
    </div>
  );
}

// The group share/visibility control — a near-copy of the single-replay
// ShareWithTeam popover (LedToggle per team + review star + Public toggle +
// Delete), but each toggle reflects the SELECTION's combined state (all / some /
// none) and acts on the whole group. Optimistic local state mirrors the single
// control, so you can flip several toggles in a row.
function BulkShareControls({
  count, busy, canDelete, teams, shareCounts, publicCount, onApply, onDelete,
}: {
  count: number; busy: boolean; canDelete: boolean;
  teams: { slug: string; name: string }[]; shareCounts: Record<string, number>; publicCount: number;
  onApply: (ops: { op: string; teamSlug?: string }[]) => void;
  onDelete: () => void;
}) {
  // Tri-state per toggle, from the SELECTION's combined state:
  //   on    = applied to every selected replay   → ✓
  //   mixed = applied to some, not all           → – (indeterminate)
  //   off   = applied to none                     → empty
  // Stage-and-apply: toggles only edit a local DRAFT (`shareDraft`/`pubDraft`/
  // `reviewDraft`) — nothing is committed until Apply, so Close abandons cleanly
  // and an untouched `mixed` team keeps its dash (no destructive round-trip).
  type Tri = 'on' | 'mixed' | 'off';
  const snapShare = (slug: string): Tri => {
    const c = shareCounts[slug] || 0;
    return c === 0 ? 'off' : c >= count ? 'on' : 'mixed';
  };
  const pubSnap: Tri = publicCount === 0 ? 'off' : publicCount >= count ? 'on' : 'mixed';
  const [shareDraft, setShareDraft] = useState<Record<string, 'on' | 'off'>>({});
  const [pubDraft, setPubDraft] = useState<'on' | 'off' | null>(null);
  const [reviewDraft, setReviewDraft] = useState<Record<string, boolean>>({}); // staged review-request per team

  // Effective (displayed) state = the draft if touched, else the snapshot.
  const shareState = (slug: string): Tri => shareDraft[slug] ?? snapShare(slug);
  const pubState: Tri = pubDraft ?? pubSnap;
  // Toggling a tri-state goes →on unless it's already fully on (then →off).
  const toggleShare = (slug: string) => setShareDraft((p) => ({ ...p, [slug]: shareState(slug) === 'on' ? 'off' : 'on' }));
  const togglePublic = () => setPubDraft(pubState === 'on' ? 'off' : 'on');
  const toggleReview = (slug: string) => setReviewDraft((p) => ({ ...p, [slug]: !p[slug] }));

  // The diff to commit: only teams/flags whose DRAFT differs from the current
  // all/none state. Each op carries `n` = how many replays it will actually
  // CHANGE (e.g. unshare only touches the ones currently shared), so the Apply
  // affordance can say "Unshare 2 from CCC" rather than the selection size. (The
  // post-apply message reconciles any server-side skips — private/encrypted.)
  const reps = (n: number) => `${n} replay${n === 1 ? '' : 's'}`;
  const ops: { op: string; teamSlug?: string; n: number; verb: string }[] = [];
  for (const t of teams) {
    const d = shareDraft[t.slug];
    const onCount = shareCounts[t.slug] || 0;
    if (d === 'on' && snapShare(t.slug) !== 'on') ops.push({ op: 'share', teamSlug: t.slug, n: count - onCount, verb: `Share ${reps(count - onCount)} with ${t.name}` });
    else if (d === 'off' && snapShare(t.slug) !== 'off') ops.push({ op: 'unshare', teamSlug: t.slug, n: onCount, verb: `Unshare ${reps(onCount)} from ${t.name}` });
  }
  for (const t of teams) {
    if (reviewDraft[t.slug] !== undefined && shareState(t.slug) === 'on') {
      ops.push(reviewDraft[t.slug]
        ? { op: 'review-request', teamSlug: t.slug, n: count, verb: `Request ${t.name} review for ${reps(count)}` }
        : { op: 'review-cancel', teamSlug: t.slug, n: count, verb: `Cancel ${t.name} review for ${reps(count)}` });
    }
  }
  if (pubDraft === 'on' && pubSnap !== 'on') ops.push({ op: 'publish', n: count - publicCount, verb: `Make ${reps(count - publicCount)} public` });
  else if (pubDraft === 'off' && pubSnap !== 'off') ops.push({ op: 'unpublish', n: publicCount, verb: `Make ${reps(publicCount)} unlisted` });

  const sectionLabel: React.CSSProperties = { fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' };
  const hint: React.CSSProperties = { fontSize: 11, color: '#6c7588', fontStyle: 'italic', lineHeight: 1.4 };
  const mixedNote: React.CSSProperties = { marginLeft: 26, fontSize: 11, color: '#e0c64a' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}>
      {/* Scrollable body: the team list (which can be long) + Public scroll here,
          so the commit footer below stays pinned and reachable. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 10px 8px', overflowY: 'auto', minHeight: 0, flex: '1 1 auto' }}>
      {teams.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={sectionLabel}>Share with team</div>
          {teams.map((t) => {
            const st = shareState(t.slug);
            const onCount = shareCounts[t.slug] || 0;
            return (
              <div key={t.slug} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <LedToggle checked={st === 'on'} indeterminate={st === 'mixed'} onChange={() => toggleShare(t.slug)} label={t.name} statusOn="Sharing" disabled={busy} />
                {st === 'mixed' && <div style={mixedNote}>On {onCount} of {count} — toggle to share all</div>}
                {st === 'on' && (
                  <button type="button" onClick={() => toggleReview(t.slug)} disabled={busy}
                    style={{ alignSelf: 'flex-start', marginLeft: 26, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 0, padding: '1px 0', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600, color: reviewDraft[t.slug] ? '#ffc357' : '#6c7588' }}>
                    <span aria-hidden style={{ fontSize: 12 }}>{reviewDraft[t.slug] ? '★' : '☆'}</span>
                    {reviewDraft[t.slug] ? 'Will request team review — click to undo' : 'Request team review'}
                  </button>
                )}
              </div>
            );
          })}
          <div style={hint}>Surfaces in the selected teams’ replay grid. Plaintext replays can’t enter a private team and are skipped.</div>
        </div>
      )}

      <div style={{ borderTop: teams.length > 0 ? '1px solid #2e333c' : undefined, paddingTop: teams.length > 0 ? 10 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={sectionLabel}>Public</div>
        <LedToggle checked={pubState === 'on'} indeterminate={pubState === 'mixed'} onChange={togglePublic} label="Public replay" statusOn="Public" disabled={busy} />
        {pubState === 'mixed' && <div style={mixedNote}>{publicCount} of {count} public — toggle to publish all</div>}
        <div style={hint}>Off: only people with the link (and your shared teams) can see these; outside viewers never see their comments. Encrypted replays are skipped.</div>
      </div>
      </div>

      {/* Pinned commit footer: stays visible no matter how long the team list is.
          Nothing commits until Apply; Close discards. The diff bullets (capped +
          scrollable) name each staged change; the button names the single change. */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #2e333c', background: '#0f1318', padding: '10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ops.length > 1 && (
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: '#a7d2ff', lineHeight: 1.5, maxHeight: 84, overflowY: 'auto' }}>
            {ops.map((o) => <li key={o.verb}>{o.verb}</li>)}
          </ul>
        )}
        <button type="button" disabled={busy || ops.length === 0} onClick={() => onApply(ops.map(({ op, teamSlug }) => ({ op, teamSlug })))}
          style={{ ...dim(selActionStyle, busy || ops.length === 0), padding: '9px 14px', fontSize: 13, textAlign: 'center', width: '100%', boxSizing: 'border-box', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.3 }}>
          {ops.length === 0 ? 'No changes' : ops.length === 1 ? ops[0].verb : `Apply ${ops.length} changes`}
        </button>
        {canDelete && (
          <button type="button" onClick={onDelete} disabled={busy}
            style={{ width: '100%', textAlign: 'center', background: 'transparent', border: 0, padding: '4px 2px 2px', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', color: '#ff6b6b' }}>
            Delete {count} replay{count === 1 ? '' : 's'}…
          </button>
        )}
      </div>
    </div>
  );
}

// One menu, two shells (responsive disclosure): on a phone it's an iOS-style
// bottom sheet pinned to the thumb-reachable bottom edge with a dim backdrop; on
// desktop it's a compact dropdown popover anchored under the Actions button with
// a transparent click-away. Same content + drill-in either way.
function ActionSheet({ variant, title, onClose, onBack, children }: { variant: 'sheet' | 'popover'; title: string; onClose: () => void; onBack?: () => void; children: React.ReactNode }) {
  const isSheet = variant === 'sheet';
  const content = (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: isSheet ? 'rgba(0,0,0,0.55)' : 'transparent' }} />
      <div role="dialog" aria-label={title} style={isSheet ? sheetPanelStyle : popoverPanelStyle}>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: isSheet ? '8px 8px 10px' : '4px 6px 8px' }}>
          <span style={{ width: 52 }}>{onBack && <button type="button" onClick={onBack} style={sheetNavStyle}>‹ Back</button>}</span>
          <span style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#9aa3b2', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
          <span style={{ width: 52, textAlign: 'right' }}><button type="button" onClick={onClose} style={sheetNavStyle}>Close</button></span>
        </div>
        {/* Header is fixed; children own their own scroll/pinned-footer split so a
            long team list never pushes the commit actions below the fold. */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}>{children}</div>
      </div>
    </>
  );
  // The mobile bottom sheet is position:fixed and MUST anchor to the viewport.
  // Some pages (e.g. the team tab, via the sidebar's slide-in transform) put a
  // transformed/contained ancestor above the list, which becomes the containing
  // block for fixed descendants and clips the sheet (cut off bottom + right).
  // Portal it to <body> so it always escapes to the viewport. The desktop popover
  // is intentionally anchored to the Manage button, so it stays inline.
  if (isSheet && typeof document !== 'undefined') return createPortal(content, document.body);
  return content;
}
const sheetPanelStyle: React.CSSProperties = {
  position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 51, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
  background: '#0f1318', borderTop: '1px solid #2e333c', borderTopLeftRadius: 16, borderTopRightRadius: 16,
  paddingBottom: 'env(safe-area-inset-bottom)', boxShadow: '0 -10px 40px rgba(0,0,0,0.55)',
};
const popoverPanelStyle: React.CSSProperties = {
  position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 51, width: 300, maxHeight: 'min(70vh, 560px)', display: 'flex', flexDirection: 'column',
  background: '#0f1318', border: '1px solid #2e333c', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
};
const dim = (base: React.CSSProperties, disabled: boolean): React.CSSProperties =>
  disabled ? { ...base, opacity: 0.45, cursor: 'default' } : base;
const selBarStyle: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 5, marginTop: 12,
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  padding: '10px 12px', borderRadius: 10,
  background: 'rgba(13,16,22,0.96)', border: '1px solid rgba(77,210,255,0.35)', boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
};
const selLinkStyle: React.CSSProperties = { background: 'transparent', color: '#a7d2ff', border: 0, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', padding: 0, whiteSpace: 'nowrap' };
const selActionStyle: React.CSSProperties = { background: 'rgba(77,157,255,0.16)', color: '#cfe4ff', border: '1px solid rgba(77,157,255,0.4)', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const sheetNavStyle: React.CSSProperties = { background: 'transparent', color: '#4dd2ff', border: 0, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };
const selectButtonStyle = (active: boolean): React.CSSProperties => ({ background: active ? 'rgba(77,210,255,0.2)' : '#11141a', color: active ? '#cfe4ff' : '#a0a8b8', border: `1px solid ${active ? 'rgba(77,210,255,0.5)' : '#2e333c'}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' });

// Mobile select mode: a dense, tappable checklist — far more scannable for
// multi-select than the full cards (~10 rows/screen vs ~1.5). The desktop table
// already has a checkbox column; this is the phone equivalent (the full table is
// too wide for a phone, which is why it degrades to cards when just browsing).
function CompactSelectList({ rows }: { rows: Row[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
      {rows.map((r) => <CompactSelectRow key={r.slug} r={r} />)}
    </div>
  );
}
function CompactSelectRow({ r }: { r: Row }) {
  const sel = useReplaySelection();
  const canSel = !!sel?.selectable(r);
  const isSel = !!sel?.selected.has(r.slug);
  const meta = `${formatDateShort(r.createdAt)} · ${r.displayName || matchupText(r)}`;
  return (
    <div
      role={canSel ? 'button' : undefined}
      aria-pressed={canSel ? isSel : undefined}
      onClick={() => canSel && sel!.toggle(r.slug)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
        border: `1px solid ${isSel ? 'rgba(77,210,255,0.6)' : '#2e333c'}`,
        background: isSel ? 'rgba(77,210,255,0.08)' : 'rgba(255,255,255,0.015)',
        cursor: canSel ? 'pointer' : 'default', opacity: canSel ? 1 : 0.5,
      }}
    >
      {canSel
        ? <SelectBox checked={isSel} onToggle={() => sel!.toggle(r.slug)} label={`Select ${matchupText(r)}`} size={20} />
        : <span style={{ width: 20, flex: '0 0 auto' }} aria-hidden />}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <PrivateMatchup row={r as any} thumb={22} showNames={false} />
        <span style={{ fontSize: 11, color: '#6c7588', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>
      </div>
    </div>
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
              {g.rows.map((r, i) => <ReplayCard key={r.slug} replay={r as any} canManage={canManage} gameNumber={i + 1} />)}
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

// B159: group a TEAM's replays by the member who recorded them (team grid only —
// on a personal library every row is yours). Mirrors ByLeaderGroups.
function ByMemberGroups({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const items = useMemo<AccordionItem[]>(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const name = r.ownerName || 'Unknown member';
      const arr = m.get(name);
      if (arr) arr.push(r); else m.set(name, [r]);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([name, rs]) => ({ key: name, label: name, rows: rs, adornment: <MemberAvatar name={name} /> }));
  }, [rows]);
  return <AccordionGroups items={items} canManage={canManage} testid="member-group-heading" />;
}

// Initial-circle avatar for the by-member accordion rows.
function MemberAvatar({ name }: { name: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 26, height: 26, borderRadius: '50%', flex: '0 0 auto',
      background: 'rgba(77,157,255,0.18)', border: '1px solid rgba(77,157,255,0.4)',
      color: '#a7d2ff', fontSize: 12, fontWeight: 700,
    }}>
      {(name.trim()[0] || '?').toUpperCase()}
    </span>
  );
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
  // The calendar is opt-in behind a small icon toggle — collapsed by default so
  // it doesn't push the day list down on first load.
  const [showCalendar, setShowCalendar] = useState(false);
  const rowId = (key: string) => `kb-day-${key}`;
  const pick = (day: string) => {
    setOpen(day);
    // Let the row mount/expand, then bring it just below the calendar.
    requestAnimationFrame(() => document.getElementById(rowId(day))?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <>
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={() => setShowCalendar((v) => !v)}
          aria-expanded={showCalendar}
          aria-label={showCalendar ? 'Hide calendar' : 'Show calendar'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px',
            background: showCalendar ? 'rgba(77,157,255,0.12)' : 'transparent',
            border: `1px solid ${showCalendar ? 'rgba(77,157,255,0.5)' : '#2e333c'}`,
            borderRadius: 6, color: showCalendar ? '#e6e6e6' : '#a0a8b8',
            fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          }}
        >
          <CalendarIcon />
          Calendar
          <span aria-hidden style={{ fontSize: 9 }}>{showCalendar ? '▴' : '▾'}</span>
        </button>
      </div>
      {showCalendar && <TimelineCalendar countByDay={countByDay} activeDay={open} onPick={pick} />}
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

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="16" y1="2" x2="16" y2="6" />
    </svg>
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
    <div style={{ marginTop: 8, border: '1px solid #2e333c', borderRadius: 10, padding: 12, maxWidth: 420 }}>
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

// B158: group by lobby, then SEGMENT each lobby's games into individual matches
// by the format — a persistent karabast lobby can hold many Bo3s/Bo1s, so
// grouping by lobbyId alone produced bogus "Best of 11" series.
function buildSeriesGroups(rows: Row[]): SeriesGroup[] {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.lobbyId || `__solo__${r.slug}`;
    const arr = m.get(key);
    if (arr) arr.push(r); else m.set(key, [r]);
  }
  const groups: SeriesGroup[] = [];
  for (const [key, rs] of m.entries()) {
    const ordered = [...rs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const wonOf = (r: Row) => {
      const winners = Array.isArray(r.winners) ? r.winners : null;
      if (!winners || !r.viewerPlayerId) return null;
      return winners.includes(r.viewerPlayerId);
    };
    const matches = segmentMatches(ordered, wonOf, ordered[0]?.match?.gamesToWinMode ?? null);
    matches.forEach((match, i) => {
      groups.push({ key: matches.length > 1 ? `${key}#${i}` : key, rows: match, isSeries: match.length > 1 });
    });
  }
  return groups;
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
  // B158: "Best of N" from the match FORMAT (the BO3 badge), not the number of
  // games the viewer happens to have — a 2-0 sweep is still "Best of 3", and a
  // viewer missing a game (opponent recorded it) shouldn't read as "Best of 2".
  const label = bestOfLabel(first?.match?.gamesToWinMode) ?? `Best of ${group.rows.length}`;
  return `${label} · ${matchup}${rec}`;
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
  const sel = useReplaySelection();
  const showSel = !!sel?.selectMode;

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
  const colCount = 7 + (showShared ? 1 : 0) + (showComments ? 1 : 0) + (showSel ? 1 : 0);

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
            {showSel && <PlainHeader>{''}</PlainHeader>}
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
            // B158: series rows read as one contained block — a continuous left
            // rail (shared with the SERIES header), a faint tint, an indented
            // first cell, and a closing edge under the last game.
            const gameRow = (r: Row, inSeries: boolean, gameNumber?: number, isLast = false) => {
              // In select mode a selectable row IS a checkbox: capture the click
              // before it reaches the inner replay link so tapping the row toggles
              // selection instead of navigating to the replay.
              const rowSelectable = showSel && !!sel?.selectable(r);
              const rowSelected = !!sel?.selected.has(r.slug);
              return (
              <tr key={r.slug}
                onClickCapture={rowSelectable ? (e) => { e.preventDefault(); e.stopPropagation(); sel!.toggle(r.slug); } : undefined}
                style={{
                borderTop: '1px solid #2e333c',
                ...(rowSelectable ? { cursor: 'pointer' } : {}),
                ...(rowSelected ? { background: 'rgba(77,210,255,0.10)' } : inSeries ? {
                  boxShadow: SERIES_RAIL,
                  background: 'rgba(77,157,255,0.045)',
                  ...(isLast ? { borderBottom: '2px solid rgba(77,157,255,0.4)' } : {}),
                } : {}),
              }}>
                {showSel && (
                  <td style={cellStyle}>
                    {sel!.selectable(r) && (
                      <SelectBox checked={rowSelected} onToggle={() => sel!.toggle(r.slug)} label={`Select ${matchupText(r)}`} />
                    )}
                  </td>
                )}
                <td style={inSeries ? { ...cellStyle, paddingLeft: 30 } : cellStyle}>{formatDateShort(r.createdAt)}</td>
                <td style={cellStyle} data-testid="replay-cell">
                  <ReplayCellLink replay={r} gameNumber={gameNumber} />
                </td>
                {showShared && (
                  <td style={cellStyle} data-testid="shared-cell">
                    <ShareBadge sharedTeams={r.sharedTeams} isPublic={r.isPublic} />
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
            };
            if (!g.isSeries) return gameRow(g.rows[0], false);
            return (
              <Fragment key={g.key}>
                <tr data-testid="series-group" style={{ borderTop: '2px solid rgba(77,157,255,0.4)', background: 'rgba(77,157,255,0.1)', boxShadow: SERIES_RAIL }}>
                  <td colSpan={colCount} style={{ padding: '7px 10px 7px 14px', fontSize: 11, fontWeight: 700, color: '#a7d2ff' }}>
                    <span style={{ background: 'rgba(77,157,255,0.18)', border: '1px solid rgba(77,157,255,0.5)', borderRadius: 999, padding: '1px 8px', fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', marginRight: 8 }}>Series</span>
                    {seriesHeadline(g)}
                  </td>
                </tr>
                {g.rows.map((r, i) => gameRow(r, true, i + 1, i === g.rows.length - 1))}
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
function ReplayCellLink({ replay, gameNumber }: { replay: Row; gameNumber?: number }) {
  // B170: an encrypted replay has no server-side matchup — decrypt the summary
  // client-side (key loaded) or show a clean lock, instead of blank art + "anon".
  if (replay.encrypted) {
    return (
      <Link href={`/r/${replay.slug}`} prefetch={false} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
        {gameNumber != null && <GameNumberChip n={gameNumber} />}
        <PrivateMatchup row={replay as any} thumb={26} />
      </Link>
    );
  }
  // Perspective order: my/the-uploader's side first, opponent second.
  const [p1, p2] = perspectivePlayers(replay);
  return (
    <Link href={`/r/${replay.slug}`} prefetch={false} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <PlayerThumbs player={p1} />
        <span style={{ fontSize: 10, color: '#6c7588', fontWeight: 700, letterSpacing: '0.08em' }}>VS</span>
        <PlayerThumbs player={p2} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {gameNumber != null && <GameNumberChip n={gameNumber} />}
        <ResultBadge playerId={p1?.id} winners={replay.winners} />
        <span style={{ fontWeight: 600, color: '#a7d2ff' }}>{matchupText(replay)}</span>
        <ResultBadge playerId={p2?.id} winners={replay.winners} />
        {replay.doubleSided && <DoubleSidedChip />}
      </div>
      {/* B116: usernames demoted to small secondary text. */}
      <div style={{ fontSize: 10, color: '#6c7588' }}>{nameText(p1)} vs {nameText(p2)}</div>
    </Link>
  );
}

// B129: position of a game within its Bo3 series (play order among the
// recorded games). Only rendered inside series groups.
export function GameNumberChip({ n }: { n: number }) {
  return (
    <span
      data-testid="game-number-chip"
      style={{
        background: 'rgba(77, 157, 255, 0.12)',
        border: '1px solid rgba(77, 157, 255, 0.4)',
        color: '#a7d2ff',
        borderRadius: 999,
        padding: '1px 8px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      Game {n}
    </span>
  );
}

// B128: both players recorded this game — the viewer can show both hands face
// up. Cyan to match the reveal accent.
export function DoubleSidedChip() {
  return (
    <span
      data-testid="double-sided-chip"
      title="Both players recorded — view with both hands face up"
      style={{
        background: 'rgba(77, 210, 255, 0.12)',
        border: '1px solid rgba(77, 210, 255, 0.4)',
        color: '#4dd2ff',
        borderRadius: 999,
        padding: '1px 8px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        marginLeft: 4,
      }}
    >
      ⇄ both POVs
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
// B158: the continuous left "rail" shared by a series' header + its game rows so
// the group reads as one contained block in the long table.
const SERIES_RAIL = 'inset 4px 0 0 rgba(77,157,255,0.6)';
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

function ViewSwitcher({ view, setView, showMember = false }: { view: ViewMode; setView: (v: ViewMode) => void; showMember?: boolean }) {
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
      {showMember && item('by-member', 'By member')}
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

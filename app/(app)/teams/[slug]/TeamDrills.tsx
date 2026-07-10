'use client';

// B227: the SHARED drill framework behind Openings AND Sideboarding. Everything
// that isn't the drill itself — the session setup (deck/vs/base/format/date/
// teammate filters + filter memory), the gauntlet (snapshotted queue, HUD,
// session rail, summary, revisit), the pool/history lists — lives here ONCE. A
// `DrillKind` adapter supplies only the drill-specific pieces: the Stage (the
// quiz), the labels, and the per-item badges/outcome. TeamOpenings and
// TeamSideboarding are thin wrappers over this.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Select } from '@/app/_components/Select';
import { LeaderSelect, type LeaderSelectOption } from '@/app/_components/LeaderSelect';
import { LedToggle } from '@/app/_components/LedToggle';
import { DateRangeSelect } from '@/app/_components/DateRangeSelect';
import { inDateRange, dateRangeLabel } from '@/lib/dateRange';
import { useFilterMemory, FilterMemoryMenu } from '@/app/_components/filterMemory';
import { LeaderBasePair } from '@/app/_components/LeaderBasePair';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { EmptyState, ErrorNote, Loading } from '@/app/_components/StatusUi';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { GradientBorderButton } from './OpeningPromptKit';

type BaseKind = { key: string; label: string; aspect: string | null; art: any; iconAspect: string | null } | null;

// The pool item shared by every drill. Drill-specific reveal fields ride along
// in the index signature — only the kind's render slots read them.
export interface DrillItem {
  replaySlug: string;
  createdAt: string;
  ownLeader: any; ownBase: any; oppLeader: any; oppBase: any;
  ownBaseKind: BaseKind; oppBaseKind: BaseKind;
  format: string | null;
  mine: boolean;
  answered: boolean;
  responseCount: number;
  commentCount: number;
  myAnsweredAt?: string;
  usernames?: { own: string | null; opp: string | null };
  recorder?: { userId: string | null; name: string | null };
  [k: string]: any;
}

// The one contract a drill's quiz stage implements (OpeningStage / SideboardStage).
export interface DrillStageProps {
  teamSlug: string;
  replaySlug: string;
  viewerName: string;
  hasNext: boolean;
  onAnswered: (slug: string, sameAsRecorder: boolean) => void;
  onNext: () => void;
  finishLabel: string;
}

export interface DrillKind {
  testPrefix: string; // 'opening' | 'sideboard' — preserves existing testids
  poolPath: string;   // 'openings' | 'sideboarding'
  Stage: React.ComponentType<DrillStageProps>;
  copy: {
    loading: string;
    emptyIcon: string;
    emptyText: string;
    setupTitle: string;
    beginLabel: string;
    unit: string;        // 'opening' | 'sideboard'
    unitPlural: string;
    reviewingLabel: string;              // 'Reviewing opening'
    sessionCounter: (i: number, n: number) => string; // 'Opening 1 of 5'
    myTitle: string;                     // 'My openings'
    answeredTitle: string;               // 'Answered'
    answeredHistoryTitle: string;        // 'Answered openings'
  };
  // A one-time dismissable "what is this" banner on the setup screen.
  explainer?: { headline: string; body: string };
  // The per-session "how many diverged" HUD/summary metric (amber count).
  sessionMetric?: (results: Record<string, boolean>) => React.ReactNode | null;
  summaryMark?: (sameAsRecorder: boolean) => React.ReactNode; // 'same' / 'different take'
  // Per-item, drill-specific bits in the pool lists:
  rowContext?: (item: DrillItem) => React.ReactNode;   // the small sub-line (initiative / game-N)
  rowBadges?: (item: DrillItem) => React.ReactNode;    // consensus / split badges
  answeredOutcome?: (item: DrillItem) => React.ReactNode; // the compact outcome glyph
}

const ALL = '__all__';

interface Session {
  queue: string[];
  index: number;
  results: Record<string, boolean>; // slug → same as the recorder (not a score)
  revisit?: boolean;
}

export function TeamDrills({
  teamSlug,
  members,
  viewerName,
  kind,
}: {
  teamSlug: string;
  members: { userId: string; name: string | null }[];
  viewerName: string;
  kind: DrillKind;
}) {
  const T = kind.testPrefix;
  const [items, setItems] = useState<DrillItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deck, setDeck] = useState<string>(ALL);
  const [base, setBase] = useState<string>(ALL);
  const [vs, setVs] = useState<string>(ALL);
  const [vsBase, setVsBase] = useState<string>(ALL);
  const [teammate, setTeammate] = useState<string>(ALL);
  const [format, setFormat] = useState<string>(ALL);
  const [since, setSince] = useState<string>(ALL);
  const [session, setSession] = useState<Session | null>(null);
  const [showAllMine, setShowAllMine] = useState(false);
  const [mineCommentsOnly, setMineCommentsOnly] = useState(false);
  const [view, setView] = useState<'setup' | 'history'>('setup');
  const [search, setSearch] = useState('');
  const [railOpen, setRailOpen] = useState(false);
  const compact = useMediaQuery('(max-width: 1100px)');

  const load = useCallback(async (opts: { flash?: boolean } = {}) => {
    if (opts.flash) setItems(null);
    try {
      const qs = teammate !== ALL ? `?recorder=${encodeURIComponent(teammate)}` : '';
      const res = await fetch(`/api/teams/${teamSlug}/${kind.poolPath}${qs}`);
      const j = await res.json();
      if (!j.ok) { setError(j.error || 'failed to load'); return; }
      setItems(j.data);
      setError(null);
    } catch { setError('failed to load'); }
  }, [teamSlug, teammate, kind.poolPath]);

  useEffect(() => { void load({ flash: true }); }, [load]);

  const leaderName = (l: any) => (l?.name as string) || null;
  const deckOptions = useMemo(() => leaderArtOptions(items, (i) => i.ownLeader), [items]);
  const vsOptions = useMemo(() => leaderArtOptions(items, (i) => i.oppLeader), [items]);
  const baseOptions = useMemo(() => baseKindOptions(items, (i) => i.ownBaseKind), [items]);
  const vsBaseOptions = useMemo(() => baseKindOptions(items, (i) => i.oppBaseKind), [items]);
  const formatOptions = useMemo(
    () => Array.from(new Set((items ?? []).map((i) => i.format).filter((f): f is string => !!f))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    if (!items) return [];
    return items.filter(
      (i) =>
        (deck === ALL || leaderName(i.ownLeader) === deck) &&
        (base === ALL || i.ownBaseKind?.key === base) &&
        (vs === ALL || leaderName(i.oppLeader) === vs) &&
        (vsBase === ALL || i.oppBaseKind?.key === vsBase) &&
        (format === ALL || i.format === format) &&
        (since === ALL || inDateRange(i.createdAt, since)),
    );
  }, [items, deck, base, vs, vsBase, format, since]);

  const anyFilter = deck !== ALL || base !== ALL || vs !== ALL || vsBase !== ALL || teammate !== ALL || format !== ALL || since !== ALL || search !== '';
  const resetFilters = () => { setDeck(ALL); setBase(ALL); setVs(ALL); setVsBase(ALL); setTeammate(ALL); setFormat(ALL); setSince(ALL); setSearch(''); };

  interface DrillFilters { deck: string; base: string; vs: string; vsBase: string; teammate: string; format: string; since: string }
  const filterMemory = useFilterMemory<DrillFilters>(`${kind.poolPath}:${teamSlug}`);
  const applyFilters = (f: DrillFilters) => { setDeck(f.deck); setBase(f.base); setVs(f.vs); setVsBase(f.vsBase); setTeammate(f.teammate); setFormat(f.format); setSince(f.since); };
  const filterLabel = () => {
    const parts: string[] = [];
    if (deck !== ALL) parts.push(deck);
    if (base !== ALL) parts.push(base);
    if (vs !== ALL) parts.push(`vs ${vs}`);
    if (vsBase !== ALL) parts.push(`vs ${vsBase}`);
    if (teammate !== ALL) parts.push(members.find((m) => m.userId === teammate)?.name ?? 'teammate');
    if (format !== ALL) parts.push(format);
    if (since !== ALL) parts.push(dateRangeLabel(since));
    return parts.join(' · ');
  };

  const matching = filtered.filter((i) => !i.mine && !i.answered);
  const answered = filtered.filter((i) => !i.mine && i.answered);
  const mine = filtered.filter((i) => i.mine);

  const begin = () => {
    if (matching.length === 0) return;
    if (anyFilter && search === '') filterMemory.remember({ deck, base, vs, vsBase, teammate, format, since }, filterLabel());
    setSession({ queue: matching.map((i) => i.replaySlug), index: 0, results: {} });
  };
  const revisit = (slug: string) => setSession({ queue: [slug], index: 0, results: {}, revisit: true });
  const endSession = () => { setSession(null); void load(); };

  const onAnswered = useCallback((slug: string, same: boolean) => {
    setSession((s) => (s ? { ...s, results: { ...s.results, [slug]: same } } : s));
    setItems((cur) => cur?.map((i) => (i.replaySlug === slug ? { ...i, answered: true } : i)) ?? cur);
    void load();
  }, [load]);

  const hideFooter = <style>{`.kb-app-shell footer { display: none !important; }`}</style>;

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!items) return <Loading label={kind.copy.loading} />;
  if (items.length === 0) return <EmptyState icon={kind.copy.emptyIcon}>{kind.copy.emptyText}</EmptyState>;

  // ── PLAY ─────────────────────────────────────────────────────────────
  if (session) {
    const { queue, index, results, revisit: isRevisit } = session;
    const current = index < queue.length ? queue[index] : null;
    const metric = !isRevisit ? kind.sessionMetric?.(results) : null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {hideFooter}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button type="button" data-testid={`${T}-end-session`} onClick={endSession} style={pillBtn}>
            {isRevisit ? '← Back' : '← End session'}
          </button>
          {current && (
            <span style={{ fontSize: 13, fontWeight: 700, color: '#c8cdd8' }}>
              {isRevisit ? kind.copy.reviewingLabel : kind.copy.sessionCounter(index + 1, queue.length)}
            </span>
          )}
          {metric && <span style={{ fontSize: 12.5, color: '#FFD60A' }}>{metric}</span>}
          {current && compact && !isRevisit && (
            <button type="button" data-testid={`${T}-rail-toggle`} onClick={() => setRailOpen(true)} style={{ ...pillBtn, marginLeft: 'auto' }}>
              ☰ {index + 1}/{queue.length}
            </button>
          )}
        </div>
        {current ? (
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <kind.Stage
                key={current}
                teamSlug={teamSlug}
                replaySlug={current}
                viewerName={viewerName}
                hasNext={index + 1 < queue.length}
                onAnswered={onAnswered}
                onNext={isRevisit ? endSession : () => setSession((s) => (s ? { ...s, index: s.index + 1 } : s))}
                finishLabel={isRevisit ? 'Done' : 'Finish session'}
              />
            </div>
            {!compact && !isRevisit && (
              <SessionRail kind={kind} queue={queue} index={index} results={results} items={items} onJump={(i) => setSession((s) => (s ? { ...s, index: i } : s))} />
            )}
            {compact && !isRevisit && railOpen && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.5)' }} onClick={() => setRailOpen(false)}>
                <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 'min(300px, 85vw)', background: '#0f131a', borderLeft: '1px solid #2e333c', padding: 12, overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => setRailOpen(false)} aria-label="Close session list" style={{ ...pillBtn, marginBottom: 10 }}>✕ Close</button>
                  <SessionRail kind={kind} queue={queue} index={index} results={results} items={items} onJump={(i) => { setSession((s) => (s ? { ...s, index: i } : s)); setRailOpen(false); }} drawer />
                </div>
              </div>
            )}
          </div>
        ) : (
          <SessionSummary kind={kind} queue={queue} results={results} items={items} onRevisit={(i) => setSession((s) => (s ? { ...s, index: i } : s))} onDone={endSession} />
        )}
      </div>
    );
  }

  const filterControls = (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flex: '1 1 300px', minWidth: 0 }}>
          <LeaderSelect value={deck} onChange={setDeck} ariaLabel="Filter by deck leader" anyLabel="Any leader" options={deckOptions} testId={`${T}-filter-deck`} fullWidth />
          <LeaderSelect value={base} onChange={setBase} ariaLabel="Filter by base" anyLabel="Any base" options={baseOptions} testId={`${T}-filter-base`} fullWidth />
        </div>
        <span style={{ flex: '0 1 auto', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: '#6c7588', textAlign: 'center', minWidth: 24 }}>VS</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flex: '1 1 300px', minWidth: 0 }}>
          <LeaderSelect value={vs} onChange={setVs} ariaLabel="Filter by opposing leader" anyLabel="Any leader" options={vsOptions} testId={`${T}-filter-vs`} fullWidth />
          <LeaderSelect value={vsBase} onChange={setVsBase} ariaLabel="Filter by opposing base" anyLabel="Any base" options={vsBaseOptions} testId={`${T}-filter-vs-base`} fullWidth />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select value={teammate} onChange={setTeammate} ariaLabel="Filter by teammate" options={[[ALL, 'Any teammate'], ...members.map((m): [string, string] => [m.userId, m.name ?? 'Unnamed'])]} />
        <Select value={format} onChange={setFormat} ariaLabel="Filter by format" options={[[ALL, 'Any format'], ...formatOptions.map((f): [string, string] => [f, f])]} />
        <DateRangeSelect value={since === ALL ? '' : since} onChange={(v) => setSince(v || ALL)} ariaLabel="Filter by date" testId={`${T}-filter-date`} />
        {anyFilter && (
          <button type="button" data-testid={`${T}-filter-reset`} onClick={resetFilters} style={{ background: 'transparent', border: 'none', color: '#5db4ff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', padding: '2px 4px' }}>Reset</button>
        )}
      </div>
    </>
  );

  // ── HISTORY ──────────────────────────────────────────────────────────
  if (view === 'history') {
    const q = search.trim().toLowerCase();
    const hit = (i: DrillItem) => !q || [i.ownLeader?.name, i.ownBase?.name, i.oppLeader?.name, i.oppBase?.name, i.recorder?.name].some((n) => typeof n === 'string' && n.toLowerCase().includes(q));
    const rows = answered.filter(hit);
    return (
      <div data-testid={`${T}-history`} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {hideFooter}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" data-testid={`${T}-history-back`} onClick={() => setView('setup')} style={pillBtn}>← Session setup</button>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#e6ebf2' }}>{kind.copy.answeredHistoryTitle} · {rows.length}</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leaders, bases, teammates…" aria-label={`Search answered ${kind.copy.unitPlural}`} style={{ marginLeft: 'auto', minWidth: 240, padding: '6px 10px', background: '#10141b', border: '1px solid #2e333c', borderRadius: 8, color: '#e6e6e6', fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{filterControls}</div>
        <FilterMemoryMenu history={filterMemory.history} onApply={applyFilters} />
        {rows.length === 0 ? (
          <EmptyState icon={kind.copy.emptyIcon}>Nothing graded matches these filters.</EmptyState>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 8 }}>
            {rows.map((i) => <AnsweredRow key={i.replaySlug} kind={kind} item={i} onClick={() => revisit(i.replaySlug)} />)}
          </div>
        )}
      </div>
    );
  }

  // ── SETUP ────────────────────────────────────────────────────────────
  const mineFiltered = mineCommentsOnly ? mine.filter((i) => i.commentCount > 0) : mine;
  const mineWithSignal = mineFiltered.filter((i) => i.responseCount > 0 || i.commentCount > 0);
  const shownMine = mineCommentsOnly ? mineFiltered : showAllMine ? mine : mineWithSignal.slice(0, 12);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 680, margin: '0 auto', width: '100%' }}>
      {hideFooter}
      <DrillExplainer kind={kind} />
      <section style={{ padding: '18px 20px 20px', background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, boxShadow: tokens.surface.panelShadow, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#e6ebf2' }}>{kind.copy.setupTitle}</div>
        {filterControls}
        <FilterMemoryMenu history={filterMemory.history} onApply={applyFilters} />
        {teammate !== ALL && <span style={{ fontSize: 11.5, color: '#6c7588' }}>Coaching mode — identities visible.</span>}
        <div style={{ fontSize: 13, color: '#a0a8b8' }} data-testid={`${T}-match-count`}>
          <strong style={{ color: '#e6ebf2' }}>{matching.length}</strong> unanswered {matching.length === 1 ? kind.copy.unit : kind.copy.unitPlural} match
          {answered.length > 0 && <span style={{ color: '#6c7588' }}> · {answered.length} already answered</span>}
        </div>
        <div>
          <GradientBorderButton testId={`${T}-begin`} onClick={begin} disabled={matching.length === 0}>{kind.copy.beginLabel}</GradientBorderButton>
        </div>
      </section>

      {mine.length > 0 && (
        <ListSection
          title={kind.copy.myTitle}
          headerRight={<LedToggle checked={mineCommentsOnly} onChange={setMineCommentsOnly} label={`With comments (${mine.filter((i) => i.commentCount > 0).length})`} />}
          note={mineCommentsOnly && mineFiltered.length === 0 ? `No comments on your ${kind.copy.unitPlural} yet.` : !mineCommentsOnly && mineWithSignal.length === 0 ? `No feedback on your ${mine.length} ${mine.length === 1 ? kind.copy.unit : kind.copy.unitPlural} yet.` : undefined}
          expander={mineCommentsOnly ? undefined : mine.length > shownMine.length ? { label: `Show all ${mine.length}`, onClick: () => setShowAllMine(true) } : showAllMine && mine.length > 12 ? { label: 'Show less', onClick: () => setShowAllMine(false) } : undefined}
        >
          {shownMine.map((i) => <PoolRow key={i.replaySlug} kind={kind} item={i} onClick={() => revisit(i.replaySlug)} />)}
        </ListSection>
      )}

      {answered.length > 0 && (
        <ListSection title={`${kind.copy.answeredTitle} · ${answered.length}`} expander={{ label: `Show all ${answered.length} →`, onClick: () => setView('history'), testId: `${T}-answered-showall` }}>
          {answered.slice(0, 6).map((i) => <AnsweredRow key={i.replaySlug} kind={kind} item={i} onClick={() => revisit(i.replaySlug)} />)}
        </ListSection>
      )}
    </div>
  );
}

const pillBtn: React.CSSProperties = { background: 'transparent', border: '1px solid #2e333c', borderRadius: tokens.radius.sm, color: '#a0a8b8', fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', cursor: 'pointer' };

// A one-time "what is this" banner on the setup screen: shown on first visit,
// dismissable, and remembered per drill in localStorage so it never nags again.
// Dismissing leaves a low-footprint "How it works" link to bring it back.
function DrillExplainer({ kind }: { kind: DrillKind }) {
  const key = `kb-drill-explainer-dismissed:${kind.poolPath}`;
  // Client-only subtree (rendered after the loading gate), so reading storage in
  // the initializer is safe — no SSR/hydration mismatch.
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try { return localStorage.getItem(key) !== '1'; } catch { return true; }
  });
  if (!kind.explainer) return null;
  const dismiss = () => { try { localStorage.setItem(key, '1'); } catch {} setOpen(false); };

  if (!open) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -14 }}>
        <button type="button" data-testid={`${kind.testPrefix}-explainer-reopen`} onClick={() => setOpen(true)}
          style={{ background: 'transparent', border: 0, color: '#6c7588', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, padding: 2 }}>
          <span aria-hidden="true">ⓘ</span> How it works
        </button>
      </div>
    );
  }
  return (
    <div data-testid={`${kind.testPrefix}-explainer`} style={{ position: 'relative', display: 'flex', gap: 12, padding: '14px 16px', borderRadius: tokens.radius.md, background: 'rgba(77,210,255,0.06)', border: '1px solid rgba(77,210,255,0.3)' }}>
      <div style={{ fontSize: 20, lineHeight: 1.1 }} aria-hidden="true">💡</div>
      <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: '#e6ebf2', marginBottom: 3 }}>{kind.explainer.headline}</div>
        <div style={{ fontSize: 12.5, color: '#a0a8b8', lineHeight: 1.55 }}>{kind.explainer.body}</div>
      </div>
      <button type="button" data-testid={`${kind.testPrefix}-explainer-dismiss`} onClick={dismiss} aria-label="Dismiss"
        style={{ position: 'absolute', top: 6, right: 9, background: 'transparent', border: 0, color: '#6c7588', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4 }}>×</button>
    </div>
  );
}

function SessionRail({ kind, queue, index, results, items, onJump, drawer = false }: { kind: DrillKind; queue: string[]; index: number; results: Record<string, boolean>; items: DrillItem[] | null; onJump: (i: number) => void; drawer?: boolean }) {
  const byId = new Map((items ?? []).map((i) => [i.replaySlug, i]));
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { currentRef.current?.scrollIntoView({ block: 'nearest' }); }, [index]);
  return (
    <nav data-testid={`${kind.testPrefix}-session-rail`} aria-label="Session items" style={{ width: drawer ? '100%' : 236, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, ...(drawer ? {} : { position: 'sticky', top: 12, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' }) }}>
      {queue.map((slug, i) => {
        const it = byId.get(slug);
        const isCurrent = i === index;
        const isAnswered = results[slug] !== undefined;
        const own = (it?.ownLeader?.name as string) || '?';
        const opp = (it?.oppLeader?.name as string) || '?';
        return (
          <button key={slug} ref={isCurrent ? currentRef : undefined} type="button" data-testid={`${kind.testPrefix}-rail-item`} aria-current={isCurrent ? 'step' : undefined} onClick={() => onJump(i)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: tokens.radius.sm, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              background: isCurrent ? 'rgba(77,210,255,0.12)' : 'transparent', border: `1px solid ${isCurrent ? 'rgba(77,210,255,0.5)' : '#23272f'}`, opacity: !isCurrent && !isAnswered && i > index ? 0.55 : 1 }}>
            <span style={{ fontSize: 10, color: '#6c7588', width: 16, flexShrink: 0, textAlign: 'right' }}>{i + 1}</span>
            <LeaderBasePair leader={it?.ownLeader} base={it?.ownBase} orientation="overlap" width={34} height={24} fit="cover" radius={3} fallback="hide" />
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: '#c8cdd8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {own} <span style={{ color: '#6c7588', fontWeight: 400 }}>vs</span> {opp}
            </span>
            {isAnswered && <span style={{ fontSize: 10, flexShrink: 0, fontWeight: 700, color: results[slug] ? '#6c7588' : '#FFD60A' }}>{results[slug] ? 'same' : 'different'}</span>}
          </button>
        );
      })}
    </nav>
  );
}

function SessionSummary({ kind, queue, results, items, onRevisit, onDone }: { kind: DrillKind; queue: string[]; results: Record<string, boolean>; items: DrillItem[]; onRevisit: (index: number) => void; onDone: () => void }) {
  const answered = Object.values(results).length;
  const byId = new Map(items.map((i) => [i.replaySlug, i]));
  return (
    <div data-testid={`${kind.testPrefix}-summary`} style={{ padding: '32px 28px', textAlign: 'center', background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, color: '#8a93a3', maxWidth: 620, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 34 }}>🏁</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#e6ebf2', marginTop: 8 }}>Session complete</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>
        {answered} {answered === 1 ? kind.copy.unit : kind.copy.unitPlural}
        {kind.sessionMetric && <>{(() => { const m = kind.sessionMetric!(results); return m ? <> · {m}</> : null; })()}</>}
      </div>
      {queue.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '18px 0 0', textAlign: 'left' }}>
          {queue.map((slug, i) => {
            const item = byId.get(slug);
            const mark = results[slug];
            return (
              <button key={slug} type="button" onClick={() => onRevisit(i)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'transparent', border: '1px solid #2e333c', borderRadius: tokens.radius.sm, color: '#c8cdd8', fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(item?.ownLeader?.name as string) ?? '?'} vs {(item?.oppLeader?.name as string) ?? '?'}</span>
                {mark !== undefined && (kind.summaryMark ? kind.summaryMark(mark) : <span style={{ color: mark ? '#6c7588' : '#FFD60A', fontWeight: 700 }}>{mark ? 'same' : 'different'}</span>)}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ marginTop: 20 }}>
        <GradientBorderButton testId={`${kind.testPrefix}-new-session`} onClick={onDone}>New session</GradientBorderButton>
      </div>
    </div>
  );
}

function baseKindOptions(items: DrillItem[] | null, pick: (i: DrillItem) => DrillItem['ownBaseKind']): LeaderSelectOption[] {
  if (!items) return [];
  const byKey = new Map<string, LeaderSelectOption>();
  for (const i of items) {
    const k = pick(i);
    if (k && !byKey.has(k.key)) byKey.set(k.key, { value: k.key, label: k.label, art: k.art, artIsLeader: false, iconAspect: k.iconAspect });
  }
  return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function leaderArtOptions(items: DrillItem[] | null, pick: (i: DrillItem) => any): LeaderSelectOption[] {
  if (!items) return [];
  const byName = new Map<string, any>();
  for (const i of items) {
    const card = pick(i);
    const name = (card?.name as string) || null;
    if (name && !byName.has(name)) byName.set(name, card);
  }
  return Array.from(byName.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([name, card]) => ({ value: name, label: name, art: card }));
}

function ListSection({ title, note, expander, headerRight, children }: { title: string; note?: string; expander?: { label: string; onClick: () => void; testId?: string }; headerRight?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '0 0 6px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a93a3' }}>{title}</div>
        {headerRight}
      </div>
      {note && <div style={{ fontSize: 12, color: '#6c7588', marginBottom: 6 }}>{note}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 6 }}>{children}</div>
      {expander && (
        <button type="button" data-testid={expander.testId} onClick={expander.onClick} style={{ marginTop: 8, background: 'transparent', border: '1px solid #2e333c', borderRadius: 6, color: '#8a93a3', fontFamily: 'inherit', fontSize: 12, padding: '4px 12px', cursor: 'pointer' }}>{expander.label}</button>
      )}
    </section>
  );
}

// Small pill badge — shared with the kind adapters (consensus/comment badges).
export function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ fontSize: 10.5, fontWeight: 700, color, border: `1px solid ${color}55`, borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' }}>{children}</span>;
}

function PairArt({ leader, base, reverse }: { leader: any; base: any; reverse?: boolean }) {
  return <LeaderBasePair leader={leader} base={base} orientation="overlap" reverse={reverse} width={58} height={41} fit="cover" radius={4} fallback="hide" />;
}

const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null);

// The unanswered pool row (setup "My …" list): matchup + kind context + badges.
function PoolRow({ kind, item, onClick }: { kind: DrillKind; item: DrillItem; onClick: () => void }) {
  const own = (item.ownLeader?.name as string) || 'Unknown';
  const opp = (item.oppLeader?.name as string) || 'Unknown';
  return (
    <button type="button" data-testid={`${kind.testPrefix}-row`} onClick={onClick} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 10px', background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.sm, cursor: 'pointer', textAlign: 'left', color: '#e6e6e6', fontFamily: 'inherit', width: '100%' }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#c8cdd8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{own} <span style={{ color: '#6c7588', fontWeight: 400 }}>vs</span> {opp}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6c7588', flexWrap: 'wrap', width: '100%' }}>
        {item.recorder?.name ? `${item.recorder.name}${item.mine ? ' (you)' : ''}` : `Teammate ${kind.copy.unit}`}
        {kind.rowContext?.(item)}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
          {item.commentCount > 0 && <Badge color="#5db4ff">💬 {item.commentCount}</Badge>}
          {kind.rowBadges?.(item)}
        </span>
      </span>
    </button>
  );
}

// A graded row (history / answered list): art both sides, matchup + players +
// dates, the kind's outcome glyph + badges.
function AnsweredRow({ kind, item, onClick }: { kind: DrillKind; item: DrillItem; onClick: () => void }) {
  const own = (item.ownLeader?.name as string) || 'Unknown';
  const opp = (item.oppLeader?.name as string) || 'Unknown';
  const ownUser = item.usernames?.own ?? item.recorder?.name ?? null;
  const oppUser = item.usernames?.opp ?? null;
  const played = shortDate(item.createdAt);
  const answeredAt = shortDate(item.myAnsweredAt);
  return (
    <button type="button" data-testid={`${kind.testPrefix}-row`} onClick={onClick} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '8px 12px', background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.sm, cursor: 'pointer', textAlign: 'left', color: '#e6e6e6', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', overflow: 'hidden', fontSize: 12.5 }}>
      <PairArt leader={item.ownLeader} base={item.ownBase} />
      <span style={{ fontSize: 10, fontWeight: 800, color: '#6c7588', flexShrink: 0 }}>VS</span>
      <PairArt leader={item.oppLeader} base={item.oppBase} reverse />
      <span style={{ flex: '1 1 170px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 600, color: '#c8cdd8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{own} <span style={{ color: '#6c7588', fontWeight: 400 }}>vs</span> {opp}</span>
        <span style={{ fontSize: 11, color: '#6c7588', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ownUser && oppUser ? `${ownUser} vs ${oppUser}` : ownUser ?? ''}
          {played && ` · played ${played}`}
          {answeredAt && ` · answered ${answeredAt}`}
        </span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0, marginLeft: 'auto' }}>
        {kind.answeredOutcome?.(item)}
        <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {item.commentCount > 0 && <Badge color="#5db4ff">💬 {item.commentCount}</Badge>}
          {kind.rowBadges?.(item)}
        </span>
      </span>
    </button>
  );
}

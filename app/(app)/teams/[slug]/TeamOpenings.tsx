'use client';

// B221: the team Openings tab — a TWO-PHASE gauntlet.
//
//   SETUP  — pick the session's parameters (deck / opposing leader / teammate
//            filters), see how many unanswered openings match, hit Begin.
//            Your own uploads and previously answered openings live here as
//            revisit lists. Filters exist ONLY on this screen.
//   PLAY   — the karabast table, nothing else: a slim session HUD, the board
//            (leader/base center column, prompt, full-width hand), one opening
//            at a time. The queue is SNAPSHOTTED at Begin (stable order), and
//            the session ends on a summary you can revisit items from.
//
// Identity stays hidden on quiz items; the teammate filter is "coaching mode"
// and inherently reveals it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Select } from '@/app/_components/Select';
import { LeaderSelect, type LeaderSelectOption } from '@/app/_components/LeaderSelect';
import { useFilterMemory, FilterMemoryChips } from '@/app/_components/filterMemory';
import { EmptyState, ErrorNote, Loading } from '@/app/_components/StatusUi';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { GradientBorderButton } from './OpeningPromptKit';
import { OpeningStage } from './OpeningQuiz';

interface PoolItem {
  replaySlug: string;
  createdAt: string;
  ownLeader: any;
  ownBase: any;
  oppLeader: any;
  oppBase: any;
  format: string | null;
  wentFirst: boolean | null;
  mine: boolean;
  answered: boolean;
  responseCount: number;
  commentCount: number;
  recordedDecision?: 'keep' | 'mulligan';
  keepCount?: number;
  mulliganCount?: number;
  myDecision?: 'keep' | 'mulligan';
  myPickMatches?: number;
  recorder?: { userId: string | null; name: string | null };
}

const ALL = '__all__';

interface Session {
  queue: string[]; // snapshotted at Begin — stable for the whole run
  index: number; // === queue.length → the summary screen
  results: Record<string, boolean>; // slug → matched the recorded call?
}

export function TeamOpenings({
  teamSlug,
  members,
  viewerName,
}: {
  teamSlug: string;
  members: { userId: string; name: string | null }[];
  viewerName: string;
}) {
  const [items, setItems] = useState<PoolItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deck, setDeck] = useState<string>(ALL);
  const [base, setBase] = useState<string>(ALL);
  const [vs, setVs] = useState<string>(ALL);
  const [vsBase, setVsBase] = useState<string>(ALL);
  const [teammate, setTeammate] = useState<string>(ALL);
  const [format, setFormat] = useState<string>(ALL);
  const [since, setSince] = useState<string>(ALL); // days-back preset
  const [session, setSession] = useState<Session | null>(null);
  const [showAllMine, setShowAllMine] = useState(false);
  // 'history' = the full-page browse/search surface for already-graded
  // openings. Same component, same FILTER STATE — switching views carries the
  // filters with zero re-setup (the workflow ask).
  const [view, setView] = useState<'setup' | 'history'>('setup');
  const [search, setSearch] = useState('');

  const load = useCallback(async (opts: { flash?: boolean } = {}) => {
    if (opts.flash) setItems(null);
    try {
      const qs = teammate !== ALL ? `?recorder=${encodeURIComponent(teammate)}` : '';
      const res = await fetch(`/api/teams/${teamSlug}/openings${qs}`);
      const j = await res.json();
      if (!j.ok) { setError(j.error || 'failed to load'); return; }
      setItems(j.data);
      setError(null);
    } catch {
      setError('failed to load');
    }
  }, [teamSlug, teammate]);

  useEffect(() => { void load({ flash: true }); }, [load]);

  const leaderName = (l: any) => (l?.name as string) || null;
  const deckOptions = useMemo(() => leaderArtOptions(items, (i) => i.ownLeader), [items]);
  const vsOptions = useMemo(() => leaderArtOptions(items, (i) => i.oppLeader), [items]);
  const baseOptions = useMemo(() => leaderArtOptions(items, (i) => i.ownBase, false), [items]);
  const vsBaseOptions = useMemo(() => leaderArtOptions(items, (i) => i.oppBase, false), [items]);
  const formatOptions = useMemo(
    () => Array.from(new Set((items ?? []).map((i) => i.format).filter((f): f is string => !!f))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    if (!items) return [];
    const cutoff = since === ALL ? null : Date.now() - Number(since) * 24 * 60 * 60 * 1000;
    return items.filter(
      (i) =>
        (deck === ALL || leaderName(i.ownLeader) === deck) &&
        (base === ALL || leaderName(i.ownBase) === base) &&
        (vs === ALL || leaderName(i.oppLeader) === vs) &&
        (vsBase === ALL || leaderName(i.oppBase) === vsBase) &&
        (format === ALL || i.format === format) &&
        (cutoff === null || new Date(i.createdAt).getTime() >= cutoff),
    );
  }, [items, deck, base, vs, vsBase, format, since]);

  const anyFilter = deck !== ALL || base !== ALL || vs !== ALL || vsBase !== ALL || teammate !== ALL || format !== ALL || since !== ALL || search !== '';
  const resetFilters = () => {
    setDeck(ALL); setBase(ALL); setVs(ALL); setVsBase(ALL); setTeammate(ALL); setFormat(ALL); setSince(ALL); setSearch('');
  };

  // Per-device memory of filter-sets actually USED (recorded on Begin) —
  // one-click restore chips on both views. Per-team key: leader pools differ.
  interface OpeningFilters { deck: string; base: string; vs: string; vsBase: string; teammate: string; format: string; since: string }
  const filterMemory = useFilterMemory<OpeningFilters>(`openings:${teamSlug}`);
  const applyFilters = (f: OpeningFilters) => {
    setDeck(f.deck); setBase(f.base); setVs(f.vs); setVsBase(f.vsBase); setTeammate(f.teammate); setFormat(f.format); setSince(f.since);
  };
  const filterLabel = () => {
    const parts: string[] = [];
    if (deck !== ALL) parts.push(deck);
    if (base !== ALL) parts.push(base);
    if (vs !== ALL) parts.push(`vs ${vs}`);
    if (vsBase !== ALL) parts.push(`vs ${vsBase}`);
    if (teammate !== ALL) parts.push(members.find((m) => m.userId === teammate)?.name ?? 'teammate');
    if (format !== ALL) parts.push(format);
    if (since !== ALL) parts.push(`${since}d`);
    return parts.join(' · ');
  };

  const matching = filtered.filter((i) => !i.mine && !i.answered);
  const answered = filtered.filter((i) => !i.mine && i.answered);
  const mine = filtered.filter((i) => i.mine);

  const begin = () => {
    if (matching.length === 0) return;
    if (deck !== ALL || base !== ALL || vs !== ALL || vsBase !== ALL || teammate !== ALL || format !== ALL || since !== ALL) {
      filterMemory.remember({ deck, base, vs, vsBase, teammate, format, since }, filterLabel());
    }
    setSession({ queue: matching.map((i) => i.replaySlug), index: 0, results: {} });
  };
  const revisit = (slug: string) => setSession({ queue: [slug], index: 0, results: {} });
  const endSession = () => {
    setSession(null);
    void load(); // fresh badges/comment counts for the setup lists
  };

  const onAnswered = useCallback((slug: string, agreed: boolean) => {
    setSession((s) => (s ? { ...s, results: { ...s.results, [slug]: agreed } } : s));
    setItems((cur) => cur?.map((i) => (i.replaySlug === slug ? { ...i, answered: true } : i)) ?? cur);
    void load(); // silent refresh for tallies/badges
  }, [load]);

  // The gauntlet is a play surface: reclaim the sticky sitewide footer's band
  // while this tab is mounted (same spirit as the immersive viewer dropping
  // it). !important — the footer sets display:flex inline. The rule dies with
  // the component on tab switch.
  const hideFooter = <style>{`.kb-app-shell footer { display: none !important; }`}</style>;

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!items) return <Loading label="Shuffling up…" />;
  if (items.length === 0) {
    return (
      <EmptyState icon="🃏">
        No openings yet — they appear when teammates share replays with a full setup.
      </EmptyState>
    );
  }

  // ── PLAY ─────────────────────────────────────────────────────────────
  if (session) {
    const { queue, index, results } = session;
    const matched = Object.values(results).filter(Boolean).length;
    const answeredCount = Object.values(results).length;
    const current = index < queue.length ? queue[index] : null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {hideFooter}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="opening-end-session"
            onClick={endSession}
            style={{
              background: 'transparent',
              border: '1px solid #2e333c',
              borderRadius: tokens.radius.sm,
              color: '#a0a8b8',
              fontFamily: 'inherit',
              fontSize: 12,
              padding: '5px 10px',
              cursor: 'pointer',
            }}
          >
            ← End session
          </button>
          {current && (
            <span style={{ fontSize: 13, fontWeight: 700, color: '#c8cdd8' }}>
              Opening {index + 1} of {queue.length}
            </span>
          )}
          {answeredCount > 0 && (
            <span style={{ fontSize: 12.5, color: '#6bd968' }}>
              {matched}/{answeredCount} matched
            </span>
          )}
        </div>
        {current ? (
          <OpeningStage
            key={current}
            teamSlug={teamSlug}
            replaySlug={current}
            viewerName={viewerName}
            hasNext={index + 1 < queue.length}
            onAnswered={onAnswered}
            onNext={() => setSession((s) => (s ? { ...s, index: s.index + 1 } : s))}
          />
        ) : (
          <SessionSummary
            queue={queue}
            results={results}
            items={items}
            onRevisit={(i) => setSession((s) => (s ? { ...s, index: i } : s))}
            onDone={endSession}
          />
        )}
      </div>
    );
  }

  // Shared by the setup card and the history view — SAME state, so filters
  // carry across views.
  const filterControls = (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <LeaderSelect value={deck} onChange={setDeck} ariaLabel="Filter by deck leader" anyLabel="Any leader" options={deckOptions} testId="opening-filter-deck" />
        <LeaderSelect value={base} onChange={setBase} ariaLabel="Filter by base" anyLabel="Any base" options={baseOptions} testId="opening-filter-base" />
        <LeaderSelect value={vs} onChange={setVs} ariaLabel="Filter by opposing leader" anyLabel="vs any leader" options={vsOptions} testId="opening-filter-vs" />
        <LeaderSelect value={vsBase} onChange={setVsBase} ariaLabel="Filter by opposing base" anyLabel="vs any base" options={vsBaseOptions} testId="opening-filter-vs-base" />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select
          value={teammate}
          onChange={setTeammate}
          ariaLabel="Filter by teammate"
          options={[
            [ALL, 'Any teammate'],
            ...members.map((m): [string, string] => [m.userId, m.name ?? 'Unnamed']),
          ]}
        />
        <Select
          value={format}
          onChange={setFormat}
          ariaLabel="Filter by format"
          options={[[ALL, 'Any format'], ...formatOptions.map((f): [string, string] => [f, f])]}
        />
        <Select
          value={since}
          onChange={setSince}
          ariaLabel="Filter by recency"
          options={[[ALL, 'Any time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']]}
        />
        {anyFilter && (
          <button
            type="button"
            data-testid="opening-filter-reset"
            onClick={resetFilters}
            style={{ background: 'transparent', border: 'none', color: '#5db4ff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', padding: '2px 4px' }}
          >
            Reset
          </button>
        )}
      </div>
    </>
  );

  // ── HISTORY — the full-page browse/search surface for graded openings ──
  if (view === 'history') {
    const q = search.trim().toLowerCase();
    const hit = (i: PoolItem) =>
      !q ||
      [i.ownLeader?.name, i.ownBase?.name, i.oppLeader?.name, i.oppBase?.name, i.recorder?.name]
        .some((n) => typeof n === 'string' && n.toLowerCase().includes(q));
    const rows = answered.filter(hit);
    return (
      <div data-testid="opening-history" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {hideFooter}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="opening-history-back"
            onClick={() => setView('setup')}
            style={{ background: 'transparent', border: '1px solid #2e333c', borderRadius: tokens.radius.sm, color: '#a0a8b8', fontFamily: 'inherit', fontSize: 12, padding: '5px 10px', cursor: 'pointer' }}
          >
            ← Session setup
          </button>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#e6ebf2' }}>Answered openings · {rows.length}</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leaders, bases, teammates…"
            aria-label="Search answered openings"
            style={{ marginLeft: 'auto', minWidth: 240, padding: '6px 10px', background: '#10141b', border: '1px solid #2e333c', borderRadius: 8, color: '#e6e6e6', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{filterControls}</div>
        <FilterMemoryChips history={filterMemory.history} onApply={applyFilters} />
        {rows.length === 0 ? (
          <EmptyState icon="🃏">Nothing graded matches these filters.</EmptyState>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
            {rows.map((i) => (
              <AnsweredRow key={i.replaySlug} item={i} onClick={() => revisit(i.replaySlug)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── SETUP ────────────────────────────────────────────────────────────
  // Centered, focused column: the session card is the star; the revisit
  // lists below only surface items with something to look at (feedback /
  // your answers), the long tail behind Show all.
  const mineWithSignal = mine.filter((i) => i.responseCount > 0 || i.commentCount > 0);
  const shownMine = showAllMine ? mine : mineWithSignal.slice(0, 12);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 680, margin: '0 auto', width: '100%' }}>
      {hideFooter}
      <section
        style={{
          padding: '18px 20px 20px',
          background: tokens.surface.panel,
          border: `1px solid ${tokens.surface.panelBorder}`,
          borderRadius: tokens.radius.md,
          boxShadow: tokens.surface.panelShadow,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800, color: '#e6ebf2' }}>Set up your session</div>
        {filterControls}
        <FilterMemoryChips history={filterMemory.history} onApply={applyFilters} />
        {teammate !== ALL && (
          <span style={{ fontSize: 11.5, color: '#6c7588' }}>
            Coaching mode — identities visible.
          </span>
        )}
        <div style={{ fontSize: 13, color: '#a0a8b8' }} data-testid="opening-match-count">
          <strong style={{ color: '#e6ebf2' }}>{matching.length}</strong> unanswered opening{matching.length === 1 ? '' : 's'} match
          {answered.length > 0 && <span style={{ color: '#6c7588' }}> · {answered.length} already answered</span>}
        </div>
        <div>
          <GradientBorderButton testId="opening-begin" onClick={begin} disabled={matching.length === 0}>
            Begin session
          </GradientBorderButton>
        </div>
      </section>

      {mine.length > 0 && (
        <ListSection
          title="My openings"
          note={
            mineWithSignal.length === 0
              ? `No feedback on your ${mine.length} opening${mine.length === 1 ? '' : 's'} yet.`
              : undefined
          }
          expander={
            mine.length > shownMine.length
              ? { label: `Show all ${mine.length}`, onClick: () => setShowAllMine(true) }
              : showAllMine && mine.length > 12
                ? { label: 'Show less', onClick: () => setShowAllMine(false) }
                : undefined
          }
        >
          {shownMine.map((i) => (
            <OpeningRow key={i.replaySlug} item={i} onClick={() => revisit(i.replaySlug)} />
          ))}
        </ListSection>
      )}

      {answered.length > 0 && (
        <ListSection
          title={`Answered · ${answered.length}`}
          expander={{ label: `Show all ${answered.length} →`, onClick: () => setView('history'), testId: 'opening-answered-showall' }}
        >
          {answered.slice(0, 6).map((i) => (
            <AnsweredRow key={i.replaySlug} item={i} onClick={() => revisit(i.replaySlug)} />
          ))}
        </ListSection>
      )}
    </div>
  );
}

function SessionSummary({
  queue,
  results,
  items,
  onRevisit,
  onDone,
}: {
  queue: string[];
  results: Record<string, boolean>;
  items: PoolItem[];
  onRevisit: (index: number) => void;
  onDone: () => void;
}) {
  const answered = Object.values(results).length;
  const matched = Object.values(results).filter(Boolean).length;
  const byId = new Map(items.map((i) => [i.replaySlug, i]));
  return (
    <div
      data-testid="opening-summary"
      style={{
        padding: '32px 28px',
        textAlign: 'center',
        background: tokens.surface.panel,
        border: `1px solid ${tokens.surface.panelBorder}`,
        borderRadius: tokens.radius.md,
        color: '#8a93a3',
        maxWidth: 620,
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontSize: 34 }}>🏁</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#e6ebf2', marginTop: 8 }}>Session complete</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>
        {answered} opening{answered === 1 ? '' : 's'} · {matched} matched
      </div>
      {queue.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '18px 0 0', textAlign: 'left' }}>
          {queue.map((slug, i) => {
            const item = byId.get(slug);
            const mark = results[slug];
            return (
              <button
                key={slug}
                type="button"
                onClick={() => onRevisit(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 10px',
                  background: 'transparent',
                  border: '1px solid #2e333c',
                  borderRadius: tokens.radius.sm,
                  color: '#c8cdd8',
                  fontFamily: 'inherit',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(item?.ownLeader?.name as string) ?? '?'} vs {(item?.oppLeader?.name as string) ?? '?'}
                </span>
                {mark !== undefined && (
                  <span style={{ color: mark ? '#6bd968' : '#ff7b72', fontWeight: 700 }}>
                    {mark ? '✓ matched' : '✗ differed'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ marginTop: 20 }}>
        <GradientBorderButton testId="opening-new-session" onClick={onDone}>
          New session
        </GradientBorderButton>
      </div>
    </div>
  );
}

function leaderArtOptions(items: PoolItem[] | null, pick: (i: PoolItem) => any, artIsLeader = true): LeaderSelectOption[] {
  if (!items) return [];
  const byName = new Map<string, any>();
  for (const i of items) {
    const card = pick(i);
    const name = (card?.name as string) || null;
    if (name && !byName.has(name)) byName.set(name, card);
  }
  return Array.from(byName.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, card]) => ({ value: name, label: name, art: card, artIsLeader }));
}

function ListSection({
  title,
  note,
  expander,
  children,
}: {
  title: string;
  note?: string;
  expander?: { label: string; onClick: () => void; testId?: string };
  children: React.ReactNode;
}) {
  return (
    <section>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a93a3', margin: '0 0 6px' }}>
        {title}
      </div>
      {note && <div style={{ fontSize: 12, color: '#6c7588', marginBottom: 6 }}>{note}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
        {children}
      </div>
      {expander && (
        <button
          type="button"
          data-testid={expander.testId}
          onClick={expander.onClick}
          style={{
            marginTop: 8,
            background: 'transparent',
            border: '1px solid #2e333c',
            borderRadius: 6,
            color: '#8a93a3',
            fontFamily: 'inherit',
            fontSize: 12,
            padding: '4px 12px',
            cursor: 'pointer',
          }}
        >
          {expander.label}
        </button>
      )}
    </section>
  );
}

// The consensus/split badge — only computable once the tallies are serialized
// (viewer answered, or it's their upload). `recordedDecision` is the ground
// truth the team is being measured against.
function ConsensusBadge({ item }: { item: PoolItem }) {
  const k = item.keepCount ?? 0;
  const m = item.mulliganCount ?? 0;
  const total = k + m;
  if (item.recordedDecision === undefined || total === 0) return null;
  if (k > 0 && m > 0) {
    return <Badge color="#ffb454">⚡ Split {Math.max(k, m)}–{Math.min(k, m)}</Badge>;
  }
  const unanimous = k > 0 ? 'keep' : 'mulligan';
  if (unanimous !== item.recordedDecision) {
    return <Badge color="#ff7b72">▲ Team disagrees ({total})</Badge>;
  }
  return <Badge color="#6bd968">✓ Consensus ({total})</Badge>;
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        color,
        border: `1px solid ${color}55`,
        borderRadius: 999,
        padding: '1px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

// The compact outcome glyph, in the reveal's visual language: three tiny
// card shapes — [mulligan call][pick][pick]. Green = you matched them;
// a cyan/yellow split = you diverged (cyan your side, yellow theirs).
function OutcomeGlyph({ item }: { item: PoolItem }) {
  if (item.myDecision === undefined || item.recordedDecision === undefined) return null;
  const chip = (matched: boolean, key: string) => (
    <span
      key={key}
      style={{
        width: 10,
        height: 14,
        borderRadius: 2,
        display: 'inline-block',
        background: matched
          ? '#00E25B'
          : 'linear-gradient(135deg, #66E5FF 50%, #FFD60A 50%)',
      }}
    />
  );
  const decisionMatched = item.myDecision === item.recordedDecision;
  // null = picks not comparable (you kept, they mulliganed — different
  // hands): both pick chips render as divergence.
  const comparable = item.myPickMatches !== null && item.myPickMatches !== undefined;
  const picks = comparable ? item.myPickMatches! : 0;
  const title = `${decisionMatched ? 'Call matched' : `You said ${item.myDecision}, they ${item.recordedDecision === 'keep' ? 'kept' : 'mulliganed'}`} · ${comparable ? `${picks}/2 resources matched` : 'picks from different hands'}`;
  return (
    <span title={title} style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {chip(decisionMatched, 'd')}
      <span style={{ width: 3 }} />
      {chip(picks >= 1, 'p1')}
      {chip(picks >= 2, 'p2')}
    </span>
  );
}

// One-line preview of a graded opening: matchup · outcome glyph · badges.
function AnsweredRow({ item, onClick }: { item: PoolItem; onClick: () => void }) {
  const own = (item.ownLeader?.name as string) || 'Unknown';
  const opp = (item.oppLeader?.name as string) || 'Unknown';
  return (
    <button
      type="button"
      data-testid="opening-row"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: tokens.surface.panel,
        border: `1px solid ${tokens.surface.panelBorder}`,
        borderRadius: tokens.radius.sm,
        cursor: 'pointer',
        textAlign: 'left',
        color: '#e6e6e6',
        fontFamily: 'inherit',
        width: '100%',
        fontSize: 12.5,
      }}
    >
      <OutcomeGlyph item={item} />
      <span style={{ flex: 1, fontWeight: 600, color: '#c8cdd8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {own} <span style={{ color: '#6c7588', fontWeight: 400 }}>vs</span> {opp}
        {item.recorder?.name && <span style={{ color: '#6c7588', fontWeight: 400 }}> · {item.recorder.name}</span>}
      </span>
      <span style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
        {item.commentCount > 0 && <Badge color="#5db4ff">💬 {item.commentCount}</Badge>}
        <ConsensusBadge item={item} />
      </span>
    </button>
  );
}

function OpeningRow({ item, onClick }: { item: PoolItem; onClick: () => void }) {
  const own = (item.ownLeader?.name as string) || 'Unknown';
  const opp = (item.oppLeader?.name as string) || 'Unknown';
  return (
    <button
      type="button"
      data-testid="opening-row"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '7px 10px',
        background: tokens.surface.panel,
        border: `1px solid ${tokens.surface.panelBorder}`,
        borderRadius: tokens.radius.sm,
        cursor: 'pointer',
        textAlign: 'left',
        color: '#e6e6e6',
        fontFamily: 'inherit',
        width: '100%',
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#c8cdd8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {own} <span style={{ color: '#6c7588', fontWeight: 400 }}>vs</span> {opp}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6c7588', flexWrap: 'wrap', width: '100%' }}>
        {item.recorder?.name ? `${item.recorder.name}${item.mine ? ' (you)' : ''}` : 'Teammate opening'}
        {/* SWU terms: whose Initiative it was, in the board's holder colors. */}
        {item.wentFirst !== null && (
          <span style={{ color: item.wentFirst ? '#00BAFF' : '#FF3231' }}>
            · {item.wentFirst ? 'initiative' : 'opp initiative'}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
          {item.commentCount > 0 && <Badge color="#5db4ff">💬 {item.commentCount}</Badge>}
          <ConsensusBadge item={item} />
        </span>
      </span>
    </button>
  );
}

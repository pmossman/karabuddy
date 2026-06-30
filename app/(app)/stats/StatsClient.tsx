'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cardImageUrl } from '@/lib/cardImage';
import { filterMinGames, sortStatRows, type SortKey, type SortDir } from '@/lib/statsView';
import { useSortable, SortHeader } from '@/app/_components/SortHeader';
import { Select } from '@/app/_components/Select';
import { Segmented } from '@/app/_components/Segmented';
import { FilterChip, Field } from '@/app/_components/FilterToolbar';
import { ReplayMatchup } from '@/app/_components/ReplayMatchup';

// B101/Phase2 (reframed): the Stats/Meta client, centered on the team/personal
// contexts teams actually want — "our leader matchups" and "card stats for the
// decks we play". Card views always show card art. Scoped to the signed-in
// user + their teams only — no global/community aggregate. /api/stats does the
// work; cardId→name via /api/cards.

type Scope = 'personal' | 'team' | 'global';
type View = 'leaders' | 'matchups' | 'cards' | 'resourcing';
type CardEvent = 'played' | 'drawn' | 'resourced' | 'discarded';
const FORMATS = [['', 'All formats'], ['premier', 'Premier'], ['eternal', 'Eternal'], ['open', 'Open'], ['limited', 'Limited']] as const;
const EVENTS: [CardEvent, string][] = [['played', 'when played'], ['drawn', 'when drawn'], ['resourced', 'when resourced'], ['discarded', 'when discarded']];
const RECORDER_SIDE: Record<CardEvent, boolean> = { drawn: true, resourced: true, played: false, discarded: false };

const pct = (wins: number, decisive: number) => (decisive > 0 ? Math.round((wins / decisive) * 100) : null);
const fmtPct = (p: number | null) => (p == null ? '—' : `${p}%`);
const parseId = (id: string) => { const i = id.indexOf('_'); return { set: id.slice(0, i), number: Number(id.slice(i + 1)) }; };

// A deck row carries baseId (ability base) XOR baseAspect (vanilla). Build a
// stable key + a short base label from that pair, sharing the matrix axes.
const baseKeyOf = (baseId: string | null, baseAspect: string | null) =>
  baseId ? `base:${baseId}` : baseAspect ? `asp:${baseAspect}` : 'asp:?';
const deckKeyOf = (leader: string, baseId: string | null, baseAspect: string | null) => `${leader}#${baseKeyOf(baseId, baseAspect)}`;

// Two callers, two distinct surfaces (they can diverge): the personal "My Stats"
// page (/stats) and the team "Stats" tab (/teams/<slug>?tab=stats). Scope is
// fixed by the caller, never URL-derived — so client nav can't leave it stale.
// `embedded` drops the standalone page chrome when rendered inside the team tab.
export function StatsClient({
  scope,
  teamSlug = '',
  teamName,
  signedIn,
  embedded = false,
}: {
  scope: Scope;
  teamSlug?: string;
  teamName?: string;
  signedIn: boolean;
  embedded?: boolean;
}) {
  const [view, setView] = useState<View>('leaders');
  const [format, setFormat] = useState<string>('');
  const [event, setEvent] = useState<CardEvent>('played');
  const [leaderCtx, setLeaderCtx] = useState<string>(''); // deck context for the Cards view
  const [baseSel, setBaseSel] = useState<string>(''); // base-identity key: ''=all | base:<id> | asp:<aspect>
  const [cardSort, setCardSort] = useState<'games' | 'winrate'>('games'); // grid sort
  const [cardSearch, setCardSearch] = useState<string>('');
  const [matchupMode, setMatchupMode] = useState<'pct' | 'wl'>('pct'); // heatmap cell: win% vs W–L count
  const [matchupLens, setMatchupLens] = useState<'leaders' | 'bases'>('leaders'); // leader-vs-leader or deck-vs-deck
  const [matchupSort, setMatchupSort] = useState<'games' | 'winrate' | 'name'>('games'); // matrix axis order
  const [data, setData] = useState<any[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [subs, setSubs] = useState<Record<string, string>>({}); // leader/card subtitles — disambiguate same-named leaders (e.g. the two Thrawns)
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile-first: secondary controls collapse behind a Filters toggle
  const [leaderOptions, setLeaderOptions] = useState<string[]>([]); // leader cardIds in scope (for the deck picker)
  const [deckBases, setDeckBases] = useState<{ baseId: string | null; baseAspect: string | null; games: number }[]>([]); // bases played with the picked leader
  const [loading, setLoading] = useState(false);
  // Team stats default to internal (teammate-vs-teammate); a member's games vs
  // outsiders are a separate view. Personal scope ignores this.
  const [teamGames, setTeamGames] = useState<'internal' | 'external' | 'all'>('internal');
  // Shared min-occurrences threshold + the Leaders-list sort & grouping controls.
  const [minGames, setMinGames] = useState(1);
  // Leaders-list sort STATE + header toggle only. The actual row ordering stays
  // with lib/statsView.sortStatRows (below) so its direction-independent Win-%
  // null-sinking + sample-size tiebreaks remain byte-identical — this hook never
  // sorts the rows itself, hence empty items + no-op comparators. The toggle rule
  // (re-click flips; a fresh column lands desc except the text 'name' column)
  // matches the old onLeaderSort exactly via descKeys.
  const { sortKey: leaderSort, sortDir: leaderDir, onSort: onLeaderSort } = useSortable<never, SortKey>(
    [],
    { initialKey: 'games', initialDir: 'desc', descKeys: ['games', 'winrate'], comparators: { games: () => 0, winrate: () => 0, name: () => 0 } },
  );
  const [leaderGroup, setLeaderGroup] = useState<'leader' | 'deck'>('leader'); // by leader, or leader + base

  const scopeQs = useMemo(() => {
    const p = new URLSearchParams({ scope });
    if (format) p.set('format', format);
    if (scope === 'team' && teamSlug) p.set('team', teamSlug);
    if (scope === 'team') p.set('games', teamGames);
    return p;
  }, [scope, format, teamSlug, teamGames]);

  // Drill-in focus is URL-addressable (shareable, back-button friendly): `leader`
  // = the focused leader cardId, `lbase` = an optional deck key (base:<id> | asp:<aspect>),
  // `vs` = an opponent leader (→ matchup detail). Both pages keep their other params
  // (team `tab`, etc.) when we push/clear focus.
  const router = useRouter();
  const pathname = usePathname();
  const urlParams = useSearchParams();
  const focusLeader = urlParams.get('leader') || '';
  const focusBaseKey = urlParams.get('lbase') || '';
  const focusVs = urlParams.get('vs') || '';
  const pushFocus = (params: Record<string, string | null>) => {
    const p = new URLSearchParams(urlParams.toString());
    for (const [k, v] of Object.entries(params)) { if (v) p.set(k, v); else p.delete(k); }
    router.push(`${pathname}${p.toString() ? `?${p}` : ''}`, { scroll: false });
  };
  const setFocus = (leader: string | null, baseKey?: string) => pushFocus({ leader, lbase: baseKey ?? null, vs: null });
  const setMatchupFocus = (leader: string, vs: string) => pushFocus({ leader, vs, lbase: null });
  const clearFocus = () => pushFocus({ leader: null, lbase: null, vs: null });

  const resolveNames = async (ids: Set<string>) => {
    if (!ids.size) return;
    try {
      const c = await fetch(`/api/cards?ids=${[...ids].join(',')}`);
      const cb = await c.json();
      if (cb.ok) {
        setNames((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(cb.cards).map(([id, v]: any) => [id, v.name || id])) }));
        setSubs((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(cb.cards).filter(([, v]: any) => v.subtitle).map(([id, v]: any) => [id, v.subtitle as string])) }));
      }
    } catch {}
  };

  // Leader list for the deck picker (whenever scope/format changes).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stats?type=leaders&${scopeQs}`);
        const body = await res.json();
        if (cancelled || !body.ok) return;
        const ids = (body.data || []).map((r: any) => r.leader).filter(Boolean);
        setLeaderOptions(ids);
        resolveNames(new Set(ids));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [scopeQs]);

  // Cards view: the bases actually played with the picked leader, so the base
  // picker only offers real decks (ability bases as themselves + vanilla aspects).
  useEffect(() => {
    if (view !== 'cards' || !leaderCtx) { setDeckBases([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stats?type=decks&leader=${encodeURIComponent(leaderCtx)}&${scopeQs}`);
        const body = await res.json();
        if (cancelled || !body.ok) return;
        const bases = (body.data || []).map((d: any) => ({ baseId: d.baseId, baseAspect: d.baseAspect, games: d.games }));
        setDeckBases(bases);
        resolveNames(new Set(bases.map((b: any) => b.baseId).filter(Boolean)));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [view, leaderCtx, scopeQs]);

  // Reset the base filter when the leader changes (its bases differ).
  useEffect(() => { setBaseSel(''); }, [leaderCtx]);

  // Main data for the active view.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null); // drop stale rows so a view switch never renders the old shape (e.g. leaders rows under the Cards table)
    const p = new URLSearchParams(scopeQs);
    // Leaders "by leader + base" reuses the decks producer (leader+base win rates).
    p.set('type', view === 'leaders' && leaderGroup === 'deck' ? 'decks' : view);
    if (view === 'cards') {
      p.set('event', event);
      if (leaderCtx) p.set('leader', leaderCtx);
      if (baseSel.startsWith('base:')) p.set('base', baseSel.slice(5));
      else if (baseSel.startsWith('asp:')) p.set('baseAspect', baseSel.slice(4));
    }
    if (view === 'matchups' && matchupLens === 'bases') p.set('byBase', '1');
    (async () => {
      try {
        const res = await fetch(`/api/stats?${p}`);
        const body = await res.json();
        if (cancelled) return;
        setData(body.ok ? body.data || [] : []);
        const ids = new Set<string>();
        for (const r of body.data || []) for (const k of ['leader', 'opponentLeader', 'cardId', 'baseId', 'opponentBaseId']) if (r[k]) ids.add(r[k]);
        resolveNames(ids);
      } catch { if (!cancelled) setData([]); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [scopeQs, view, event, leaderCtx, baseSel, matchupLens, leaderGroup]);

  const nm = (id: string) => names[id] || id;

  // Cards view: client-side sort + name search over the fetched rows. Win% is
  // null below a small decisive-game floor, so "Best win %" sinks those rows
  // rather than letting a 1-of-1 card top the grid.
  const cardRows = useMemo(() => {
    if (view !== 'cards' || !data) return [];
    const q = cardSearch.trim().toLowerCase();
    const rows = filterMinGames(
      data
        .map((r) => ({ ...r, name: nm(r.cardId), win: pct(r.wins, r.decisive) }))
        .filter((r) => !q || r.name.toLowerCase().includes(q)),
      minGames, (r) => r.observations,
    );
    rows.sort((a, b) =>
      cardSort === 'winrate'
        ? (b.win ?? -1) - (a.win ?? -1) || b.observations - a.observations
        : b.observations - a.observations || (b.win ?? -1) - (a.win ?? -1),
    );
    return rows;
  }, [view, data, cardSearch, cardSort, minGames, names]);

  // Leaders view: client-side min-games filter + sort over the fetched rows
  // (leader rows, or leader+base "deck" rows when grouping by base).
  const leaderRows = useMemo(() => {
    if (view !== 'leaders' || !data) return [];
    return sortStatRows(filterMinGames(data, minGames, (r) => r.games), leaderSort, leaderDir, {
      count: (r) => r.games,
      winPct: (r) => pct(r.wins, r.decisive),
      name: (r) => (leaderGroup === 'deck' ? `${nm(r.leader)} ${r.baseId ? nm(r.baseId) : r.baseAspect ?? ''}` : nm(r.leader)),
    });
  }, [view, data, minGames, leaderSort, leaderDir, leaderGroup, names]);

  // Matchups view: pivot the flat directed rows into a square matrix. In the
  // "Leaders" lens an axis is a leader; in "Leaders & Bases" it's a DECK
  // (leader + base-identity). Both axes share one ordered set (by games), so
  // popular decks cluster top-left. Per-axis totals sum that axis's own rows.
  const matrix = useMemo(() => {
    if (view !== 'matchups' || !data) return null;
    const byBase = matchupLens === 'bases';
    const axisOf = (leader: string, baseId: string | null, baseAspect: string | null) =>
      byBase ? { key: deckKeyOf(leader, baseId, baseAspect), leader, baseId, baseAspect } : { key: leader, leader, baseId: null, baseAspect: null };
    const cell = new Map<string, any>();
    const totals = new Map<string, { games: number; wins: number; decisive: number }>();
    const axes = new Map<string, { key: string; leader: string; baseId: string | null; baseAspect: string | null }>();
    for (const r of data) {
      const self = axisOf(r.leader, r.baseId ?? null, r.baseAspect ?? null);
      const opp = axisOf(r.opponentLeader, r.opponentBaseId ?? null, r.opponentBaseAspect ?? null);
      axes.set(self.key, self);
      axes.set(opp.key, opp);
      cell.set(`${self.key}|${opp.key}`, r);
      const t = totals.get(self.key) || { games: 0, wins: 0, decisive: 0 };
      t.games += r.games; t.wins += r.wins; t.decisive += r.decisive;
      totals.set(self.key, t);
      if (!totals.has(opp.key)) totals.set(opp.key, { games: 0, wins: 0, decisive: 0 });
    }
    // Drop an axis unless it has at least ONE matchup (a single cell, either
    // direction) meeting min-games. Gating by an axis's TOTAL games kept leaders
    // whose games were spread thin across many opponents — their row/column was
    // then all-blank (every individual matchup < min), the sparse "junk" grid.
    // Here a leader survives only if it has a real, sufficiently-sampled matchup.
    const qualifies = new Set<string>();
    for (const [k, r] of cell) {
      if (r.games >= minGames) { const [s, o] = k.split('|'); qualifies.add(s); qualifies.add(o); }
    }
    const axisWin = (k: string) => { const t = totals.get(k)!; return t.decisive > 0 ? t.wins / t.decisive : -1; };
    const ordered = [...axes.values()]
      .filter((a) => qualifies.has(a.key))
      .sort((a, b) =>
        matchupSort === 'name' ? nm(a.leader).localeCompare(nm(b.leader))
        : matchupSort === 'winrate' ? axisWin(b.key) - axisWin(a.key) || totals.get(b.key)!.games - totals.get(a.key)!.games
        : totals.get(b.key)!.games - totals.get(a.key)!.games);
    return { axes: ordered, cell, totals };
  }, [view, data, matchupLens, minGames, matchupSort, names]);

  // Active non-default filters → removable chips, shown next to the collapsed Filters
  // toggle so the current state stays visible on mobile without opening the panel.
  const activeChips = useMemo(() => {
    const c: { key: string; label: string; onClear: () => void }[] = [];
    if (scope === 'team' && teamGames !== 'internal') c.push({ key: 'g', label: teamGames === 'external' ? 'vs Outsiders' : 'All games', onClear: () => setTeamGames('internal') });
    if (format) c.push({ key: 'f', label: FORMATS.find((f) => f[0] === format)?.[1] || format, onClear: () => setFormat('') });
    if (view === 'leaders' && leaderGroup === 'deck') c.push({ key: 'grp', label: 'By leader + base', onClear: () => setLeaderGroup('leader') });
    if (view === 'cards' && leaderCtx) c.push({ key: 'deck', label: nm(leaderCtx), onClear: () => setLeaderCtx('') });
    if (view === 'cards' && event !== 'played') c.push({ key: 'ev', label: EVENTS.find((e) => e[0] === event)?.[1] || event, onClear: () => setEvent('played') });
    if (view === 'cards' && cardSearch.trim()) c.push({ key: 'q', label: `“${cardSearch.trim()}”`, onClear: () => setCardSearch('') });
    if (minGames > 1) c.push({ key: 'min', label: `Min ${minGames} games`, onClear: () => setMinGames(1) });
    return c;
  }, [scope, teamGames, format, view, leaderGroup, leaderCtx, event, cardSearch, minGames, names]);

  return (
    <div style={embedded
      ? { color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }
      : { maxWidth: 940, margin: '0 auto', padding: '24px 16px 64px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      {!embedded && (
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 4px', color: '#fff' }}>
          {scope === 'global' ? 'Meta' : scope === 'team' ? 'Team' : 'My'} <span style={{ color: '#4dd2ff' }}>Stats</span>
        </h1>
      )}
      <p style={{ color: '#6c7588', fontSize: 13, margin: embedded ? '0 0 14px' : '0 0 18px' }}>
        {scope === 'global'
          ? 'Leader matchups and card stats across every recorded game in the meta. Win rates over games with a result; every figure shows its sample size.'
          : scope === 'team'
          ? `Leader matchups and card stats across ${teamName ? `${teamName}’s` : 'your team’s'} recorded games. Win rates over games with a result; every figure shows its sample size.`
          : 'Your leader matchups and card stats for the decks you play. Win rates over games with a recorded result; every figure shows its sample size.'}
      </p>

      {!signedIn ? (
        <div style={dim}>Sign in to see your personal stats.</div>
      ) : focusLeader && focusVs ? (
        <MatchupDetail
          leader={focusLeader}
          vs={focusVs}
          baseQs={scopeQs.toString()}
          scope={scope}
          teamName={teamName}
          nm={nm}
          subs={subs}
          resolveNames={resolveNames}
          onBack={() => setFocus(focusLeader)}
          onClose={clearFocus}
          onFlip={() => setMatchupFocus(focusVs, focusLeader)}
          onOpenLeader={(l) => setFocus(l)}
        />
      ) : focusLeader ? (
        <LeaderDetail
          leader={focusLeader}
          baseKey={focusBaseKey}
          baseQs={scopeQs.toString()}
          scope={scope}
          teamName={teamName}
          nm={nm}
          subs={subs}
          resolveNames={resolveNames}
          onOpenMatchup={(opp) => setMatchupFocus(focusLeader, opp)}
          onBack={clearFocus}
        />
      ) : (<>
      {/* Primary nav — the view switcher is always visible (scrolls horizontally on narrow screens). */}
      <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
        <Segmented options={[['leaders', 'Leaders'], ['matchups', 'Matchups'], ['cards', 'Cards'], ['resourcing', 'Resourcing']]} value={view} onChange={(v) => setView(v as View)} />
      </div>

      {/* Mobile-first: every secondary control collapses behind ONE Filters toggle; active
          non-default choices stay visible as removable chips. Sort lives on the table headers. */}
      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <FiltersToggle open={filtersOpen} count={activeChips.length} onClick={() => setFiltersOpen((v) => !v)} />
        {activeChips.map((c) => (
          <FilterChip key={c.key} label={c.label} onClear={c.onClear} title="Clear"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(77,157,255,0.12)', color: '#9fc4ff', border: '1px solid rgba(77,157,255,0.3)', borderRadius: 14, padding: '4px 10px' }} />
        ))}
      </div>

      {filtersOpen && (
        <div style={filtersPanel}>
          {scope === 'team' && (
            <Field orientation="row" label="Games"><Segmented options={[['internal', 'Internal'], ['external', 'vs Outsiders'], ['all', 'All']]} value={teamGames} onChange={(v) => setTeamGames(v as 'internal' | 'external' | 'all')} /></Field>
          )}
          <Field orientation="row" label="Format"><Select value={format} onChange={setFormat} options={FORMATS} /></Field>

          {view === 'leaders' && (
            <Field orientation="row" label="Group"><Segmented options={[['leader', 'By leader'], ['deck', 'By leader + base']]} value={leaderGroup} onChange={(v) => setLeaderGroup(v as 'leader' | 'deck')} /></Field>
          )}

          {view === 'cards' && (<>
            <Field orientation="row" label="Deck"><Select value={leaderCtx} onChange={setLeaderCtx} options={[['', 'All decks'], ...leaderOptions.map((id) => [id, nm(id)] as [string, string])]} /></Field>
            {leaderCtx && (
              <Field orientation="row" label="Base"><Select value={baseSel} onChange={setBaseSel} options={[
                ['', 'Any base'],
                ...deckBases.map((b) => [
                  baseKeyOf(b.baseId, b.baseAspect),
                  b.baseId ? `${nm(b.baseId)} (${b.games})` : `${b.baseAspect ? b.baseAspect[0].toUpperCase() + b.baseAspect.slice(1) : 'Unknown'} — no ability (${b.games})`,
                ] as [string, string]),
              ]} /></Field>
            )}
            <Field orientation="row" label="Win rate when"><Segmented options={EVENTS} value={event} onChange={(v) => setEvent(v as CardEvent)} /></Field>
            {RECORDER_SIDE[event] && (
              <span title="Drawn and resourced cards are only observable for the recorder of each game." style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#e0c64a' }}>{scope === 'global' ? 'recorder side only' : 'your side only'}</span>
            )}
            <Field orientation="row" label="Sort"><Segmented options={[['games', 'Most played'], ['winrate', 'Best win %']]} value={cardSort} onChange={(v) => setCardSort(v as any)} /></Field>
            <Field orientation="row" label="Search"><input value={cardSearch} onChange={(e) => setCardSearch(e.target.value)} placeholder="Search cards…" type="search" style={{ background: '#11141a', color: '#e6e6e6', border: '1px solid #2e333c', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontFamily: 'inherit', minWidth: 140 }} /></Field>
          </>)}

          {view === 'matchups' && (<>
            <Field orientation="row" label="Axis"><Segmented options={[['leaders', 'Leaders'], ['bases', 'Leaders & Bases']]} value={matchupLens} onChange={(v) => setMatchupLens(v as any)} /></Field>
            <Field orientation="row" label="Cells"><Segmented options={[['pct', 'Win %'], ['wl', 'W–L']]} value={matchupMode} onChange={(v) => setMatchupMode(v as any)} /></Field>
            <Field orientation="row" label="Sort"><Segmented options={[['games', 'Most games'], ['winrate', 'Best win %'], ['name', 'Name']]} value={matchupSort} onChange={(v) => setMatchupSort(v as any)} /></Field>
          </>)}

          <Field orientation="row" label="Min games"><MinGamesInput value={minGames} onChange={setMinGames} /></Field>
        </div>
      )}

      {view === 'matchups' && (
        <p style={{ fontSize: 11, color: '#6c7588', margin: '10px 0 0' }}>
          Win rate as the row {matchupLens === 'bases' ? 'deck' : 'leader'} vs. the column ({subjectPoss(scope, teamName)} side only — not every game involving it). Tap a cell for matchup detail. Color fades when the sample is small.
          {matchupLens === 'bases' && ' Ability bases are their own decks; vanilla bases collapse to aspect.'}
        </p>
      )}

      {view === 'resourcing' && (
        <p style={{ color: '#6c7588', fontSize: 12, margin: '14px 0 0' }}>
          {scope === 'global'
            ? 'How tightly players spend resources, across the meta — recorder side only, since an opponent’s resource use isn’t observable. '
            : scope === 'team'
            ? 'How tightly your team spends resources, from your team’s games. '
            : 'How tightly you spend resources, from your own games. '}
          Efficiency = resources spent ÷ resources available, excluding rounds the player claimed initiative and the game-deciding round. Higher is better.
        </p>
      )}

      <div style={{ marginTop: 16 }}>
        {loading && !data ? (
          <div style={dim}>Loading…</div>
        ) : !data || data.length === 0 ? (
          <div style={dim}>{view === 'resourcing' ? 'No rated games yet — upload some games to see your resourcing trend.' : 'No data yet for this view — upload some games.'}</div>
        ) : view === 'resourcing' ? (
          <ResourcingPanel games={data} nm={nm} minGames={minGames} />
        ) : view === 'cards' ? (
          <CardGrid cards={cardRows} event={event} nm={nm} />
        ) : view === 'matchups' ? (
          <MatchupMatrix matrix={matrix!} mode={matchupMode} byBase={matchupLens === 'bases'} minGames={minGames} nm={nm} onFocus={setFocus} onMatchupFocus={setMatchupFocus} />
        ) : (
          <Table
            cols={[{ label: leaderGroup === 'deck' ? 'Deck' : 'Leader', sortKey: 'name' }, { label: 'Win %', sortKey: 'winrate' }, { label: 'Games', sortKey: 'games' }]}
            sort={leaderSort} dir={leaderDir} onSort={onLeaderSort}
            rowKeys={leaderRows.map((r) => deckKeyOf(r.leader, r.baseId ?? null, r.baseAspect ?? null))}
            onRowClick={leaderRows.map((r) => () => setFocus(r.leader, leaderGroup === 'deck' ? baseKeyOf(r.baseId ?? null, r.baseAspect ?? null) : undefined))}
            rows={leaderRows.map((r) => [
              leaderGroup === 'deck' ? deckCell(r, nm, subs) : leaderCell(r.leader, nm(r.leader), subs[r.leader]),
              <Win key="w">{fmtPct(pct(r.wins, r.decisive))}</Win>,
              <Muted key="g">{r.games}</Muted>,
            ])} />
        )}
      </div>
      </>)}
    </div>
  );
}

// Drill-in detail for one leader (or leader+base): the focused leader's record
// vs each opponent leader + the recorder's recent games on it. Fetches its own
// data (so a shared/deep-linked URL works cold), scoped by the parent's
// scope/format/team via `baseQs`. Recent games link to the replay viewer.
function LeaderDetail({ leader, baseKey, baseQs, scope, teamName, nm, subs, resolveNames, onBack, onOpenMatchup }: {
  leader: string; baseKey: string; baseQs: string; scope: Scope; teamName?: string;
  nm: (id: string) => string; subs: Record<string, string>;
  resolveNames: (ids: Set<string>) => Promise<void>; onBack: () => void; onOpenMatchup: (opponentLeader: string) => void;
}) {
  const [matchups, setMatchups] = useState<any[] | null>(null);
  const [replays, setReplays] = useState<any[] | null>(null);
  // Standard stats-table controls (sort + min-games), like the Leaders view —
  // header sort via the SHARED useSortable hook (the actual ordering still runs
  // through sortStatRows below, so its null-sinking + tiebreaks stay identical;
  // the hook only owns the key/dir state + the flip-on-re-click toggle rule).
  const { sortKey: mSort, sortDir: mDir, onSort: onMSort } = useSortable<never, SortKey>(
    [],
    { initialKey: 'games', initialDir: 'desc', descKeys: ['games', 'winrate'], comparators: { games: () => 0, winrate: () => 0, name: () => 0 } },
  );
  const [mMin, setMMin] = useState(1);

  const baseId = baseKey.startsWith('base:') ? baseKey.slice(5) : null;
  const baseAspect = baseKey.startsWith('asp:') ? baseKey.slice(4) : null;

  useEffect(() => {
    let cancelled = false;
    setMatchups(null); setReplays(null);
    const qs = new URLSearchParams(baseQs);
    qs.set('leader', leader);
    if (baseId) qs.set('base', baseId);
    else if (baseAspect) qs.set('baseAspect', baseAspect);
    (async () => {
      try {
        const [m, r] = await Promise.all([
          fetch(`/api/stats?type=matchups&${qs}`).then((x) => x.json()),
          fetch(`/api/stats?type=replays&${qs}`).then((x) => x.json()),
        ]);
        if (cancelled) return;
        const mRows = m.ok ? m.data || [] : [];
        setMatchups(mRows);
        setReplays(r.ok ? r.data || [] : []);
        const ids = new Set<string>([leader]);
        if (baseId) ids.add(baseId);
        for (const row of mRows) if (row.opponentLeader) ids.add(row.opponentLeader);
        resolveNames(ids);
      } catch { if (!cancelled) { setMatchups([]); setReplays([]); } }
    })();
    return () => { cancelled = true; };
  }, [leader, baseKey, baseQs]);

  // Overall record = the sum over the leader's opponent rows.
  const overall = useMemo(() => {
    const t = { games: 0, wins: 0, decisive: 0 };
    for (const r of matchups || []) { t.games += r.games; t.wins += r.wins; t.decisive += r.decisive; }
    return t;
  }, [matchups]);
  const sortedMatchups = useMemo(() =>
    sortStatRows(filterMinGames(matchups || [], mMin, (r) => r.games), mSort, mDir, {
      count: (r) => r.games,
      winPct: (r) => pct(r.wins, r.decisive),
      name: (r) => nm(r.opponentLeader),
    }), [matchups, mSort, mDir, mMin, nm]);

  return (
    <div style={{ marginTop: 4 }}>
      <button type="button" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 0, color: '#a7d2ff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 0', marginBottom: 12 }}>
        ‹ Back to stats
      </button>

      {/* Header: leader art + name (+ base) + overall record. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <CardThumb cardId={leader} isLeader h={56} />
        {(baseId || baseAspect) && <BaseChip baseId={baseId} baseAspect={baseAspect} />}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>
            {nm(leader)}{baseId ? ` · ${nm(baseId)}` : baseAspect ? ` · ${baseAspect[0].toUpperCase()}${baseAspect.slice(1)}` : ''}
          </span>
          {subs[leader] && <span style={{ fontSize: 11, color: '#6c7588' }}>{subs[leader]}</span>}
          {/* "your games" embeds the perspective subtly — these are the recorder's
              games AS this leader, not every game involving it (no separate note). */}
          <span style={{ fontSize: 13, color: '#a0a8b8', marginTop: 2 }}>
            {overall.decisive > 0
              ? <><Win>{fmtPct(pct(overall.wins, overall.decisive))}</Win> · {overall.wins}–{overall.decisive - overall.wins} over {overall.games} of {subjectPoss(scope, teamName)} game{overall.games === 1 ? '' : 's'}</>
              : `${overall.games} of ${subjectPoss(scope, teamName)} game${overall.games === 1 ? '' : 's'} (no decided results)`}
          </span>
        </div>
      </div>

      {/* Matchups: vs each opponent leader. Sortable headers + min-games, like the
          Leaders view; each row drills into that specific matchup. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 0 8px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6c7588' }}>Matchups</div>
        <Field orientation="row" label="Min games"><MinGamesInput value={mMin} onChange={setMMin} /></Field>
      </div>
      {matchups == null ? <div style={dim}>Loading…</div>
        : sortedMatchups.length === 0 ? <div style={{ ...dim, padding: '16px 0' }}>No recorded matchups yet.</div>
        : (
          <div style={{ marginBottom: 24 }}>
            <Table
              cols={[{ label: 'Opponent', sortKey: 'name' }, { label: 'Record' }, { label: 'Win %', sortKey: 'winrate' }, { label: 'Games', sortKey: 'games' }]}
              sort={mSort} dir={mDir} onSort={onMSort}
              rowKeys={sortedMatchups.map((r) => r.opponentLeader)}
              onRowClick={sortedMatchups.map((r) => () => onOpenMatchup(r.opponentLeader))}
              rows={sortedMatchups.map((r) => [
                leaderCell(r.opponentLeader, nm(r.opponentLeader), subs[r.opponentLeader]),
                <Muted key="rec">{r.wins}–{r.decisive - r.wins}</Muted>,
                <Win key="w">{fmtPct(pct(r.wins, r.decisive))}</Win>,
                <Muted key="g">{r.games}</Muted>,
              ])} />
          </div>
        )}

      {/* Recent games on this leader → the replay viewer. */}
      {scope !== 'global' && <RecentGames replays={replays} />}
    </div>
  );
}

// Matchup drill-in (leader A vs opponent leader B): the analytical weeds — the
// head-to-head record, CARD-LEVEL stats within the matchup (win rate when a card
// was played/drawn/… in A-vs-B games), and the matchup's recent games. Fetches its
// own data (deep-linkable). Card grid carries the standard event/sort/min-games.
function MatchupDetail({ leader, vs, baseQs, scope, teamName, nm, subs, resolveNames, onBack, onClose, onFlip, onOpenLeader }: {
  leader: string; vs: string; baseQs: string; scope: Scope; teamName?: string;
  nm: (id: string) => string; subs: Record<string, string>;
  resolveNames: (ids: Set<string>) => Promise<void>; onBack: () => void; onClose: () => void;
  onFlip: () => void; onOpenLeader: (leader: string) => void;
}) {
  const [record, setRecord] = useState<{ games: number; wins: number; decisive: number } | null>(null);
  const [cards, setCards] = useState<any[] | null>(null);
  const [replays, setReplays] = useState<any[] | null>(null);
  const [event, setEvent] = useState<CardEvent>('played');
  const [cardSort, setCardSort] = useState<'games' | 'winrate'>('games');
  const [cardMin, setCardMin] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false); // controls collapse behind a Filters toggle (mobile real-estate)

  useEffect(() => {
    let cancelled = false;
    setRecord(null); setCards(null); setReplays(null);
    const qs = new URLSearchParams(baseQs);
    qs.set('leader', leader); qs.set('vs', vs);
    (async () => {
      try {
        const [m, c, r] = await Promise.all([
          fetch(`/api/stats?type=matchups&${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(baseQs)), leader })}`).then((x) => x.json()),
          fetch(`/api/stats?type=cards&event=${event}&${qs}`).then((x) => x.json()),
          fetch(`/api/stats?type=replays&${qs}`).then((x) => x.json()),
        ]);
        if (cancelled) return;
        const rec = (m.ok ? m.data || [] : []).find((row: any) => row.opponentLeader === vs);
        setRecord(rec ? { games: rec.games, wins: rec.wins, decisive: rec.decisive } : { games: 0, wins: 0, decisive: 0 });
        const cRows = c.ok ? c.data || [] : [];
        setCards(cRows);
        setReplays(r.ok ? r.data || [] : []);
        resolveNames(new Set<string>([leader, vs, ...cRows.map((x: any) => x.cardId)]));
      } catch { if (!cancelled) { setRecord({ games: 0, wins: 0, decisive: 0 }); setCards([]); setReplays([]); } }
    })();
    return () => { cancelled = true; };
  }, [leader, vs, baseQs, event]);

  const cardRows = useMemo(() => {
    const rows = filterMinGames((cards || []).map((r) => ({ ...r, name: nm(r.cardId), win: pct(r.wins, r.decisive) })), cardMin, (r) => r.observations);
    rows.sort((a, b) => cardSort === 'winrate' ? (b.win ?? -1) - (a.win ?? -1) || b.observations - a.observations : b.observations - a.observations || (b.win ?? -1) - (a.win ?? -1));
    return rows;
  }, [cards, cardSort, cardMin, nm]);

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', gap: 14, marginBottom: 12, fontSize: 12, fontWeight: 700 }}>
        <button type="button" onClick={onBack} style={{ background: 'transparent', border: 0, color: '#a7d2ff', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 0' }}>‹ {nm(leader)}</button>
        <button type="button" onClick={onClose} style={{ background: 'transparent', border: 0, color: '#6c7588', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 0' }}>All stats</button>
      </div>

      {/* Header: A vs B + head-to-head record. Each leader's art links to that
          leader's stats; the ⇄ flips to the opponent's point of view. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <ThumbButton cardId={leader} title={`View ${nm(leader)} stats`} onClick={() => onOpenLeader(leader)} />
        <button type="button" onClick={onFlip} title="Flip — view this matchup from the other side"
          style={{ background: 'transparent', border: 0, color: '#6c7588', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 800, padding: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span aria-hidden style={{ fontSize: 16 }}>⇄</span> VS
        </button>
        <ThumbButton cardId={vs} title={`View ${nm(vs)} stats`} onClick={() => onOpenLeader(vs)} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, marginLeft: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{nm(leader)} vs {nm(vs)}</span>
          <span style={{ fontSize: 13, color: '#a0a8b8', marginTop: 2 }}>
            {record == null ? '…' : record.decisive > 0
              ? <><Win>{fmtPct(pct(record.wins, record.decisive))}</Win> · {record.wins}–{record.decisive - record.wins} over {record.games} of {subjectPoss(scope, teamName)} game{record.games === 1 ? '' : 's'}</>
              : `${record.games} of ${subjectPoss(scope, teamName)} game${record.games === 1 ? '' : 's'} (no decided results)`}
          </span>
        </div>
      </div>

      {/* Card-level stats within the matchup — controls tuck behind a Filters
          toggle (like the main stats pages); active non-defaults stay as chips. */}
      {(() => {
        const chips: { key: string; label: string; onClear: () => void }[] = [];
        if (event !== 'played') chips.push({ key: 'ev', label: EVENTS.find((e) => e[0] === event)![1], onClear: () => setEvent('played') });
        if (cardSort !== 'games') chips.push({ key: 'sort', label: 'Best win %', onClear: () => setCardSort('games') });
        if (cardMin > 1) chips.push({ key: 'min', label: `Min ${cardMin} games`, onClear: () => setCardMin(1) });
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 0 4px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6c7588', marginRight: 4 }}>Cards in this matchup</div>
              <FiltersToggle open={filtersOpen} count={chips.length} onClick={() => setFiltersOpen((v) => !v)} />
              {chips.map((c) => (
                <FilterChip key={c.key} label={c.label} onClear={c.onClear} title="Clear"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(77,157,255,0.12)', color: '#9fc4ff', border: '1px solid rgba(77,157,255,0.3)', borderRadius: 14, padding: '4px 10px' }} />
              ))}
              {RECORDER_SIDE[event] && <span title="Drawn/resourced are only observable for the recorder." style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#e0c64a' }}>{scope === 'global' ? 'recorder side' : 'your side'}</span>}
            </div>
            {filtersOpen && (
              <div style={filtersPanel}>
                <Field orientation="row" label="Win rate when"><Segmented options={EVENTS} value={event} onChange={(v) => setEvent(v as CardEvent)} /></Field>
                <Field orientation="row" label="Sort"><Segmented options={[['games', 'Most played'], ['winrate', 'Best win %']]} value={cardSort} onChange={(v) => setCardSort(v as any)} /></Field>
                <Field orientation="row" label="Min games"><MinGamesInput value={cardMin} onChange={setCardMin} /></Field>
              </div>
            )}
          </>
        );
      })()}
      <div style={{ height: 12 }} />
      {cards == null ? <div style={dim}>Loading…</div>
        : cardRows.length === 0 ? <div style={{ ...dim, padding: '16px 0' }}>No card data for this matchup yet.</div>
        : <div style={{ marginBottom: 24 }}><CardGrid cards={cardRows} event={event} nm={nm} /></div>}

      {/* The matchup's recent games → the replay viewer. */}
      {scope !== 'global' && <RecentGames replays={replays} />}
    </div>
  );
}

const fmtShortDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`; };

// Shared "Recent games" list for the drill-in detail views (LeaderDetail +
// MatchupDetail rendered it identically) — date · matchup · W/L, linking to the
// replay. Extracted so the two views don't duplicate the concept.
function RecentGames({ replays }: { replays: any[] | null }) {
  return (
    <>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6c7588', margin: '0 0 8px' }}>Recent games</div>
      {replays == null ? <div style={dim}>Loading…</div>
        : replays.length === 0 ? <div style={{ ...dim, padding: '16px 0' }}>No recent games.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {replays.map((g) => (
              <a key={g.slug} href={`/r/${g.slug}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, textDecoration: 'none', color: '#e6e6e6' }}>
                <span style={{ width: 42, flex: '0 0 auto', color: '#6c7588', fontSize: 11 }}>{fmtShortDate(g.createdAt)}</span>
                <span style={{ flex: 1, minWidth: 0 }}><ReplayMatchup players={g.players} ownerPlayerId={g.ownerPlayerId} winners={g.winners} thumb={26} /></span>
                <span style={{ flex: '0 0 auto', fontWeight: 800, fontSize: 12, color: g.won === true ? '#6bd968' : g.won === false ? '#e06a5a' : '#6c7588' }}>{g.won === true ? 'W' : g.won === false ? 'L' : '—'}</span>
              </a>
            ))}
          </div>
        )}
    </>
  );
}

// Possessive subject for the "whose games are these" cue, folded into the record
// copy: personal stats are strictly YOUR recorded side (isRecorder), team stats
// are the team's games. Keeps the perspective clear without a dedicated info box.
const subjectPoss = (scope: Scope, teamName?: string) => (scope === 'global' ? 'the meta’s' : scope === 'team' ? `${teamName || 'your team'}’s` : 'your');

const dim: React.CSSProperties = { color: '#6c7588', fontStyle: 'italic', padding: '32px 0', textAlign: 'center' };
const filtersPanel: React.CSSProperties = { marginTop: 10, padding: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid #1c2128', borderRadius: 10, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' };

// The single Filters disclosure that holds every secondary control (mobile-first).
function FiltersToggle({ open, count, onClick }: { open: boolean; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: open ? 'rgba(77,157,255,0.15)' : '#11141a', color: '#cdd3df', border: '1px solid #2e333c', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
      Filters{count > 0 ? ` (${count})` : ''} <span style={{ fontSize: 9, color: '#6c7588' }}>{open ? '▲' : '▼'}</span>
    </button>
  );
}

// Minimum-occurrences: a number input flanked by −/+ steppers — type any value or
// nudge it. Hides tiny-sample rows (1-game 100%/0% noise) across leaders/cards/matrix.
const stepBtn: React.CSSProperties = { background: 'transparent', color: '#a0a8b8', border: 0, width: 30, padding: '6px 0', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 };
function MinGamesInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.max(1, Math.floor(n) || 1));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid #2e333c', borderRadius: 6, overflow: 'hidden', background: '#11141a' }}>
      <button type="button" onClick={() => set(value - 1)} aria-label="Fewer minimum games" style={stepBtn}>−</button>
      <input type="number" min={1} value={value} onChange={(e) => set(Number(e.target.value))} aria-label="Minimum games"
        style={{ width: 46, textAlign: 'center', background: 'transparent', color: '#e6e6e6', border: 0, borderLeft: '1px solid #2e333c', borderRight: '1px solid #2e333c', padding: '6px 4px', fontSize: 12, fontFamily: 'inherit' }} />
      <button type="button" onClick={() => set(value + 1)} aria-label="More minimum games" style={stepBtn}>+</button>
    </span>
  );
}

// Leader cell: art + name, with the SUBTITLE beneath — every SWU leader has one, and
// it disambiguates same-named leaders (the two Grand Admiral Thrawns are distinct cards).
const leaderCell = (cardId: string, name: string, subtitle?: string) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
    <CardThumb cardId={cardId} isLeader />
    <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      {subtitle && <span style={{ fontSize: 10, color: '#6c7588', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</span>}
    </span>
  </span>
);

// Leader + base "deck" cell (Leaders list grouped by leader+base), subtitle included.
const deckCell = (r: any, nm: (id: string) => string, subs: Record<string, string>) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
    <CardThumb cardId={r.leader} isLeader />
    <BaseChip baseId={r.baseId ?? null} baseAspect={r.baseAspect ?? null} />
    <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{nm(r.leader)}{r.baseId ? ` · ${nm(r.baseId)}` : r.baseAspect ? ` · ${r.baseAspect[0].toUpperCase() + r.baseAspect.slice(1)}` : ''}</span>
      {subs[r.leader] && <span style={{ fontSize: 10, color: '#6c7588', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subs[r.leader]}</span>}
    </span>
  </span>
);

function CardThumb({ cardId, isLeader, h = 40 }: { cardId: string; isLeader?: boolean; h?: number }) {
  if (!cardId || !cardId.includes('_')) return null;
  const url = cardImageUrl(parseId(cardId), isLeader);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" loading="lazy" style={{ height: h, width: 'auto', borderRadius: 3, background: '#0a0c10', flex: '0 0 auto' }} />;
}
// A leader thumbnail that links somewhere (matchup header → that leader's stats).
// Bare button so the art stays the affordance; subtle ring + lift on hover.
function ThumbButton({ cardId, title, onClick, h = 48 }: { cardId: string; title: string; onClick: () => void; h?: number }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      style={{ background: 'transparent', border: 0, padding: 0, lineHeight: 0, cursor: 'pointer', borderRadius: 3 }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 2px #4d9dff'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}>
      <CardThumb cardId={cardId} isLeader h={h} />
    </button>
  );
}
const Win = ({ children }: { children: React.ReactNode }) => <span style={{ color: '#4dd2ff', fontWeight: 700 }}>{children}</span>;
const Muted = ({ children }: { children: React.ReactNode }) => <span style={{ color: '#a0a8b8' }}>{children}</span>;

// Win% → color: red (poor) → amber (even) → green (strong). Null = unknown.
function winColor(p: number | null): string {
  if (p == null) return '#6c7588';
  if (p >= 60) return '#6bd968';
  if (p >= 50) return '#9bd14a';
  if (p >= 40) return '#e0c64a';
  return '#e06a5a';
}

// Diverging heatmap with CONFIDENCE MUTING — the team-prep edge over swubase.
// A cell's color is the win-rate hue (green favorable / red unfavorable) scaled
// by BOTH how far from 50% it is AND how many decisive games back it: a 2–0
// matchup stays near-neutral gray, not glowing green, so a tiny sample never
// masquerades as a strong read. 12 decisive games ≈ full saturation.
function heatColor(p: number | null, decisive: number): string {
  if (p == null) return 'transparent';
  const confidence = Math.min(decisive / 12, 1);
  const magnitude = Math.min(Math.abs(p - 50) / 25, 1);
  const intensity = magnitude * confidence;
  const target = p >= 50 ? [47, 158, 68] : [201, 42, 42]; // green / red
  const neutral = [28, 33, 40];
  const c = neutral.map((n, i) => Math.round(n + (target[i] - n) * intensity));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// A deck's base part: ability bases show their card art; vanilla bases show a
// small aspect-colored tag. Distinguishes same-leader decks on the matrix axes.
function BaseChip({ baseId, baseAspect }: { baseId: string | null; baseAspect: string | null }) {
  if (baseId) return <CardThumb cardId={baseId} h={18} />;
  if (baseAspect) {
    // Real SWU aspect icon (public/aspect-icons, lifted from karabast) — instantly
    // readable to players, vs the old "VIN"/"CUN" text badges.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/aspect-icons/aspect-${baseAspect}.webp`} alt={baseAspect} title={baseAspect} style={{ height: 18, width: 18, flex: '0 0 auto' }} />;
  }
  return <span style={{ fontSize: 8, color: '#6c7588' }}>?</span>;
}

type Axis = { key: string; leader: string; baseId: string | null; baseAspect: string | null };

// Square matchup matrix. Rows/columns are leaders ("Leaders" lens) or decks
// ("Leaders & Bases") sharing one games-ordered axis set. Each cell is win% or
// W–L, tinted by heatColor; the leftmost Total column is the axis's overall rate.
function MatchupMatrix({ matrix, mode, byBase, minGames, nm, onFocus, onMatchupFocus }: { matrix: { axes: Axis[]; cell: Map<string, any>; totals: Map<string, { games: number; wins: number; decisive: number }> }; mode: 'pct' | 'wl'; byBase: boolean; minGames: number; nm: (id: string) => string; onFocus: (leader: string, baseKey?: string) => void; onMatchupFocus: (leader: string, vs: string) => void }) {
  const { axes, cell, totals } = matrix;
  const show = (wins: number, decisive: number) => {
    if (mode === 'wl') return decisive ? `${wins}–${decisive - wins}` : '—';
    return fmtPct(pct(wins, decisive));
  };
  const focusOf = (a: Axis) => onFocus(a.leader, byBase ? baseKeyOf(a.baseId, a.baseAspect) : undefined);
  const label = (a: Axis) => nm(a.leader) + (byBase ? ` · ${a.baseId ? nm(a.baseId) : a.baseAspect ?? '?'}` : '');
  const COL = 44;
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ position: 'sticky', left: 0, zIndex: 2, background: '#0e1116' }} />
            <th style={{ width: COL, color: '#6c7588', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '0 2px', verticalAlign: 'bottom' }}>Total</th>
            {axes.map((a) => (
              <th key={a.key} style={{ width: COL, height: 104, padding: 0, verticalAlign: 'bottom' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <CardThumb cardId={a.leader} isLeader h={26} />
                  {byBase && <BaseChip baseId={a.baseId} baseAspect={a.baseAspect} />}
                  <span title={label(a)} style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis', color: '#a0a8b8', fontSize: 10 }}>{nm(a.leader)}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {axes.map((rowA) => {
            const t = totals.get(rowA.key)!;
            return (
              <tr key={rowA.key}>
                <td style={{ position: 'sticky', left: 0, zIndex: 1, background: '#0e1116', paddingRight: 8, whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => focusOf(rowA)} title={`See ${label(rowA)} detail`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                    <CardThumb cardId={rowA.leader} isLeader h={22} />
                    {byBase && <BaseChip baseId={rowA.baseId} baseAspect={rowA.baseAspect} />}
                    <span style={{ color: '#a7d2ff', fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label(rowA)}</span>
                  </button>
                </td>
                <td title={`${label(rowA)} overall — ${t.wins}–${t.decisive - t.wins}, ${t.games} games`}
                  style={{ width: COL, height: 30, textAlign: 'center', background: heatColor(pct(t.wins, t.decisive), t.decisive), color: '#fff', fontWeight: 700, borderLeft: '2px solid #0e1116' }}>
                  {show(t.wins, t.decisive)}
                </td>
                {axes.map((colA) => {
                  if (rowA.key === colA.key) return <td key={colA.key} style={{ width: COL, textAlign: 'center', color: '#3a4150', background: '#14171d' }}>{'–'}</td>;
                  const r = cell.get(`${rowA.key}|${colA.key}`);
                  // Blank cells below the min-games threshold (tiny-sample noise).
                  if (!r || r.games < minGames) return <td key={colA.key} style={{ width: COL, background: '#101319' }} />;
                  const p = pct(r.wins, r.decisive);
                  return (
                    <td key={colA.key} onClick={() => onMatchupFocus(rowA.leader, colA.leader)} title={`${label(rowA)} vs ${label(colA)} — ${r.wins}–${r.decisive - r.wins} (${fmtPct(p)}), ${r.games} games · click for matchup detail`}
                      style={{ width: COL, height: 30, textAlign: 'center', background: heatColor(p, r.decisive), color: '#e6e6e6', fontWeight: 600, cursor: 'pointer' }}>
                      {show(r.wins, r.decisive)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Efficiency → color. Tighter band than win% (most efficiencies sit 70–100%).
function effColor(p: number | null): string {
  if (p == null) return '#6c7588';
  if (p >= 90) return '#6bd968';
  if (p >= 80) return '#9bd14a';
  if (p >= 70) return '#e0c64a';
  return '#e06a5a';
}

// Tiny inline sparkline of per-game efficiency (chronological). Dots colored by
// value so a dip stands out at a glance.
function Sparkline({ points }: { points: number[] }) {
  const W = 280, H = 44, pad = 4;
  if (points.length < 2) return <div style={{ color: '#6c7588', fontSize: 12 }}>Need a few more games to chart a trend.</div>;
  const lo = Math.min(...points, 0.5), hi = Math.max(...points, 1);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (points.length - 1);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const path = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <path d={path} fill="none" stroke="#3a4150" strokeWidth={1.5} />
      {points.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.4} fill={effColor(Math.round(v * 100))} />)}
    </svg>
  );
}

// B101/Phase 3: the resourcing trend — blended efficiency headline + sparkline,
// the dominant leak, dead cards/game, a by-deck breakdown, and recent games that
// link into the in-viewer report. Aggregates the raw components (Σwasted/Σavail),
// so it's a true blended rate, not an average of per-game percentages.
function ResourcingPanel({ games, nm, minGames }: { games: any[]; nm: (id: string) => string; minGames: number }) {
  const sum = (k: string) => games.reduce((s, g) => s + (g[k] || 0), 0);
  const avail = sum('available'), wasted = sum('wasted'), forced = sum('forced'), underspend = sum('underspend');
  const blended = avail > 0 ? Math.round((1 - wasted / avail) * 100) : null;
  const deadPerGame = games.length ? (sum('deadCards') / games.length).toFixed(1) : '0';
  const leak = forced === 0 && underspend === 0 ? 'none' : underspend >= forced ? 'underspend (capacity left after playing)' : 'forced (stuck with no play)';
  // Chronological efficiency points (rows arrive newest-first).
  const points = [...games].reverse().filter((g) => g.available > 0).map((g) => 1 - g.wasted / g.available);

  // By deck (leader + base-identity), blended efficiency, games desc. Min-games
  // hides decks you've played too few times to read (same noise cut as the lists).
  const deckMap = new Map<string, { leader: string; baseId: string | null; baseAspect: string | null; games: number; avail: number; wasted: number }>();
  for (const g of games) {
    if (!g.leader) continue;
    const key = deckKeyOf(g.leader, g.baseId ?? null, g.baseAspect ?? null);
    const d = deckMap.get(key) || { leader: g.leader, baseId: g.baseId ?? null, baseAspect: g.baseAspect ?? null, games: 0, avail: 0, wasted: 0 };
    d.games += 1; d.avail += g.available || 0; d.wasted += g.wasted || 0;
    deckMap.set(key, d);
  }
  const byDeck = [...deckMap.values()].map((d) => ({ ...d, eff: d.avail > 0 ? Math.round((1 - d.wasted / d.avail) * 100) : null })).filter((d) => d.games >= minGames).sort((a, b) => b.games - a.games);
  const recent = games.slice(0, 14);
  const fmtDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`; };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Resource efficiency</div>
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, color: effColor(blended) }}>{blended == null ? '—' : `${blended}%`}</div>
          <div style={{ fontSize: 11, color: '#6c7588' }}>blended over {games.length} game{games.length === 1 ? '' : 's'}</div>
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Trend (oldest → newest)</div>
          <Sparkline points={points} />
        </div>
        <div style={{ display: 'flex', gap: 22 }}>
          <div><div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase' }}>Main leak</div><div style={{ fontSize: 13, color: '#e6e6e6', maxWidth: 180 }}>{leak}</div></div>
          <div><div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase' }}>Dead cards / game</div><div style={{ fontSize: 13, color: '#e6e6e6' }}>{deadPerGame}</div></div>
        </div>
      </div>

      {byDeck.length > 1 && (
        <div>
          <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>By deck</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {byDeck.map((d) => (
                <tr key={deckKeyOf(d.leader, d.baseId, d.baseAspect)}>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #1c2128' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <CardThumb cardId={d.leader} isLeader h={24} />
                      <BaseChip baseId={d.baseId} baseAspect={d.baseAspect} />
                      <span>{nm(d.leader)}</span>
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #1c2128', textAlign: 'right', fontWeight: 700, color: effColor(d.eff) }}>{d.eff == null ? '—' : `${d.eff}%`}</td>
                  <td style={{ padding: '6px 10px', borderBottom: '1px solid #1c2128', textAlign: 'right', color: '#a0a8b8' }}>{d.games} game{d.games === 1 ? '' : 's'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Recent games</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {recent.map((g) => {
            const eff = g.available > 0 ? Math.round((1 - g.wasted / g.available) * 100) : null;
            return (
              <a key={g.gameId} href={`/r/${g.replaySlug}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px', borderRadius: 6, textDecoration: 'none', color: '#e6e6e6' }}>
                <span style={{ width: 34, color: '#6c7588', fontSize: 11 }}>{fmtDate(g.createdAt)}</span>
                <CardThumb cardId={g.leader} isLeader h={22} />
                <BaseChip baseId={g.baseId} baseAspect={g.baseAspect} />
                <span style={{ flex: 1, fontSize: 12, color: '#a0a8b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.leader ? nm(g.leader) : 'Unknown'}</span>
                {g.deadCards > 0 && <span style={{ fontSize: 10, color: '#6c7588' }}>{g.deadCards} dead</span>}
                <span style={{ fontWeight: 700, color: effColor(eff), minWidth: 40, textAlign: 'right' }}>{eff == null ? '—' : `${eff}%`}</span>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// swubase-inspired: big card art in a responsive grid. Each tile leads with the
// image (what players scan for), then win% in the result color, then sample size.
function CardGrid({ cards, event, nm }: { cards: any[]; event: CardEvent; nm: (id: string) => string }) {
  const label = EVENTS.find((e) => e[0] === event)![1];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14 }}>
      {cards.map((r) => (
        <CardTile key={r.cardId} cardId={r.cardId} name={nm(r.cardId)} win={r.win} observations={r.observations} label={label} />
      ))}
    </div>
  );
}
function CardTile({ cardId, name, win, observations, label }: { cardId: string; name: string; win: number | null; observations: number; label: string }) {
  const url = cardId && cardId.includes('_') ? cardImageUrl(parseId(cardId), false) : null;
  return (
    <div style={{ background: '#11141a', border: '1px solid #1c2128', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ aspectRatio: '5 / 7', background: '#0a0c10', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ color: '#3a4150', fontSize: 11, padding: 8, textAlign: 'center' }}>{name}</span>
        )}
      </div>
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e6e6e6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={name}>{name}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: winColor(win) }}>{fmtPct(win)}</span>
          <span style={{ fontSize: 10, color: '#6c7588' }}>{observations} {label}</span>
        </div>
      </div>
    </div>
  );
}

// Sort lives on the headers (the native data-table pattern, and the cleanest on
// mobile): a sortable column shows ↕; the active one shows ▲/▼ and tapping it flips.
type Col = { label: string; sortKey?: SortKey };
function Table({ cols, rows, sort, dir, onSort, onRowClick, rowKeys }: { cols: Col[]; rows: React.ReactNode[][]; sort?: SortKey; dir?: SortDir; onSort?: (k: SortKey) => void; onRowClick?: (() => void)[]; rowKeys?: string[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>{cols.map((c, i) => {
          const align = i === 0 ? 'left' : 'right';
          // Per-site cell extras merged over the shared SortHeader base.
          const cellStyle: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #2e333c', letterSpacing: '0.04em' };
          if (c.sortKey && onSort) {
            return (
              <SortHeader<SortKey> key={i} k={c.sortKey} current={sort!} dir={dir ?? 'desc'} onSort={onSort}
                align={align} neutralIndicator activeColor="#4dd2ff" idleColor="#6c7588" style={cellStyle}>
                {c.label}
              </SortHeader>
            );
          }
          // Non-sortable column: plain header, idle color, no indicator (as before).
          return (
            <th key={i} style={{ textAlign: align, ...cellStyle, color: '#6c7588', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', cursor: 'default', userSelect: 'none', whiteSpace: 'nowrap' }}>
              {c.label}
            </th>
          );
        })}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => {
          const click = onRowClick?.[ri];
          return (
            <tr key={rowKeys?.[ri] ?? ri} onClick={click} title={click ? 'See detail' : undefined}
              style={click ? { cursor: 'pointer' } : undefined}>
              {r.map((c, ci) => <td key={ci} style={{ textAlign: ci === 0 ? 'left' : 'right', padding: '6px 10px', borderBottom: '1px solid #1c2128' }}>{c}</td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

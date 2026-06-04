'use client';

import { useEffect, useMemo, useState } from 'react';
import { cardImageUrl } from '@/lib/cardImage';

// B101/Phase2 (reframed): the Stats/Meta client, centered on the team/personal
// contexts teams actually want — "our leader matchups" and "card stats for the
// decks we play". Card views always show card art. Scoped to the signed-in
// user + their teams only — no global/community aggregate. /api/stats does the
// work; cardId→name via /api/cards.

type Scope = 'personal' | 'team';
type View = 'leaders' | 'matchups' | 'cards' | 'resourcing';
type CardEvent = 'played' | 'drawn' | 'resourced' | 'discarded';
const FORMATS = [['', 'All formats'], ['premier', 'Premier'], ['eternal', 'Eternal'], ['open', 'Open'], ['limited', 'Limited']] as const;
const EVENTS: [CardEvent, string][] = [['played', 'when played'], ['drawn', 'when drawn'], ['resourced', 'when resourced'], ['discarded', 'when discarded']];
const RECORDER_SIDE: Record<CardEvent, boolean> = { drawn: true, resourced: true, played: false, discarded: false };

const pct = (wins: number, decisive: number) => (decisive > 0 ? Math.round((wins / decisive) * 100) : null);
const fmtPct = (p: number | null) => (p == null ? '—' : `${p}%`);
const parseId = (id: string) => { const i = id.indexOf('_'); return { set: id.slice(0, i), number: Number(id.slice(i + 1)) }; };

const ASPECT_COLOR: Record<string, string> = { vigilance: '#2f74c0', command: '#2f9e44', aggression: '#c0392b', cunning: '#d4a017', heroism: '#cfd2d6', villainy: '#7b3fb5' };
const aspectAbbr = (a: string) => a.slice(0, 3).toUpperCase();
// A deck row carries baseId (ability base) XOR baseAspect (vanilla). Build a
// stable key + a short base label from that pair, sharing the matrix axes.
const baseKeyOf = (baseId: string | null, baseAspect: string | null) =>
  baseId ? `base:${baseId}` : baseAspect ? `asp:${baseAspect}` : 'asp:?';
const deckKeyOf = (leader: string, baseId: string | null, baseAspect: string | null) => `${leader}#${baseKeyOf(baseId, baseAspect)}`;

export function StatsClient({ signedIn, teams }: { signedIn: boolean; teams: { slug: string; name: string }[] }) {
  const [scope, setScope] = useState<Scope>(teams.length && !signedIn ? 'team' : 'personal');
  const [teamSlug, setTeamSlug] = useState<string>(teams[0]?.slug || '');
  const [view, setView] = useState<View>('leaders');
  const [format, setFormat] = useState<string>('');
  const [event, setEvent] = useState<CardEvent>('played');
  const [leaderCtx, setLeaderCtx] = useState<string>(''); // deck context for the Cards view
  const [baseSel, setBaseSel] = useState<string>(''); // base-identity key: ''=all | base:<id> | asp:<aspect>
  const [cardSort, setCardSort] = useState<'games' | 'winrate'>('games'); // grid sort
  const [cardSearch, setCardSearch] = useState<string>('');
  const [matchupMode, setMatchupMode] = useState<'pct' | 'wl'>('pct'); // heatmap cell: win% vs W–L count
  const [matchupLens, setMatchupLens] = useState<'leaders' | 'bases'>('leaders'); // leader-vs-leader or deck-vs-deck
  const [data, setData] = useState<any[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [leaderOptions, setLeaderOptions] = useState<string[]>([]); // leader cardIds in scope (for the deck picker)
  const [deckBases, setDeckBases] = useState<{ baseId: string | null; baseAspect: string | null; games: number }[]>([]); // bases played with the picked leader
  const [loading, setLoading] = useState(false);

  const scopeQs = useMemo(() => {
    const p = new URLSearchParams({ scope });
    if (format) p.set('format', format);
    if (scope === 'team' && teamSlug) p.set('team', teamSlug);
    return p;
  }, [scope, format, teamSlug]);

  const resolveNames = async (ids: Set<string>) => {
    if (!ids.size) return;
    try {
      const c = await fetch(`/api/cards?ids=${[...ids].join(',')}`);
      const cb = await c.json();
      if (cb.ok) setNames((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(cb.cards).map(([id, v]: any) => [id, v.name || id])) }));
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
    p.set('type', view);
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
  }, [scopeQs, view, event, leaderCtx, baseSel, matchupLens]);

  const nm = (id: string) => names[id] || id;

  // Cards view: client-side sort + name search over the fetched rows. Win% is
  // null below a small decisive-game floor, so "Best win %" sinks those rows
  // rather than letting a 1-of-1 card top the grid.
  const cardRows = useMemo(() => {
    if (view !== 'cards' || !data) return [];
    const q = cardSearch.trim().toLowerCase();
    const rows = data
      .map((r) => ({ ...r, name: nm(r.cardId), win: pct(r.wins, r.decisive) }))
      .filter((r) => !q || r.name.toLowerCase().includes(q));
    rows.sort((a, b) =>
      cardSort === 'winrate'
        ? (b.win ?? -1) - (a.win ?? -1) || b.observations - a.observations
        : b.observations - a.observations || (b.win ?? -1) - (a.win ?? -1),
    );
    return rows;
  }, [view, data, cardSearch, cardSort, names]);

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
    const ordered = [...axes.values()].sort((a, b) => (totals.get(b.key)!.games) - (totals.get(a.key)!.games));
    return { axes: ordered, cell, totals };
  }, [view, data, matchupLens]);

  const scopeOptions: [Scope, string][] = [
    ...(signedIn ? [['personal', 'Mine'] as [Scope, string]] : []),
    ...(teams.length ? [['team', 'Team'] as [Scope, string]] : []),
  ];

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '24px 16px 64px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 4px', color: '#fff' }}>
        Meta <span style={{ color: '#4dd2ff' }}>Stats</span>
      </h1>
      <p style={{ color: '#6c7588', fontSize: 13, margin: '0 0 18px' }}>
        Your leader matchups and card stats for the decks you play. Win rates over games with a recorded result; every figure shows its sample size.
      </p>

      {!signedIn ? (
        <div style={dim}>Sign in to see your personal and team stats.</div>
      ) : (<>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <Segmented options={scopeOptions} value={scope} onChange={(v) => setScope(v as Scope)} />
        {scope === 'team' && teams.length > 0 && <Select value={teamSlug} onChange={setTeamSlug} options={teams.map((t) => [t.slug, t.name])} />}
        <Select value={format} onChange={setFormat} options={FORMATS as any} />
      </div>

      <Segmented options={[['leaders', 'Leaders'], ['matchups', 'Matchups'], ['cards', 'Cards'], ['resourcing', 'Resourcing']]} value={view} onChange={(v) => setView(v as View)} />

      {view === 'cards' && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Deck:</span>
          <Select value={leaderCtx} onChange={setLeaderCtx} options={[['', 'All decks'], ...leaderOptions.map((id) => [id, nm(id)] as [string, string])]} />
          {leaderCtx && (
            <Select value={baseSel} onChange={setBaseSel} options={[
              ['', 'Any base'],
              ...deckBases.map((b) => [
                baseKeyOf(b.baseId, b.baseAspect),
                b.baseId ? `${nm(b.baseId)} (${b.games})` : `${b.baseAspect ? b.baseAspect[0].toUpperCase() + b.baseAspect.slice(1) : 'Unknown'} — no ability (${b.games})`,
              ] as [string, string]),
            ]} />
          )}
          <Segmented options={EVENTS} value={event} onChange={(v) => setEvent(v as CardEvent)} />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: RECORDER_SIDE[event] ? '#e0c64a' : '#6bd968' }}>
            {RECORDER_SIDE[event] ? 'recorder-side only' : 'whole-meta'}
          </span>
          <div style={{ flexBasis: '100%', height: 0 }} />
          <span style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sort:</span>
          <Segmented options={[['games', 'Most played'], ['winrate', 'Best win %']]} value={cardSort} onChange={(v) => setCardSort(v as any)} />
          <input value={cardSearch} onChange={(e) => setCardSearch(e.target.value)} placeholder="Search cards…" type="search"
            style={{ background: '#11141a', color: '#e6e6e6', border: '1px solid #2e333c', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontFamily: 'inherit', minWidth: 160 }} />
        </div>
      )}

      {view === 'matchups' && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Axis:</span>
          <Segmented options={[['leaders', 'Leaders'], ['bases', 'Leaders & Bases']]} value={matchupLens} onChange={(v) => setMatchupLens(v as any)} />
          <span style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cells:</span>
          <Segmented options={[['pct', 'Win %'], ['wl', 'W–L']]} value={matchupMode} onChange={(v) => setMatchupMode(v as any)} />
          <span style={{ fontSize: 11, color: '#6c7588', flexBasis: '100%' }}>
            Row {matchupLens === 'bases' ? 'deck' : 'leader'} vs. column {matchupLens === 'bases' ? 'deck' : 'leader'}. Color = win rate, faded when the sample is small.
            {matchupLens === 'bases' && ' Ability bases (Tarkintown, splash bases…) are their own decks; vanilla bases collapse to their aspect.'}
          </span>
        </div>
      )}

      {view === 'resourcing' && (
        <p style={{ color: '#6c7588', fontSize: 12, margin: '14px 0 0' }}>
          How tightly you spend resources, from your own games. Efficiency = resources spent ÷ resources you had, excluding rounds you claimed initiative and the game-deciding round. Higher is better.
        </p>
      )}

      <div style={{ marginTop: 16 }}>
        {loading && !data ? (
          <div style={dim}>Loading…</div>
        ) : !data || data.length === 0 ? (
          <div style={dim}>{view === 'resourcing' ? 'No rated games yet — upload some games to see your resourcing trend.' : 'No data yet for this view — upload some games.'}</div>
        ) : view === 'resourcing' ? (
          <ResourcingPanel games={data} nm={nm} />
        ) : view === 'cards' ? (
          <CardGrid cards={cardRows} event={event} nm={nm} />
        ) : view === 'matchups' ? (
          <MatchupMatrix matrix={matrix!} mode={matchupMode} byBase={matchupLens === 'bases'} nm={nm} />
        ) : (
          <Table head={['Leader', 'Win %', 'Games']}
            rows={data.map((r) => [cardCell(nm(r.leader), r.leader, true), <Win key="w">{fmtPct(pct(r.wins, r.decisive))}</Win>, <Muted key="g">{r.games}</Muted>])} />
        )}
      </div>
      </>)}
    </div>
  );
}

const dim: React.CSSProperties = { color: '#6c7588', fontStyle: 'italic', padding: '32px 0', textAlign: 'center' };

function CardThumb({ cardId, isLeader, h = 40 }: { cardId: string; isLeader?: boolean; h?: number }) {
  if (!cardId || !cardId.includes('_')) return null;
  const url = cardImageUrl(parseId(cardId), isLeader);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" loading="lazy" style={{ height: h, width: 'auto', borderRadius: 3, background: '#0a0c10', flex: '0 0 auto' }} />;
}
const cardCell = (name: string, cardId: string, isLeader: boolean) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><CardThumb cardId={cardId} isLeader={isLeader} /><span>{name}</span></span>
);
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
    const c = ASPECT_COLOR[baseAspect] || '#6c7588';
    return <span title={baseAspect} style={{ fontSize: 8, fontWeight: 800, color: '#0a0c10', background: c, borderRadius: 3, padding: '1px 3px', lineHeight: 1.2, letterSpacing: '0.03em' }}>{aspectAbbr(baseAspect)}</span>;
  }
  return <span style={{ fontSize: 8, color: '#6c7588' }}>?</span>;
}

type Axis = { key: string; leader: string; baseId: string | null; baseAspect: string | null };

// Square matchup matrix. Rows/columns are leaders ("Leaders" lens) or decks
// ("Leaders & Bases") sharing one games-ordered axis set. Each cell is win% or
// W–L, tinted by heatColor; the leftmost Total column is the axis's overall rate.
function MatchupMatrix({ matrix, mode, byBase, nm }: { matrix: { axes: Axis[]; cell: Map<string, any>; totals: Map<string, { games: number; wins: number; decisive: number }> }; mode: 'pct' | 'wl'; byBase: boolean; nm: (id: string) => string }) {
  const { axes, cell, totals } = matrix;
  const show = (wins: number, decisive: number) => {
    if (mode === 'wl') return decisive ? `${wins}–${decisive - wins}` : '—';
    return fmtPct(pct(wins, decisive));
  };
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
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <CardThumb cardId={rowA.leader} isLeader h={22} />
                    {byBase && <BaseChip baseId={rowA.baseId} baseAspect={rowA.baseAspect} />}
                    <span style={{ color: '#e6e6e6', fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label(rowA)}</span>
                  </span>
                </td>
                <td title={`${label(rowA)} overall — ${t.wins}–${t.decisive - t.wins}, ${t.games} games`}
                  style={{ width: COL, height: 30, textAlign: 'center', background: heatColor(pct(t.wins, t.decisive), t.decisive), color: '#fff', fontWeight: 700, borderLeft: '2px solid #0e1116' }}>
                  {show(t.wins, t.decisive)}
                </td>
                {axes.map((colA) => {
                  if (rowA.key === colA.key) return <td key={colA.key} style={{ width: COL, textAlign: 'center', color: '#3a4150', background: '#14171d' }}>{'–'}</td>;
                  const r = cell.get(`${rowA.key}|${colA.key}`);
                  if (!r) return <td key={colA.key} style={{ width: COL, background: '#101319' }} />;
                  const p = pct(r.wins, r.decisive);
                  return (
                    <td key={colA.key} title={`${label(rowA)} vs ${label(colA)} — ${r.wins}–${r.decisive - r.wins} (${fmtPct(p)}), ${r.games} games`}
                      style={{ width: COL, height: 30, textAlign: 'center', background: heatColor(p, r.decisive), color: '#e6e6e6', fontWeight: 600 }}>
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
function ResourcingPanel({ games, nm }: { games: any[]; nm: (id: string) => string }) {
  const sum = (k: string) => games.reduce((s, g) => s + (g[k] || 0), 0);
  const avail = sum('available'), wasted = sum('wasted'), forced = sum('forced'), underspend = sum('underspend');
  const blended = avail > 0 ? Math.round((1 - wasted / avail) * 100) : null;
  const deadPerGame = games.length ? (sum('deadCards') / games.length).toFixed(1) : '0';
  const leak = forced === 0 && underspend === 0 ? 'none' : underspend >= forced ? 'underspend (capacity left after playing)' : 'forced (stuck with no play)';
  // Chronological efficiency points (rows arrive newest-first).
  const points = [...games].reverse().filter((g) => g.available > 0).map((g) => 1 - g.wasted / g.available);

  // By deck (leader + base-identity), blended efficiency, games desc.
  const deckMap = new Map<string, { leader: string; baseId: string | null; baseAspect: string | null; games: number; avail: number; wasted: number }>();
  for (const g of games) {
    if (!g.leader) continue;
    const key = deckKeyOf(g.leader, g.baseId ?? null, g.baseAspect ?? null);
    const d = deckMap.get(key) || { leader: g.leader, baseId: g.baseId ?? null, baseAspect: g.baseAspect ?? null, games: 0, avail: 0, wasted: 0 };
    d.games += 1; d.avail += g.available || 0; d.wasted += g.wasted || 0;
    deckMap.set(key, d);
  }
  const byDeck = [...deckMap.values()].map((d) => ({ ...d, eff: d.avail > 0 ? Math.round((1 - d.wasted / d.avail) * 100) : null })).sort((a, b) => b.games - a.games);
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

function Segmented({ options, value, onChange }: { options: readonly (readonly [string, string])[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #2e333c', borderRadius: 6, overflow: 'hidden' }}>
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={v === value}
          style={{ background: v === value ? 'rgba(77,157,255,0.22)' : 'transparent', color: v === value ? '#fff' : '#a0a8b8', border: 0, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          {label}
        </button>
      ))}
    </div>
  );
}
function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ background: '#11141a', color: '#e6e6e6', border: '1px solid #2e333c', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontFamily: 'inherit', maxWidth: 220 }}>
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}
function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>{head.map((h, i) => <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '8px 10px', borderBottom: '1px solid #2e333c', color: '#6c7588', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ textAlign: ci === 0 ? 'left' : 'right', padding: '6px 10px', borderBottom: '1px solid #1c2128' }}>{c}</td>)}</tr>)}
      </tbody>
    </table>
  );
}

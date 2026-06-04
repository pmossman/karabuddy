'use client';

import { useEffect, useMemo, useState } from 'react';
import { cardImageUrl } from '@/lib/cardImage';

// B101/Phase2 (reframed): the Stats/Meta client, centered on the team/personal
// contexts teams actually want — "our leader matchups" and "card stats for the
// decks we play". Card views always show card art. Global is a de-emphasized
// fallback. /api/stats does the work; cardId→name via /api/cards.

type Scope = 'personal' | 'team' | 'global';
type View = 'leaders' | 'matchups' | 'cards';
type CardEvent = 'played' | 'drawn' | 'resourced' | 'discarded';
const FORMATS = [['', 'All formats'], ['premier', 'Premier'], ['eternal', 'Eternal'], ['open', 'Open'], ['limited', 'Limited']] as const;
const EVENTS: [CardEvent, string][] = [['played', 'when played'], ['drawn', 'when drawn'], ['resourced', 'when resourced'], ['discarded', 'when discarded']];
const ASPECTS = [['', 'Any base aspect'], ['vigilance', 'Vigilance'], ['command', 'Command'], ['aggression', 'Aggression'], ['cunning', 'Cunning'], ['heroism', 'Heroism'], ['villainy', 'Villainy']] as const;
const RECORDER_SIDE: Record<CardEvent, boolean> = { drawn: true, resourced: true, played: false, discarded: false };

const pct = (wins: number, decisive: number) => (decisive > 0 ? Math.round((wins / decisive) * 100) : null);
const fmtPct = (p: number | null) => (p == null ? '—' : `${p}%`);
const parseId = (id: string) => { const i = id.indexOf('_'); return { set: id.slice(0, i), number: Number(id.slice(i + 1)) }; };

export function StatsClient({ signedIn, teams }: { signedIn: boolean; teams: { slug: string; name: string }[] }) {
  const [scope, setScope] = useState<Scope>(signedIn ? 'personal' : 'global');
  const [teamSlug, setTeamSlug] = useState<string>(teams[0]?.slug || '');
  const [view, setView] = useState<View>('leaders');
  const [format, setFormat] = useState<string>('');
  const [event, setEvent] = useState<CardEvent>('played');
  const [leaderCtx, setLeaderCtx] = useState<string>(''); // deck context for the Cards view
  const [baseAspect, setBaseAspect] = useState<string>('');
  const [cardSort, setCardSort] = useState<'games' | 'winrate'>('games'); // grid sort
  const [cardSearch, setCardSearch] = useState<string>('');
  const [matchupMode, setMatchupMode] = useState<'pct' | 'wl'>('pct'); // heatmap cell: win% vs W–L count
  const [data, setData] = useState<any[] | null>(null);
  const [minGames, setMinGames] = useState<number>(1);
  const [names, setNames] = useState<Record<string, string>>({});
  const [leaderOptions, setLeaderOptions] = useState<string[]>([]); // leader cardIds in scope (for the deck picker)
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

  // Main data for the active view.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null); // drop stale rows so a view switch never renders the old shape (e.g. leaders rows under the Cards table)
    const p = new URLSearchParams(scopeQs);
    p.set('type', view);
    if (view === 'cards') { p.set('event', event); if (leaderCtx) p.set('leader', leaderCtx); if (baseAspect) p.set('baseAspect', baseAspect); }
    (async () => {
      try {
        const res = await fetch(`/api/stats?${p}`);
        const body = await res.json();
        if (cancelled) return;
        setData(body.ok ? body.data || [] : []);
        setMinGames(body.minGames ?? 1);
        const ids = new Set<string>();
        for (const r of body.data || []) for (const k of ['leader', 'opponentLeader', 'cardId']) if (r[k]) ids.add(r[k]);
        resolveNames(ids);
      } catch { if (!cancelled) setData([]); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [scopeQs, view, event, leaderCtx, baseAspect]);

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

  // Matchups view: pivot the flat directed rows (leader → opponentLeader) into a
  // square matrix. Axes share one leader set, ordered by total games played, so
  // the popular decks cluster top-left. Per-leader totals come from summing its
  // own matchup rows (one fetch, no extra round-trip).
  const matrix = useMemo(() => {
    if (view !== 'matchups' || !data) return null;
    const cell = new Map<string, any>();
    const totals = new Map<string, { games: number; wins: number; decisive: number }>();
    for (const r of data) {
      cell.set(`${r.leader}|${r.opponentLeader}`, r);
      const t = totals.get(r.leader) || { games: 0, wins: 0, decisive: 0 };
      t.games += r.games; t.wins += r.wins; t.decisive += r.decisive;
      totals.set(r.leader, t);
      if (!totals.has(r.opponentLeader)) totals.set(r.opponentLeader, { games: 0, wins: 0, decisive: 0 });
    }
    const leaders = [...totals.keys()].sort((a, b) => (totals.get(b)!.games) - (totals.get(a)!.games));
    return { leaders, cell, totals };
  }, [view, data]);

  const scopeOptions: [Scope, string][] = [
    ...(signedIn ? [['personal', 'Mine'] as [Scope, string]] : []),
    ...(teams.length ? [['team', 'Team'] as [Scope, string]] : []),
    ['global', 'Global'],
  ];

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '24px 16px 64px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 4px', color: '#fff' }}>
        Meta <span style={{ color: '#4dd2ff' }}>Stats</span>
      </h1>
      <p style={{ color: '#6c7588', fontSize: 13, margin: '0 0 18px' }}>
        Your leader matchups and card stats for the decks you play. Win rates over games with a recorded result; every figure shows its sample size.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <Segmented options={scopeOptions} value={scope} onChange={(v) => setScope(v as Scope)} />
        {scope === 'team' && teams.length > 0 && <Select value={teamSlug} onChange={setTeamSlug} options={teams.map((t) => [t.slug, t.name])} />}
        <Select value={format} onChange={setFormat} options={FORMATS as any} />
      </div>

      <Segmented options={[['leaders', 'Leaders'], ['matchups', 'Matchups'], ['cards', 'Cards']]} value={view} onChange={(v) => setView(v as View)} />

      {view === 'cards' && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Deck:</span>
          <Select value={leaderCtx} onChange={setLeaderCtx} options={[['', 'All decks'], ...leaderOptions.map((id) => [id, nm(id)] as [string, string])]} />
          <Select value={baseAspect} onChange={setBaseAspect} options={ASPECTS as any} />
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
          <span style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cells:</span>
          <Segmented options={[['pct', 'Win %'], ['wl', 'W–L']]} value={matchupMode} onChange={(v) => setMatchupMode(v as any)} />
          <span style={{ fontSize: 11, color: '#6c7588' }}>Row leader vs. column leader. Color = win rate, faded when the sample is small.</span>
        </div>
      )}

      {scope === 'global' && <div style={{ fontSize: 12, color: '#6c7588', margin: '12px 0 0' }}>Global rows need ≥{minGames} games to appear (privacy).</div>}

      <div style={{ marginTop: 16 }}>
        {loading && !data ? (
          <div style={dim}>Loading…</div>
        ) : !data || data.length === 0 ? (
          <div style={dim}>No data yet for this view{scope === 'personal' ? ' — upload some games or sign in' : ''}.</div>
        ) : view === 'cards' ? (
          <CardGrid cards={cardRows} event={event} nm={nm} />
        ) : view === 'matchups' ? (
          <MatchupMatrix matrix={matrix!} mode={matchupMode} nm={nm} />
        ) : (
          <Table head={['Leader', 'Win %', 'Games']}
            rows={data.map((r) => [cardCell(nm(r.leader), r.leader, true), <Win key="w">{fmtPct(pct(r.wins, r.decisive))}</Win>, <Muted key="g">{r.games}</Muted>])} />
        )}
      </div>
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

// Square leader-vs-leader matrix. Rows = your leader, columns = opponent, one
// shared leader set ordered by games played. Each cell is win% or W–L, tinted
// by heatColor; the leftmost Total column is the leader's overall rate.
function MatchupMatrix({ matrix, mode, nm }: { matrix: { leaders: string[]; cell: Map<string, any>; totals: Map<string, { games: number; wins: number; decisive: number }> }; mode: 'pct' | 'wl'; nm: (id: string) => string }) {
  const { leaders, cell, totals } = matrix;
  const show = (wins: number, decisive: number) => {
    const p = pct(wins, decisive);
    if (mode === 'wl') return decisive ? `${wins}–${decisive - wins}` : '—';
    return fmtPct(p);
  };
  const COL = 44;
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ position: 'sticky', left: 0, zIndex: 2, background: '#0e1116' }} />
            <th style={{ width: COL, color: '#6c7588', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '0 2px', verticalAlign: 'bottom' }}>Total</th>
            {leaders.map((id) => (
              <th key={id} style={{ width: COL, height: 96, padding: 0, verticalAlign: 'bottom' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <CardThumb cardId={id} isLeader h={26} />
                  <span title={nm(id)} style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', maxHeight: 64, overflow: 'hidden', textOverflow: 'ellipsis', color: '#a0a8b8', fontSize: 10 }}>{nm(id)}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leaders.map((row) => {
            const t = totals.get(row)!;
            return (
              <tr key={row}>
                <td style={{ position: 'sticky', left: 0, zIndex: 1, background: '#0e1116', paddingRight: 8, whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <CardThumb cardId={row} isLeader h={22} />
                    <span style={{ color: '#e6e6e6', fontSize: 11, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{nm(row)}</span>
                  </span>
                </td>
                <td title={`${nm(row)} overall — ${t.wins}–${t.decisive - t.wins}, ${t.games} games`}
                  style={{ width: COL, height: 30, textAlign: 'center', background: heatColor(pct(t.wins, t.decisive), t.decisive), color: '#fff', fontWeight: 700, borderLeft: '2px solid #0e1116' }}>
                  {show(t.wins, t.decisive)}
                </td>
                {leaders.map((col) => {
                  if (row === col) return <td key={col} style={{ width: COL, textAlign: 'center', color: '#3a4150', background: '#14171d' }}>{'–'}</td>;
                  const r = cell.get(`${row}|${col}`);
                  if (!r) return <td key={col} style={{ width: COL, background: '#101319' }} />;
                  const p = pct(r.wins, r.decisive);
                  return (
                    <td key={col} title={`${nm(row)} vs ${nm(col)} — ${r.wins}–${r.decisive - r.wins} (${fmtPct(p)}), ${r.games} games`}
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

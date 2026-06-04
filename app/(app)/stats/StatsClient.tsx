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
        </div>
      )}

      {scope === 'global' && <div style={{ fontSize: 12, color: '#6c7588', margin: '12px 0 0' }}>Global rows need ≥{minGames} games to appear (privacy).</div>}

      <div style={{ marginTop: 16 }}>
        {loading && !data ? (
          <div style={dim}>Loading…</div>
        ) : !data || data.length === 0 ? (
          <div style={dim}>No data yet for this view{scope === 'personal' ? ' — upload some games or sign in' : ''}.</div>
        ) : view === 'cards' ? (
          <Table head={['Card', `Win % ${EVENTS.find((e) => e[0] === event)![1]}`, 'Games']}
            rows={data.map((r) => [cardCell(nm(r.cardId), r.cardId, false), <Win key="w">{fmtPct(pct(r.wins, r.decisive))}</Win>, <Muted key="g">{r.observations}</Muted>])} />
        ) : view === 'matchups' ? (
          <Table head={['Matchup', 'Win %', 'Games']}
            rows={data.map((r) => [matchupCell(nm(r.leader), r.leader, nm(r.opponentLeader), r.opponentLeader), <Win key="w">{fmtPct(pct(r.wins, r.decisive))}</Win>, <Muted key="g">{r.games}</Muted>])} />
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
const matchupCell = (a: string, aId: string, b: string, bId: string) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
    <CardThumb cardId={aId} isLeader h={34} /><span>{a}</span>
    <span style={{ color: '#6c7588', fontWeight: 700, fontSize: 11 }}>vs</span>
    <CardThumb cardId={bId} isLeader h={34} /><span style={{ color: '#a0a8b8' }}>{b}</span>
  </span>
);
const Win = ({ children }: { children: React.ReactNode }) => <span style={{ color: '#4dd2ff', fontWeight: 700 }}>{children}</span>;
const Muted = ({ children }: { children: React.ReactNode }) => <span style={{ color: '#a0a8b8' }}>{children}</span>;

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

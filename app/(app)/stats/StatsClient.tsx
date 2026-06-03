'use client';

import { useEffect, useMemo, useState } from 'react';

// B101/Phase2: the Stats/Meta client. Drives /api/stats across audience
// (global/personal/team), view (leaders/matchups/cards), format, and — for
// cards — event. Resolves cardId→name via /api/cards. Every row shows its
// sample size; card stats show an attribution badge (recorder-side vs
// whole-meta) since draw/resource events are only observable for the recorder.

type Scope = 'global' | 'personal' | 'team';
type View = 'leaders' | 'matchups' | 'cards';
type CardEvent = 'played' | 'drawn' | 'resourced' | 'discarded';
const FORMATS = [['', 'All formats'], ['premier', 'Premier'], ['eternal', 'Eternal'], ['open', 'Open'], ['limited', 'Limited']] as const;
const EVENTS: [CardEvent, string][] = [['played', 'when played'], ['drawn', 'when drawn'], ['resourced', 'when resourced'], ['discarded', 'when discarded']];
const RECORDER_SIDE: Record<CardEvent, boolean> = { drawn: true, resourced: true, played: false, discarded: false };

const pct = (wins: number, decisive: number) => (decisive > 0 ? Math.round((wins / decisive) * 100) : null);

export function StatsClient({ signedIn, teams }: { signedIn: boolean; teams: { slug: string; name: string }[] }) {
  const [scope, setScope] = useState<Scope>('global');
  const [teamSlug, setTeamSlug] = useState<string>(teams[0]?.slug || '');
  const [view, setView] = useState<View>('leaders');
  const [format, setFormat] = useState<string>('');
  const [event, setEvent] = useState<CardEvent>('played');
  const [data, setData] = useState<any[] | null>(null);
  const [minGames, setMinGames] = useState<number>(1);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ type: view, scope });
    if (format) p.set('format', format);
    if (scope === 'team' && teamSlug) p.set('team', teamSlug);
    if (view === 'cards') p.set('event', event);
    return p.toString();
  }, [view, scope, format, teamSlug, event]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/stats?${qs}`);
        const body = await res.json();
        if (cancelled) return;
        if (!body.ok) { setData([]); setMinGames(body.minGames ?? 1); return; }
        setData(body.data || []);
        setMinGames(body.minGames ?? 1);
        // resolve names for any cardIds in the rows
        const ids = new Set<string>();
        for (const r of body.data || []) { for (const k of ['leader', 'opponentLeader', 'cardId']) if (r[k]) ids.add(r[k]); }
        if (ids.size) {
          const c = await fetch(`/api/cards?ids=${[...ids].join(',')}`);
          const cb = await c.json();
          if (!cancelled && cb.ok) setNames((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(cb.cards).map(([id, v]: any) => [id, v.name || id])) }));
        }
      } catch { if (!cancelled) setData([]); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [qs]);

  const nm = (id: string) => names[id] || id;

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 16px 64px', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 4px', color: '#fff' }}>
        Meta <span style={{ color: '#4dd2ff' }}>Stats</span>
      </h1>
      <p style={{ color: '#6c7588', fontSize: 13, margin: '0 0 18px' }}>
        Aggregated from KaraBuddy replays. Win rates over games with a recorded result; every figure shows its sample size.
      </p>

      {/* Audience + format */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <Segmented
          options={[['global', 'Global'], ...(signedIn ? [['personal', 'Mine'] as const] : []), ...(teams.length ? [['team', 'Team'] as const] : [])]}
          value={scope}
          onChange={(v) => setScope(v as Scope)}
        />
        {scope === 'team' && teams.length > 0 && (
          <Select value={teamSlug} onChange={setTeamSlug} options={teams.map((t) => [t.slug, t.name])} />
        )}
        <Select value={format} onChange={setFormat} options={FORMATS as any} />
      </div>

      {/* View tabs */}
      <Segmented options={[['leaders', 'Leaders'], ['matchups', 'Matchups'], ['cards', 'Cards']]} value={view} onChange={(v) => setView(v as View)} />
      {view === 'cards' && (
        <div style={{ marginTop: 10 }}>
          <Segmented options={EVENTS} value={event} onChange={(v) => setEvent(v as CardEvent)} />
          <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: RECORDER_SIDE[event] ? '#e0c64a' : '#6bd968' }}>
            {RECORDER_SIDE[event] ? 'recorder-side only' : 'whole-meta'}
          </span>
        </div>
      )}

      {scope === 'global' && (
        <div style={{ fontSize: 12, color: '#6c7588', margin: '12px 0 0' }}>Global rows need ≥{minGames} games to appear (privacy).</div>
      )}

      <div style={{ marginTop: 16 }}>
        {loading && !data ? (
          <div style={{ color: '#6c7588', fontStyle: 'italic', padding: '32px 0', textAlign: 'center' }}>Loading…</div>
        ) : !data || data.length === 0 ? (
          <div style={{ color: '#6c7588', fontStyle: 'italic', padding: '32px 0', textAlign: 'center' }}>No data yet for this view.</div>
        ) : view === 'cards' ? (
          <Table head={['Card', `Win % ${EVENTS.find((e) => e[0] === event)![1]}`, 'Games']} rows={data.map((r) => [nm(r.cardId), fmtPct(pct(r.wins, r.decisive)), String(r.observations)])} />
        ) : view === 'matchups' ? (
          <Table head={['Matchup', 'Win %', 'Games']} rows={data.map((r) => [`${nm(r.leader)}  vs  ${nm(r.opponentLeader)}`, fmtPct(pct(r.wins, r.decisive)), String(r.games)])} />
        ) : (
          <Table head={['Leader', 'Win %', 'Games']} rows={data.map((r) => [nm(r.leader), fmtPct(pct(r.wins, r.decisive)), String(r.games)])} />
        )}
      </div>
    </div>
  );
}

const fmtPct = (p: number | null) => (p == null ? '—' : `${p}%`);

function Segmented({ options, value, onChange }: { options: readonly (readonly [string, string])[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #2e333c', borderRadius: 6, overflow: 'hidden' }}>
      {options.map(([v, label]) => {
        const active = v === value;
        return (
          <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={active}
            style={{ background: active ? 'rgba(77,157,255,0.22)' : 'transparent', color: active ? '#fff' : '#a0a8b8', border: 0, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ background: '#11141a', color: '#e6e6e6', border: '1px solid #2e333c', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontFamily: 'inherit' }}>
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>{head.map((h, i) => <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '8px 10px', borderBottom: '1px solid #2e333c', color: '#6c7588', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ textAlign: ci === 0 ? 'left' : 'right', padding: '7px 10px', borderBottom: '1px solid #1c2128', color: ci === 0 ? '#e6e6e6' : ci === 1 ? '#4dd2ff' : '#a0a8b8', fontWeight: ci === 1 ? 700 : 400 }}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

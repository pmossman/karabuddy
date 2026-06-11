'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B124: the tournament detail view. One GET drives everything; every action
// POSTs/PATCHes then refetches. P2 scope: header + settings (organizer),
// registration panel (self-register w/ decklist import, organizer guest-add),
// standings render once rounds exist (P3 adds the lifecycle controls).

export interface DetailEntrant {
  id: string;
  userId: string | null; // null = guest
  displayName: string;
  dropped: boolean;
  deck: unknown | null;
  deckLink: string | null;
  deckName: string | null;
  hasDeck: boolean;
  deckVisible: boolean;
}
export interface DetailGame { winner: string | null; replaySlug?: string }
export interface DetailMatch {
  id: string;
  tableNumber: number;
  entrant1Id: string;
  entrant2Id: string | null; // null = bye
  games: DetailGame[];
  status: 'pending' | 'reported' | 'confirmed';
  resultSource: string | null;
}
export interface DetailRound {
  id: string;
  number: number;
  status: 'active' | 'complete';
  createdAt: string;
  matches: DetailMatch[];
}
export interface DetailStanding {
  entrantId: string;
  rank: number;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  omwp: number;
  gwp: number;
  ogwp: number;
  dropped: boolean;
}
export interface Detail {
  tournament: {
    id: string;
    teamSlug: string;
    name: string;
    status: 'setup' | 'active' | 'complete';
    decklistVisibility: string;
    plannedRounds: number | null;
    suggestedRounds: number;
    createdAt: string;
  };
  viewer: { userId: string; isOrganizer: boolean; entrantId: string | null };
  entrants: DetailEntrant[];
  rounds: DetailRound[];
  standings: DetailStanding[];
}

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  setup: { label: 'Registration open', color: '#e0c64a', bg: 'rgba(224,198,74,0.12)' },
  active: { label: 'In progress', color: '#6bd968', bg: 'rgba(107,217,104,0.12)' },
  complete: { label: 'Finished', color: '#a0a8b8', bg: 'rgba(160,168,184,0.12)' },
};

export function TournamentDetail({ teamSlug, tournamentId }: { teamSlug: string; tournamentId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/teams/${teamSlug}/tournaments/${tournamentId}`;

  const load = useCallback(async () => {
    const res = await fetch(base);
    const body = await res.json().catch(() => ({ ok: false, error: 'network error' }));
    if (!body.ok) { setError(body.error || 'failed to load'); return; }
    setError(null);
    setDetail(body.data);
  }, [base]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div style={{ color: '#ff8a8a', fontSize: 13 }}>{error}</div>;
  if (!detail) return <div style={{ color: '#6c7588', fontSize: 13 }}>Loading…</div>;

  const { tournament: t, viewer } = detail;
  const status = STATUS_STYLE[t.status] ?? STATUS_STYLE.setup;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, flex: 1, minWidth: 200 }}>{t.name}</h1>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: status.color, background: status.bg, border: `1px solid ${status.color}40`, borderRadius: 999, padding: '4px 12px' }}>
          {status.label}
        </span>
      </header>

      <RegistrationPanel teamSlug={teamSlug} detail={detail} onChanged={load} />

      {detail.rounds.length > 0 && <StandingsTable detail={detail} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RegistrationPanel({ teamSlug, detail, onChanged }: { teamSlug: string; detail: Detail; onChanged: () => Promise<void> }) {
  const { tournament: t, viewer, entrants } = detail;
  const base = `/api/teams/${teamSlug}/tournaments/${t.id}`;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deckLink, setDeckLink] = useState('');
  const [guestName, setGuestName] = useState('');
  const inSetup = t.status === 'setup';
  const myEntrant = entrants.find((e) => e.id === viewer.entrantId) ?? null;

  const act = async (fn: () => Promise<Response>) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setActionError(body.error || `failed (${res.status})`); return; }
      setDeckLink('');
      setGuestName('');
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const join = () => act(() =>
    fetch(`${base}/entrants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(deckLink.trim() ? { deckLink: deckLink.trim() } : {}) })
  );
  const leave = () => act(() => fetch(`${base}/entrants/${viewer.entrantId}`, { method: 'DELETE' }));
  const submitDeck = () => act(() =>
    fetch(`${base}/entrants/${viewer.entrantId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deckLink: deckLink.trim() }) })
  );
  const addGuest = () => act(() =>
    fetch(`${base}/entrants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: guestName.trim() }) })
  );

  return (
    <section style={panelStyle}>
      <h2 style={sectionTitleStyle}>
        Entrants <span style={{ color: '#6c7588', fontWeight: 400 }}>{entrants.length}</span>
        {inSetup && <span style={{ fontSize: 11, color: '#6c7588', fontWeight: 400, marginLeft: 8 }}>suggested rounds: {t.suggestedRounds}</span>}
      </h2>

      {entrants.length === 0 && (
        <div style={{ fontSize: 13, color: '#a0a8b8', padding: '10px 0' }}>Nobody has registered yet.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entrants.map((e) => (
          <div key={e.id} data-testid="entrant-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'rgba(17,20,26,0.5)', border: '1px solid #2e333c', borderRadius: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600, textDecoration: e.dropped ? 'line-through' : 'none', color: e.dropped ? '#6c7588' : '#e6e6e6' }}>
              {e.displayName}
            </span>
            {!e.userId && <Badge color="#c99cff">Guest</Badge>}
            {e.id === viewer.entrantId && <Badge color="#6bd968">You</Badge>}
            {e.dropped && <Badge color="#ff8a8a">Dropped</Badge>}
            <span style={{ flex: 1 }} />
            {e.hasDeck ? (
              e.deckVisible ? (
                <Link href={`/teams/${teamSlug}/tournaments/${t.id}/decks/${e.id}`} style={{ fontSize: 12, color: '#5db4ff', textDecoration: 'none' }}>
                  {e.deckName || 'Decklist'} →
                </Link>
              ) : (
                <span style={{ fontSize: 11, color: '#6c7588' }}>🔒 deck registered</span>
              )
            ) : (
              <span style={{ fontSize: 11, color: '#4a4e56' }}>no deck</span>
            )}
          </div>
        ))}
      </div>

      {actionError && <div style={{ color: '#ff8a8a', fontSize: 12, marginTop: 10 }}>{actionError}</div>}

      {/* Self-registration / decklist controls (members, while setup). */}
      {inSetup && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="url"
              value={deckLink}
              onChange={(e) => setDeckLink(e.target.value)}
              placeholder="Decklist link (swubase, swustats, my-swu, …) — optional"
              style={{ ...inputStyle, flex: 1, minWidth: 240 }}
            />
            {!myEntrant ? (
              <button type="button" onClick={join} disabled={busy} style={primaryButtonStyle}>
                {busy ? 'Working…' : deckLink.trim() ? 'Register with deck' : 'Register'}
              </button>
            ) : (
              <>
                <button type="button" onClick={submitDeck} disabled={busy || !deckLink.trim()} style={primaryButtonStyle}>
                  {myEntrant.hasDeck ? 'Replace my deck' : 'Submit my deck'}
                </button>
                <button type="button" onClick={leave} disabled={busy} style={ghostButtonStyle}>
                  Unregister
                </button>
              </>
            )}
          </div>

          {viewer.isOrganizer && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid #2e333c', paddingTop: 10 }}>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addGuest(); }}
                placeholder="Guest name (player without a karabuddy account)"
                maxLength={80}
                style={{ ...inputStyle, flex: 1, minWidth: 240 }}
              />
              <button type="button" onClick={addGuest} disabled={busy || !guestName.trim()} style={ghostButtonStyle}>
                + Add guest
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function StandingsTable({ detail }: { detail: Detail }) {
  const nameOf = new Map(detail.entrants.map((e) => [e.id, e.displayName]));
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return (
    <section style={panelStyle}>
      <h2 style={sectionTitleStyle}>Standings</h2>
      <div style={{ overflowX: 'auto' }}>
        <table data-testid="standings-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#d6d6d6' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#a0a8b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>Player</th>
              <th style={thStyle}>Record</th>
              <th style={thStyle}>Pts</th>
              <th style={thStyle}>OMW%</th>
              <th style={thStyle}>GW%</th>
              <th style={thStyle}>OGW%</th>
            </tr>
          </thead>
          <tbody>
            {detail.standings.map((s) => (
              <tr key={s.entrantId} style={{ borderTop: '1px solid #2e333c', opacity: s.dropped ? 0.5 : 1 }}>
                <td style={tdStyle}>{s.rank}</td>
                <td style={{ ...tdStyle, fontWeight: 600, textDecoration: s.dropped ? 'line-through' : 'none' }}>
                  {nameOf.get(s.entrantId) ?? s.entrantId}
                </td>
                <td style={tdStyle}>{s.wins}–{s.losses}{s.draws > 0 ? `–${s.draws}` : ''}</td>
                <td style={tdStyle}>{s.points}</td>
                <td style={tdStyle}>{pct(s.omwp)}</td>
                <td style={tdStyle}>{pct(s.gwp)}</td>
                <td style={tdStyle}>{pct(s.ogwp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color, background: `${color}1f`, border: `1px solid ${color}55`, borderRadius: 999, padding: '1px 8px' }}>
      {children}
    </span>
  );
}

const panelStyle: React.CSSProperties = {
  background: tokens.surface.panel,
  border: `1px solid ${tokens.surface.panelBorder}`,
  borderRadius: tokens.radius.md,
  boxShadow: tokens.surface.panelShadow,
  padding: '14px 16px',
};
const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 14,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#e6e6e6',
};
const inputStyle: React.CSSProperties = {
  background: '#11141a',
  color: '#e6e6e6',
  border: '1px solid #2e333c',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};
const primaryButtonStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, #4d9dff, #3b7fe0)',
  border: '1px solid #6cb0ff',
  color: '#fff',
  fontSize: 12,
  fontWeight: 700,
  padding: '7px 14px',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const ghostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2e333c',
  color: '#a0a8b8',
  fontSize: 12,
  fontWeight: 600,
  padding: '7px 14px',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const thStyle: React.CSSProperties = { padding: '6px 10px', fontWeight: 700 };
const tdStyle: React.CSSProperties = { padding: '7px 10px' };

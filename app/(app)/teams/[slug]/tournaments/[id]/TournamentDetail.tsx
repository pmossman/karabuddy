'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { cardImageUrl } from '@/lib/cardImage';

// B151: small leader + base thumbnails for an entrant's registered deck. Ids are
// "SET_NNN"; the leader image uses the `-base` (deployed) side.
function artFromId(id: string | undefined, isLeader: boolean): string | null {
  if (!id) return null;
  const m = /^([A-Za-z0-9]+)_(\d+)$/.exec(id);
  return m ? cardImageUrl({ set: m[1], number: m[2] }, isLeader) : null;
}
function DeckLeaderBase({ deck }: { deck: any }) {
  const leader = artFromId(deck?.leader?.id, true);
  const base = artFromId(deck?.base?.id, false);
  if (!leader && !base) return null;
  // Leaders (deployed side) + bases are LANDSCAPE cards — keep the thumbnails
  // landscape so they don't crop weirdly.
  const thumb: CSSProperties = { width: 40, height: 28, borderRadius: 4, objectFit: 'cover', border: '1px solid #2e333c', flex: '0 0 auto', background: '#0b0e14' };
  return (
    <span style={{ display: 'inline-flex', gap: 4, flex: '0 0 auto' }}>
      {leader && <img src={leader} alt="leader" title="Leader" style={thumb} />}
      {base && <img src={base} alt="base" title="Base" style={thumb} />}
    </span>
  );
}

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
  // B152: deck legality (only when the viewer can see the deck). null otherwise.
  legality?: { legal: boolean; violations: { code: string; message: string }[] } | null;
  claimToken: string | null; // organizer-only; guest's account-claim secret
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
export interface DetailSuggestion {
  games: { winner: string | null; replaySlug: string }[];
  score: string;
  confidence: 'high' | 'low';
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
    inviteCode: string | null; // organizer-only
    createdAt: string;
  };
  viewer: { userId: string; isOrganizer: boolean; entrantId: string | null };
  entrants: DetailEntrant[];
  rounds: DetailRound[];
  standings: DetailStanding[];
  // matchId → replay-derived suggestion for the active round's pending matches.
  suggestions: Record<string, DetailSuggestion>;
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

  const { tournament: t } = detail;
  const status = STATUS_STYLE[t.status] ?? STATUS_STYLE.setup;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, flex: 1, minWidth: 200 }}>{t.name}</h1>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: status.color, background: status.bg, border: `1px solid ${status.color}40`, borderRadius: 999, padding: '4px 12px' }}>
          {status.label}
        </span>
      </header>

      <OrganizerControls teamSlug={teamSlug} detail={detail} onChanged={load} />

      {detail.rounds.length > 0 && <StandingsTable detail={detail} />}
      {detail.rounds.length > 0 && <RoundsList teamSlug={teamSlug} detail={detail} onChanged={load} />}

      <RegistrationPanel teamSlug={teamSlug} detail={detail} onChanged={load} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function OrganizerControls({ teamSlug, detail, onChanged }: { teamSlug: string; detail: Detail; onChanged: () => Promise<void> }) {
  const { tournament: t, viewer, entrants } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/teams/${teamSlug}/tournaments/${t.id}`;
  if (!viewer.isOrganizer || t.status === 'complete') return null;

  const post = async (path: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/${path}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error || `failed (${res.status})`); return; }
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const activeEntrants = entrants.filter((e) => !e.dropped).length;
  const currentRound = detail.rounds.length > 0 ? detail.rounds[detail.rounds.length - 1] : null;
  const reachedPlanned = t.plannedRounds != null && (currentRound?.number ?? 0) >= t.plannedRounds;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {t.status === 'setup' && (
        <button type="button" onClick={() => post('start')} disabled={busy || activeEntrants < 2} style={primaryButtonStyle} title={activeEntrants < 2 ? 'Need at least 2 entrants' : undefined}>
          {busy ? 'Working…' : `Start tournament (pair round 1)`}
        </button>
      )}
      {t.status === 'active' && (
        <>
          <button type="button" onClick={() => post('rounds')} disabled={busy} style={reachedPlanned ? ghostButtonStyle : primaryButtonStyle}>
            {busy ? 'Working…' : `Pair round ${(currentRound?.number ?? 0) + 1}`}
          </button>
          <button type="button" onClick={() => post('finish')} disabled={busy} style={reachedPlanned ? primaryButtonStyle : ghostButtonStyle}>
            Finish tournament
          </button>
          {t.plannedRounds != null && (
            <span style={{ fontSize: 11, color: '#6c7588' }}>
              round {currentRound?.number ?? 0} of {t.plannedRounds} planned
            </span>
          )}
        </>
      )}
      {error && <span style={{ color: '#ff8a8a', fontSize: 12 }}>{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RoundsList({ teamSlug, detail, onChanged }: { teamSlug: string; detail: Detail; onChanged: () => Promise<void> }) {
  const nameOf = new Map(detail.entrants.map((e) => [e.id, e.displayName]));
  // Latest round first — it's the one being played.
  const rounds = [...detail.rounds].reverse();
  return (
    <section style={panelStyle}>
      <h2 style={sectionTitleStyle}>Rounds</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rounds.map((r) => (
          <div key={r.id} data-testid={`round-${r.number}`}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#a7d2ff', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Round {r.number}
              <span style={{ marginLeft: 8, fontWeight: 400, color: '#6c7588', textTransform: 'none', letterSpacing: 0 }}>
                {r.status === 'complete' ? 'complete' : 'in progress'}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {r.matches.map((m) => (
                <MatchCard key={m.id} teamSlug={teamSlug} detail={detail} match={m} nameOf={nameOf} onChanged={onChanged} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function scoreText(m: DetailMatch): string {
  if (m.entrant2Id === null) return 'BYE';
  if (m.games.length === 0) return '—';
  let a = 0, b = 0;
  for (const g of m.games) {
    if (g.winner === m.entrant1Id) a++;
    else if (g.winner === m.entrant2Id) b++;
  }
  return `${a}–${b}`;
}

function MatchCard({
  teamSlug, detail, match: m, nameOf, onChanged,
}: {
  teamSlug: string;
  detail: Detail;
  match: DetailMatch;
  nameOf: Map<string, string>;
  onChanged: () => Promise<void>;
}) {
  const { tournament: t, viewer, entrants } = detail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const myEntrant = entrants.find((e) => e.id === viewer.entrantId);
  const isPaired = !!myEntrant && (m.entrant1Id === myEntrant.id || m.entrant2Id === myEntrant.id);
  const isBye = m.entrant2Id === null;
  const canReport =
    t.status === 'active' && !isBye &&
    (viewer.isOrganizer || (isPaired && m.status !== 'confirmed'));
  const showButtons = canReport && (m.status === 'pending' || editing);

  const postReport = async (games: { winner: string | null; replaySlug?: string }[], source: 'manual' | 'replays') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${teamSlug}/tournaments/${t.id}/matches/${m.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ games, source }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error || `failed (${res.status})`); return; }
      setEditing(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const report = (wins1: number, wins2: number) =>
    postReport(
      [
        ...Array.from({ length: wins1 }, () => ({ winner: m.entrant1Id })),
        ...Array.from({ length: wins2 }, () => ({ winner: m.entrant2Id })),
      ],
      'manual'
    );

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${teamSlug}/tournaments/${t.id}/matches/${m.id}/confirm`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error || `failed (${res.status})`); return; }
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const name1 = nameOf.get(m.entrant1Id) ?? '?';
  const name2 = isBye ? null : nameOf.get(m.entrant2Id!) ?? '?';

  return (
    <div data-testid="match-card" style={{ padding: '8px 12px', background: 'rgba(17,20,26,0.5)', border: '1px solid #2e333c', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: '#6c7588', fontWeight: 700 }}>T{m.tableNumber}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {name1}
          {!isBye && <span style={{ color: '#6c7588', fontWeight: 400 }}> vs </span>}
          {name2}
          {isBye && <span style={{ color: '#6c7588', fontWeight: 400 }}> — bye</span>}
        </span>
        <span data-testid="match-score" style={{ fontSize: 14, fontWeight: 700, color: '#a7d2ff' }}>{scoreText(m)}</span>
        <span style={{ flex: 1 }} />
        {m.status === 'confirmed' && !isBye && <Badge color="#6bd968">Final</Badge>}
        {m.status === 'reported' && <Badge color="#e0c64a">Reported</Badge>}
        {m.status === 'reported' && viewer.isOrganizer && (
          <button type="button" onClick={confirm} disabled={busy} style={miniButtonStyle}>Confirm</button>
        )}
        {canReport && m.status !== 'pending' && !editing && (
          <button type="button" onClick={() => setEditing(true)} style={miniButtonStyle}>Edit</button>
        )}
      </div>
      {/* B124/P4: replay-derived suggestion — confirm posts the suggested games
          through the normal report endpoint (source 'replays'). */}
      {m.status === 'pending' && detail.suggestions[m.id] && (
        <div data-testid="suggestion-banner" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 10px', background: 'rgba(107,217,104,0.08)', border: '1px solid rgba(107,217,104,0.3)', borderRadius: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#7fd97f' }}>
            🎬 Detected <strong>{detail.suggestions[m.id].score}</strong> from recorded replays
            {detail.suggestions[m.id].confidence === 'low' ? ' (incomplete — check before confirming)' : ''}
          </span>
          {detail.suggestions[m.id].games.map((g, i) => (
            <a key={i} href={`/r/${g.replaySlug}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#5db4ff', textDecoration: 'none' }}>
              game {i + 1} ↗
            </a>
          ))}
          {canReport && (
            <button
              type="button"
              onClick={() => postReport(detail.suggestions[m.id].games, 'replays')}
              disabled={busy}
              style={{ ...miniButtonStyle, background: 'rgba(107,217,104,0.15)', borderColor: 'rgba(107,217,104,0.5)', color: '#7fd97f' }}
            >
              Confirm {detail.suggestions[m.id].score}
            </button>
          )}
        </div>
      )}
      {showButtons && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#6c7588' }}>Report ({name1} first):</span>
          {[[2, 0], [2, 1], [1, 2], [0, 2]].map(([w1, w2]) => (
            <button key={`${w1}-${w2}`} type="button" onClick={() => report(w1, w2)} disabled={busy} style={miniButtonStyle}>
              {w1}–{w2}
            </button>
          ))}
          {editing && (
            <button type="button" onClick={() => setEditing(false)} style={{ ...miniButtonStyle, color: '#6c7588' }}>Cancel</button>
          )}
        </div>
      )}
      {error && <div style={{ color: '#ff8a8a', fontSize: 12, marginTop: 6 }}>{error}</div>}
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
  // null = closed; 'add' = new-guest modal; an entrant = editing that guest.
  const [guestModal, setGuestModal] = useState<'add' | DetailEntrant | null>(null);
  // B145: the viewer editing their OWN deck / confirming unregister (both inline
  // from their entrant row).
  const [deckModalOpen, setDeckModalOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copied, setCopied] = useState<string | null>(null); // feedback label

  // B126: get-or-create the invite code, then copy a link to the clipboard.
  // `claimToken` appends a guest's personal claim secret to the same link.
  const copyInviteLink = async (label: string, claimToken?: string) => {
    setActionError(null);
    try {
      let code = t.inviteCode;
      if (!code) {
        const res = await fetch(`${base}/invite`, { method: 'POST' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) { setActionError(body.error || 'could not create invite'); return; }
        code = body.code;
        await onChanged(); // refresh so t.inviteCode is set for next time
      }
      const url = `${window.location.origin}/tournaments/join?code=${code}${claimToken ? `&claim=${claimToken}` : ''}`;
      await navigator.clipboard.writeText(url);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setActionError('could not copy — clipboard unavailable');
    }
  };
  const inSetup = t.status === 'setup';
  const myEntrant = entrants.find((e) => e.id === viewer.entrantId) ?? null;

  // `onDone` clears only the field the ACTION consumed — clearing both would
  // wipe whatever the user is typing into the OTHER input while this request
  // is in flight (register completing must not eat a half-typed guest name).
  const act = async (fn: () => Promise<Response>, onDone?: () => void) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setActionError(body.error || `failed (${res.status})`); return; }
      onDone?.();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const join = () => act(() =>
    fetch(`${base}/entrants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(deckLink.trim() ? { deckLink: deckLink.trim() } : {}) }),
    () => setDeckLink('')
  );
  const leave = () => act(() => fetch(`${base}/entrants/${viewer.entrantId}`, { method: 'DELETE' }));
  const dropSelf = () => act(() =>
    fetch(`${base}/entrants/${viewer.entrantId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropped: true }) })
  );
  const setDropped = (entrantId: string, dropped: boolean) => act(() =>
    fetch(`${base}/entrants/${entrantId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropped }) })
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <DeckLeaderBase deck={e.deck} />
                  <Link href={`/teams/${teamSlug}/tournaments/${t.id}/decks/${e.id}`} style={{ fontSize: 12, color: '#5db4ff', textDecoration: 'none' }}>
                    {e.deckName || 'Decklist'} →
                  </Link>
                  {e.legality && !e.legality.legal && (
                    <span
                      data-testid={`deck-illegal-${e.id}`}
                      title={e.legality.violations.map((v) => v.message).join('\n')}
                      style={{ fontSize: 10.5, fontWeight: 800, color: '#ffce4d', background: 'rgba(255,206,77,0.12)', border: '1px solid rgba(255,206,77,0.45)', borderRadius: 999, padding: '1px 7px', cursor: 'help' }}
                    >
                      ⚠ illegal
                    </span>
                  )}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: '#6c7588' }}>🔒 deck registered</span>
              )
            ) : (
              <span style={{ fontSize: 11, color: '#4a4e56' }}>no deck</span>
            )}
            {/* B145: manage your OWN entry inline on your row while registration
                is open — edit deck (modal) + unregister (confirm modal). */}
            {inSetup && e.id === viewer.entrantId && (
              <>
                <button type="button" onClick={() => setDeckModalOpen(true)} style={miniGhostStyle}>
                  {e.hasDeck ? 'Edit deck' : 'Add deck'}
                </button>
                <button type="button" onClick={() => setConfirmLeave(true)} disabled={busy} style={dangerMiniStyle}>
                  Unregister
                </button>
              </>
            )}
            {/* Organizer manages a guest's name + decklist via the modal —
                anytime (guests can't fix their own list). */}
            {viewer.isOrganizer && !e.userId && t.status !== 'complete' && (
              <button type="button" onClick={() => setGuestModal(e)} style={miniGhostStyle}>Edit</button>
            )}
            {/* B126: the guest's personal claim link — send it to them so
                creating an account converts this entry + joins the team. */}
            {viewer.isOrganizer && !e.userId && e.claimToken && t.status !== 'complete' && (
              <button type="button" onClick={() => copyInviteLink(`claim:${e.id}`, e.claimToken!)} style={miniGhostStyle}>
                {copied === `claim:${e.id}` ? 'Copied!' : 'Claim link'}
              </button>
            )}
            {/* Drop controls during an active tournament: self-drop for the
                viewer's own entry; organizer can drop/undrop anyone. */}
            {t.status === 'active' && !e.dropped && e.id === viewer.entrantId && (
              <button type="button" onClick={dropSelf} disabled={busy} style={dangerMiniStyle}>Drop</button>
            )}
            {t.status === 'active' && viewer.isOrganizer && e.id !== viewer.entrantId && (
              <button type="button" onClick={() => setDropped(e.id, !e.dropped)} disabled={busy} style={dangerMiniStyle}>
                {e.dropped ? 'Undrop' : 'Drop'}
              </button>
            )}
          </div>
        ))}
      </div>

      {actionError && <div style={{ color: '#ff8a8a', fontSize: 12, marginTop: 10 }}>{actionError}</div>}

      {/* Self-registration / decklist controls (members, while setup). Guests
          are added via a separate modal so the two flows never read as one form. */}
      {inSetup && (!myEntrant || viewer.isOrganizer) && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Register is for viewers who haven't joined yet; once registered, the
              deck + unregister controls live on the viewer's own row above. */}
          {!myEntrant && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="url"
                value={deckLink}
                onChange={(e) => setDeckLink(e.target.value)}
                placeholder="Your decklist link (swubase, swustats, my-swu, …) — optional"
                style={{ ...inputStyle, flex: 1, minWidth: 240 }}
              />
              <button type="button" onClick={join} disabled={busy} style={primaryButtonStyle}>
                {busy ? 'Working…' : deckLink.trim() ? 'Register with deck' : 'Register'}
              </button>
            </div>
          )}

          {viewer.isOrganizer && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setGuestModal('add')} style={ghostButtonStyle}>
                + Add guest player
              </button>
              {/* B126: shareable registration link — guests fill in their own
                  name + deck, no account needed. */}
              <button type="button" data-testid="copy-invite-link" onClick={() => copyInviteLink('invite')} style={ghostButtonStyle}>
                {copied === 'invite' ? 'Copied!' : '🔗 Copy invite link'}
              </button>
              <span style={{ fontSize: 11, color: '#6c7588' }}>
                guests register themselves via the link — you manage their results
              </span>
            </div>
          )}
        </div>
      )}

      {guestModal && (
        <GuestModal
          base={base}
          entrant={guestModal === 'add' ? null : guestModal}
          onClose={() => setGuestModal(null)}
          onSaved={async () => { setGuestModal(null); await onChanged(); }}
        />
      )}
      {deckModalOpen && myEntrant && (
        <DeckModal
          base={base}
          entrant={myEntrant}
          onClose={() => setDeckModalOpen(false)}
          onSaved={async () => { setDeckModalOpen(false); await onChanged(); }}
        />
      )}
      {confirmLeave && myEntrant && (
        <ConfirmModal
          title="Unregister?"
          message={`Remove your registration from ${t.name}? You'll lose your spot${myEntrant.hasDeck ? ' and submitted deck' : ''}. You can register again while registration is open.`}
          confirmLabel="Unregister"
          busy={busy}
          onConfirm={async () => { await leave(); setConfirmLeave(false); }}
          onClose={() => setConfirmLeave(false)}
        />
      )}
    </section>
  );
}

// B145: a generic "are you sure?" confirmation modal (destructive confirm).
function ConfirmModal({
  title, message, confirmLabel, busy, onConfirm, onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      data-testid="confirm-modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', padding: 16,
      }}
    >
      <div
        data-testid="confirm-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#11141a', border: '1px solid #2e333c', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)', width: 'min(420px, 100%)',
          padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e6e6e6' }}>{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: 'transparent', border: 0, color: '#a0a8b8', fontSize: 16, cursor: 'pointer', padding: 4 }}>✕</button>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={ghostButtonStyle}>Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{ background: 'transparent', border: '1px solid rgba(255,107,107,0.5)', color: '#ff8a8a', fontSize: 12, fontWeight: 700, padding: '8px 16px', borderRadius: 6, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// B145: a viewer changing their OWN decklist while registration is open — a
// deck-link-only modal (no name field; members are named by their account).
// PATCHes the entrant deckLink, which the API allows for the self entrant while
// the tournament is in setup.
function DeckModal({
  base, entrant, onClose, onSaved,
}: {
  base: string;
  entrant: DetailEntrant;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy || !link.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/entrants/${entrant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckLink: link.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error || `failed (${res.status})`); return; }
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="deck-modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', padding: 16,
      }}
    >
      <div
        data-testid="deck-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#11141a', border: '1px solid #2e333c', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)', width: 'min(480px, 100%)',
          padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e6e6e6' }}>
            {entrant.hasDeck ? 'Replace your deck' : 'Add your deck'}
          </h3>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: 'transparent', border: 0, color: '#a0a8b8', fontSize: 16, cursor: 'pointer', padding: 4 }}>✕</button>
        </div>
        <label style={modalLabelStyle}>
          Decklist link <span style={{ color: '#4a4e56', textTransform: 'none', letterSpacing: 0 }}>(swubase, swustats, my-swu, …)</span>
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            placeholder={entrant.hasDeck ? 'Paste a new link to replace your deck' : 'https://…'}
            style={inputStyle}
            autoFocus
          />
        </label>
        {entrant.hasDeck && !link.trim() && (
          <span style={{ fontSize: 11, color: '#6c7588' }}>Current deck: {entrant.deckName || 'registered'} (kept unless you paste a new link)</span>
        )}
        {error && <div style={{ color: '#ff8a8a', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={ghostButtonStyle}>Cancel</button>
          <button type="button" onClick={save} disabled={busy || !link.trim()} style={primaryButtonStyle}>
            {busy ? 'Saving…' : 'Save deck'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

// B124-followup: guests get a dedicated modal (add + edit) with name AND
// decklist link — guests need tracked decklists too, and the old inline
// stacked-forms layout read as one confusing blob.
function GuestModal({
  base, entrant, onClose, onSaved,
}: {
  base: string;
  entrant: DetailEntrant | null; // null = add mode
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(entrant?.displayName ?? '');
  const [link, setLink] = useState(entrant?.deckLink ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      if (entrant === null) {
        res = await fetch(`${base}/entrants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: name.trim(), ...(link.trim() ? { deckLink: link.trim() } : {}) }),
        });
      } else {
        // PATCH only what changed — a deckLink triggers a fresh import.
        const payload: Record<string, string> = {};
        if (name.trim() !== entrant.displayName) payload.displayName = name.trim();
        if (link.trim() && link.trim() !== (entrant.deckLink ?? '')) payload.deckLink = link.trim();
        if (Object.keys(payload).length === 0) { onClose(); return; }
        res = await fetch(`${base}/entrants/${entrant.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error || `failed (${res.status})`); return; }
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="guest-modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', padding: 16,
      }}
    >
      <div
        data-testid="guest-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#11141a', border: '1px solid #2e333c', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)', width: 'min(480px, 100%)',
          padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e6e6e6' }}>
            {entrant ? `Edit ${entrant.displayName}` : 'Add guest player'}
          </h3>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: 'transparent', border: 0, color: '#a0a8b8', fontSize: 16, cursor: 'pointer', padding: 4 }}>✕</button>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: '#6c7588', lineHeight: 1.4 }}>
          A guest is a player without a karabuddy account. You enter their name,
          decklist, and match results on their behalf.
        </p>
        <label style={modalLabelStyle}>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mando Mike"
            maxLength={80}
            style={inputStyle}
            autoFocus={!entrant}
          />
        </label>
        <label style={modalLabelStyle}>
          Decklist link <span style={{ color: '#4a4e56', textTransform: 'none', letterSpacing: 0 }}>(optional — swubase, swustats, my-swu, …)</span>
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            placeholder={entrant?.hasDeck ? 'Paste a new link to replace the registered deck' : 'https://…'}
            style={inputStyle}
          />
        </label>
        {entrant?.hasDeck && !link.trim() && (
          <span style={{ fontSize: 11, color: '#6c7588' }}>Current deck: {entrant.deckName || 'registered'} (kept unless you paste a new link)</span>
        )}
        {error && <div style={{ color: '#ff8a8a', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={ghostButtonStyle}>Cancel</button>
          <button type="button" onClick={save} disabled={busy || !name.trim()} style={primaryButtonStyle}>
            {busy ? 'Saving…' : entrant ? 'Save changes' : 'Add guest'}
          </button>
        </div>
      </div>
    </div>
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
const modalLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 10,
  color: '#6c7588',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
};
const miniGhostStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2e333c',
  color: '#a0a8b8',
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 5,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const dangerMiniStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,138,138,0.35)',
  color: '#ff8a8a',
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 5,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const miniButtonStyle: React.CSSProperties = {
  background: 'rgba(77,157,255,0.12)',
  border: '1px solid rgba(77,157,255,0.4)',
  color: '#a7d2ff',
  fontSize: 11,
  fontWeight: 700,
  padding: '3px 10px',
  borderRadius: 5,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const thStyle: React.CSSProperties = { padding: '6px 10px', fontWeight: 700 };
const tdStyle: React.CSSProperties = { padding: '7px 10px' };

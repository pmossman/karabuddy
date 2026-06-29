'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ErrorNote, Loading } from '@/app/_components/StatusUi';

// B126: the public invite-registration flow. One component, four viewer states:
//   signed out          → guest form (name + optional deck link); on success
//                         the claimToken is stashed in localStorage so signing
//                         up later can claim the entry from this browser.
//   signed in, member   → pointer to the real tournament page.
//   signed in, entrant  → "Join the team" (linked entrant w/o membership).
//   signed in, neither  → register (linked) with the account name.
// A ?claim=<token> in the URL (guest's personal claim link, or post-signup
// return) drives the guest→member upgrade.

interface InviteInfo {
  tournament: { id: string; name: string; status: string };
  team: { slug: string; name: string };
  entrants: { displayName: string; isGuest: boolean; dropped: boolean }[];
  registrationOpen: boolean;
  viewer: { signedIn: boolean; isMember: boolean; registered: boolean };
}

const storageKey = (code: string) => `karabuddy:tournamentClaim:${code}`;

export function TournamentInvite({ code, claimToken: claimFromUrl }: { code: string; claimToken: string | null }) {
  const router = useRouter();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [deckLink, setDeckLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [registeredAsGuest, setRegisteredAsGuest] = useState(false);
  const [storedClaim, setStoredClaim] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tournaments/invite/${encodeURIComponent(code)}`);
    const body = await res.json().catch(() => ({ ok: false, error: 'network error' }));
    if (!body.ok) { setError(body.error || 'invite not found'); return; }
    setInfo(body.data);
  }, [code]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    try { setStoredClaim(localStorage.getItem(storageKey(code))); } catch {}
  }, [code]);

  const tournamentUrl = info ? `/teams/${info.team.slug}/tournaments/${info.tournament.id}` : '/';
  const claimable = claimFromUrl || storedClaim;

  const registerGuest = async () => {
    if (busy || !info) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/invite/${encodeURIComponent(code)}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(info.viewer.signedIn ? {} : { displayName: name.trim() }),
          ...(deckLink.trim() ? { deckLink: deckLink.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error || `failed (${res.status})`); return; }
      if (body.claimToken) {
        try { localStorage.setItem(storageKey(code), body.claimToken); } catch {}
        setStoredClaim(body.claimToken);
        setRegisteredAsGuest(true);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const claim = async () => {
    if (busy || !claimable) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/invite/${encodeURIComponent(code)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimToken: claimable }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error || `failed (${res.status})`); return; }
      try { localStorage.removeItem(storageKey(code)); } catch {}
      router.push(`/teams/${body.teamSlug}/tournaments/${body.tournamentId}`);
    } finally {
      setBusy(false);
    }
  };

  if (error && !info) return <ErrorNote>{error}</ErrorNote>;
  if (!info) return <Loading />;

  const { viewer } = info;
  const active = info.entrants.filter((e) => !e.dropped);
  const signinUrl = `/signin?callbackUrl=${encodeURIComponent(`/tournaments/join?code=${code}`)}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
          Tournament invite · {info.team.name}
        </div>
        <h1 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 700 }}>{info.tournament.name}</h1>
      </header>

      <section style={panelStyle}>
        <div style={{ fontSize: 12, color: '#a0a8b8', marginBottom: 8 }}>
          {active.length} {active.length === 1 ? 'player' : 'players'} registered
          {!info.registrationOpen && ' · registration closed'}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {active.map((e, i) => (
            <span key={i} style={{ fontSize: 12, color: '#d6d6d6', background: 'rgba(17,20,26,0.6)', border: '1px solid #2e333c', borderRadius: 999, padding: '3px 10px' }}>
              {e.displayName}
            </span>
          ))}
          {active.length === 0 && <span style={{ fontSize: 12, color: '#4a4e56' }}>Nobody yet — be the first.</span>}
        </div>
      </section>

      <ErrorNote>{error}</ErrorNote>

      {/* Claim flow: a guest entry waiting + a signed-in account → upgrade.
          B127: claiming links the entry to the account (tournament access);
          team membership is separate, via a normal team invite. */}
      {viewer.signedIn && !viewer.registered && claimable && info.tournament.status !== 'complete' && (
        <section style={panelStyle}>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#d6d6d6' }}>
            You have a guest registration waiting. Claim it to link it to your
            account — you&apos;ll see pairings and report your own results.
          </p>
          <button type="button" onClick={claim} disabled={busy} style={primaryButtonStyle}>
            {busy ? 'Working…' : 'Claim my registration'}
          </button>
        </section>
      )}

      {viewer.isMember ? (
        <section style={panelStyle}>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#d6d6d6' }}>
            You&apos;re a member of {info.team.name} — register on the tournament page.
          </p>
          <a href={tournamentUrl} style={{ ...primaryButtonStyle, display: 'inline-block', textDecoration: 'none' }}>Open the tournament →</a>
        </section>
      ) : viewer.registered ? (
        <section style={panelStyle}>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#d6d6d6' }}>
            You&apos;re registered — open the tournament to see pairings, report
            your results, and follow the standings.
          </p>
          <a href={tournamentUrl} style={{ ...primaryButtonStyle, display: 'inline-block', textDecoration: 'none' }}>Open the tournament →</a>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: '#6c7588' }}>
            Want to join {info.team.name} itself (replays, discussion, stats)? Ask the organizer for a team invite.
          </p>
        </section>
      ) : registeredAsGuest ? (
        <section style={panelStyle}>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#7fd97f' }}>
            ✓ You&apos;re registered! The organizer will report your results.
          </p>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#a0a8b8', lineHeight: 1.5 }}>
            Want to manage your own registration, see pairings, and get replay-powered
            results? Create a karabuddy account — your registration carries over.
          </p>
          <a href={signinUrl} style={{ ...primaryButtonStyle, display: 'inline-block', textDecoration: 'none' }}>Create an account / sign in</a>
        </section>
      ) : info.registrationOpen ? (
        <section style={panelStyle}>
          <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Register</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!viewer.signedIn && (
              <label style={labelStyle}>
                Your name
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="How should pairings show you?" maxLength={80} style={inputStyle} />
              </label>
            )}
            <label style={labelStyle}>
              Decklist link <span style={{ color: '#4a4e56', textTransform: 'none', letterSpacing: 0 }}>(optional — swubase, swustats, my-swu, …)</span>
              <input type="url" value={deckLink} onChange={(e) => setDeckLink(e.target.value)} placeholder="https://…" style={inputStyle} />
            </label>
            <div>
              <button type="button" onClick={registerGuest} disabled={busy || (!viewer.signedIn && !name.trim())} style={primaryButtonStyle}>
                {busy ? 'Registering…' : 'Register'}
              </button>
              {!viewer.signedIn && (
                <a href={signinUrl} style={{ marginLeft: 12, fontSize: 12, color: '#5db4ff', textDecoration: 'none' }}>
                  or sign in first
                </a>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section style={panelStyle}>
          <p style={{ margin: 0, fontSize: 13, color: '#a0a8b8' }}>
            Registration is closed{info.tournament.status === 'active' ? ' — the tournament is underway.' : '.'}
          </p>
        </section>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: tokens.surface.panel,
  border: `1px solid ${tokens.surface.panelBorder}`,
  borderRadius: tokens.radius.md,
  boxShadow: tokens.surface.panelShadow,
  padding: '14px 16px',
};
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 10,
  color: '#6c7588',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  background: '#11141a',
  color: '#e6e6e6',
  border: '1px solid #2e333c',
  borderRadius: 6,
  padding: '8px 10px',
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
  padding: '8px 16px',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

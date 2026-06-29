'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { Panel } from '@/app/_components/Panel';
import { ErrorNote } from '@/app/_components/StatusUi';

// Owner-only "Danger zone" — permanently delete the team. Two-step like
// TransferOwnership: a danger button reveals a red-wash block that requires typing
// the EXACT team name to confirm (the server re-checks it). On success the team and
// all its tournaments / shares / discussion / invites are gone — but members keep
// their own replays (just un-shared). Posts to .../delete (DELETE means "leave").
export function DeleteTeam({ slug, teamName }: { slug: string; teamName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === teamName;

  const del = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${slug}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: typed.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error || `failed (${res.status})`); return; }
      // The team is gone — leave the now-404 team page; the active-team cookie self-heals.
      router.push('/teams');
    } catch (e: any) {
      setError(e?.message || 'network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#ffb3b3' }}>Danger zone — delete team</div>
      <p style={{ margin: 0, fontSize: 12, color: '#a0a8b8', lineHeight: 1.5, maxWidth: 540 }}>
        Permanently delete <strong style={{ color: '#e6e6e6' }}>{teamName}</strong> and everything in it —
        all tournaments, replay shares, discussion, review marks, and invites. Members{' '}
        <strong>keep their own replays</strong> (they&apos;re just no longer shared here).
        <strong style={{ color: '#ffb3b3' }}> This cannot be undone.</strong>
      </p>
      <ErrorNote>{error}</ErrorNote>

      {!confirming ? (
        <button type="button" data-testid="delete-open" onClick={() => setConfirming(true)} style={btnDanger}>
          Delete this team…
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: 'rgba(255,122,122,0.06)', border: '1px solid rgba(255,122,122,0.3)', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#ffd0d0' }}>Delete {teamName} permanently?</div>
          <label style={{ fontSize: 12, color: '#a0a8b8', lineHeight: 1.5 }}>
            Type the team name <strong style={{ color: '#e6e6e6' }}>{teamName}</strong> to confirm:
            <input
              data-testid="delete-confirm-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={teamName}
              autoComplete="off"
              style={{ display: 'block', marginTop: 6, background: '#11141a', color: '#e6e6e6', border: `1px solid ${tokens.color.border}`, borderRadius: 6, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none', minWidth: 220 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" data-testid="delete-confirm" onClick={del} disabled={!matches || busy}
              style={{ ...btnDanger, opacity: matches && !busy ? 1 : 0.5, cursor: matches && !busy ? 'pointer' : 'not-allowed' }}>
              {busy ? 'Deleting…' : 'Delete team'}
            </button>
            <button type="button" onClick={() => { setConfirming(false); setTyped(''); setError(null); }} disabled={busy} style={btnGhost}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

const btnBase: React.CSSProperties = { border: 0, borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' };
const btnDanger: React.CSSProperties = { ...btnBase, background: 'transparent', color: '#ff7a7a', border: '1px solid rgba(255, 122, 122, 0.4)' };
const btnGhost: React.CSSProperties = { ...btnBase, background: 'transparent', color: '#a0a8b8', border: '1px solid #4a4e56' };

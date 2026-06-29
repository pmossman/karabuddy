'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Panel } from '@/app/_components/Panel';
import { Select } from '@/app/_components/Select';
import { ErrorNote } from '@/app/_components/StatusUi';
import { btnGhost, btnDanger } from '@/app/_components/buttonStyles';

// B160: owner-only "Transfer ownership" control in team Settings. Pick a member,
// then confirm an explicit warning — the acting owner hands the team over and
// steps down to a regular member (the API does promote-then-demote).
export function TransferOwnership({
  slug,
  members,
  viewerUserId,
}: {
  slug: string;
  members: { userId: string; name: string | null; role: string }[];
  viewerUserId: string;
}) {
  const router = useRouter();
  const targets = members.filter((m) => m.userId !== viewerUserId);
  const [targetId, setTargetId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((m) => m.userId === targetId) || null;

  // Nothing to transfer to (you're the only member) → hide the section entirely.
  if (targets.length === 0) return null;

  const transfer = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${slug}/members/${target.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'owner' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error || `failed (${res.status})`); return; }
      // You're now a regular member — refresh so the owner-only controls drop away.
      router.refresh();
    } catch (e: any) {
      setError(e?.message || 'network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#e6e6e6' }}>Transfer ownership</div>
      <p style={{ margin: 0, fontSize: 12, color: '#a0a8b8', lineHeight: 1.5, maxWidth: 540 }}>
        Hand this team to another member. You&apos;ll step down to a regular member and lose
        owner controls (renaming, invites, transferring).
      </p>
      <ErrorNote>{error}</ErrorNote>

      {!confirming ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select
            size="sm"
            testId="transfer-target"
            value={targetId}
            onChange={setTargetId}
            placeholder="Choose a member…"
            options={targets.map((m) => [m.userId, (m.name || 'Unnamed') + (m.role === 'owner' ? ' (owner)' : '')] as const)}
            style={{ padding: '7px 10px', fontSize: 13, outline: 'none', minWidth: 200, maxWidth: 'none' }}
          />
          <button
            type="button"
            data-testid="transfer-open"
            disabled={!targetId}
            onClick={() => setConfirming(true)}
            style={{ ...btnDanger, opacity: targetId ? 1 : 0.5, cursor: targetId ? 'pointer' : 'not-allowed' }}
          >
            Transfer ownership
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: 'rgba(255,122,122,0.06)', border: '1px solid rgba(255,122,122,0.3)', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#ffd0d0' }}>
            Make {target?.name || 'this member'} the owner?
          </div>
          <div style={{ fontSize: 12, color: '#a0a8b8', lineHeight: 1.5 }}>
            You will <strong>no longer be an owner</strong> of this team. {target?.name || 'They'} will
            own it, and you&apos;ll become a regular member — you won&apos;t be able to rename the team,
            manage invites, or transfer ownership again unless an owner makes you one.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" data-testid="transfer-confirm" onClick={transfer} disabled={busy} style={btnDanger}>
              {busy ? 'Transferring…' : `Yes, transfer to ${target?.name || 'them'}`}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} style={btnGhost}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

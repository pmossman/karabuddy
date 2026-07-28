'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Panel } from '@/app/_components/Panel';
import { Select } from '@/app/_components/Select';
import { ErrorNote } from '@/app/_components/StatusUi';
import { btnGhost, btnDanger } from '@/app/_components/buttonStyles';

// Owner-only "Remove a member" control in team Settings (mirrors TransferOwnership).
// Pick a member, then confirm an explicit "are you sure?" — the DELETE drops only
// their membership row, so their access is revoked but anything they already
// shared with the team stays. You can't remove yourself (the API enforces it too),
// so the team always keeps at least one owner.
export function RemoveMember({
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

  // You're the only member → nothing to remove; hide the section entirely.
  if (targets.length === 0) return null;

  const remove = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${slug}/members/${target.userId}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) { setError(body.error || `failed (${res.status})`); return; }
      // Refresh so the roster + member count update and the removed person drops out.
      setConfirming(false);
      setTargetId('');
      router.refresh();
    } catch (e: any) {
      setError(e?.message || 'network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#e6e6e6' }}>Remove a member</div>
      <p style={{ margin: 0, fontSize: 12, color: '#a0a8b8', lineHeight: 1.5, maxWidth: 540 }}>
        Remove someone from this team. They immediately lose access to the team&apos;s replays,
        discussion, and stats. Anything they already shared with the team stays — you can re-invite
        them anytime.
      </p>
      <ErrorNote>{error}</ErrorNote>

      {!confirming ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select
            size="sm"
            testId="remove-member-target"
            value={targetId}
            onChange={setTargetId}
            placeholder="Choose a member…"
            options={targets.map((m) => [m.userId, (m.name || 'Unnamed') + (m.role === 'owner' ? ' (owner)' : '')] as const)}
            style={{ padding: '7px 10px', fontSize: 13, outline: 'none', minWidth: 200, maxWidth: 'none' }}
          />
          <button
            type="button"
            data-testid="remove-member-open"
            disabled={!targetId}
            onClick={() => setConfirming(true)}
            style={{ ...btnDanger, opacity: targetId ? 1 : 0.5, cursor: targetId ? 'pointer' : 'not-allowed' }}
          >
            Remove from team
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: 'rgba(255,122,122,0.06)', border: '1px solid rgba(255,122,122,0.3)', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#ffd0d0' }}>
            Remove {target?.name || 'this member'} from the team?
          </div>
          <div style={{ fontSize: 12, color: '#a0a8b8', lineHeight: 1.5 }}>
            {target?.name || 'They'} will <strong>immediately lose access</strong> to this team&apos;s
            replays, discussion, and stats{target?.role === 'owner' ? ', and their owner role' : ''}. This
            can&apos;t be undone from here, but you can re-invite them anytime.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" data-testid="remove-member-confirm" onClick={remove} disabled={busy} style={btnDanger}>
              {busy ? 'Removing…' : `Yes, remove ${target?.name || 'them'}`}
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

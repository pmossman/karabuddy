'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { copyToClipboard } from '@/lib/clipboard';
import { ErrorNote } from '@/app/_components/StatusUi';
import { useConfirm } from '@/app/_components/Confirm';
import { btnBase, btnGhost, btnDanger } from '@/app/_components/buttonStyles';

// B55a: owner + member controls for a team — generate invite, copy link,
// leave team, rename (owners). All inline on the team page header.
export function TeamControls({
  slug,
  teamName,
  viewerRole,
  memberCount,
}: {
  slug: string;
  teamName: string;
  viewerRole: string;
  memberCount: number;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(teamName);

  const isOwner = viewerRole === 'owner';

  const generateInvite = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${slug}/invites`, { method: 'POST' });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error || 'failed to create invite');
        return;
      }
      const url = `${window.location.origin}/teams/join?code=${encodeURIComponent(body.code)}`;
      setInviteUrl(url);
    } catch (err: any) {
      setError(err?.message || 'network error');
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    await copyToClipboard(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const leave = async () => {
    const opts = isOwner && memberCount === 1
      ? { title: 'Leave and delete this team?', message: 'Leaving as the only member effectively deletes this team — the data sticks around but is unreachable.', confirmLabel: 'Leave team', destructive: true }
      : { title: 'Leave this team?', message: 'You\'ll be removed from this team and need an invite link to rejoin.', confirmLabel: 'Leave team', destructive: true };
    if (!(await confirm(opts))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${slug}`, { method: 'DELETE' });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error || 'failed to leave');
        setBusy(false);
        return;
      }
      router.push('/teams');
    } catch (err: any) {
      setError(err?.message || 'network error');
      setBusy(false);
    }
  };

  const submitRename = async () => {
    const next = renameDraft.trim();
    if (!next || next === teamName) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error || 'rename failed');
        setBusy(false);
        return;
      }
      setRenaming(false);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {confirmDialog}
      <ErrorNote>{error}</ErrorNote>

      {renaming && isOwner ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            maxLength={80}
            autoFocus
            style={{
              flex: 1,
              background: '#11141a',
              color: '#e6e6e6',
              border: '1px solid #4d9dff',
              borderRadius: 4,
              padding: '6px 10px',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <button type="button" onClick={submitRename} disabled={busy} style={btnPrimary}>Save</button>
          <button type="button" onClick={() => { setRenameDraft(teamName); setRenaming(false); }} style={btnGhost}>Cancel</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isOwner && !inviteUrl && (
            <button type="button" onClick={generateInvite} disabled={busy} style={btnPrimary}>
              {busy ? 'Generating…' : 'Generate invite link'}
            </button>
          )}
          {isOwner && (
            <button type="button" onClick={() => setRenaming(true)} disabled={busy} style={btnGhost}>
              Rename team
            </button>
          )}
          <button type="button" onClick={leave} disabled={busy} style={btnDanger}>
            Leave team
          </button>
        </div>
      )}

      {inviteUrl && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, background: 'rgba(77, 157, 255, 0.08)', border: '1px solid rgba(77, 157, 255, 0.3)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: '#a7d2ff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Invite link
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={inviteUrl}
              readOnly
              style={{
                flex: 1,
                background: '#11141a',
                color: '#d6e7ff',
                border: '1px solid #2e333c',
                borderRadius: 4,
                padding: '6px 10px',
                fontSize: 12,
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                outline: 'none',
              }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" onClick={copyInvite} style={btnPrimary}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#6c7588' }}>
            Anyone with this link can join. The link doesn&apos;t expire.
          </div>
        </div>
      )}
    </div>
  );
}

const btnPrimary: React.CSSProperties = { ...btnBase, background: tokens.button.bg, color: tokens.color.accent, border: `1px solid ${tokens.color.primary}`, boxShadow: tokens.button.glow };

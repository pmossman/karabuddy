'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text — user copies manually.
    }
  };

  const leave = async () => {
    const confirmMsg = isOwner && memberCount === 1
      ? 'Leaving as the only member effectively deletes this team (the data sticks around but is unreachable). Continue?'
      : 'Leave this team?';
    if (!confirm(confirmMsg)) return;
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
      {error && (
        <div style={{ fontSize: 12, color: '#ff7a7a', padding: '6px 10px', background: 'rgba(255, 122, 122, 0.08)', borderRadius: 4 }}>
          {error}
        </div>
      )}

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
              border: '1px solid #4a7cff',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, background: 'rgba(74, 124, 255, 0.08)', border: '1px solid rgba(74, 124, 255, 0.3)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: '#a0c4ff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
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

const btnBase: React.CSSProperties = {
  border: 0,
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = { ...btnBase, background: '#4a7cff', color: 'white' };
const btnGhost: React.CSSProperties = { ...btnBase, background: 'transparent', color: '#a0a8b8', border: '1px solid #4a4e56' };
const btnDanger: React.CSSProperties = { ...btnBase, background: 'transparent', color: '#ff7a7a', border: '1px solid rgba(255, 122, 122, 0.4)' };

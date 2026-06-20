'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getCompanionInfo,
  extensionPresent,
  loadedTeamKeyIds,
  resolvePrivateReplayAccess,
  openKeyManager,
  type PrivateReplayAccess,
} from '@/lib/companion';

// B170 / ADR 0010 — a member's PERSONAL readiness for a private team, derived
// client-side from the same signals as the replay gate (is the extension here,
// is it new enough, is this team's key loaded). Two shapes:
//   - variant="banner"   — a prompt shown at the top of a private team's pages
//     ONLY when the member isn't ready (install / update / load key). Hidden
//     once ready, so it disappears the moment setup is done.
//   - variant="checklist" — an always-visible "✓ extension ✓ key loaded" status
//     block for the Settings privacy section, so a member can see what's left.
// The key never enters the page — we only ask the extension which kids are loaded.

type Access = PrivateReplayAccess | 'loading';

export function MyPrivateAccess({
  teamKeyId,
  teamName,
  variant,
}: {
  teamKeyId: string | null;
  teamName: string;
  variant: 'banner' | 'checklist';
}) {
  const [access, setAccess] = useState<Access>('loading');
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    const [info, present, loaded] = await Promise.all([
      getCompanionInfo(),
      extensionPresent(),
      loadedTeamKeyIds(),
    ]);
    setAccess(resolvePrivateReplayAccess({ encrypted: true, teamKeyId, companion: info, present, loadedKeyIds: loaded }));
    setBusy(false);
  };
  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamKeyId]);

  const extOk = access === 'ready' || access === 'needs-key';
  const keyOk = access === 'ready';

  // The single key-manager action, contextual to the state. (The banner only
  // shows the not-ready ones; the checklist also offers "Manage" when ready —
  // this is the panel's ONE key-manager button, so there's no duplicate.)
  const action =
    access === 'absent' ? { label: 'Install the extension', href: '/install' as const }
    : access === 'unsupported' ? { label: 'How to update', href: '/install' as const }
    : access === 'needs-key' ? { label: 'Open key manager', onClick: () => openKeyManager() }
    : access === 'ready' ? { label: '🔑 Manage this team’s key', onClick: () => openKeyManager() }
    : null;

  // ---- Banner: only when NOT ready (and not still loading / plaintext). ----
  if (variant === 'banner') {
    if (access === 'loading' || access === 'ready' || access === 'plaintext') return null;
    const msg =
      access === 'absent' ? `Install the KaraBuddy extension to view ${teamName}’s encrypted replays.`
      : access === 'unsupported' ? `Your KaraBuddy extension is too old to view ${teamName}’s encrypted replays — update it.`
      : `Load ${teamName}’s team key to view its replays. Ask a teammate for the key, then add it in the extension.`;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: 'rgba(255,176,32,0.08)', border: '1px solid rgba(255,176,32,0.4)', borderRadius: 10,
        padding: '12px 14px', margin: '0 0 18px',
      }}>
        <span aria-hidden style={{ fontSize: 18 }}>🔒</span>
        <span style={{ flex: '1 1 240px', fontSize: 13, color: '#ffd98a', lineHeight: 1.45 }}>
          {msg}{' '}
          <Link href="/how-privacy-mode-works#for-members" style={{ color: '#5db4ff', textDecoration: 'none', whiteSpace: 'nowrap' }}>How it works →</Link>
        </span>
        {action && (action.href
          ? <Link href={action.href} style={pillPrimary}>{action.label}</Link>
          : <button onClick={action.onClick} style={pillPrimary as React.CSSProperties}>{action.label}</button>)}
        <button onClick={check} disabled={busy} style={pillGhost}>{busy ? 'Checking…' : 'Re-check'}</button>
      </div>
    );
  }

  // ---- Checklist: always-on status for the Settings privacy section. ----
  const Row = ({ ok, pending, label }: { ok: boolean; pending?: boolean; label: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: ok ? '#cdd5e0' : '#a0a8b8' }}>
      <span aria-hidden style={{ fontSize: 13, color: pending ? '#6c7588' : ok ? '#6fe3a3' : '#ffb020' }}>
        {pending ? '…' : ok ? '✓' : '○'}
      </span>
      {label}
    </div>
  );
  const loading = access === 'loading';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row ok={extOk} pending={loading} label={extOk ? 'KaraBuddy extension ready' : access === 'unsupported' ? 'Extension needs updating' : 'Extension not detected'} />
        <Row ok={keyOk} pending={loading || !extOk} label={keyOk ? `${teamName}’s key loaded on this device` : 'Team key not loaded'} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
        {action && (action.href
          ? <Link href={action.href} style={pillPrimary}>{action.label}</Link>
          : <button onClick={action.onClick} style={pillPrimary as React.CSSProperties}>{action.label}</button>)}
        <button onClick={check} disabled={busy} style={pillGhost}>{busy ? 'Checking…' : access === 'ready' ? 'Re-check' : 'Re-check'}</button>
      </div>
    </div>
  );
}

const pillBase: React.CSSProperties = {
  display: 'inline-block', cursor: 'pointer', padding: '7px 13px', fontSize: 12.5, fontWeight: 600,
  borderRadius: 6, fontFamily: 'inherit', textDecoration: 'none', flex: '0 0 auto',
};
const pillPrimary: React.CSSProperties = { ...pillBase, border: '1px solid rgba(77,210,255,0.55)', background: 'rgba(77,210,255,0.12)', color: '#9fe6ff' };
const pillGhost: React.CSSProperties = { ...pillBase, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: '#c2c9d6' };

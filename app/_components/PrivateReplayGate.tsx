'use client';

import { useState } from 'react';
import type { PrivateReplayAccess } from '@/lib/companion';

// B170 / ADR 0010: the tiered gate shown when a private (E2EE) replay can't be
// rendered yet. Each non-ready tier maps to ONE clear next action — install the
// extension, update it, or load the team key — plus a re-check that re-runs the
// capability/key handshake (so the user doesn't have to reload after acting).
//
// `compact` is the inline form for list/dashboard cards; default is the full
// centered panel for the viewer.

const COPY: Record<Exclude<PrivateReplayAccess, 'plaintext' | 'ready'>, { icon: string; title: string; body: (team?: string | null) => string; cta?: { label: string; href: string } }> = {
  absent: {
    icon: '🔒',
    title: 'Private replay',
    body: () => 'This replay is end-to-end encrypted for a private team. Install the KaraBuddy extension to view it — decryption happens in your browser; the server never sees the contents.',
    cta: { label: 'Install the extension', href: '/install' },
  },
  unsupported: {
    icon: '⬆️',
    title: 'Update needed',
    body: () => 'Your KaraBuddy extension is too old to open private replays. Update it, then re-check.',
    cta: { label: 'How to update', href: '/install' },
  },
  'needs-key': {
    icon: '🔑',
    title: 'Load your team key',
    body: (team) => `This replay is encrypted for ${team || 'your team'}. Open your KaraBuddy key manager, add your team key, then re-check. The key stays on your device — it’s never sent to karabuddy.`,
  },
};

export function PrivateReplayGate({
  tier,
  teamName,
  onRecheck,
  onOpenKeyManager,
  compact = false,
}: {
  tier: Exclude<PrivateReplayAccess, 'plaintext' | 'ready'>;
  teamName?: string | null;
  onRecheck?: () => void | Promise<void>;
  // B170: on the needs-key tier, opens the extension's trusted key page (via the
  // bridge → SW) so the user doesn't have to find the toolbar icon.
  onOpenKeyManager?: () => void | Promise<void>;
  compact?: boolean;
}) {
  const [rechecking, setRechecking] = useState(false);
  const copy = COPY[tier];

  const recheck = async () => {
    if (!onRecheck) return;
    setRechecking(true);
    try { await onRecheck(); } finally { setRechecking(false); }
  };

  const btn = (children: React.ReactNode, onClick: (() => void) | undefined, primary: boolean) => (
    <button
      onClick={onClick}
      disabled={rechecking && !primary}
      style={{
        cursor: 'pointer',
        padding: compact ? '5px 10px' : '8px 14px',
        fontSize: compact ? 12 : 13,
        fontWeight: 600,
        borderRadius: 6,
        border: primary ? '1px solid rgba(77,210,255,0.6)' : '1px solid rgba(255,255,255,0.18)',
        background: primary ? 'rgba(77,210,255,0.12)' : 'transparent',
        color: primary ? '#9fe6ff' : '#c2c9d6',
      }}
    >
      {children}
    </button>
  );

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: compact ? 'flex-start' : 'center',
        justifyContent: 'center',
        gap: compact ? 6 : 12,
        textAlign: compact ? 'left' : 'center',
        padding: compact ? 12 : 32,
        maxWidth: compact ? undefined : 460,
        margin: compact ? undefined : '0 auto',
        color: '#c2c9d6',
      }}
    >
      <div style={{ fontSize: compact ? 22 : 40, lineHeight: 1 }}>{copy.icon}</div>
      <div style={{ fontSize: compact ? 14 : 18, fontWeight: 700, color: '#e6ebf2' }}>{copy.title}</div>
      <div style={{ fontSize: compact ? 12 : 14, lineHeight: 1.5, color: '#9aa3b2' }}>{copy.body(teamName)}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: compact ? 'flex-start' : 'center', marginTop: 4 }}>
        {/* needs-key → a button that opens the extension's key page (primary). */}
        {tier === 'needs-key' && onOpenKeyManager && btn('Open key manager', () => onOpenKeyManager(), true)}
        {copy.cta && btn(copy.cta.label, () => { window.location.href = copy.cta!.href; }, true)}
        {onRecheck && btn(rechecking ? 'Checking…' : 'Re-check', recheck, !(copy.cta || (tier === 'needs-key' && onOpenKeyManager)))}
      </div>
      <a
        href="/how-privacy-mode-works#for-members"
        style={{ fontSize: compact ? 11 : 12.5, color: '#5db4ff', textDecoration: 'none', marginTop: compact ? 2 : 4 }}
      >
        How private mode works →
      </a>
    </div>
  );
}

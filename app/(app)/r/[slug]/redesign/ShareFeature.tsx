'use client';

import { useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ShareWithTeam } from '../ShareWithTeam';

// B216 redesign — the Share sidebar view: copy the replay link, and (owner only)
// the team-share / public-visibility controls, reusing the existing ShareWithTeam.
export function ShareFeature({ replaySlug, installToken, isOwner }: { replaySlug: string; installToken: string; isOwner: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/r/${replaySlug}`); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px 28px', color: tokens.color.text }}>
      <button type="button" onClick={copy}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '11px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 800, color: '#eaf9ff', background: 'rgba(77,210,255,0.14)', border: `1px solid ${tokens.led.on}` }}>
        {copied ? '✓ Link copied' : 'Copy replay link'}
      </button>
      {isOwner ? (
        // The glass variant renders its own "Share with team" / "Private teams" /
        // "Public" section headers — no outer "Sharing" label needed.
        <ShareWithTeam replaySlug={replaySlug} installToken={installToken} variant="glass" />
      ) : (
        <div style={{ fontSize: 12.5, color: tokens.color.textMuted, lineHeight: 1.5 }}>Only the replay’s owner can change who it’s shared with.</div>
      )}
    </div>
  );
}

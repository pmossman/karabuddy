'use client';

import { useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ShareWithTeam } from '../ShareWithTeam';
import { useShareMoment } from '../MatchupInfo';

// B216 redesign — the Share sidebar view: copy the replay link (or a link to the
// CURRENT moment, which unfurls into that board state — B113), and (owner only)
// the team-share / public-visibility controls, reusing the existing ShareWithTeam.
export function ShareFeature({ replaySlug, installToken, isOwner, currentIndex, toOriginalFrame, onArmedTeamsChange }: {
  replaySlug: string;
  installToken: string;
  isOwner: boolean;
  currentIndex: number;
  toOriginalFrame: (i: number) => number;
  // Reports the LIVE shared set upward so the composer's scope pills track
  // same-session share changes (B168) instead of the page-load snapshot.
  onArmedTeamsChange?: (teams: { slug: string; name: string }[]) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/r/${replaySlug}`); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ }
  };
  const moment = useShareMoment(replaySlug, currentIndex, toOriginalFrame);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 16px 28px', color: tokens.color.text }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={copy} style={copyBtn(true)}>
          {copied ? '✓ Link copied' : 'Copy replay link'}
        </button>
        <button type="button" onClick={moment.share} style={copyBtn(false)} title="Link opens the replay at the frame you're viewing">
          {moment.copied ? '✓ Link copied' : `Copy link to this moment (frame ${currentIndex + 1})`}
        </button>
      </div>
      {isOwner ? (
        // The glass variant renders its own "Share with team" / "Private teams" /
        // "Public" section headers — no outer "Sharing" label needed.
        <ShareWithTeam replaySlug={replaySlug} installToken={installToken} variant="glass" onArmedTeamsChange={onArmedTeamsChange} />
      ) : (
        <div style={{ fontSize: 12.5, color: tokens.color.textMuted, lineHeight: 1.5 }}>Only the replay’s owner can change who it’s shared with.</div>
      )}
    </div>
  );
}

// Primary (replay link) vs secondary (moment link) copy button.
const copyBtn = (primary: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '11px',
  borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: primary ? 800 : 700,
  color: primary ? '#eaf9ff' : tokens.color.textSecondary,
  background: primary ? 'rgba(77,210,255,0.14)' : 'rgba(255,255,255,0.04)',
  border: `1px solid ${primary ? tokens.led.on : tokens.color.border}`,
});

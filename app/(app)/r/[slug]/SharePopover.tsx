'use client';

import { useState } from 'react';
import { ResponsiveMenu } from '@/app/_components/ResponsiveMenu';
import { ShareWithTeam } from './ShareWithTeam';

// The ONE share menu for a replay — a share-icon trigger opening a responsive
// menu (anchored popover on desktop, bottom sheet on mobile via ResponsiveMenu).
// Used by both the desktop sidebar header AND the mobile matchup panel, so a
// share feature added here lands on both (no more desktop-vs-mobile drift).
//
// `shareMoment` is optional — the current-frame "share this moment" flow lives in
// the viewer (token mint), so the desktop sidebar passes it; surfaces without a
// live frame context simply omit it.
export function SharePopover({
  replaySlug, installToken, isOwner, asSheet, onArmedTeamsChange, shareMoment,
}: {
  replaySlug: string;
  installToken: string;
  isOwner: boolean;
  asSheet: boolean;
  onArmedTeamsChange?: (teams: { slug: string; name: string }[]) => void;
  shareMoment?: { copied: boolean; onClick: () => void };
}) {
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/r/${replaySlug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — no-op */ }
  };

  return (
    <ResponsiveMenu
      asSheet={asSheet}
      title="Share"
      align="right"
      panelWidth={264}
      trigger={(open, toggle) => (
        // B197: a labeled "Share" button (icon + text) rather than a bare icon —
        // far easier to find. Compact enough for both the desktop sidebar header
        // slot and the mobile panel header.
        <button type="button" onClick={toggle} aria-label="Share replay" aria-expanded={open} title="Share"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            height: 32, padding: '0 12px', borderRadius: 7, cursor: 'pointer', flex: '0 0 auto',
            fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap',
            background: open ? 'rgba(77, 157, 255, 0.22)' : 'rgba(77, 157, 255, 0.1)',
            border: `1px solid ${open ? 'rgba(77,157,255,0.6)' : 'rgba(77,157,255,0.35)'}`,
            color: open ? '#a7d2ff' : '#cfe4ff',
          }}>
          <ShareIcon /> Share
        </button>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: asSheet ? undefined : 220 }}>
        {!asSheet && <div style={sectionLabel}>Share</div>}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <ShareBtn onClick={copyLink}>{copied ? '✓ Copied' : 'Copy link'}</ShareBtn>
          {shareMoment && <ShareBtn onClick={shareMoment.onClick}>{shareMoment.copied ? '✓ Copied' : 'Share this moment'}</ShareBtn>}
        </div>
        <div style={hintStyle}>
          Anyone with the link can view.{shareMoment ? ' “Share this moment” links to the current frame — it unfurls into the board.' : ''}{isOwner ? ' Share with a team below to surface it in their replays.' : ''}
        </div>
        {isOwner && (
          <div style={{ borderTop: '1px solid #2e333c', paddingTop: 8 }}>
            <ShareWithTeam replaySlug={replaySlug} installToken={installToken} onArmedTeamsChange={onArmedTeamsChange} />
          </div>
        )}
      </div>
    </ResponsiveMenu>
  );
}

function ShareBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ background: 'rgba(77,157,255,0.14)', border: '1px solid rgba(77,157,255,0.4)', color: '#cfe4ff', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
      {children}
    </button>
  );
}

const sectionLabel: React.CSSProperties = { fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' };
const hintStyle: React.CSSProperties = { fontSize: 11, color: '#6c7588', fontStyle: 'italic', lineHeight: 1.4 };

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
    </svg>
  );
}

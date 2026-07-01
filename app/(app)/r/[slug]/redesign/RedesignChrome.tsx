'use client';

import { useEffect, useState, type ReactNode, type ComponentProps } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { FeaturePanel } from './FeaturePanel';
import { TagsFeature, type ViewerTag } from './TagsFeature';
import { GameLogFeature } from './GameLogFeature';
import { MatchupFeature } from './MatchupFeature';
import { DecksFeature } from './DecksFeature';
import { TagHud } from './TagHud';

// B216 redesign — the unified viewer chrome (gated behind ?redesign=1). Replaces
// the old TagSidebar (desktop drawer) + mobile sheet system with ONE model:
// a bubble RAIL (each feature = one icon) + a FeaturePanel that docks on desktop
// / goes full-screen on mobile. Same components, screen-tailored. Stage 1 wires
// the Tags feature fully; the other bubbles are placeholders for the same rail.

type FeatureId = 'tags' | 'log' | 'info' | 'decks';
interface FeatureDef { id: FeatureId; label: string; icon: string; soon?: boolean }
const FEATURES: FeatureDef[] = [
  { id: 'tags', label: 'Tags', icon: '🏷' },
  { id: 'log', label: 'Game log', icon: '📜' },
  { id: 'info', label: 'Matchup', icon: '⚔' },
  { id: 'decks', label: 'Decks', icon: '🃏' },
];

export function RedesignChrome({ mode, tags, currentIndex, onJump, replaySlug, toOriginalFrame, appendTag, messagesByFrame, matchup, decks, onTagModeChange, onDockWidthChange, canTag }: {
  mode: 'desktop' | 'mobile';
  tags: ViewerTag[];
  currentIndex: number;
  onJump: (frame: number) => void;
  replaySlug: string;
  toOriginalFrame: (i: number) => number;
  appendTag: (t: ViewerTag) => void;
  messagesByFrame: any[][] | null;
  matchup: ComponentProps<typeof MatchupFeature>;
  decks: ComponentProps<typeof DecksFeature>;
  onTagModeChange?: (active: boolean) => void;
  // Reports the desktop docked-panel width (0 when closed) so the board can
  // position its chevrons/playback against the redesign panel, not the old one.
  onDockWidthChange?: (w: number) => void;
  // false for an anonymized viewer (not owner/teammate/shared) — gates compose.
  canTag: boolean;
}) {
  // Desktop opens Tags by default (parity with today's docked drawer); mobile
  // starts on the board (tap a bubble to open).
  const [open, setOpen] = useState<FeatureId | null>(null);
  // Mobile Tags: the glassy HUD floats over the board; `tagsFeed` opens the
  // full-page feed (all tags). Desktop shows the feed in the docked sidebar.
  const [tagsFeed, setTagsFeed] = useState(false);
  useEffect(() => { setOpen(mode === 'desktop' ? 'tags' : null); }, [mode]);
  useEffect(() => { if (open !== 'tags') setTagsFeed(false); }, [open]);

  const active = FEATURES.find((f) => f.id === open) || null;
  const usable = !!active && !active.soon;
  const tagsOpen = open === 'tags';
  // The glassy Tag HUD floats over the board whenever Tags is open (both sizes) —
  // except when the mobile full-page feed has taken over.
  const showHud = tagsOpen && !(mode === 'mobile' && tagsFeed);
  const desktopOpen = mode === 'desktop' && usable; // docked panel present (feed or feature)
  // Full-screen mobile overlay: a non-Tags feature, or the Tags full-page feed.
  const mobileFullScreen = mode === 'mobile' && ((usable && !tagsOpen) || (tagsOpen && tagsFeed));
  // Tags open → the HUD/feed owns tag-to-tag nav, so hide the board's tag-jump.
  useEffect(() => { onTagModeChange?.(tagsOpen); }, [tagsOpen, onTagModeChange]);
  useEffect(() => { onDockWidthChange?.(desktopOpen ? 380 : 0); }, [desktopOpen, onDockWidthChange]);
  // The Tags icon summarises tags on the CURRENT frame (its minimised form).
  const tagCountHere = tags.filter((t) => !t.parentTagId && t.frameIndex === currentIndex).length;

  const renderBody = (id: FeatureId): ReactNode => {
    if (id === 'tags') return <TagsFeature tags={tags} currentIndex={currentIndex} onJump={onJump} replaySlug={replaySlug} toOriginalFrame={toOriginalFrame} appendTag={appendTag} canTag={canTag} />;
    if (id === 'log') return <GameLogFeature messagesByFrame={messagesByFrame} currentIndex={currentIndex} />;
    if (id === 'info') return <MatchupFeature {...matchup} />;
    if (id === 'decks') return <DecksFeature {...decks} />;
    return <ComingSoon label={FEATURES.find((f) => f.id === id)?.label ?? ''} />;
  };

  // Desktop: rail sits just left of the docked panel (or at the edge when closed).
  const railRight = desktopOpen ? 380 + 14 : 14;

  const tagsFeatureFeed = (onJumpDone?: () => void) => (
    <TagsFeature tags={tags} currentIndex={currentIndex} onJump={(f) => { onJump(f); onJumpDone?.(); }} replaySlug={replaySlug} toOriginalFrame={toOriginalFrame} appendTag={appendTag} canTag={canTag} />
  );

  return (
    <>
      {/* Glassy Tag HUD over the CENTRE of the board (both sizes) when Tags is
          open — the primary current-frame surface. Board reads through it. */}
      {showHud && (
        <TagHud
          tags={tags} currentIndex={currentIndex} onJump={onJump}
          replaySlug={replaySlug} toOriginalFrame={toOriginalFrame} appendTag={appendTag} canTag={canTag}
          sidebarW={mode === 'desktop' ? 380 : 0}
          onOpenFeed={mode === 'mobile' ? () => setTagsFeed(true) : undefined}
        />
      )}

      {/* Docked desktop panel: the Tags FEED (all tags) or a non-Tags feature. */}
      {desktopOpen && (
        <FeaturePanel open mode="desktop" title={tagsOpen ? 'Tags' : (active?.label ?? '')} icon={active?.icon} onClose={() => setOpen(null)}>
          {tagsOpen ? tagsFeatureFeed() : (active && renderBody(active.id))}
        </FeaturePanel>
      )}

      {/* Mobile full-page overlay: the Tags feed, or a non-Tags feature. */}
      {mobileFullScreen && (tagsOpen ? (
        <FeaturePanel open mode="mobile" title="All tags" icon={active?.icon} onClose={() => setTagsFeed(false)}>
          {tagsFeatureFeed(() => setTagsFeed(false))}
        </FeaturePanel>
      ) : (
        <FeaturePanel open mode="mobile" title={active?.label ?? ''} icon={active?.icon} onClose={() => setOpen(null)}>
          {active && renderBody(active.id)}
        </FeaturePanel>
      ))}

      {/* The bubble rail — one icon per feature. Hidden only when a full-screen
          mobile overlay owns the view (the board-visible HUD keeps it). */}
      {!mobileFullScreen && (
        <div style={{ position: 'fixed', top: 'max(14px, env(safe-area-inset-top, 14px))', right: railRight, zIndex: 120, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FEATURES.map((f) => {
            const isOpen = open === f.id && !f.soon;
            // The Tags icon is the minimised tag panel — it summarises how many
            // tags sit on the CURRENT frame (updates as you scrub).
            const badge = f.id === 'tags' && tagCountHere > 0 ? tagCountHere : null;
            return (
              <button key={f.id} type="button" title={f.soon ? `${f.label} — coming soon` : f.label} aria-label={f.label}
                disabled={f.soon}
                onClick={() => { if (!f.soon) setOpen((cur) => (cur === f.id ? null : f.id)); }}
                style={{
                  position: 'relative',
                  width: 46, height: 46, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                  cursor: f.soon ? 'default' : 'pointer', fontFamily: 'inherit',
                  background: isOpen ? 'rgba(77,210,255,0.22)' : 'rgba(17,20,26,0.85)',
                  border: `1px solid ${isOpen ? tokens.led.on : tokens.color.borderStrong}`,
                  boxShadow: isOpen ? tokens.led.ringGlow : '0 2px 8px rgba(0,0,0,0.4)',
                  opacity: f.soon ? 0.38 : 1,
                  backdropFilter: 'blur(4px)',
                }}>
                <span aria-hidden>{f.icon}</span>
                {badge != null && (
                  <span aria-hidden style={{ position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: tokens.led.on, color: '#06121a', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{badge}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function ComingSoon({ label }: { label: string }) {
  return <div style={{ padding: '28px 18px', textAlign: 'center', color: tokens.color.textMuted, fontSize: 13 }}>{label} moves onto this rail next.</div>;
}

'use client';

import { useEffect, useState, type ReactNode, type ComponentProps } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { FeaturePanel } from './FeaturePanel';
import { TagsFeature, type ViewerTag } from './TagsFeature';
import { GameLogFeature } from './GameLogFeature';
import { MatchupFeature } from './MatchupFeature';

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
  { id: 'decks', label: 'Decks', icon: '🃏', soon: true },
];

export function RedesignChrome({ mode, tags, currentIndex, onJump, replaySlug, toOriginalFrame, appendTag, messagesByFrame, matchup }: {
  mode: 'desktop' | 'mobile';
  tags: ViewerTag[];
  currentIndex: number;
  onJump: (frame: number) => void;
  replaySlug: string;
  toOriginalFrame: (i: number) => number;
  appendTag: (t: ViewerTag) => void;
  messagesByFrame: any[][] | null;
  matchup: ComponentProps<typeof MatchupFeature>;
}) {
  // Desktop opens Tags by default (parity with today's docked drawer); mobile
  // starts on the board (tap a bubble to open).
  const [open, setOpen] = useState<FeatureId | null>(null);
  useEffect(() => { setOpen(mode === 'desktop' ? 'tags' : null); }, [mode]);

  const active = FEATURES.find((f) => f.id === open) || null;
  const panelOpen = !!active && !active.soon;

  const renderBody = (id: FeatureId): ReactNode => {
    if (id === 'tags') return <TagsFeature tags={tags} currentIndex={currentIndex} onJump={onJump} replaySlug={replaySlug} toOriginalFrame={toOriginalFrame} appendTag={appendTag} />;
    if (id === 'log') return <GameLogFeature messagesByFrame={messagesByFrame} currentIndex={currentIndex} />;
    if (id === 'info') return <MatchupFeature {...matchup} />;
    return <ComingSoon label={FEATURES.find((f) => f.id === id)?.label ?? ''} />;
  };

  // Desktop: rail sits just left of the docked panel (or at the edge when closed).
  const railRight = mode === 'desktop' && panelOpen ? 380 + 14 : 14;

  return (
    <>
      {/* Docked panel (desktop) — a flex child of the board row. */}
      {mode === 'desktop' && (
        <FeaturePanel open={panelOpen} mode="desktop" title={active?.label ?? ''} icon={active?.icon} onClose={() => setOpen(null)}>
          {active && renderBody(active.id)}
        </FeaturePanel>
      )}

      {/* Full-screen panel (mobile) — fixed overlay above the board. */}
      {mode === 'mobile' && (
        <FeaturePanel open={panelOpen} mode="mobile" title={active?.label ?? ''} icon={active?.icon} onClose={() => setOpen(null)}>
          {active && renderBody(active.id)}
        </FeaturePanel>
      )}

      {/* The bubble rail — one icon per feature, consistent on both sizes. Hidden
          on mobile while a full-screen feature is open (the overlay owns the view). */}
      {!(mode === 'mobile' && panelOpen) && (
        <div style={{ position: 'fixed', top: 'max(14px, env(safe-area-inset-top, 14px))', right: railRight, zIndex: 120, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FEATURES.map((f) => {
            const isOpen = open === f.id && !f.soon;
            return (
              <button key={f.id} type="button" title={f.soon ? `${f.label} — coming soon` : f.label} aria-label={f.label}
                disabled={f.soon}
                onClick={() => { if (!f.soon) setOpen((cur) => (cur === f.id ? null : f.id)); }}
                style={{
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

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
interface FeatureDef { id: FeatureId; label: string; icon: ReactNode; soon?: boolean }
// Minimal line icons (glassy/iOS feel) instead of skeuomorphic emoji.
const S = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const FEATURES: FeatureDef[] = [
  { id: 'tags', label: 'Tags', icon: (<svg {...S}><path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" /></svg>) },
  { id: 'log', label: 'Game log', icon: (<svg {...S}><line x1="8" y1="7" x2="20" y2="7" /><line x1="8" y1="12" x2="20" y2="12" /><line x1="8" y1="17" x2="15" y2="17" /><circle cx="4.5" cy="7" r="0.6" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="0.6" fill="currentColor" stroke="none" /><circle cx="4.5" cy="17" r="0.6" fill="currentColor" stroke="none" /></svg>) },
  { id: 'info', label: 'Matchup', icon: (<svg {...S}><polyline points="10 6 5 12 10 18" /><polyline points="14 6 19 12 14 18" /></svg>) },
  { id: 'decks', label: 'Decks', icon: (<svg {...S}><rect x="3" y="7" width="12" height="14" rx="2" /><rect x="9" y="3" width="12" height="14" rx="2" /></svg>) },
];

export function RedesignChrome({ mode, tags, currentIndex, onJump, replaySlug, toOriginalFrame, appendTag, updateTag, messagesByFrame, matchup, decks, onTagModeChange, onDockWidthChange, canTag }: {
  mode: 'desktop' | 'mobile';
  tags: ViewerTag[];
  currentIndex: number;
  onJump: (frame: number) => void;
  replaySlug: string;
  toOriginalFrame: (i: number) => number;
  appendTag: (t: ViewerTag) => void;
  updateTag: (id: string, patch: Partial<ViewerTag>) => void;
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
  // Two INDEPENDENT surfaces, shared by desktop + mobile (B216):
  //  • the Tag HUD — a glassy overlay over the board, the PRIMARY tag surface,
  //    toggled by the Tags rail icon. Fully usable with the panel collapsed.
  //  • the panel — a docked sidebar (desktop) / full-page overlay (mobile) that
  //    shows ONE view (tags feed / log / matchup / decks), toggled by its rail
  //    icon (the feed also opens from the HUD's ≣).
  // Decoupled: the HUD stays open across panel view changes, and the feed can be
  // open without the HUD (until you click an entry, which opens it).
  const [hudOpen, setHudOpen] = useState(false);
  const [panelView, setPanelView] = useState<FeatureId | null>(null);
  useEffect(() => { setHudOpen(mode === 'desktop'); setPanelView(null); }, [mode]);

  const panelDef = FEATURES.find((f) => f.id === panelView) || null;
  const panelUsable = !!panelDef && !panelDef.soon;
  const desktopDock = mode === 'desktop' && panelUsable;      // docked sidebar present
  const mobileFullScreen = mode === 'mobile' && panelUsable;  // full-page panel present
  const showHud = hudOpen && !mobileFullScreen;               // a mobile panel takes over the HUD
  // The HUD owns tag-to-tag nav → hide the board's tag-jump while it's open.
  useEffect(() => { onTagModeChange?.(hudOpen); }, [hudOpen, onTagModeChange]);
  useEffect(() => { onDockWidthChange?.(desktopDock ? 380 : 0); }, [desktopDock, onDockWidthChange]);
  const tagCountHere = tags.filter((t) => !t.parentTagId && t.frameIndex === currentIndex).length;

  // Click a feed entry → jump there AND open the HUD (on mobile, close the
  // full-page feed so the board + HUD show; desktop keeps the sidebar).
  const openTagFromFeed = (f: number) => { onJump(f); setHudOpen(true); if (mode === 'mobile') setPanelView(null); };
  const renderPanel = (id: FeatureId): ReactNode => {
    if (id === 'tags') return <TagsFeature tags={tags} currentIndex={currentIndex} onJump={openTagFromFeed} />;
    if (id === 'log') return <GameLogFeature messagesByFrame={messagesByFrame} currentIndex={currentIndex} />;
    if (id === 'info') return <MatchupFeature {...matchup} />;
    if (id === 'decks') return <DecksFeature {...decks} />;
    return <ComingSoon label={FEATURES.find((f) => f.id === id)?.label ?? ''} />;
  };

  // Desktop: rail sits just left of the docked panel (or at the edge when closed).
  const railRight = desktopDock ? 380 + 14 : 14;

  return (
    <>
      {/* Glassy Tag HUD over the board — independent of the panel/sidebar. Its ≣
          opens the feed (docked on desktop, full-page on mobile). */}
      {showHud && (
        <TagHud
          tags={tags} currentIndex={currentIndex} onJump={onJump}
          replaySlug={replaySlug} toOriginalFrame={toOriginalFrame} appendTag={appendTag} updateTag={updateTag} canTag={canTag}
          sidebarW={desktopDock ? 380 : 0}
          onOpenFeed={() => setPanelView('tags')}
        />
      )}

      {/* Docked desktop panel — any view, independent of the HUD. */}
      {desktopDock && panelView && (
        <FeaturePanel open mode="desktop" title={panelDef?.label ?? ''} icon={panelDef?.icon} onClose={() => setPanelView(null)}>
          {renderPanel(panelView)}
        </FeaturePanel>
      )}

      {/* Mobile full-page panel — any view. */}
      {mobileFullScreen && panelView && (
        <FeaturePanel open mode="mobile" title={panelView === 'tags' ? 'All tags' : (panelDef?.label ?? '')} icon={panelDef?.icon} onClose={() => setPanelView(null)}>
          {renderPanel(panelView)}
        </FeaturePanel>
      )}

      {/* The bubble rail — one icon per feature. Hidden only when a full-screen
          mobile overlay owns the view (the board-visible HUD keeps it). */}
      {!mobileFullScreen && (
        <div style={{ position: 'fixed', top: 'max(14px, env(safe-area-inset-top, 14px))', right: railRight, zIndex: 120, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FEATURES.map((f) => {
            // Tags toggles the HUD overlay; every other icon toggles its panel view.
            const isOpen = f.id === 'tags' ? hudOpen : (panelView === f.id && !f.soon);
            // The Tags icon summarises how many tags sit on the CURRENT frame.
            const badge = f.id === 'tags' && tagCountHere > 0 ? tagCountHere : null;
            return (
              <button key={f.id} type="button" title={f.soon ? `${f.label} — coming soon` : f.label} aria-label={f.label}
                disabled={f.soon}
                onClick={() => { if (f.soon) return; if (f.id === 'tags') setHudOpen((v) => !v); else setPanelView((cur) => (cur === f.id ? null : f.id)); }}
                style={{
                  position: 'relative',
                  width: 44, height: 44, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: f.soon ? 'default' : 'pointer', fontFamily: 'inherit',
                  // Frosted glass — translucent + blur, cyan when active.
                  background: isOpen ? 'rgba(77,210,255,0.22)' : 'rgba(255,255,255,0.07)',
                  color: isOpen ? tokens.led.on : 'rgba(255,255,255,0.82)',
                  border: `1px solid ${isOpen ? tokens.led.on : 'rgba(255,255,255,0.16)'}`,
                  boxShadow: isOpen ? tokens.led.ringGlow : '0 2px 10px rgba(0,0,0,0.35)',
                  opacity: f.soon ? 0.38 : 1,
                  backdropFilter: 'blur(16px) saturate(1.4)',
                  WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
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

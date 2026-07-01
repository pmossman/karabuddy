'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode, type ComponentProps } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { type Chapter } from '@/lib/replayChapters';
import { FeaturePanel } from './FeaturePanel';
import { TagsFeature, type ViewerTag } from './TagsFeature';
import { GameLogFeature } from './GameLogFeature';
import { MatchupFeature } from './MatchupFeature';
import { DecksFeature } from './DecksFeature';
import { PlaybackFeature, type PlaybackControls } from './PlaybackFeature';
import { ShareFeature } from './ShareFeature';
import { ClipsFeature } from './ClipsFeature';
import { TagHud } from './TagHud';
import { Icon } from './icons';
import { type ClipSummary } from '../ClipsList';

// B216 redesign — the unified viewer chrome (gated behind ?redesign=1).
// Conceptual split (Parker): the RAIL = current-frame actions (tags · play/pause ·
// jump-to · clip · sidebar toggle); the SIDEBAR = whole-replay views behind a view
// selector (tag feed · game log · matchup · decks · playback · share · clips).
// Sidebar = a resizable dock on desktop, a slide-out drawer on mobile. The Tag HUD
// is an independent overlay. Same model drives both screen sizes.

export interface ViewerControls extends PlaybackControls {
  chapters: Chapter[];
  onOpenClip: () => void;
  clips: ClipSummary[];
  installToken: string;
  isOwner: boolean;
}

type SidebarView = 'tags' | 'log' | 'info' | 'decks' | 'playback' | 'share' | 'clips';
const VIEWS: { id: SidebarView; label: string; icon: ReactNode }[] = [
  { id: 'tags', label: 'Tags', icon: Icon.tag },
  { id: 'log', label: 'Log', icon: Icon.log },
  { id: 'info', label: 'Matchup', icon: Icon.matchup },
  { id: 'decks', label: 'Decks', icon: Icon.decks },
  { id: 'playback', label: 'Playback', icon: Icon.play },
  { id: 'share', label: 'Share', icon: Icon.share },
  { id: 'clips', label: 'Clips', icon: Icon.clips },
];
const CHAPTER_COLOR: Record<string, string> = { start: '#8aa0b8', round: '#5db4ff', leader: '#e0c64a', tag: '#4dd2ff', end: '#8aa0b8' };

export function RedesignChrome({ mode, tags, currentIndex, onJump, replaySlug, toOriginalFrame, appendTag, updateTag, messagesByFrame, matchup, decks, controls, onTagModeChange, onDockWidthChange, canTag }: {
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
  controls: ViewerControls;
  onTagModeChange?: (active: boolean) => void;
  onDockWidthChange?: (w: number) => void;
  canTag: boolean;
}) {
  const [hudOpen, setHudOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarView, setSidebarView] = useState<SidebarView>('tags');
  const [sidebarW, setSidebarW] = useState(380);
  const [jumpOpen, setJumpOpen] = useState(false);
  useEffect(() => { setHudOpen(mode === 'desktop'); setSidebarOpen(false); setJumpOpen(false); }, [mode]);

  const desktopDock = mode === 'desktop' && sidebarOpen;
  const mobileDrawer = mode === 'mobile' && sidebarOpen;
  const showHud = hudOpen && !mobileDrawer; // the mobile drawer covers the HUD
  useEffect(() => { onTagModeChange?.(hudOpen); }, [hudOpen, onTagModeChange]);
  useEffect(() => { onDockWidthChange?.(desktopDock ? sidebarW : 0); }, [desktopDock, sidebarW, onDockWidthChange]);
  const tagCountHere = tags.filter((t) => !t.parentTagId && t.frameIndex === currentIndex).length;

  const openSidebar = (v: SidebarView) => { setSidebarView(v); setSidebarOpen(true); };
  // Click a feed entry → jump + open the HUD (mobile closes the drawer to reveal the board).
  const openTagFromFeed = (f: number) => { onJump(f); setHudOpen(true); if (mode === 'mobile') setSidebarOpen(false); };

  const renderView = (v: SidebarView): ReactNode => {
    if (v === 'tags') return <TagsFeature tags={tags} currentIndex={currentIndex} onJump={openTagFromFeed} />;
    if (v === 'log') return <GameLogFeature messagesByFrame={messagesByFrame} currentIndex={currentIndex} />;
    if (v === 'info') return <MatchupFeature {...matchup} />;
    if (v === 'decks') return <DecksFeature {...decks} />;
    if (v === 'playback') return <PlaybackFeature {...controls} />;
    if (v === 'share') return <ShareFeature replaySlug={replaySlug} installToken={controls.installToken} isOwner={controls.isOwner} />;
    return <ClipsFeature clips={controls.clips} onCreate={controls.onOpenClip} canCreate={canTag} />;
  };
  const activeView = VIEWS.find((v) => v.id === sidebarView)!;

  const railRight = desktopDock ? sidebarW + 14 : 14;

  // Rail = current-frame actions.
  const railItems: { key: string; icon: ReactNode; label: string; active?: boolean; badge?: number | null; onClick: () => void }[] = [
    { key: 'tags', icon: Icon.tag, label: 'Tags', active: hudOpen, badge: tagCountHere > 0 ? tagCountHere : null, onClick: () => setHudOpen((v) => !v) },
    { key: 'play', icon: controls.playing ? Icon.pause : Icon.play, label: controls.playing ? 'Pause' : 'Play', active: controls.playing, onClick: controls.onTogglePlay },
    { key: 'jump', icon: Icon.jump, label: 'Jump to…', active: jumpOpen, onClick: () => setJumpOpen((v) => !v) },
    { key: 'clip', icon: Icon.clip, label: 'Clip', onClick: controls.onOpenClip },
    { key: 'sidebar', icon: Icon.sidebar, label: 'Sidebar', active: sidebarOpen, onClick: () => setSidebarOpen((v) => !v) },
  ];

  return (
    <>
      {showHud && (
        <TagHud
          tags={tags} currentIndex={currentIndex} onJump={onJump}
          replaySlug={replaySlug} toOriginalFrame={toOriginalFrame} appendTag={appendTag} updateTag={updateTag} canTag={canTag}
          sidebarW={desktopDock ? sidebarW : 0}
          onOpenFeed={() => openSidebar('tags')}
        />
      )}

      {/* Sidebar — whole-replay views behind a selector. Resizable dock (desktop)
          / slide-out drawer (mobile). Independent of the HUD. */}
      {sidebarOpen && (
        <FeaturePanel
          open mode={mode} title={activeView.label} icon={activeView.icon}
          width={sidebarW} onWidthChange={setSidebarW} resizable={mode === 'desktop'}
          onClose={() => setSidebarOpen(false)}
          toolbar={<ViewSelector value={sidebarView} onChange={setSidebarView} />}
        >
          {renderView(sidebarView)}
        </FeaturePanel>
      )}

      {/* Jump-to-moment menu (rail → glassy popover). */}
      {jumpOpen && !mobileDrawer && (
        <JumpMenu chapters={controls.chapters} currentIndex={currentIndex} right={railRight + 52}
          onJump={(f) => { onJump(f); setJumpOpen(false); }} onClose={() => setJumpOpen(false)} />
      )}

      {/* The rail — current-frame actions. Hidden while the mobile drawer is open. */}
      {!mobileDrawer && (
        <div style={{ position: 'fixed', top: 'max(14px, env(safe-area-inset-top, 14px))', right: railRight, zIndex: 120, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
          {railItems.map((it, i) => (
            <div key={it.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
              {/* subtle divider before the sidebar toggle (the whole-replay control) */}
              {it.key === 'sidebar' && <div style={{ width: 26, height: 1, background: 'rgba(255,255,255,0.14)', margin: '0 9px' }} />}
              <RailBtn {...it} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RailBtn({ icon, label, active, badge, onClick }: { icon: ReactNode; label: string; active?: boolean; badge?: number | null; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick}
      style={{
        position: 'relative', width: 44, height: 44, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit',
        background: active ? 'rgba(77,210,255,0.22)' : 'rgba(255,255,255,0.07)',
        color: active ? tokens.led.on : 'rgba(255,255,255,0.82)',
        border: `1px solid ${active ? tokens.led.on : 'rgba(255,255,255,0.16)'}`,
        boxShadow: active ? tokens.led.ringGlow : '0 2px 10px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(16px) saturate(1.4)', WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
      }}>
      <span aria-hidden>{icon}</span>
      {badge != null && (
        <span aria-hidden style={{ position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: tokens.led.on, color: '#06121a', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{badge}</span>
      )}
    </button>
  );
}

function ViewSelector({ value, onChange }: { value: SidebarView; onChange: (v: SidebarView) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, padding: '10px 12px', overflowX: 'auto', scrollbarWidth: 'none' }}>
      {VIEWS.map((v) => {
        const on = v.id === value;
        return (
          <button key={v.id} type="button" onClick={() => onChange(v.id)} title={v.label}
            style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700,
              background: on ? 'rgba(77,210,255,0.2)' : 'rgba(255,255,255,0.05)', color: on ? '#eaf9ff' : 'rgba(255,255,255,0.72)',
              border: `1px solid ${on ? tokens.led.on : 'rgba(255,255,255,0.14)'}` }}>
            <span aria-hidden style={{ display: 'inline-flex', transform: 'scale(0.82)' }}>{v.icon}</span>{v.label}
          </button>
        );
      })}
    </div>
  );
}

function JumpMenu({ chapters, currentIndex, right, onJump, onClose }: { chapters: Chapter[]; currentIndex: number; right: number; onJump: (f: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const activeIdx = useMemo(() => {
    let best = 0; for (let i = 0; i < chapters.length; i++) if (chapters[i].frameIndex <= currentIndex) best = i; return best;
  }, [chapters, currentIndex]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div ref={ref} style={{
      position: 'fixed', top: 'max(14px, env(safe-area-inset-top, 14px))', right, zIndex: 125,
      width: 'min(280px, 84vw)', maxHeight: '62vh', overflowY: 'auto', borderRadius: 16, padding: 6,
      background: 'rgba(16,20,28,0.72)', backdropFilter: 'blur(20px) saturate(1.4)', WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
      border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 12px 44px rgba(0,0,0,0.5)', color: '#eef2f8', fontFamily: 'var(--font-barlow), sans-serif',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.5)', padding: '6px 10px 4px' }}>Jump to a moment</div>
      {chapters.map((c, i) => {
        const on = i === activeIdx;
        return (
          <button key={`${c.frameIndex}-${i}`} type="button" onClick={() => onJump(c.frameIndex)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', border: 0,
              background: on ? 'rgba(77,210,255,0.16)' : 'transparent', color: on ? '#eaf9ff' : 'rgba(255,255,255,0.85)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', background: CHAPTER_COLOR[c.kind] ?? '#8aa0b8' }} />
            <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 13, fontWeight: on ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}{c.sublabel ? <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}> · {c.sublabel}</span> : null}</span>
            <span style={{ flex: '0 0 auto', fontSize: 10.5, color: 'rgba(255,255,255,0.45)' }}>#{c.frameIndex + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

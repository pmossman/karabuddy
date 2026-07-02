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
import { ReviewsFeature } from './ReviewsFeature';
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

type SidebarView = 'tags' | 'reviews' | 'log' | 'info' | 'decks' | 'playback' | 'share' | 'clips';
const VIEWS: { id: SidebarView; label: string; icon: ReactNode }[] = [
  { id: 'tags', label: 'Tags', icon: Icon.messages },
  { id: 'reviews', label: 'Reviews', icon: Icon.review },
  { id: 'log', label: 'Log', icon: Icon.log },
  { id: 'info', label: 'Matchup', icon: Icon.matchup },
  { id: 'decks', label: 'Decks', icon: Icon.decks },
  { id: 'playback', label: 'Playback', icon: Icon.gear },
  { id: 'share', label: 'Share', icon: Icon.share },
  { id: 'clips', label: 'Clips', icon: Icon.clips },
];
const CHAPTER_COLOR: Record<string, string> = { start: '#8aa0b8', round: '#5db4ff', leader: '#e0c64a', tag: '#4dd2ff', end: '#8aa0b8' };
// Remembers whether you left the desktop Tag HUD open ('1') or closed ('0').
const HUD_PREF_KEY = 'kb:redesign:hudOpen';

export function RedesignChrome({ mode, tags, currentIndex, onJump, replaySlug, toOriginalFrame, appendTag, updateTag, removeTag, armedTeams, lastViewedAt, messagesByFrame, matchup, decks, controls, onTagModeChange, onDockWidthChange, canTag, onToggleSideboard, sideboardOpen }: {
  mode: 'desktop' | 'mobile';
  tags: ViewerTag[];
  currentIndex: number;
  onJump: (frame: number) => void;
  replaySlug: string;
  toOriginalFrame: (i: number) => number;
  appendTag: (t: ViewerTag) => void;
  updateTag: (id: string, patch: Partial<ViewerTag>) => void;
  removeTag: (id: string) => void;
  armedTeams: { slug: string; name: string }[];
  lastViewedAt: string | null;
  messagesByFrame: any[][] | null;
  matchup: ComponentProps<typeof MatchupFeature>;
  decks: ComponentProps<typeof DecksFeature>;
  controls: ViewerControls;
  onTagModeChange?: (active: boolean) => void;
  onDockWidthChange?: (w: number) => void;
  canTag: boolean;
  // Present only on replays with a sideboard swap to show → a persistent rail icon
  // that toggles the splash (click while open closes it).
  onToggleSideboard?: () => void;
  sideboardOpen?: boolean; // the splash's open state → rail icon lights blue while open
}) {
  const [hudOpen, setHudOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarView, setSidebarView] = useState<SidebarView>('tags');
  const [sidebarW, setSidebarW] = useState(380);
  const [jumpOpen, setJumpOpen] = useState(false);
  // Glow the Play (▶) to invite the first play this session; stops once played and
  // never re-glows (not even when you pause).
  const [invitePlay, setInvitePlay] = useState(true);
  // Glow the sideboard rail icon to draw attention until it's opened once this session.
  const [sideboardSeen, setSideboardSeen] = useState(false);
  useEffect(() => { if (sideboardOpen) setSideboardSeen(true); }, [sideboardOpen]);
  // Deep-link view captured ONCE (?panel=<view>). Read via a lazy initializer, not
  // re-read in the effect — otherwise Strict Mode's double-invoked effect strips the
  // param on the first pass and the second pass sees none and closes the panel.
  const [initialPanel] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try { return new URLSearchParams(window.location.search).get('panel'); } catch { return null; }
  });
  // The board loads clean: the HUD starts CLOSED and only opens when you engage
  // tagging (Tags rail icon / a tag in the feed). Your open/close choice is
  // remembered across reloads (desktop only — mobile always uses the drawer).
  useEffect(() => {
    setSidebarOpen(false); setJumpOpen(false);
    if (mode !== 'desktop') { setHudOpen(false); return; }
    let saved: string | null = null;
    try { saved = localStorage.getItem(HUD_PREF_KEY); } catch { /* private mode */ }
    setHudOpen(saved === '1'); // default closed when unset
  }, [mode]);
  // Deep-link: open the sidebar straight to ?panel=<view> ONCE on mount (used by the
  // series rows so hopping between games lands on the same panel). Declared after the
  // mode effect so its setSidebarOpen(false) doesn't clobber this; mount-only so a
  // later resize doesn't force it back open. Strips the param so a manual close sticks.
  useEffect(() => {
    if (!initialPanel || !VIEWS.some((v) => v.id === initialPanel)) return;
    setSidebarView(initialPanel as SidebarView);
    setSidebarOpen(true);
    try { const u = new URL(window.location.href); u.searchParams.delete('panel'); window.history.replaceState(null, '', u.toString()); } catch { /* param stays; harmless */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (mode !== 'desktop') return; // don't let the mobile drawer clobber the desktop pref
    try { localStorage.setItem(HUD_PREF_KEY, hudOpen ? '1' : '0'); } catch { /* private mode */ }
  }, [hudOpen, mode]);

  const desktopDock = mode === 'desktop' && sidebarOpen;
  const mobileDrawer = mode === 'mobile' && sidebarOpen;
  const showHud = hudOpen && !mobileDrawer; // the mobile drawer covers the HUD
  useEffect(() => { onTagModeChange?.(hudOpen); }, [hudOpen, onTagModeChange]);
  useEffect(() => { onDockWidthChange?.(desktopDock ? sidebarW : 0); }, [desktopDock, sidebarW, onDockWidthChange]);
  const tagCountHere = tags.filter((t) => !t.parentTagId && t.frameIndex === currentIndex).length;

  const openSidebar = (v: SidebarView) => { setSidebarView(v); setSidebarOpen(true); };
  // Jump from a sidebar view; on mobile close the drawer so the board is revealed.
  const jumpFromSidebar = (f: number) => { onJump(f); if (mode === 'mobile') setSidebarOpen(false); };
  // Click a tag feed entry → also open the HUD at that frame.
  const openTagFromFeed = (f: number) => { setHudOpen(true); jumpFromSidebar(f); };

  const renderView = (v: SidebarView): ReactNode => {
    if (v === 'tags') return <TagsFeature tags={tags} currentIndex={currentIndex} onJump={openTagFromFeed} armedTeams={armedTeams} lastViewedAt={lastViewedAt} />;
    if (v === 'reviews') return <ReviewsFeature replaySlug={replaySlug} tags={tags} onJump={jumpFromSidebar} toOriginalFrame={toOriginalFrame} updateTag={updateTag} removeTag={removeTag} isOwner={controls.isOwner} />;
    if (v === 'log') return <GameLogFeature messagesByFrame={messagesByFrame} currentIndex={currentIndex} onJump={jumpFromSidebar} />;
    if (v === 'info') return <MatchupFeature {...matchup} />;
    if (v === 'decks') return <DecksFeature {...decks} />;
    if (v === 'playback') return <PlaybackFeature {...controls} />;
    if (v === 'share') return <ShareFeature replaySlug={replaySlug} installToken={controls.installToken} isOwner={controls.isOwner} />;
    return <ClipsFeature clips={controls.clips} onCreate={controls.onOpenClip} canCreate={canTag} />;
  };
  const activeView = VIEWS.find((v) => v.id === sidebarView)!;

  const railRight = desktopDock ? sidebarW + 14 : 14;

  // Top-right rail: the sidebar toggle (top corner) + Tags (the messages HUD).
  // Play / gear / jump-to live in the bottom-right cluster; Clip lives in the
  // sidebar's Clips view.
  const railItems: { key: string; icon: ReactNode; label: string; active?: boolean; badge?: number | null; glow?: boolean; onClick: () => void }[] = [
    { key: 'sidebar', icon: Icon.sidebar, label: 'Sidebar', active: sidebarOpen, onClick: () => setSidebarOpen((v) => !v) },
    // Tags rail = the board HUD, and ONLY the HUD: lit ⇔ HUD open, click toggles it.
    // The panel is the sidebar rail's job; the panel's Tags view opens the HUD via a
    // tag click (openTagFromFeed). Keeping this icon off the panel is what removed the
    // phantom activation (panel defaults to its Tags view) + the dead click-to-close.
    { key: 'tags', icon: Icon.messages, label: 'Tags', active: hudOpen, badge: tagCountHere > 0 ? tagCountHere : null, onClick: () => setHudOpen((v) => !v) },
  ];
  // Sideboard: only on replays with a swap to show — toggles the splash (open ⇄
  // close). Lights blue while open, and glows until first opened to draw attention.
  if (onToggleSideboard) railItems.push({ key: 'sideboard', icon: Icon.sideboard, label: 'Sideboard changes', active: !!sideboardOpen, glow: !sideboardSeen && !sideboardOpen, onClick: onToggleSideboard });

  return (
    <>
      {showHud && (
        <TagHud
          tags={tags} currentIndex={currentIndex} onJump={onJump}
          replaySlug={replaySlug} toOriginalFrame={toOriginalFrame} appendTag={appendTag} updateTag={updateTag} removeTag={removeTag} canTag={canTag}
          armedTeams={armedTeams} lastViewedAt={lastViewedAt}
          sidebarW={desktopDock ? sidebarW : 0}
          onClose={() => setHudOpen(false)}
        />
      )}

      {/* Sidebar — whole-replay views behind a selector. Resizable dock (desktop)
          / slide-out drawer (mobile). Independent of the HUD. */}
      {sidebarOpen && (
        <FeaturePanel
          open mode={mode} title={activeView.label} icon={activeView.icon} hideHeader
          width={sidebarW} onWidthChange={setSidebarW} resizable={mode === 'desktop'}
          onClose={() => setSidebarOpen(false)}
          toolbar={<ViewSelector value={sidebarView} onChange={setSidebarView} />}
        >
          {renderView(sidebarView)}
        </FeaturePanel>
      )}

      {/* Jump-to-moment menu — opens UPWARD from the bottom-right jump bubble. */}
      {jumpOpen && !mobileDrawer && (
        <JumpMenu chapters={controls.chapters} currentIndex={currentIndex}
          right={(desktopDock ? sidebarW : 0) + 18}
          bottom={'calc(max(18px, env(safe-area-inset-bottom, 18px)) + 142px)'}
          onJump={(f) => { onJump(f); setJumpOpen(false); }} onClose={() => setJumpOpen(false)} />
      )}

      {/* Bottom-right transport cluster (its pre-redesign home, dock-aware): the
          jump-to bubble + a larger Play/Pause FAB (breathes a glow WHILE PLAYING)
          with a small gear OVERLAPPING it — clearly its playback options. */}
      {!mobileDrawer && (
        <div style={{ position: 'fixed', zIndex: 121, bottom: 'max(18px, env(safe-area-inset-bottom, 18px))', right: `calc(${desktopDock ? sidebarW : 0}px + max(18px, env(safe-area-inset-right, 18px)))`, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
          <style>{'@keyframes kb-play-pulse{0%,100%{box-shadow:0 0 7px 1px rgba(77,210,255,0.32)}50%{box-shadow:0 0 17px 5px rgba(77,210,255,0.55)}}'}</style>
          {/* Jump-to — stacked ABOVE the play button. */}
          <button type="button" title="Jump to a moment" aria-label="Jump to a moment" onClick={() => setJumpOpen((v) => !v)}
            style={{
              width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit',
              background: jumpOpen ? 'rgba(77,210,255,0.22)' : 'rgba(255,255,255,0.07)',
              color: jumpOpen ? tokens.led.on : 'rgba(255,255,255,0.82)',
              border: `1px solid ${jumpOpen ? tokens.led.on : 'rgba(255,255,255,0.16)'}`,
              boxShadow: jumpOpen ? tokens.led.ringGlow : '0 2px 10px rgba(0,0,0,0.35)',
              backdropFilter: 'blur(16px) saturate(1.4)', WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
            }}>
            <span aria-hidden>{Icon.jump}</span>
          </button>
          {/* Double-sided (POV) controls beside Play — grouped in a labelled glass
              rect so it's clear WHY they appear (only on double-sided replays).
              Flip is a momentary action (fires the curtain, never lit);
              reveal-hands is a toggle, lit while on. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {controls.canFlip && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '7px 10px 9px', borderRadius: 16,
                background: 'rgba(16,20,28,0.4)', border: '1px solid rgba(255,255,255,0.12)',
                backdropFilter: 'blur(16px) saturate(1.4)', WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
              }}>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>Double-sided</span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <RailBtn icon={Icon.flip} label={`Flip seat — viewing ${controls.viewLabel}`} onClick={controls.onFlip} />
                  <RailBtn icon={Icon.eye} label="Both hands face up" active={controls.revealHands} onClick={() => controls.onRevealHandsChange(!controls.revealHands)} />
                </div>
              </div>
            )}
          {/* Play + overlapping gear. */}
          <div style={{ position: 'relative' }}>
            <button type="button" title={controls.playing ? 'Pause' : 'Play'} aria-label={controls.playing ? 'Pause' : 'Play'} onClick={() => { setInvitePlay(false); controls.onTogglePlay(); }}
              style={{
                width: 58, height: 58, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit',
                background: controls.playing ? 'rgba(77,210,255,0.24)' : 'rgba(255,255,255,0.09)',
                color: controls.playing ? tokens.led.on : '#eef2f8',
                border: `1px solid ${controls.playing ? tokens.led.on : 'rgba(255,255,255,0.2)'}`,
                boxShadow: '0 3px 16px rgba(0,0,0,0.45)',
                backdropFilter: 'blur(16px) saturate(1.4)', WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
                // Glow the ▶ to invite the first play; not while playing, and not after pausing.
                animation: invitePlay && !controls.playing ? 'kb-play-pulse 1.9s ease-in-out infinite' : undefined,
              }}>
              <span aria-hidden style={{ display: 'inline-flex', transform: 'scale(1.35)' }}>{controls.playing ? Icon.pause : Icon.play}</span>
            </button>
            <button type="button" title="Playback options" aria-label="Playback options" onClick={() => { if (sidebarOpen) setSidebarOpen(false); else openSidebar('playback'); }}
              style={{
                position: 'absolute', right: -9, bottom: -9, width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit',
                background: sidebarOpen && sidebarView === 'playback' ? 'rgba(77,210,255,0.9)' : 'rgba(22,28,38,0.95)',
                color: sidebarOpen && sidebarView === 'playback' ? '#06121a' : '#eef2f8',
                border: `1.5px solid ${sidebarOpen && sidebarView === 'playback' ? tokens.led.on : 'rgba(255,255,255,0.5)'}`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              }}>
              <span aria-hidden style={{ display: 'inline-flex', transform: 'scale(0.66)' }}>{Icon.gear}</span>
            </button>
          </div>
          </div>
        </div>
      )}

      {/* The rail — current-frame actions. Hidden while the mobile drawer is open. */}
      {!mobileDrawer && (
        <div style={{ position: 'fixed', top: 'calc(var(--kb-header-h, 46px) + 14px)', right: railRight, zIndex: 120, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
          <style>{'@keyframes kb-play-pulse{0%,100%{box-shadow:0 0 7px 1px rgba(77,210,255,0.32)}50%{box-shadow:0 0 17px 5px rgba(77,210,255,0.55)}}'}</style>
          {railItems.map((it, i) => (
            <div key={it.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
              {/* subtle divider between the sidebar toggle (whole-replay) and Tags
                  (current-frame). */}
              {it.key === 'tags' && <div style={{ width: 26, height: 1, background: 'rgba(255,255,255,0.14)', margin: '0 9px' }} />}
              <RailBtn {...it} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RailBtn({ icon, label, active, badge, glow, onClick }: { icon: ReactNode; label: string; active?: boolean; badge?: number | null; glow?: boolean; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick}
      style={{
        position: 'relative', width: 44, height: 44, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit',
        background: active ? 'rgba(77,210,255,0.22)' : 'rgba(255,255,255,0.07)',
        color: active ? tokens.led.on : 'rgba(255,255,255,0.82)',
        border: `1px solid ${active || glow ? tokens.led.on : 'rgba(255,255,255,0.16)'}`,
        boxShadow: active ? tokens.led.ringGlow : '0 2px 10px rgba(0,0,0,0.35)',
        animation: glow ? 'kb-play-pulse 1.9s ease-in-out infinite' : undefined,
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 44px 10px 12px' }}>
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

function JumpMenu({ chapters, currentIndex, right, bottom, onJump, onClose }: { chapters: Chapter[]; currentIndex: number; right: number; bottom: string; onJump: (f: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const activeIdx = useMemo(() => {
    let best = 0; for (let i = 0; i < chapters.length; i++) if (chapters[i].frameIndex <= currentIndex) best = i; return best;
  }, [chapters, currentIndex]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Start scrolled to the current moment (the list opens upward from the bottom).
  useEffect(() => { ref.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' }); }, []);
  return (
    <>
    {/* Tap outside to close. */}
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 124 }} />
    <div ref={ref} style={{
      position: 'fixed', bottom, right, zIndex: 125,
      width: 'min(280px, 84vw)', maxHeight: '62vh', overflowY: 'auto', borderRadius: 16, padding: 6,
      background: 'rgba(16,20,28,0.72)', backdropFilter: 'blur(20px) saturate(1.4)', WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
      border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 12px 44px rgba(0,0,0,0.5)', color: '#eef2f8', fontFamily: 'var(--font-barlow), sans-serif',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.5)', padding: '6px 10px 4px' }}>Jump to a moment</div>
      {chapters.map((c, i) => {
        const on = i === activeIdx;
        // Comments read as messages (speech-bubble + tinted, accented row), while
        // structural markers (rounds, leader plays, start/end) stay plain dots.
        const isTag = c.kind === 'tag';
        return (
          <button key={`${c.frameIndex}-${i}`} type="button" onClick={() => onJump(c.frameIndex)} data-active={on ? '1' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit',
              border: 0, borderLeft: `2px solid ${isTag ? 'rgba(77,210,255,0.7)' : 'transparent'}`,
              background: on ? 'rgba(77,210,255,0.2)' : isTag ? 'rgba(77,210,255,0.08)' : 'transparent',
              color: on ? '#eaf9ff' : 'rgba(255,255,255,0.85)' }}>
            {isTag ? (
              <span aria-hidden style={{ flex: '0 0 auto', display: 'inline-flex', color: '#4dd2ff' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" /></svg>
              </span>
            ) : (
              <span style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', background: CHAPTER_COLOR[c.kind] ?? '#8aa0b8' }} />
            )}
            <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 13, fontWeight: isTag ? 500 : 700, textTransform: isTag ? 'none' : 'uppercase', letterSpacing: isTag ? 0 : '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isTag ? <>“{c.label}”</> : c.label}{c.sublabel ? <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}> · {c.sublabel}</span> : null}
            </span>
            <span style={{ flex: '0 0 auto', fontSize: 10.5, color: 'rgba(255,255,255,0.45)' }}>#{c.frameIndex + 1}</span>
          </button>
        );
      })}
    </div>
    </>
  );
}

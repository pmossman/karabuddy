'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode, type ComponentProps } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMediaQuery } from '@/lib/useMediaQuery';
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
import { PULSE_KEYFRAMES } from './ui';
import { type ClipSummary } from '../ClipsList';

// B216 redesign — the unified viewer chrome.
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

// ===== Chrome layout contract (shared) =====
// The right-edge chrome sits on ONE vertical axis: edge padding CHROME_EDGE_PX
// (grown by the safe-area inset) + half of PLAY_SIZE, the widest control. Anything
// that wants to sit on the axis (the frame chevrons, via ReplayViewer) derives its
// offset from these SAME constants — alignment by construction, not arithmetic.
export const CHROME_EDGE_PX = 14;
export const PLAY_SIZE = 58;

export function RedesignChrome({ mode, tags, currentIndex, onJump, replaySlug, toOriginalFrame, appendTag, updateTag, removeTag, armedTeams, lastViewedAt, messagesByFrame, matchup, decks, controls, onDockWidthChange, canTag, onToggleSideboard, sideboardOpen, onArmedTeamsChange }: {
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
  onDockWidthChange?: (w: number) => void;
  canTag: boolean;
  // Present only on replays with a sideboard swap to show → a persistent rail icon
  // that toggles the splash (click while open closes it).
  onToggleSideboard?: () => void;
  sideboardOpen?: boolean; // the splash's open state → rail icon lights blue while open
  // B168: live armed-teams sync from the Share view back up to the viewer.
  onArmedTeamsChange?: (teams: { slug: string; name: string }[]) => void;
}) {
  // Phone-landscape: the right edge is too short for a vertical rail (it collides
  // with the chevron + the play pocket), but the top-right corner is empty — the
  // rail lies horizontal there instead.
  const landscape = useMediaQuery('(orientation: landscape)');
  const railRow = mode === 'mobile' && landscape;
  const [hudOpen, setHudOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarView, setSidebarView] = useState<SidebarView>('tags');
  const [sidebarW, setSidebarW] = useState(380);
  const [jumpOpen, setJumpOpen] = useState(false);
  // Glow the Play (▶) to invite the first play this session; stops once played and
  // never re-glows (not even when you pause).
  const [invitePlay, setInvitePlay] = useState(true);
  // Deep-link view captured ONCE (?panel=<view>; ?finishReview=<team> implies the
  // Reviews view — B194, from the team Reviews tab). Read via a lazy initializer,
  // not re-read in the effect — otherwise Strict Mode's double-invoked effect strips
  // the param on the first pass and the second pass sees none and closes the panel.
  // (ReviewsFeature reads + strips finishReview itself to auto-expand the team.)
  // Read via useSearchParams, NOT window.location: on a client-side navigation
  // (series hop, team Reviews tab) the render happens before the URL commits, so a
  // window read sees the PREVIOUS page's search and the deep-link is lost.
  const searchParams = useSearchParams();
  const [initialPanel] = useState<string | null>(
    () => searchParams.get('panel') ?? (searchParams.get('finishReview') ? 'reviews' : null),
  );
  // The deep-linked view stays "pending" until the user takes over the sidebar —
  // the [mode] effect below re-runs when useMediaQuery settles desktop→mobile just
  // after mount, and its close-on-crossing would otherwise clobber the deep-link
  // (the panel opened, then instantly closed on phones).
  const pendingPanelRef = useRef<SidebarView | null>(
    initialPanel && VIEWS.some((v) => v.id === initialPanel) ? (initialPanel as SidebarView) : null,
  );
  // Any USER open/close takes ownership: consume the pending deep-link so a later
  // breakpoint crossing doesn't resurrect it.
  const userSetSidebar = (open: boolean) => { pendingPanelRef.current = null; setSidebarOpen(open); };
  // The board loads clean: the HUD starts CLOSED and only opens when you engage
  // tagging (Tags rail icon / a tag in the feed). Your open/close choice is
  // remembered across reloads (desktop only — mobile always uses the drawer).
  // A pending deep-link wins over the default-closed sidebar (and survives the
  // initial desktop→mobile mode settle, which re-runs this effect).
  useEffect(() => {
    setJumpOpen(false);
    if (pendingPanelRef.current) { setSidebarView(pendingPanelRef.current); setSidebarOpen(true); }
    else setSidebarOpen(false);
    if (mode !== 'desktop') { setHudOpen(false); return; }
    let saved: string | null = null;
    try { saved = localStorage.getItem(HUD_PREF_KEY); } catch { /* private mode */ }
    setHudOpen(saved === '1'); // default closed when unset
  }, [mode]);
  // Strip the ?panel param once so a copied URL is clean and a manual close sticks.
  useEffect(() => {
    if (!initialPanel) return;
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
  useEffect(() => { onDockWidthChange?.(desktopDock ? sidebarW : 0); }, [desktopDock, sidebarW, onDockWidthChange]);
  const tagCountHere = tags.filter((t) => !t.parentTagId && t.frameIndex === currentIndex).length;

  const openSidebar = (v: SidebarView) => { pendingPanelRef.current = null; setSidebarView(v); setSidebarOpen(true); };
  // Jump from a sidebar view; on mobile close the drawer so the board is revealed.
  const jumpFromSidebar = (f: number) => { onJump(f); if (mode === 'mobile') userSetSidebar(false); };
  // Click a tag feed entry → also open the HUD at that frame.
  const openTagFromFeed = (f: number) => { setHudOpen(true); jumpFromSidebar(f); };

  const renderView = (v: SidebarView): ReactNode => {
    if (v === 'tags') return <TagsFeature tags={tags} currentIndex={currentIndex} onJump={openTagFromFeed} armedTeams={armedTeams} lastViewedAt={lastViewedAt} />;
    if (v === 'reviews') return <ReviewsFeature replaySlug={replaySlug} tags={tags} onJump={jumpFromSidebar} toOriginalFrame={toOriginalFrame} updateTag={updateTag} removeTag={removeTag} isOwner={controls.isOwner} />;
    if (v === 'log') return <GameLogFeature messagesByFrame={messagesByFrame} currentIndex={currentIndex} onJump={jumpFromSidebar} />;
    if (v === 'info') return <MatchupFeature {...matchup} />;
    if (v === 'decks') return <DecksFeature {...decks} />;
    if (v === 'playback') return <PlaybackFeature {...controls} />;
    if (v === 'share') return <ShareFeature replaySlug={replaySlug} installToken={controls.installToken} isOwner={controls.isOwner} currentIndex={currentIndex} toOriginalFrame={toOriginalFrame} onArmedTeamsChange={onArmedTeamsChange} />;
    return <ClipsFeature clips={controls.clips} onCreate={controls.onOpenClip} canCreate={canTag} />;
  };
  const activeView = VIEWS.find((v) => v.id === sidebarView)!;

  // ===== Chrome layout contract =====
  // Every small round icon (rail, jump, gear, capsule) is a RailBtn at ONE size
  // per breakpoint, and both right-edge columns (top rail + bottom pocket) share
  // ONE fixed-width, centre-aligned container — so all icon centres are forced
  // onto a single vertical axis structurally. Play is the ONLY special case
  // (bigger; its centre sits on the same axis because the column centres it).
  const railSize = mode === 'mobile' ? 38 : 44;
  const chromeRight = `calc(${desktopDock ? sidebarW : 0}px + max(${CHROME_EDGE_PX}px, env(safe-area-inset-right, ${CHROME_EDGE_PX}px)))`;
  const chromeColumn: React.CSSProperties = {
    position: 'fixed', right: chromeRight, width: PLAY_SIZE, zIndex: 120,
    display: 'flex', flexDirection: 'column', alignItems: 'center',
  };

  // Top-right rail: the sidebar toggle (top corner) + Tags (the messages HUD).
  // Play / gear / jump-to live in the bottom-right cluster; Clip lives in the
  // sidebar's Clips view.
  const railItems: { key: string; icon: ReactNode; label: string; active?: boolean; badge?: number | null; onClick: () => void; testId?: string }[] = [
    { key: 'sidebar', icon: Icon.sidebar, label: 'Sidebar', active: sidebarOpen, onClick: () => userSetSidebar(!sidebarOpen) },
    // Tags rail = the board HUD, and ONLY the HUD: lit ⇔ HUD open, click toggles it.
    // The panel is the sidebar rail's job; the panel's Tags view opens the HUD via a
    // tag click (openTagFromFeed). Keeping this icon off the panel is what removed the
    // phantom activation (panel defaults to its Tags view) + the dead click-to-close.
    { key: 'tags', icon: Icon.messages, label: 'Tags', active: hudOpen, badge: tagCountHere > 0 ? tagCountHere : null, onClick: () => setHudOpen((v) => !v) },
  ];
  // Sideboard: only on replays with a swap to show — toggles the splash (open ⇄
  // close); lights blue while open.
  if (onToggleSideboard) railItems.push({ key: 'sideboard', icon: Icon.sideboard, label: 'Sideboard changes', active: !!sideboardOpen, onClick: onToggleSideboard });


  return (
    <>
      <style>{PULSE_KEYFRAMES}</style>
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
          onClose={() => userSetSidebar(false)}
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

      {/* Bottom-right transport pocket — a plain centred column: Jump, then the
          gear (a stock rail icon), then the big Play FAB (breathes a glow until
          the first play). Same on both breakpoints. */}
      {!mobileDrawer && (
        <div style={railRow
          ? { position: 'fixed', right: chromeRight, bottom: 'max(14px, env(safe-area-inset-bottom, 14px))', zIndex: 120, height: PLAY_SIZE, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }
          : { ...chromeColumn, bottom: 'max(18px, env(safe-area-inset-bottom, 18px))', gap: 12 }}>
          <RailBtn size={railSize} icon={Icon.jump} label="Jump to a moment" active={jumpOpen} onClick={() => setJumpOpen((v) => !v)} />
          <RailBtn size={railSize} icon={Icon.gear} label="Playback options" active={sidebarOpen && sidebarView === 'playback'}
            onClick={() => { if (sidebarOpen) userSetSidebar(false); else openSidebar('playback'); }} />
          <button type="button" title={controls.playing ? 'Pause' : 'Play'} aria-label={controls.playing ? 'Pause' : 'Play'} onClick={() => { setInvitePlay(false); controls.onTogglePlay(); }}
            style={{
              width: PLAY_SIZE, height: PLAY_SIZE, padding: 0, boxSizing: 'border-box', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: 'inherit',
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
        </div>
      )}

      {/* The rail — current-frame actions. Hidden while the mobile drawer is open. */}
      {!mobileDrawer && (
        <div style={railRow
          ? { position: 'fixed', top: 'calc(var(--kb-header-h, 0px) + 10px)', right: 'max(12px, env(safe-area-inset-right, 12px))', zIndex: 120, display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }
          : { ...chromeColumn, top: 'calc(var(--kb-header-h, 46px) + 14px)', gap: mode === 'mobile' ? 8 : 10 }}>
          {railItems.map(({ key, ...it }) => (
            <div key={key} style={{ display: 'flex', flexDirection: railRow ? 'row' : 'column', alignItems: 'center', gap: mode === 'mobile' ? 8 : 10 }}>
              {/* subtle divider between the sidebar toggle (whole-replay) and Tags
                  (current-frame). No side margins — a wider divider box would
                  re-centre its wrapper and knock the icons out of column. */}
              {key === 'tags' && (
                <div style={railRow
                  ? { width: 1, height: 26, background: 'rgba(255,255,255,0.14)' }
                  : { width: 26, height: 1, background: 'rgba(255,255,255,0.14)' }} />
              )}
              <RailBtn {...it} size={railSize} />
            </div>
          ))}
          {/* Double-sided pair — a subtle capsule marks them as one unit, riding
              the rail on BOTH breakpoints (a bulkier labelled group beside Play
              sat on the hand fan; keep mobile/desktop identical unless a
              difference is functional). */}
          {controls.canFlip && (
            <div data-testid="pov-controls" style={{
              display: 'flex', flexDirection: railRow ? 'row' : 'column', alignItems: 'center', gap: 6,
              padding: 4, borderRadius: 999, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(16,20,28,0.35)',
              backdropFilter: 'blur(16px) saturate(1.4)', WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
            }}>
              <RailBtn icon={Icon.flip} label={`Flip seat — viewing ${controls.viewLabel}`} onClick={controls.onFlip} testId="flip-button" size={railSize} />
              <RailBtn icon={Icon.eye} label="Both hands face up" active={controls.revealHands} onClick={() => controls.onRevealHandsChange(!controls.revealHands)} testId="reveal-toggle" size={railSize} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function RailBtn({ icon, label, active, badge, onClick, testId, size = 44 }: { icon: ReactNode; label: string; active?: boolean; badge?: number | null; onClick: () => void; testId?: string; size?: number }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} onClick={onClick} data-testid={testId}
      style={{
        position: 'relative', width: size, height: size, borderRadius: '50%',
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

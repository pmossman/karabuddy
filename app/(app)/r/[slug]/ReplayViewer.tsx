'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemeContextProvider } from '@/app/_contexts/Theme.context';
import { KaraBuddyThemeProvider } from '@/app/_components/KaraBuddyThemeProvider';
import { CosmeticsProvider } from '@/app/_contexts/CosmeticsContext';
import { UserProvider } from '@/app/_contexts/User.context';
import { PopupProvider } from '@/app/_contexts/Popup.context';
import { GameProvider, useGame } from '@/app/_contexts/Game.context';
import Gameboard from '@/app/_components/Gameboard/Gameboard';
import { useRouter, useSearchParams } from 'next/navigation';
import { decodeReplay, type Frame, type DecodedReplay } from '@/lib/replayDecoder';
import { TagSidebar } from './TagSidebar';
import { StepModeOverlay, MatchupPanel } from './MobileLandscapePanels';
import { FrameNavOverlay } from './FrameNavOverlay';
import { useDragSize } from './useDragSize';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useSession } from 'next-auth/react';
import { getOrCreateInstallToken } from '@/lib/installToken';
import { canMutateReplay } from '@/lib/replayPermissions';

interface ReplayRow {
  slug: string;
  gameId: string;
  userId: string | null;
  ownerToken: string;
  players: any;
  durationMs: number;
  actionCount: number;
  payloadBlobUrl: string;
  payloadSizeBytes: number;
  createdAt: string;
  // B42: nullable JSONB columns persisted by the server route.
  match?: any;
  decks?: any;
  displayName?: string | null;
  labels?: any;
  // B59: winning playerIds extracted from the final gamestate at upload.
  // Null on pre-B59 replays + games ended via disconnect / abandon.
  winners?: any;
}

interface TagRow {
  id: string;
  replaySlug: string;
  frameIndex: number;
  authorToken: string;
  authorName: string;
  comment: string;
  createdAt: string;
  scope?: string[];
}

interface Props {
  replay: ReplayRow;
  initialTags: TagRow[];
}

export function ReplayViewer({ replay, initialTags }: Props) {
  return (
    <ThemeContextProvider>
      <UserProvider>
        <CosmeticsProvider>
          <PopupProvider>
            <GameProvider>
              <ViewerShell replay={replay} initialTags={initialTags} />
            </GameProvider>
          </PopupProvider>
        </CosmeticsProvider>
      </UserProvider>
    </ThemeContextProvider>
  );
}

type StepMode = 'action' | 'frame';

// B100: matchup-info FAB glyph — a simple info circle, distinct from the ☰
// review toggle so the two mobile buttons read as different actions.
function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function ViewerShell({ replay, initialTags }: Props) {
  const { setGameState, setConnectedPlayer } = useGame();
  const [decoded, setDecoded] = useState<DecodedReplay | null>(null);
  const [currentIndex, setCurrentIndexRaw] = useState(0);
  // B11: track the most recent frame transition so FrameLog can highlight
  // the range of frames a single action stepped across. Null on initial
  // mount (and after backward jumps — handled inside the setter).
  const [lastTransition, setLastTransition] = useState<{ from: number; to: number } | null>(null);
  const setCurrentIndex = useCallback((next: number | ((cur: number) => number)) => {
    setCurrentIndexRaw((cur) => {
      const target = typeof next === 'function' ? (next as (c: number) => number)(cur) : next;
      if (target !== cur) {
        setLastTransition({ from: cur, to: target });
      }
      return target;
    });
  }, []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tagState, setTagState] = useState<TagRow[]>(initialTags);
  // B44/B46: drawer state owned here so the gameboard overlay (FrameNavOverlay)
  // can shift in response. Starts closed on mobile so the first paint gives
  // the gameboard the full viewport.
  //
  // Mobile detection (B47): viewport width OR coarse pointer. The width-only
  // 767px breakpoint missed phone landscape (iPhone 14 = 844px, iPhone 14 Pro
  // Max = 932px) — those got desktop chrome and a tiny sidebar. Bumping width
  // to 900px catches all current phones in landscape; adding `pointer: coarse`
  // as an OR catches tablets too. Desktop users with mouse pointer get the
  // desktop chrome regardless of window width (until they shrink past 900px,
  // at which point mobile mode is the more usable layout anyway).
  const isMobile = useMediaQuery('(max-width: 900px), (pointer: coarse)');
  // B66: landscape-vs-portrait split. Mobile landscape gets a left
  // matchup panel + the step-mode overlay, freeing the right drawer to
  // be slim (tags/log only). Portrait splits TOP/BOTTOM instead.
  const isLandscape = useMediaQuery('(orientation: landscape)');
  const mobileLandscape = isMobile && isLandscape;
  const mobilePortrait = isMobile && !isLandscape;
  // B100: two independent mobile panels, two FABs. `reviewOpen` is the
  // log/tags drawer (the old single `drawerOpen` — still the docked sidebar
  // on desktop, open by default there, closed on mobile so the first paint
  // shows the full gameboard). `matchupOpen` is the matchup info panel, which
  // exists only on mobile and starts collapsed (rarely needed mid-replay).
  // On mobile the two are mutually exclusive — they're top/bottom (or
  // left/right) sheets that would otherwise sandwich the board, which was the
  // "total mess" of the old shared-state model. Desktop ignores matchupOpen.
  const [reviewOpen, setReviewOpenRaw] = useState(false);
  const [matchupOpen, setMatchupOpen] = useState(false);
  const userTouchedDrawerRef = useRef(false);
  useEffect(() => {
    if (userTouchedDrawerRef.current) return;
    setReviewOpenRaw(!isMobile);
  }, [isMobile]);
  const setReviewOpen = useCallback((next: boolean) => {
    userTouchedDrawerRef.current = true;
    setReviewOpenRaw(next);
    if (next) setMatchupOpen(false); // mobile: opening review closes matchup
  }, []);
  const openMatchup = useCallback((next: boolean) => {
    setMatchupOpen(next);
    if (next) setReviewOpenRaw(false); // mobile: opening matchup closes review
  }, []);
  // Keep the drawerOpen name for the props passed down (desktop sidebar +
  // overlays still reason about "is the review panel open").
  const drawerOpen = reviewOpen;
  // B66b: lifted from TagSidebar so FrameNavOverlay's right-chevron
  // offset can track the actual desktop sidebar width (was hardcoded to
  // the mobile drawer width, making it float in dead space).
  const [sidebarWidth, setSidebarWidth] = useState<number>(360);

  // B100: the mobile review-sheet drag size lives HERE (not in TagSidebar) so
  // the live height/width drives three things at once as you drag: the sheet
  // itself, the frame-nav chevrons (they ride up/inward with the sheet edge so
  // they're never buried under it), and the FABs + step pill (they sit just
  // outside the sheet edge instead of overlaying it). Portrait → height
  // (bottom sheet, grabber on its TOP edge → drag up grows, grow:-1).
  // Landscape → width (right sheet, grabber on its LEFT edge → drag left grows,
  // grow:-1). Computed unconditionally (hook rule); consumed only on mobile.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  // Cap the sheet by RESERVING a fixed minimum board size rather than a % of
  // the viewport — past ~0.9vh the board (and the controls floating above it)
  // got squished into a sliver. Reserving 240px of board height / 340px of
  // board width keeps it readable on any phone.
  const reviewDrag = useDragSize({
    axis: mobilePortrait ? 'y' : 'x',
    grow: -1,
    initial: mobilePortrait ? Math.round(vh * 0.55) : Math.min(380, Math.round(vw * 0.5)),
    min: mobilePortrait ? 160 : 260,
    max: mobilePortrait ? Math.max(200, vh - 240) : Math.max(280, vw - 340),
    // Persist per orientation so a tall portrait sheet / wide landscape sheet
    // is remembered across reloads (no re-dragging each visit).
    storageKey: mobilePortrait ? 'karabuddy:reviewSheetH' : 'karabuddy:reviewSheetW',
  });

  // B66e: ownership resolved here so both TagSidebar (desktop) AND
  // MatchupPanel (mobile) can show owner-only affordances from the
  // same source of truth.
  const { data: session } = useSession();
  const sessionUserId: string | null = ((session?.user as any)?.id as string | undefined) || null;
  const [installToken, setInstallToken] = useState('');
  useEffect(() => { setInstallToken(getOrCreateInstallToken()); }, []);

  // B71: armed teams = teams I'm in that this replay is shared with. Drives
  // the comment form's scope chip (audience ⊆ shares). Returned alongside
  // the scoped tags so the form knows the bounds without a second request.
  const [armedTeams, setArmedTeams] = useState<{ slug: string; name: string }[]>([]);

  // B71: tags are fetched (not SSR'd) so the server can scope them to the
  // viewer — own comments + tags scoped to a team they're in. Refetched
  // when the install token resolves (identifies an anonymous author) or
  // the session changes (team membership).
  useEffect(() => {
    if (!installToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/replays/${replay.slug}/tags`, {
          headers: { 'X-Install-Token': installToken },
        });
        const body = await res.json();
        if (cancelled || !body.ok) return;
        setTagState((body.data as TagRow[]) ?? []);
        setArmedTeams((body.armedTeams as { slug: string; name: string }[]) ?? []);
      } catch {
        /* keep whatever's already in state */
      }
    })();
    return () => { cancelled = true; };
  }, [installToken, sessionUserId, replay.slug]);
  const isOwner = canMutateReplay(
    { userId: replay.userId, ownerToken: replay.ownerToken },
    { sessionUserId, installToken: installToken || null },
  );

  // B48: on mobile the persistent (app)-layout header eats too much
  // vertical real estate from the gameboard. Toggle a body-level class
  // while the mobile viewer is mounted so globals.css can hide the header
  // and zero out --kb-header-h.
  useEffect(() => {
    if (!isMobile) return;
    document.documentElement.classList.add('kb-viewer-mobile');
    return () => document.documentElement.classList.remove('kb-viewer-mobile');
  }, [isMobile]);

  // B48: persist + restore current frame via URL search param `?f=N` so
  // refreshes keep your place AND links to a specific frame share cleanly.
  // Uses router.replace with scroll:false to avoid touching scroll position
  // on every step. Reads the initial value once on mount; subsequent URL
  // changes (e.g. browser back) don't re-sync state to avoid a write-loop
  // with the writer effect below.
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFrameRef = useRef<number | null>(null);
  if (initialFrameRef.current === null) {
    const raw = searchParams?.get('f');
    const n = raw ? parseInt(raw, 10) : NaN;
    initialFrameRef.current = Number.isFinite(n) && n > 0 ? n - 1 : 0;
  }
  // Apply the initial frame once frames have loaded (the index is 0-based
  // internally; the URL is 1-based for human-friendly sharing).
  const appliedInitialRef = useRef(false);
  // After every currentIndex change, mirror to the URL. Skip the first
  // render — searchParams is the source of truth on initial mount.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
    const human = currentIndex + 1;
    if (currentIndex === 0) params.delete('f');
    else params.set('f', String(human));
    const qs = params.toString();
    const url = qs ? `?${qs}` : window.location.pathname;
    router.replace(url, { scroll: false });
    // Intentionally exclude searchParams + router from deps — replace runs
    // on every meaningful frame change, not on its own URL writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);
  // Start at the server-safe default so SSR and the first client render agree;
  // hydrate the persisted choice in an effect after mount (mirrors the
  // sidebar-width pattern below). Reading localStorage in the useState
  // initializer caused a hydration mismatch on the step-mode toggle's
  // aria-pressed/styling when the saved mode differed from the default.
  const [mode, setMode] = useState<StepMode>('action');
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('karabuddy:stepMode');
      if (v === 'frame' || v === 'action') setMode(v);
    } catch {}
  }, []);
  // Persist on change — but skip the mount pass so we don't clobber the stored
  // value before the hydrate effect above has read it.
  const stepModePersistReady = useRef(false);
  useEffect(() => {
    if (!stepModePersistReady.current) { stepModePersistReady.current = true; return; }
    try { window.localStorage.setItem('karabuddy:stepMode', mode); } catch {}
  }, [mode]);

  const frames = decoded?.frames || null;
  const activeByFrame = decoded?.activeByFrame || null;

  // B48: apply the URL-derived initial frame once frames are decoded.
  // Clamps to [0, total-1] in case the link points at a frame that no
  // longer exists (replay re-uploaded shorter, etc).
  useEffect(() => {
    if (appliedInitialRef.current) return;
    if (!frames || frames.length === 0) return;
    const target = Math.max(0, Math.min(frames.length - 1, initialFrameRef.current ?? 0));
    appliedInitialRef.current = true;
    if (target !== 0) setCurrentIndex(target);
  }, [frames, setCurrentIndex]);

  // Step delta — `dir` is +/-1. Action mode walks through frames until the
  // active player changes (matches the extension's advanceByAction).
  const step = useMemo(() => (dir: 1 | -1) => {
    if (!frames || frames.length === 0) return;
    if (mode === 'action' && activeByFrame) {
      const total = frames.length;
      const cur = activeByFrame[currentIndex];
      let next = currentIndex + dir;
      while (next >= 0 && next < total && activeByFrame[next] === cur) next += dir;
      if (next < 0 || next >= total) next = dir > 0 ? total - 1 : 0;
      if (next !== currentIndex) setCurrentIndex(next);
    } else {
      const next = Math.max(0, Math.min(frames.length - 1, currentIndex + dir));
      if (next !== currentIndex) setCurrentIndex(next);
    }
  }, [frames, activeByFrame, currentIndex, mode]);

  // B13: jump to the previous/next tagged frame. Lifted out of TagSidebar so
  // the keydown handler below can invoke it for `[` / `]` without DOM
  // querying; TagSidebar's prev/next-tag buttons now call this via prop.
  const jumpToAdjacentTag = useCallback((dir: 1 | -1) => {
    const sorted = tagState.map((t) => t.frameIndex).sort((a, b) => a - b);
    const target =
      dir > 0
        ? sorted.find((i) => i > currentIndex)
        : [...sorted].reverse().find((i) => i < currentIndex);
    if (target != null) setCurrentIndex(target);
  }, [tagState, currentIndex, setCurrentIndex]);

  // Fetch + decode the payload from Blob.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(replay.payloadBlobUrl);
        if (!res.ok) throw new Error(`payload fetch failed: ${res.status}`);
        const text = await res.text();
        const parsed = JSON.parse(text);
        const result = decodeReplay(parsed);
        if (cancelled) return;
        setDecoded(result);
        // Prefer the player ID captured by the recorder (the local karabast
        // user whose perspective this match was played from). Fall back to
        // the first player key for older replays that predate the recorder
        // embedding it.
        const players = result.frames[0]?.state?.players;
        const localId = result.meta.localPlayerId;
        const connected =
          (localId && players && Object.prototype.hasOwnProperty.call(players, localId))
            ? localId
            : players ? Object.keys(players)[0] : null;
        if (connected) setConnectedPlayer(connected);
      } catch (err: any) {
        if (cancelled) return;
        setLoadError(err?.message || 'failed to load replay');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [replay.payloadBlobUrl, setConnectedPlayer]);

  // Push the current frame's state into the game context whenever we step.
  useEffect(() => {
    if (!frames || frames.length === 0) return;
    const i = Math.max(0, Math.min(frames.length - 1, currentIndex));
    setGameState(frames[i].state);
  }, [frames, currentIndex, setGameState]);

  // Keyboard nav. Shift+arrow temporarily flips mode (action↔frame).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey) {
          // Temporary flip — step one in the OTHER mode, then leave the
          // mode setting alone.
          const otherMode: StepMode = mode === 'action' ? 'frame' : 'action';
          if (!frames) return;
          if (otherMode === 'action' && activeByFrame) {
            const total = frames.length;
            const cur = activeByFrame[currentIndex];
            let next = currentIndex + dir;
            while (next >= 0 && next < total && activeByFrame[next] === cur) next += dir;
            if (next < 0 || next >= total) next = dir > 0 ? total - 1 : 0;
            if (next !== currentIndex) setCurrentIndex(next);
          } else {
            const next = Math.max(0, Math.min(frames.length - 1, currentIndex + dir));
            if (next !== currentIndex) setCurrentIndex(next);
          }
        } else {
          step(dir as 1 | -1);
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        setCurrentIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setCurrentIndex((frames?.length || 1) - 1);
      } else if (e.key === '[' || e.key === ']') {
        // B13: prev/next tag — no-op when no tag exists in that direction.
        e.preventDefault();
        jumpToAdjacentTag(e.key === ']' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [frames, activeByFrame, currentIndex, mode, step, jumpToAdjacentTag]);

  const playerUsernames = useMemo(() => {
    const set = new Set<string>();
    for (const p of (replay.players as any[]) || []) {
      if (p?.username && !/^anonymous\s/i.test(p.username)) set.add(p.username);
    }
    return set;
  }, [replay.players]);

  if (loadError) {
    return (
      <div style={{ padding: 32, color: '#ff6b6b', fontFamily: 'var(--font-barlow), sans-serif' }}>
        Failed to load replay: {loadError}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - var(--kb-header-h, 0px))', overflow: 'hidden' }}>
      {/* B66b: gameboard first, sidebar second — sidebar now lives on
          the RIGHT (matches mobile drawer anchor). When the desktop
          sidebar is closed, TagSidebar unmounts its <aside>, so the
          gameboard's flex:1 reclaims the full width. */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        {frames ? (
          <Gameboard />
        ) : (
          <div style={{ padding: 32, color: '#a0a8b8', fontFamily: 'var(--font-barlow), sans-serif' }}>
            Loading replay…
          </div>
        )}
      </div>
      {/* The viewer is wrapped in the gameboard's ThemeContextProvider (for
          the board); re-assert the KaraBuddy theme over the sidebar so its
          MUI controls match the chrome instead of the gameboard's default
          MUI theme. TagSidebar uses no gameboard contexts, only the theme. */}
      <KaraBuddyThemeProvider>
      <TagSidebar
        replay={replay}
        frames={frames}
        currentIndex={currentIndex}
        lastTransition={lastTransition}
        onStep={step}
        onJump={setCurrentIndex}
        onJumpToAdjacentTag={jumpToAdjacentTag}
        tags={tagState}
        setTags={setTagState}
        playerUsernames={playerUsernames}
        mode={mode}
        setMode={setMode}
        messagesByFrame={decoded?.messagesByFrame || null}
        drawerOpen={drawerOpen}
        setDrawerOpen={setReviewOpen}
        isMobile={isMobile}
        reviewSize={reviewDrag.size}
        reviewDragging={reviewDrag.dragging}
        reviewHandleProps={reviewDrag.handleProps}
        mobileLandscape={mobileLandscape}
        mobilePortrait={mobilePortrait}
        sidebarWidth={sidebarWidth}
        setSidebarWidth={setSidebarWidth}
        // B42: prefer DB columns (replay.match / replay.decks) since they're
        // already populated server-side; fall back to decoder.meta if a
        // historical replay only has them embedded in the blob.
        matchMeta={replay.match ?? decoded?.meta.match ?? null}
        decks={replay.decks ?? decoded?.meta.decks ?? null}
        localPlayerId={decoded?.meta.localPlayerId ?? null}
        armedTeams={armedTeams}
        onArmedTeamsChange={setArmedTeams}
      />
      </KaraBuddyThemeProvider>
      {(() => {
        // B100: chevron + FAB geometry, derived from the LIVE review-sheet
        // size so everything rides with the sheet as you drag it.
        //   • Portrait review open → chevrons centre in the board band ABOVE
        //     the bottom sheet (drag taller → they rise). FABs + step pill lift
        //     to just above the sheet's top edge.
        //   • A RIGHT-anchored sheet (desktop docked sidebar OR mobile-landscape
        //     review) pushes the right chevron + FABs inward past its left edge.
        const edgeR = 'max(8px, env(safe-area-inset-right, 8px))';
        const edgeB = 'max(12px, env(safe-area-inset-bottom, 12px))';
        const rightSheetOpen = drawerOpen && (!isMobile || mobileLandscape);
        const rightSheetW = isMobile ? `${reviewDrag.size}px` : `${sidebarWidth}px`;
        const chevRight = rightSheetOpen ? `calc(${rightSheetW} + 8px)` : 'max(8px, env(safe-area-inset-left, 8px))';
        const portraitLift = mobilePortrait && drawerOpen;
        const fabRight = mobileLandscape && drawerOpen ? `calc(${reviewDrag.size}px + 12px)` : edgeR;
        const navVerticalCenter = portraitLift ? `calc((100vh - ${reviewDrag.size}px) / 2)` : '50%';
        return (
          <>
            <FrameNavOverlay
              leftOffset="max(8px, env(safe-area-inset-left, 8px))"
              rightOffset={chevRight}
              verticalCenter={navVerticalCenter}
              dragging={reviewDrag.dragging}
              onStep={step}
              canPrev={currentIndex > 0}
              canNext={!!frames && currentIndex < frames.length - 1}
              // Desktop only: faint keyboard hint adjacent to each chevron.
              showKeyboardHint={!isMobile}
            />
            {/* B66b/B100: floating step-mode toggle. Desktop tracks the docked
                sidebar (shifts left past it). Mobile pins it bottom-center but
                lifts above the portrait sheet so it doesn't overlay it. */}
            <StepModeOverlay
              mode={mode}
              setMode={setMode}
              landscape={!isMobile}
              drawerOpen={drawerOpen}
              drawerWidth={`${sidebarWidth}px`}
              portraitDrawerOpen={portraitLift}
              portraitBottom={portraitLift ? `calc(${reviewDrag.size}px + 12px)` : undefined}
              dragging={reviewDrag.dragging}
            />
            {/* B100: matchup FAB sits to the LEFT of the ☰ review FAB on the
                same row (horizontal, to spare a row of vertical space), and
                rides clear of the sheet edge using the same offsets. */}
            {isMobile && (
              <button
                type="button"
                onClick={() => openMatchup(!matchupOpen)}
                aria-label={matchupOpen ? 'Hide matchup info' : 'Show matchup info'}
                title={matchupOpen ? 'Hide matchup' : 'Matchup info'}
                style={{
                  position: 'fixed',
                  bottom: portraitLift ? `calc(${reviewDrag.size}px + 12px)` : edgeB,
                  right: `calc(${fabRight} + 50px)`,
                  zIndex: 90,
                  width: 38,
                  height: 38,
                  background: matchupOpen ? 'rgba(77, 157, 255, 0.32)' : 'rgba(36, 48, 68, 0.85)',
                  color: '#d6e7ff',
                  border: '1px solid rgba(77, 157, 255, 0.4)',
                  borderRadius: '50%',
                  padding: 0,
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.45)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backdropFilter: 'blur(6px)',
                  transition: reviewDrag.dragging
                    ? 'background 160ms ease'
                    : 'right 220ms cubic-bezier(0.4, 0, 0.2, 1), bottom 220ms cubic-bezier(0.4, 0, 0.2, 1), background 160ms ease',
                }}
              >
                <InfoIcon />
              </button>
            )}
          </>
        );
      })()}
      {/* B100: mobile backdrop — closes whichever sheet is open. The two FABs
          (☰ review in TagSidebar so it can track the desktop sidebar, ⓘ
          matchup in the overlay block above) sit just outside the open sheet
          rather than over it. */}
      {isMobile && (matchupOpen || reviewOpen) && (
        <div
          onClick={() => { setMatchupOpen(false); setReviewOpen(false); }}
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 'var(--kb-header-h, 0px) 0 0 0',
            zIndex: 75,
            background: 'rgba(0, 0, 0, 0.45)',
            animation: 'kb-fade-in 220ms ease',
          }}
        />
      )}
      {/* B66/B100: mobile matchup panel. Anchored LEFT in landscape, TOP in
          portrait. Opened by the dedicated ⓘ FAB (no longer shares the ☰
          tags trigger). Collapsed by default. */}
      {isMobile && (
        <MatchupPanel
          open={matchupOpen}
          onClose={() => setMatchupOpen(false)}
          anchor={isLandscape ? 'left' : 'top'}
          replay={replay}
          matchMeta={replay.match ?? decoded?.meta.match ?? null}
          decks={replay.decks ?? decoded?.meta.decks ?? null}
          localPlayerId={decoded?.meta.localPlayerId ?? null}
          frames={frames}
          installToken={installToken}
          isOwner={isOwner}
        />
      )}
    </div>
  );
}

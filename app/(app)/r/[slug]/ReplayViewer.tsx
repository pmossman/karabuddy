'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemeContextProvider } from '@/app/_contexts/Theme.context';
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
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useSession } from 'next-auth/react';
import { getOrCreateInstallToken } from '@/lib/installToken';
import { canMutateReplay } from '@/lib/replayPermissions';

const MOBILE_DRAWER_WIDTH = 'min(380px, 100vw)';

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
  visibility: string;
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
  // B66b: desktop now also uses the toggleable sidebar — same chrome on
  // every viewport. Open by default on desktop, closed on mobile so the
  // first paint shows the full gameboard. We track "did the user touch
  // it" so the isMobile-based auto-sync doesn't clobber a manual choice.
  const [drawerOpen, setDrawerOpenRaw] = useState(false);
  const userTouchedDrawerRef = useRef(false);
  useEffect(() => {
    if (userTouchedDrawerRef.current) return;
    setDrawerOpenRaw(!isMobile);
  }, [isMobile]);
  const setDrawerOpen = useCallback((next: boolean) => {
    userTouchedDrawerRef.current = true;
    setDrawerOpenRaw(next);
  }, []);
  // B66b: lifted from TagSidebar so FrameNavOverlay's right-chevron
  // offset can track the actual desktop sidebar width (was hardcoded to
  // the mobile drawer width, making it float in dead space).
  const [sidebarWidth, setSidebarWidth] = useState<number>(360);

  // B66e: ownership resolved here so both TagSidebar (desktop) AND
  // MatchupPanel (mobile) can show owner-only affordances from the
  // same source of truth.
  const { data: session } = useSession();
  const sessionUserId: string | null = ((session?.user as any)?.id as string | undefined) || null;
  const [installToken, setInstallToken] = useState('');
  useEffect(() => { setInstallToken(getOrCreateInstallToken()); }, []);
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
  const [mode, setMode] = useState<StepMode>(() => {
    if (typeof window === 'undefined') return 'action';
    try {
      const v = window.localStorage.getItem('karabuddy:stepMode');
      return v === 'frame' ? 'frame' : 'action';
    } catch { return 'action'; }
  });

  useEffect(() => {
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
        setDrawerOpen={setDrawerOpen}
        isMobile={isMobile}
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
      />
      <FrameNavOverlay
        drawerOpen={drawerOpen}
        leftPanelOpen={mobileLandscape && drawerOpen}
        leftPanelWidth="min(280px, 60vw)"
        // Portrait's bottom drawer covers vertical 50%; shift chevrons
        // up to the centerline above it so they stay reachable.
        verticalCenter={mobilePortrait && drawerOpen ? '20%' : '50%'}
        onStep={step}
        canPrev={currentIndex > 0}
        canNext={!!frames && currentIndex < frames.length - 1}
        // B66b: track the actual desktop sidebar width so the right
        // chevron hugs the sidebar's left edge as it resizes. Mobile
        // sticks with the fixed mobile drawer width.
        drawerWidth={isMobile ? MOBILE_DRAWER_WIDTH : `${sidebarWidth}px`}
        // Desktop only: faint keyboard hint adjacent to each chevron.
        showKeyboardHint={!isMobile}
      />
      {/* B66b: floating step-mode toggle on every viewport. Tracks the
          sidebar — shifts LEFT past it when open so it doesn't get
          buried; lifts UP above the portrait bottom drawer. */}
      <StepModeOverlay
        mode={mode}
        setMode={setMode}
        landscape={isLandscape || !isMobile}
        drawerOpen={drawerOpen}
        drawerWidth={isMobile ? MOBILE_DRAWER_WIDTH : `${sidebarWidth}px`}
        portraitDrawerOpen={mobilePortrait && drawerOpen}
      />
      {/* B66: mobile matchup panel. Anchored LEFT in landscape, TOP in
          portrait — same ☰ trigger that opens the tags drawer (which
          anchors RIGHT in landscape, BOTTOM in portrait) opens this. */}
      {isMobile && (
        <MatchupPanel
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
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

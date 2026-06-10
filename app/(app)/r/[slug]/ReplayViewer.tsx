'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemeContextProvider } from '@/app/_contexts/Theme.context';
import { KaraBuddyThemeProvider } from '@/app/_components/KaraBuddyThemeProvider';
import { CosmeticsProvider } from '@/app/_contexts/CosmeticsContext';
import { UserProvider } from '@/app/_contexts/User.context';
import { PopupProvider } from '@/app/_contexts/Popup.context';
import { GameProvider, useGame } from '@/app/_contexts/Game.context';
import { FrameAnimator } from './FrameAnimator';
import { computeActionStops, nextActionStop } from './actionStops';
import { EndGameSummary } from './EndGameSummary';
import { computeEndGameStats } from '@/lib/endGameStats';
import { JumpToMenu } from './JumpToMenu';
import { computeChapters, type Chapter } from '@/lib/replayChapters';
import { anonymizeFrames, anonByIdFromPlayers, anonymizeDecks } from '@/lib/anonymizeReplay';
import Gameboard from '@/app/_components/Gameboard/Gameboard';
import { useRouter, useSearchParams } from 'next/navigation';
import { decodeReplay, collapseReplay, type Frame, type CollapsedReplay } from '@/lib/replayDecoder';
import { mapFrameIndex } from '@/lib/replaySignature';
import { TagSidebar } from './TagSidebar';
import { StepModeOverlay, MobileControlsFab, MatchupPanel } from './MobileLandscapePanels';
import { InstallExtensionCta } from '@/app/_components/InstallExtensionCta';
import { ResourcingModal } from './ResourcingModal';
import { FrameNavOverlay } from './FrameNavOverlay';
import { useDragSize } from './useDragSize';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useSession } from 'next-auth/react';
import { getOrCreateInstallToken } from '@/lib/installToken';
import { canMutateReplay } from '@/lib/replayPermissions';

// B104: cadence of the action-mode multi-frame playback (ms between frames).
// Tuned to ~the card-move animation length so consecutive transitions flow.
const PLAYBACK_TICK_MS = 300;
// If two action steps arrive within this window, the user is holding the arrow
// (key-repeat ~30-50ms) — fly through instead of playing the choreography.
const HELD_STEP_MS = 180;

// B104: auto-play speed tiers. There's no objective "real-time" rate for a
// replay (frames aren't evenly spaced in wall-clock), so the UI labels these
// qualitatively; `value` is the dwell divisor (higher = less time per frame).
const PLAY_SPEEDS = [
  { label: 'Slow', value: 0.25 },
  { label: 'Normal', value: 0.5 },
  { label: 'Fast', value: 1 },
  { label: 'Faster', value: 3 },
] as const;
const PLAY_SPEED_DEFAULT = 0.5; // Normal
const PLAY_SPEED_STORAGE_KEY = 'karabuddy:playSpeed';
// Never dwell shorter than this regardless of speed — below it the board can't
// keep up and frames just blur past without registering.
const PLAY_MIN_DWELL_MS = 45;

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
  // B107: a curated sample shown publicly on the signed-out home — anonymize
  // the board + game log and skip the (scoped) tag fetch.
  anonymize?: boolean;
  // B112: this viewer is a team member entitled to the second player's
  // perspective (computed server-side in page.tsx). Gates the Flip control.
  canFlip?: boolean;
  // B121-followup: signed-in viewer already has a linked extension (server-known)
  // → suppress the install-onboarding banner regardless of the browser probe.
  hasLinkedExtension?: boolean;
}

export function ReplayViewer({ replay, initialTags, anonymize, canFlip, hasLinkedExtension }: Props) {
  return (
    <ThemeContextProvider>
      <UserProvider>
        <CosmeticsProvider>
          <PopupProvider>
            <GameProvider>
              <ViewerShell replay={replay} initialTags={initialTags} anonymize={anonymize} canFlip={canFlip} hasLinkedExtension={hasLinkedExtension} />
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

function ViewerShell({ replay, initialTags, anonymize, canFlip, hasLinkedExtension }: Props) {
  const { setGameState, setConnectedPlayer } = useGame();
  const [decoded, setDecoded] = useState<CollapsedReplay | null>(null);
  // B112: double-sided replay. `decoded` is always the CANONICAL perspective
  // (the public payload). When the viewer flips, we lazily fetch + decode the
  // alt perspective from the auth-gated endpoint and drive the viewer off it.
  const [pov, setPov] = useState<'canonical' | 'alt'>('canonical');
  const [altDecoded, setAltDecoded] = useState<CollapsedReplay | null>(null);
  const activeDecoded = pov === 'alt' && altDecoded ? altDecoded : decoded;
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
  // B104: latest currentIndex for the action-playback driver (avoids stale
  // closures), + the active playback (interval) handle.
  const currentIndexRef = useRef(0);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  const playRef = useRef<{ timer: number; target: number; dir: 1 | -1 } | null>(null);
  const lastStepAt = useRef(0); // timestamp of the last action step (held vs deliberate)
  const stopPlayback = useCallback(() => {
    if (playRef.current) { window.clearTimeout(playRef.current.timer); playRef.current = null; }
  }, []);
  useEffect(() => () => stopPlayback(), [stopPlayback]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tagState, setTagState] = useState<TagRow[]>(initialTags);
  // B104 (prototype): FLIP card-movement animation between frames. Toggle +
  // board container ref for the overlay animator.
  const boardRef = useRef<HTMLDivElement>(null);
  const [animate, setAnimate] = useState(true);
  useEffect(() => {
    try { const v = window.localStorage.getItem('karabuddy:animate'); if (v != null) setAnimate(v === '1'); } catch {}
  }, []);
  const toggleAnimate = useCallback(() => {
    setAnimate((v) => { const next = !v; try { window.localStorage.setItem('karabuddy:animate', next ? '1' : '0'); } catch {} return next; });
  }, []);
  // Live mirror for the autoplay driver, which reads `animate` from inside a
  // setTimeout closure — toggling animation mid-play then takes effect on the
  // next frame (animate on → per-frame choreography dwell; off → flat cadence)
  // without restarting playback.
  const animateRef = useRef(animate);
  useEffect(() => { animateRef.current = animate; }, [animate]);

  // B104: auto-play ("watch the replay"). A self-rescheduling timer that walks
  // every frame to the end so card animations actually play, dwelling per frame
  // by its choreography length (frameAnimMs) scaled by the speed multiplier.
  // Independent of step-mode (which only governs manual arrow/chevron stepping).
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const autoplayTimerRef = useRef<number | null>(null);
  // B121: pulse the Play button to cue first-time viewers; cleared the first
  // time they press play, remembered across visits. Initialized in an effect
  // (not the useState initializer) to avoid an SSR/hydration mismatch.
  const [pulsePlay, setPulsePlay] = useState(false);
  useEffect(() => {
    try { if (!window.localStorage.getItem('karabuddy:hasPlayedReplay')) setPulsePlay(true); } catch {}
  }, []);
  const [speed, setSpeed] = useState<number>(PLAY_SPEED_DEFAULT);
  const speedRef = useRef(PLAY_SPEED_DEFAULT);
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(PLAY_SPEED_STORAGE_KEY));
      if (PLAY_SPEEDS.some((o) => o.value === v)) { setSpeed(v); speedRef.current = v; }
    } catch {}
  }, []);
  const stopAutoplay = useCallback(() => {
    playingRef.current = false;
    if (autoplayTimerRef.current != null) { window.clearTimeout(autoplayTimerRef.current); autoplayTimerRef.current = null; }
    setPlaying(false);
  }, []);
  const setSpeedValue = useCallback((next: number) => {
    speedRef.current = next;
    setSpeed(next);
    try { window.localStorage.setItem(PLAY_SPEED_STORAGE_KEY, String(next)); } catch {}
  }, []);
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
  // B101: per-game resourcing report (analyzed client-side from decoded frames).
  const [resourcingOpen, setResourcingOpen] = useState(false);
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
    // B107: a public sample replay never loads tags — their authors are real
    // handles we don't want to surface, and the comment UI isn't the point.
    if (anonymize) return;
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
  }, [installToken, sessionUserId, replay.slug, anonymize]);
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
  const urlTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    // B104: debounce the URL write. `router.replace` per step is expensive (a
    // Next navigation); firing it 30×/s while holding the arrow tanks perf. We
    // only need the final frame in the URL — write it once stepping settles.
    if (urlTimerRef.current != null) window.clearTimeout(urlTimerRef.current);
    urlTimerRef.current = window.setTimeout(() => {
      const params = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
      // Mirror as an ORIGINAL index so the link round-trips and matches external
      // deep-links (comments/decks) that point at original frame indices.
      const human = collapsedToOriginal(currentIndexRef.current) + 1;
      if (currentIndexRef.current === 0) params.delete('f');
      else params.set('f', String(human));
      const qs = params.toString();
      const url = qs ? `?${qs}` : window.location.pathname;
      router.replace(url, { scroll: false });
    }, 200);
    // Intentionally exclude searchParams + router from deps — replace runs
    // on every meaningful frame change, not on its own URL writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);
  useEffect(() => () => { if (urlTimerRef.current != null) window.clearTimeout(urlTimerRef.current); }, []);
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

  const frames = activeDecoded?.frames || null;
  const activeByFrame = activeDecoded?.activeByFrame || null;

  // B104: end-of-game summary. Computed once from the decoded frames + the
  // winner playerIds; surfaced when you reach the final frame, hidden the
  // moment you step back (or dismiss it). `summaryDismissed` resets whenever
  // you leave the last frame, so re-reaching the end re-shows it.
  const endStats = useMemo(
    () => computeEndGameStats(frames, (replay.winners as string[] | null) ?? null),
    [frames, replay.winners],
  );
  const [summaryDismissed, setSummaryDismissed] = useState(false);
  const atEnd = !!frames && frames.length > 1 && currentIndex >= frames.length - 1;
  useEffect(() => { if (!atEnd) setSummaryDismissed(false); }, [atEnd]);
  const showSummary = atEnd && !summaryDismissed && endStats != null;

  // B104: how long action-playback should dwell on each frame before advancing
  // — longer for frames with an attack, so the lunge→death→reflow choreography
  // (in FrameAnimator) has time to play instead of being cut off.
  const frameAnimMs = useMemo(() => {
    const fr = decoded?.frames;
    if (!fr) return [] as number[];
    return fr.map((f: Frame) => {
      const msgs = (f.state as any)?.newMessages;
      const has = (re: RegExp) => Array.isArray(msgs) && msgs.some((m: any) =>
        Array.isArray(m?.message) && m.message.some((p: any) => typeof p === 'string' && re.test(p)));
      if (has(/attacks/i)) return 900;   // lunge → death → reflow choreography
      if (has(/plays /i)) return 720;    // slide-in + flip reveal
      return PLAYBACK_TICK_MS;
    });
  }, [decoded]);
  const frameAnimMsRef = useRef<number[]>([]);
  useEffect(() => { frameAnimMsRef.current = frameAnimMs; }, [frameAnimMs]);

  // B102: the viewer steps in COLLAPSED frame space (currentIndex), but the DB
  // and the shareable `?f=` URL stay in the recorder's ORIGINAL space so old
  // tags + external deep-links keep working. Convert at the boundary.
  const frameRemap = activeDecoded?.frameRemap || null;          // orig -> collapsed
  const collapsedToOrig = activeDecoded?.collapsedToOrig || null; // collapsed -> orig
  const origToCollapsed = useCallback((i: number) => {
    if (!frameRemap || frameRemap.length === 0) return i;
    return frameRemap[Math.min(Math.max(i, 0), frameRemap.length - 1)] ?? 0;
  }, [frameRemap]);
  const collapsedToOriginal = useCallback((c: number) => {
    if (!collapsedToOrig || collapsedToOrig.length === 0) return c;
    return collapsedToOrig[Math.min(Math.max(c, 0), collapsedToOrig.length - 1)] ?? c;
  }, [collapsedToOrig]);
  // Tags are stored at original indices; reposition them onto collapsed frames
  // for display (markers, jump targets, "tags at this frame").
  const displayTags = useMemo(
    () => tagState.map((t) => ({ ...t, frameIndex: origToCollapsed(t.frameIndex) })),
    [tagState, origToCollapsed],
  );

  // B106: "jump to a moment" chapters — structural beats (rounds, leader flips,
  // start/end) from the frames, merged with the user's tags (in collapsed-frame
  // space). Stable sort by frame keeps start first / end last at ties.
  const chapters = useMemo<Chapter[]>(() => {
    const structural = computeChapters(frames);
    const tagChapters: Chapter[] = displayTags.map((t) => ({
      frameIndex: t.frameIndex,
      kind: 'tag',
      label: (t.comment || 'Tag').slice(0, 48),
      sublabel: t.authorName || undefined,
    }));
    return [...structural, ...tagChapters].sort((a, b) => a.frameIndex - b.frameIndex);
  }, [frames, displayTags]);

  // B107: the deck snapshots shown in the matchup panel / decks modal also
  // carry the player's handle + their (user-authored) deck title — anonymize
  // both for sample replays. Falls back to the payload-embedded decks for older
  // rows that lack the DB column.
  const decksForView = useMemo(() => {
    const d = replay.decks ?? activeDecoded?.meta.decks ?? null;
    if (!anonymize) return d;
    // B122: anonymized viewers (non-uploader, non-teammate) don't get full
    // decklists — keep leader/base for the card thumbnails, drop the deck +
    // sideboard lists and the deck name. The DecksModal shows the "seen during
    // play" cards (derived from frames) instead.
    const anon = anonymizeDecks(d as any, anonByIdFromPlayers(replay.players as any[]));
    if (!anon) return null;
    const out: Record<string, any> = {};
    for (const [pid, deck] of Object.entries(anon)) out[pid] = { ...(deck as any), deck: null, sideboard: null };
    return out;
  }, [replay.decks, replay.players, activeDecoded, anonymize]);

  // B48: apply the URL-derived initial frame once frames are decoded.
  // Clamps to [0, total-1] in case the link points at a frame that no
  // longer exists (replay re-uploaded shorter, etc).
  useEffect(() => {
    if (appliedInitialRef.current) return;
    if (!frames || frames.length === 0) return;
    // The URL's ?f= is an ORIGINAL frame index — map it onto the collapsed
    // timeline (a deep-link to an undone/static frame lands on its survivor).
    const collapsedTarget = origToCollapsed(initialFrameRef.current ?? 0);
    const target = Math.max(0, Math.min(frames.length - 1, collapsedTarget));
    appliedInitialRef.current = true;
    if (target !== 0) setCurrentIndex(target);
  }, [frames, setCurrentIndex, origToCollapsed]);

  // B104: the next action-boundary frame from `from` in `dir`. Actions are runs
  // of frames sharing an active player PLUS the regroup-phase beats (a player
  // drawing / resourcing / discarding), so stepping by action stops on those
  // instead of blowing through them. Both directions land on a stop, so a
  // forward step then a back step are inverses. (B108)
  const actionStops = useMemo(() => computeActionStops(frames, activeByFrame), [frames, activeByFrame]);
  const actionBoundary = useCallback(
    (from: number, dir: 1 | -1) => nextActionStop(actionStops, from, dir),
    [actionStops],
  );

  // Step delta — `dir` is +/-1.
  //  - Frame mode: one frame.
  //  - Action mode: a DELIBERATE step plays through every frame to the next
  //    action boundary so the intermediate moves/attacks animate (B104). But
  //    HOLDING the arrow (rapid repeats) just jumps boundary-to-boundary so you
  //    fly through — no cadence pacing, no animation.
  const step = useMemo(() => (dir: 1 | -1) => {
    if (!frames || frames.length === 0) return;
    stopAutoplay(); // a manual step takes over from auto-play
    if (mode === 'action' && activeByFrame) {
      const now = performance.now();
      const held = now - lastStepAt.current < HELD_STEP_MS;
      lastStepAt.current = now;
      if (held) {
        // Held / rapid → fly: jump straight to the next boundary.
        stopPlayback();
        const target = actionBoundary(currentIndexRef.current, dir);
        if (target !== currentIndexRef.current) setCurrentIndex(target);
        return;
      }
      stopPlayback(); // deliberate single step → play through (choreography)
      const start = currentIndexRef.current;
      const target = actionBoundary(start, dir);
      if (target === start) return;
      const stepDir: 1 | -1 = target > start ? 1 : -1;
      let pos = start;
      // Recursive timer (not a fixed interval) so each frame can dwell for its
      // own animation length (attack frames longer than the rest).
      playRef.current = { timer: 0, target, dir };
      const advance = () => {
        pos += stepDir;
        setCurrentIndex(pos);
        if (pos === target) { stopPlayback(); return; }
        if (!playRef.current) return;
        const delay = frameAnimMsRef.current[pos] ?? PLAYBACK_TICK_MS;
        playRef.current.timer = window.setTimeout(advance, delay);
      };
      advance(); // first frame immediately
    } else {
      stopPlayback();
      // Functional update — robust against a stale `currentIndex` closure while
      // the arrow is held (rapid steps come faster than re-renders commit).
      setCurrentIndex((cur) => Math.max(0, Math.min(frames.length - 1, cur + dir)));
    }
  }, [frames, activeByFrame, mode, actionBoundary, stopPlayback, stopAutoplay, setCurrentIndex]);

  // B104: start auto-play from the current frame to the end. If we're already
  // at (or past) the last frame, restart from the top — matches the "press play
  // again at the end to rewatch" convention of every video player.
  const startAutoplay = useCallback(() => {
    if (!frames || frames.length === 0) return;
    stopPlayback(); // cancel any in-flight action-step play-through
    let pos = currentIndexRef.current;
    if (pos >= frames.length - 1) { pos = 0; setCurrentIndex(0); }
    playingRef.current = true;
    setPlaying(true);
    // B121: they've now used Play — stop the first-time pulse for good.
    setPulsePlay(false);
    try { window.localStorage.setItem('karabuddy:hasPlayedReplay', '1'); } catch {}
    const tick = () => {
      if (!playingRef.current || !frames) return;
      if (pos >= frames.length - 1) { stopAutoplay(); return; }
      pos += 1;
      setCurrentIndex(pos);
      if (pos >= frames.length - 1) { stopAutoplay(); return; } // landed on last
      const base = animateRef.current ? (frameAnimMsRef.current[pos] ?? PLAYBACK_TICK_MS) : PLAYBACK_TICK_MS;
      autoplayTimerRef.current = window.setTimeout(tick, Math.max(PLAY_MIN_DWELL_MS, base / speedRef.current));
    };
    // Dwell on the CURRENT frame before advancing to the next, so the very
    // first transition gets the same pacing as the rest.
    const first = animateRef.current ? (frameAnimMsRef.current[pos] ?? PLAYBACK_TICK_MS) : PLAYBACK_TICK_MS;
    autoplayTimerRef.current = window.setTimeout(tick, Math.max(PLAY_MIN_DWELL_MS, first / speedRef.current));
  }, [frames, stopPlayback, stopAutoplay, setCurrentIndex]);
  const toggleAutoplay = useCallback(() => {
    if (playingRef.current) stopAutoplay(); else startAutoplay();
  }, [startAutoplay, stopAutoplay]);

  // B13: jump to the previous/next tagged frame. Lifted out of TagSidebar so
  // the keydown handler below can invoke it for `[` / `]` without DOM
  // querying; TagSidebar's prev/next-tag buttons now call this via prop.
  const jumpToAdjacentTag = useCallback((dir: 1 | -1) => {
    const sorted = displayTags.map((t) => t.frameIndex).sort((a, b) => a - b);
    const target =
      dir > 0
        ? sorted.find((i) => i > currentIndex)
        : [...sorted].reverse().find((i) => i < currentIndex);
    if (target != null) { stopAutoplay(); stopPlayback(); setCurrentIndex(target); }
  }, [displayTags, currentIndex, setCurrentIndex, stopPlayback, stopAutoplay]);

  // B104: a direct jump (slider, tag click) must cancel any playback.
  const jumpTo = useCallback((i: number) => { stopAutoplay(); stopPlayback(); setCurrentIndex(i); }, [stopPlayback, stopAutoplay, setCurrentIndex]);

  // Fetch + decode the payload from Blob.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(replay.payloadBlobUrl);
        if (!res.ok) throw new Error(`payload fetch failed: ${res.status}`);
        const text = await res.text();
        const parsed = JSON.parse(text);
        // B102: collapse undone + board-static frames so stepping only lands on
        // real, distinct board positions. `decodeReplay` stays raw (extraction
        // path); the viewer renders the collapsed timeline.
        const result = collapseReplay(decodeReplay(parsed));
        if (cancelled) return;
        // B107: sample replay → rewrite the board labels + game-log player
        // names to "Player N" before the frames ever reach the game context.
        // The id→label map comes from the (already-anonymized) players prop, so
        // the board, log, and card all agree.
        if (anonymize) anonymizeFrames(result.frames, anonByIdFromPlayers(replay.players as any[]));
        setDecoded(result);
        // Prefer the player ID captured by the recorder (the local karabast
        // Board orientation (connectedPlayer) is set by a dedicated effect that
        // tracks the ACTIVE perspective (canonical or alt), so a flip re-orients
        // without re-running this fetch. See below.
      } catch (err: any) {
        if (cancelled) return;
        setLoadError(err?.message || 'failed to load replay');
      }
    })();
    return () => {
      cancelled = true;
    };
    // Key ONLY on the payload URL — the stable identity of this replay. Stepping
    // updates the ?f= URL, which re-renders the force-dynamic server page and
    // hands down a NEW `replay` object (fresh `players` array) every step. If
    // those were deps, this effect would re-fetch the whole 728KB payload and
    // re-decode on EVERY step — producing a new `frames` array that re-pushed
    // the current frame and re-fired one-shot animations (the double lunge), on
    // top of being very wasteful. `anonymize` + `replay.players` are stable in
    // content for a given payload URL, so reading them via closure is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay.payloadBlobUrl]);

  // B112: board orientation follows the ACTIVE perspective. Prefer the recorder's
  // captured localPlayerId; fall back to the first player key for older replays.
  // Re-runs on flip (activeDecoded changes) → the flipped player drops to the
  // bottom tray without re-fetching anything.
  useEffect(() => {
    const players = activeDecoded?.frames[0]?.state?.players;
    if (!players) return;
    const localId = activeDecoded?.meta.localPlayerId;
    const connected = (localId && Object.prototype.hasOwnProperty.call(players, localId))
      ? localId
      : Object.keys(players)[0] ?? null;
    if (connected) setConnectedPlayer(connected);
  }, [activeDecoded, setConnectedPlayer]);

  // B112: flip between the two players' recordings. Lazily fetch + decode the
  // alt perspective from the auth-gated endpoint on first flip; map the current
  // frame to the equivalent moment in the other timeline (best-effort, via a
  // hand-independent board signature). Silently no-ops if not entitled.
  const flipPov = useCallback(async () => {
    if (!canFlip) return;
    stopPlayback();
    stopAutoplay();
    if (pov === 'canonical') {
      let alt = altDecoded;
      if (!alt) {
        try {
          const res = await fetch(`/api/replays/${replay.slug}/perspective`, {
            headers: installToken ? { 'X-Install-Token': installToken } : {},
          });
          if (!res.ok) return;
          const body = await res.json();
          if (!body?.ok || typeof body.payload !== 'string') return;
          alt = collapseReplay(decodeReplay(JSON.parse(body.payload)));
          setAltDecoded(alt);
        } catch { return; }
      }
      const target = mapFrameIndex(decoded?.frames || [], currentIndexRef.current, alt.frames);
      setPov('alt');
      setCurrentIndex(target);
    } else {
      const target = mapFrameIndex(altDecoded?.frames || [], currentIndexRef.current, decoded?.frames || []);
      setPov('canonical');
      setCurrentIndex(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFlip, pov, altDecoded, decoded, replay.slug, installToken, setCurrentIndex, stopPlayback, stopAutoplay]);

  // B112: the handle of the player whose perspective is currently shown (for the
  // Flip control's label). Falls back to a side label if the handle is unknown.
  const viewingHandle = useMemo(() => {
    const arr = (replay.players as any[]) || [];
    const pid = activeDecoded?.meta.localPlayerId ?? null;
    return (pid && arr.find((p) => p?.id === pid)?.username) || (pov === 'alt' ? 'Player 2' : 'Player 1');
  }, [replay.players, activeDecoded, pov]);

  // Push the current frame's state into the game context whenever we step.
  // B104: coalesce via requestAnimationFrame. Rendering the (heavy) gameboard
  // is the dominant per-step cost; while holding the arrow, currentIndex
  // changes far faster than the board can paint. Collapsing to one render per
  // frame — always for the LATEST index — lets the counter fly while the board
  // keeps up at the paint rate (skipping intermediates), instead of crawling.
  const boardRafRef = useRef<number | null>(null);
  const lastPushedIndexRef = useRef<number>(-1);
  useEffect(() => {
    if (!frames || frames.length === 0) return;
    if (boardRafRef.current != null) return; // already scheduled — coalesce
    boardRafRef.current = requestAnimationFrame(() => {
      boardRafRef.current = null;
      const i = Math.max(0, Math.min(frames.length - 1, currentIndexRef.current));
      // B108: this effect can run more than once for a single step (a re-render
      // lands on the same currentIndex), which would push the SAME frame's state
      // twice — re-triggering the FrameAnimator and double-playing one-shot
      // animations like the attack lunge. Dedupe: only push when the frame
      // actually changed.
      if (i === lastPushedIndexRef.current) return;
      lastPushedIndexRef.current = i;
      setGameState(frames[i].state);
    });
  }, [frames, currentIndex, setGameState]);
  // Re-decode (new frames array) must be allowed to re-push even at the same
  // index, so reset the dedupe whenever the frames identity changes.
  useEffect(() => { lastPushedIndexRef.current = -1; }, [frames]);
  useEffect(() => () => { if (boardRafRef.current != null) cancelAnimationFrame(boardRafRef.current); }, []);

  // Keyboard nav. Shift+arrow temporarily flips mode (action↔frame).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === ' ' || e.code === 'Space') {
        // Spacebar = play/pause, the universal transport shortcut.
        e.preventDefault();
        toggleAutoplay();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey) {
          // Temporary flip — step one in the OTHER mode, then leave the
          // mode setting alone.
          stopAutoplay();
          const otherMode: StepMode = mode === 'action' ? 'frame' : 'action';
          if (!frames) return;
          if (otherMode === 'action' && activeByFrame) {
            // Same symmetric action-boundary rule as the buttons/arrows.
            const next = actionBoundary(currentIndex, dir as 1 | -1);
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
        jumpTo(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        jumpTo((frames?.length || 1) - 1);
      } else if (e.key === '[' || e.key === ']') {
        // B13: prev/next tag — no-op when no tag exists in that direction.
        e.preventDefault();
        jumpToAdjacentTag(e.key === ']' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [frames, activeByFrame, currentIndex, mode, step, jumpToAdjacentTag, jumpTo, toggleAutoplay, stopAutoplay, setCurrentIndex, actionBoundary]);

  // Stop the auto-play timer on unmount so it can't fire into a dead component.
  useEffect(() => () => stopAutoplay(), [stopAutoplay]);

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
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--kb-header-h, 0px))', overflow: 'hidden' }}>
      {/* B121: pulse keyframes for the first-time Play cue. */}
      <style>{'@keyframes kb-play-pulse{0%,100%{box-shadow:0 0 0 0 rgba(77,210,255,0)}50%{box-shadow:0 0 16px 4px rgba(77,210,255,0.75)}}'}</style>
      {/* B121: onboarding CTA for visitors without the extension (the viewer has
          no global header). Renders nothing for extension users / once dismissed. */}
      <InstallExtensionCta variant="banner" alreadyLinked={hasLinkedExtension} />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* B66b: gameboard first, sidebar second — sidebar now lives on
          the RIGHT (matches mobile drawer anchor). When the desktop
          sidebar is closed, TagSidebar unmounts its <aside>, so the
          gameboard's flex:1 reclaims the full width. */}
      <div ref={boardRef} style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        {frames ? (
          <>
            <Gameboard />
            <FrameAnimator
              containerRef={boardRef}
              enabled={animate}
              direction={lastTransition && lastTransition.to < lastTransition.from ? -1 : 1}
            />
            {showSummary && endStats && (
              <EndGameSummary
                stats={endStats}
                players={(replay.players as any[]) || []}
                localPlayerId={anonymize ? null : (activeDecoded?.meta.localPlayerId ?? null)}
                onClose={() => setSummaryDismissed(true)}
              />
            )}
          </>
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
        onJump={jumpTo}
        onJumpToAdjacentTag={jumpToAdjacentTag}
        tags={displayTags}
        setTags={setTagState}
        toOriginalFrame={collapsedToOriginal}
        playerUsernames={playerUsernames}
        mode={mode}
        setMode={setMode}
        messagesByFrame={activeDecoded?.messagesByFrame || null}
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
        matchMeta={replay.match ?? activeDecoded?.meta.match ?? null}
        decks={decksForView}
        localPlayerId={anonymize ? null : (activeDecoded?.meta.localPlayerId ?? null)}
        armedTeams={armedTeams}
        onArmedTeamsChange={setArmedTeams}
        onOpenResourcing={() => setResourcingOpen(true)}
        anonymize={anonymize}
      />
      </KaraBuddyThemeProvider>
      <ResourcingModal
        open={resourcingOpen}
        onClose={() => setResourcingOpen(false)}
        frames={frames}
        localPlayerId={anonymize ? null : (activeDecoded?.meta.localPlayerId ?? null)}
        onJump={setCurrentIndex}
      />
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
            {/* B66b/B100: desktop step/playback controls as an inline pill that
                tracks the docked sidebar (shifts left past it). On MOBILE the
                same controls collapse into a bubble FAB (below) so they don't
                sprawl across the cramped bottom edge. */}
            {!isMobile && (
              <StepModeOverlay
                mode={mode}
                setMode={setMode}
                animate={animate}
                onToggleAnimate={toggleAnimate}
                playing={playing}
                onTogglePlay={toggleAutoplay}
                speed={speed}
                speeds={PLAY_SPEEDS as unknown as { label: string; value: number }[]}
                onSetSpeed={setSpeedValue}
                landscape
                drawerOpen={drawerOpen}
                drawerWidth={`${sidebarWidth}px`}
                dragging={reviewDrag.dragging}
                canFlip={!!canFlip}
                viewLabel={viewingHandle}
                onFlip={flipPov}
                pulse={pulsePlay}
              />
            )}
            {/* B104: mobile playback-controls bubble. A round FAB in the
                bottom-right cluster (left of the ☰ review FAB) that opens a
                small panel with play/pause, speed, step-mode + animate —
                mirroring the ☰/ⓘ bubble pattern. Lifts above the portrait
                sheet using the same offsets as its neighbours. */}
            {isMobile && (
              <MobileControlsFab
                mode={mode}
                setMode={setMode}
                animate={animate}
                onToggleAnimate={toggleAnimate}
                playing={playing}
                onTogglePlay={toggleAutoplay}
                speed={speed}
                speeds={PLAY_SPEEDS as unknown as { label: string; value: number }[]}
                onSetSpeed={setSpeedValue}
                bottom={portraitLift ? `calc(${reviewDrag.size}px + 12px)` : edgeB}
                right={`calc(${fabRight} + 50px)`}
                dragging={reviewDrag.dragging}
                canFlip={!!canFlip}
                viewLabel={viewingHandle}
                onFlip={flipPov}
                pulse={pulsePlay}
              />
            )}
            {/* B100/B104: matchup info FAB moves to the TOP on mobile so it
                points at where its panel slides in (and clears the bottom
                playback cluster). Anchored to the same edge as the panel:
                TOP-RIGHT in portrait (panel drops from the top), TOP-LEFT in
                landscape (panel slides from the left — and the right edge is
                where the review sheet's × close lives, so top-right would
                collide with it). */}
            {isMobile && (
              <button
                type="button"
                onClick={() => openMatchup(!matchupOpen)}
                aria-label={matchupOpen ? 'Hide matchup info' : 'Show matchup info'}
                title={matchupOpen ? 'Hide matchup' : 'Matchup info'}
                style={{
                  position: 'fixed',
                  top: 'max(10px, env(safe-area-inset-top, 10px))',
                  ...(mobileLandscape
                    ? { left: 'max(10px, env(safe-area-inset-left, 10px))' }
                    : { right: 'max(10px, env(safe-area-inset-right, 10px))' }),
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
                  transition: 'background 160ms ease',
                }}
              >
                <InfoIcon />
              </button>
            )}
            {/* B106: "jump to a moment" navigator — stacked directly ABOVE the
                ☰ review FAB so it joins the bottom-right control cluster. Tracks
                the same right offset the ☰ uses (shifts past the docked desktop
                sidebar / mobile-landscape sheet) and rides up with the portrait
                sheet, sitting one FAB-height (38 + 8 gap) above it. */}
            {(() => {
              const menuEdgeR = 'max(12px, env(safe-area-inset-right, 12px))';
              const menuRight = !isMobile
                ? (drawerOpen ? `calc(${sidebarWidth}px + 12px)` : menuEdgeR)
                : (mobileLandscape && drawerOpen ? `calc(${reviewDrag.size}px + 12px)` : menuEdgeR);
              const menuBottom = mobilePortrait && drawerOpen ? `calc(${reviewDrag.size}px + 12px)` : edgeB;
              return (
                <JumpToMenu
                  chapters={chapters}
                  currentIndex={currentIndex}
                  onJump={jumpTo}
                  bottom={`calc(${menuBottom} + 46px)`}
                  right={menuRight}
                />
              );
            })()}
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
          matchMeta={replay.match ?? activeDecoded?.meta.match ?? null}
          decks={decksForView}
          localPlayerId={anonymize ? null : (activeDecoded?.meta.localPlayerId ?? null)}
          frames={frames}
          installToken={installToken}
          isOwner={isOwner}
          anonymize={anonymize}
        />
      )}
      </div>
    </div>
  );
}

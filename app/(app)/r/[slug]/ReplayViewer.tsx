'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemeContextProvider } from '@/app/_contexts/Theme.context';
import { KaraBuddyThemeProvider } from '@/app/_components/KaraBuddyThemeProvider';
import { CosmeticsProvider } from '@/app/_contexts/CosmeticsContext';
import { UserProvider } from '@/app/_contexts/User.context';
import { PopupProvider } from '@/app/_contexts/Popup.context';
import { GameProvider, useGame } from '@/app/_contexts/Game.context';
import { buildNamedCardMap, stampNamedCards } from '@/lib/namedCards';
import { FrameAnimator } from './FrameAnimator';
import { computeActionStops, nextActionStop } from './actionStops';
import { EndGameSummary } from './EndGameSummary';
import { SideboardSplash } from './SideboardSplash';
import { computeEndGameStats } from '@/lib/endGameStats';
import { revealHiddenHand } from './revealHands';
import { computeChapters, type Chapter } from '@/lib/replayChapters';
import { anonymizeFrames, anonByIdFromPlayers, anonByIdFromFrames, anonymizeDecks } from '@/lib/anonymizeReplay';
import Gameboard from '@/app/_components/Gameboard/Gameboard';
import { PrivateReplayGate } from '@/app/_components/PrivateReplayGate';
import { getCompanionInfo, extensionPresent, loadedTeamKeyIds, resolvePrivateReplayAccess, decryptReplayPayload, hydrateEncryptedTags, companionCapabilityState, openKeyManager, type PrivateReplayAccess } from '@/lib/companion';
import { useSearchParams } from 'next/navigation';
import { decodeReplay, collapseReplay, type Frame, type CollapsedReplay } from '@/lib/replayDecoder';
import { mapFrameIndex } from '@/lib/replaySignature';
import type { SeriesInfo } from './seriesTypes';
import type { SideboardChanges } from '@/lib/sideboardDiff';
import { InstallExtensionCta } from '@/app/_components/InstallExtensionCta';
import type { ClipSummary } from './ClipsList';
import { ClipBuilder } from './ClipBuilder';
import { FrameNavOverlay, CHEVRON_W } from './FrameNavOverlay';
import type { OpponentHistory } from './redesign/MatchupHistory';
import { RedesignChrome, CHROME_EDGE_PX, PLAY_SIZE } from './redesign/RedesignChrome'; // B216: the viewer chrome
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useSession } from 'next-auth/react';
import { getOrCreateInstallToken } from '@/lib/installToken';
import { canMutateReplay } from '@/lib/replayPermissions';
import { computeFrameDwells } from './frameDwell';
import { resolveConnectedPlayer, createDwellStepper, type DwellStepper, PLAYBACK_SPEEDS, PLAYBACK_SPEED_DEFAULT, PLAYBACK_SPEED_STORAGE_KEY } from './playback';

// B104: cadence of the action-mode multi-frame playback (ms between frames).
// Tuned to ~the card-move animation length so consecutive transitions flow.
const PLAYBACK_TICK_MS = 300;
// B134: the per-frame choreography dwell map (staged plays, resourcing, leader
// deploy, ambush, attacks) now lives in ./frameDwell so the clip reel shares it.
// If two action steps arrive within this window, the user is holding the arrow
// (key-repeat ~30-50ms) — fly through instead of playing the choreography.
const HELD_STEP_MS = 180;

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
  // B170 / ADR 0010: private (E2EE) replays. When `encrypted`, payloadBlobUrl is
  // ciphertext — decrypted in-browser via the extension bridge under the team key
  // identified by `teamKeyId` (the server never sees plaintext or the key).
  encrypted?: boolean;
  teamKeyId?: string | null;
}

interface TagRow {
  id: string;
  replaySlug: string;
  frameIndex: number;
  authorToken: string;
  authorName: string;
  comment: string;
  // B170: ciphertext comment on a private replay's web-authored tag; decrypted
  // into `comment` via the bridge before display (hydrateEncryptedTags).
  commentEncrypted?: string | null;
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
  // B129: the games of this replay's Bo3 series (identity-entitled viewers
  // only) — drives the Game-N title suffix + the series hop pills.
  series?: SeriesInfo | null;
  // B150: sideboard swaps vs the previous game in this lobby (entitled viewers
  // only) — drives the decks-modal Sideboard panel + the frame-0 splash.
  sideboard?: SideboardChanges | null;
  // B133: the owner published this replay — anonymized viewers still fetch
  // tags (the server serves them redacted).
  publicComments?: boolean;
  // B216: the uploader's other matches vs this opponent (owner-only) for the
  // redesign Matchup view's "History vs <opponent>" section.
  opponentHistory?: OpponentHistory | null;
}

export function ReplayViewer({ replay, initialTags, anonymize, canFlip, hasLinkedExtension, series, sideboard, opponentHistory, publicComments }: Props) {
  return (
    <ThemeContextProvider>
      <UserProvider>
        <CosmeticsProvider>
          <PopupProvider>
            <GameProvider>
              <ViewerShell replay={replay} initialTags={initialTags} anonymize={anonymize} canFlip={canFlip} hasLinkedExtension={hasLinkedExtension} series={series} sideboard={sideboard} opponentHistory={opponentHistory} publicComments={publicComments} />
            </GameProvider>
          </PopupProvider>
        </CosmeticsProvider>
      </UserProvider>
    </ThemeContextProvider>
  );
}

type StepMode = 'action' | 'frame';

// B170 / ADR 0010: map a private replay's embedded in-game tags (from the
// decrypted payload) to the viewer's TagRow shape. Frame indices are ORIGINAL
// space (like web tags) — displayTags remaps them. These are read-only here.
function payloadTagsToRows(payloadTags: any, replaySlug: string): TagRow[] {
  if (!Array.isArray(payloadTags)) return [];
  return payloadTags
    .filter((t) => t && Number.isFinite(t.frameIndex))
    .map((t) => ({
      id: String(t.id ?? `ingame-${t.frameIndex}-${Math.random().toString(36).slice(2, 8)}`),
      replaySlug,
      frameIndex: Math.max(0, Math.floor(t.frameIndex)),
      authorToken: '',
      authorName: String(t.author || 'anon'),
      comment: String(t.comment || ''),
      createdAt: new Date(t.createdAt ?? Date.now()).toISOString(),
      scope: [],
    }));
}

function ViewerShell({ replay, initialTags, anonymize, canFlip, hasLinkedExtension, series, sideboard, opponentHistory, publicComments }: Props) {
  const { setGameState, setConnectedPlayer } = useGame();
  // B170 / ADR 0010: for an encrypted replay, resolve the access tier (capability
  // handshake + key-presence) before fetching/decoding. `null` = still resolving;
  // 'plaintext' for non-encrypted (the path below is untouched). The payload
  // effect only fetches/decrypts once tier === 'ready'.
  const [access, setAccess] = useState<PrivateReplayAccess | null>(replay.encrypted ? null : 'plaintext');
  const resolveAccess = useCallback(async () => {
    if (!replay.encrypted) { setAccess('plaintext'); return; }
    // Two signals in parallel: the capability handshake (new builds) + the
    // universal install-token handshake (every build) — so an OLD extension
    // reads as 'unsupported' ("update"), not 'absent' ("install"). If not
    // supported, gate immediately (skip the slower loaded-keys lookup).
    const [info, present] = await Promise.all([getCompanionInfo(), extensionPresent()]);
    const cap = companionCapabilityState(info, present);
    if (cap !== 'supported') { setAccess(cap); return; }
    const kids = await loadedTeamKeyIds();
    setAccess(resolvePrivateReplayAccess({ encrypted: true, teamKeyId: replay.teamKeyId ?? null, companion: info, present, loadedKeyIds: kids }));
  }, [replay.encrypted, replay.teamKeyId]);
  useEffect(() => { resolveAccess(); }, [resolveAccess]);
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
  // B228: uuid → named card, parsed once from the active POV's game log.
  const namedCardMapRef = useRef<Record<string, string>>({});
  useEffect(() => { namedCardMapRef.current = buildNamedCardMap(activeDecoded?.messagesByFrame); }, [activeDecoded]);
  const playRef = useRef<{ timer: number; target: number; dir: 1 | -1 } | null>(null);
  const lastStepAt = useRef(0); // timestamp of the last action step (held vs deliberate)
  const stopPlayback = useCallback(() => {
    if (playRef.current) { window.clearTimeout(playRef.current.timer); playRef.current = null; }
  }, []);
  useEffect(() => () => stopPlayback(), [stopPlayback]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tagState, setTagState] = useState<TagRow[]>(initialTags);
  // B170 / ADR 0010: a private replay's in-game tags ride INSIDE the encrypted
  // payload (the server can't lift them), so we surface them from the decrypted
  // payload and merge with the web-authored (API) tags. Read-only here — web
  // authoring writes to `tagState`. Empty for non-encrypted replays (their
  // in-game tags were lifted into the tags table server-side and come via the API).
  const [inGameTags, setInGameTags] = useState<TagRow[]>([]);
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
  // Shared autoplay stepping engine (playback.ts) — same cadence as the clip
  // reel. Created lazily in startAutoplay; closures read live refs.
  const autoplayStepperRef = useRef<DwellStepper | null>(null);
  const [speed, setSpeed] = useState<number>(PLAYBACK_SPEED_DEFAULT);
  const speedRef = useRef(PLAYBACK_SPEED_DEFAULT);
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY));
      if (PLAYBACK_SPEEDS.some((o) => o.value === v)) { setSpeed(v); speedRef.current = v; }
    } catch {}
  }, []);
  const stopAutoplay = useCallback(() => {
    playingRef.current = false;
    autoplayStepperRef.current?.stop();
    setPlaying(false);
  }, []);
  const setSpeedValue = useCallback((next: number) => {
    speedRef.current = next;
    setSpeed(next);
    try { window.localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, String(next)); } catch {}
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
  // B216: width of the docked desktop panel (0 = closed), so the board chevrons
  // clear it.
  const [redesignDockW, setRedesignDockW] = useState(0);
  const [clipOpen, setClipOpen] = useState(false);
  // B138: clips that already exist on this replay → the Clip control gains a
  // picker. Public list (link-accessible like the replay); refetched after the
  // builder creates one.
  const [clips, setClips] = useState<ClipSummary[]>([]);
  const refetchClips = useCallback(async () => {
    try {
      const res = await fetch(`/api/replays/${replay.slug}/clips`);
      const body = await res.json();
      if (body?.ok && Array.isArray(body.data)) setClips(body.data);
    } catch { /* non-fatal */ }
  }, [replay.slug]);
  useEffect(() => { refetchClips(); }, [refetchClips]);

  // B66e: ownership resolved here so every chrome surface shows owner-only
  // affordances from the same source of truth.
  const { data: session } = useSession();
  const sessionUserId: string | null = (session?.user?.id as string | undefined) || null;
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
    // B107: an anonymized viewer normally never loads tags — their authors
    // are real handles we don't want to surface. B133 exception: the owner
    // PUBLISHED this replay, so the server serves the tags redacted (aliased
    // authors, mentions stripped) and we fetch them for everyone.
    if (anonymize && !publicComments) return;
    if (!installToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/replays/${replay.slug}/tags`, {
          headers: { 'X-Install-Token': installToken },
        });
        const body = await res.json();
        if (cancelled || !body.ok) return;
        let data = (body.data as TagRow[]) ?? [];
        // B170: web-authored tags on a private replay carry ciphertext comments —
        // decrypt them via the bridge before display.
        if (replay.encrypted && replay.teamKeyId) data = await hydrateEncryptedTags(data, replay.teamKeyId);
        if (cancelled) return;
        setTagState(data);
        setArmedTeams((body.armedTeams as { slug: string; name: string }[]) ?? []);
      } catch {
        /* keep whatever's already in state */
      }
    })();
    return () => { cancelled = true; };
  }, [installToken, sessionUserId, replay.slug, anonymize]);

  // B149: record this visit + capture the PRIOR one, so tags added since then can
  // be flagged "new" for a returning reviewee. Signed-in only (no-op otherwise).
  const [lastViewedAt, setLastViewedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!sessionUserId) return;
    let live = true;
    fetch(`/api/replays/${replay.slug}/viewed`, { method: 'POST' })
      .then((r) => r.json())
      .then((b) => { if (live && b?.ok) setLastViewedAt(b.previousViewedAt ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, [sessionUserId, replay.slug]);

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
  // Written via native history.replaceState — router.replace() on this
  // force-dynamic page fires an RSC request (a real function invocation)
  // per settled step, so skimming a replay hammered prod. Reads the initial
  // value once on mount; subsequent URL changes (e.g. browser back) don't
  // re-sync state to avoid a write-loop with the writer effect below.
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
    // B104: debounce the URL write; firing it 30×/s while holding the arrow
    // is wasted work. We only need the final frame in the URL — write it once
    // stepping settles.
    if (urlTimerRef.current != null) window.clearTimeout(urlTimerRef.current);
    urlTimerRef.current = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      // Mirror as an ORIGINAL index so the link round-trips and matches external
      // deep-links (comments/decks) that point at original frame indices.
      const human = collapsedToOriginal(currentIndexRef.current) + 1;
      if (currentIndexRef.current === 0) params.delete('f');
      else params.set('f', String(human));
      const qs = params.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, '', url);
    }, 200);
    // Intentionally exclude searchParams from deps — the write runs
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

  // B150/B216: the sideboard splash never auto-opens — it's click-only via the
  // glowing rail icon (shown only when there's a swap), so the board loads clean.
  const sideboardHasChanges = !!sideboard && sideboard.players.some((p) => p.changed);
  const [sideboardOpen, setSideboardOpen] = useState(false);
  const showSideboard = !!sideboard && sideboardOpen;

  // B104: how long action-playback should dwell on each frame before advancing
  // — longer for frames with an attack, so the lunge→death→reflow choreography
  // (in FrameAnimator) has time to play instead of being cut off.
  const frameAnimMs = useMemo(
    () => (decoded?.frames ? computeFrameDwells(decoded.frames) : ([] as number[])),
    [decoded],
  );
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
    // B170: merge web-authored tags (tagState) with a private replay's in-game
    // tags (inGameTags, from the decrypted payload); both remap orig→collapsed.
    () => [...tagState, ...inGameTags].map((t) => ({ ...t, frameIndex: origToCollapsed(t.frameIndex) })),
    [tagState, inGameTags, origToCollapsed],
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
    // sideboard lists and the deck name. The Decks view shows the "seen during
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
  // drawing / resourcing / discarding) PLUS the setup mulligan/resource
  // decisions (B217 — log-driven, since setup has no active player), so stepping
  // by action stops on those instead of blowing through them. Both directions
  // land on a stop, so a forward step then a back step are inverses. (B108)
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
      const start = currentIndexRef.current;
      const target = actionBoundary(start, dir);
      if (target === start) return;
      stopPlayback(); // deliberate single step → play through (choreography)
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
    // Shared stepping engine — identical cadence to the clip reel (playback.ts).
    // `animate` off → flat tick; on → per-frame choreography dwell. Stops at the
    // last frame (no loop). Closures read live refs, so flips/speed take effect.
    if (!autoplayStepperRef.current) {
      autoplayStepperRef.current = createDwellStepper({
        isPlaying: () => playingRef.current,
        speed: () => speedRef.current,
        minDwellMs: PLAY_MIN_DWELL_MS,
        dwellMs: (f) => (animateRef.current ? (frameAnimMsRef.current[f] ?? PLAYBACK_TICK_MS) : PLAYBACK_TICK_MS),
        lower: () => 0,
        upper: () => frameAnimMsRef.current.length - 1,
        loop: false,
        show: (f) => setCurrentIndex(f),
        onEnd: () => { playingRef.current = false; setPlaying(false); },
      });
    }
    autoplayStepperRef.current.start(pos);
  }, [frames, stopPlayback, setCurrentIndex]);
  const toggleAutoplay = useCallback(() => {
    if (playingRef.current) stopAutoplay(); else startAutoplay();
  }, [startAutoplay, stopAutoplay]);

  // B13: jump to the previous/next tagged frame — the `[` / `]` shortcuts (the
  // Tag HUD's prev/next ears do their own adjacent-tag lookup).
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
    // B170: an encrypted replay only loads once the access tier is 'ready' (the
    // gate handles the other tiers). Non-encrypted replays are 'plaintext' → load
    // immediately, unchanged.
    if (replay.encrypted && access !== 'ready') return;
    let cancelled = false;
    (async () => {
      try {
        // B170: encrypted → fetch the ciphertext blob + decrypt it via the
        // extension bridge (the key never reaches the page). Else the plain path.
        const parsed = replay.encrypted
          ? await decryptReplayPayload<any>(replay.teamKeyId as string, replay.payloadBlobUrl)
          : JSON.parse(await (await (async () => {
              const res = await fetch(replay.payloadBlobUrl);
              if (!res.ok) throw new Error(`payload fetch failed: ${res.status}`);
              return res;
            })()).text());
        // B102: collapse undone + board-static frames so stepping only lands on
        // real, distinct board positions. `decodeReplay` stays raw (extraction
        // path); the viewer renders the collapsed timeline.
        const result = collapseReplay(decodeReplay(parsed));
        if (cancelled) return;
        // B170: a private replay's in-game tags are embedded (plaintext) in the
        // now-decrypted payload — surface them (the server never lifted them).
        if (replay.encrypted) setInGameTags(payloadTagsToRows(parsed.tags, replay.slug));
        // B107: sample replay → rewrite the board labels + game-log player
        // names to "Player N" before the frames ever reach the game context.
        // The id→label map is derived from the FRAMES (the stored players
        // summary has no player ids), owner-first so the board, log, and card
        // all agree.
        if (anonymize) anonymizeFrames(result.frames, anonByIdFromFrames(result.frames, result.meta?.localPlayerId ?? null));
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
    // B170: also re-run when an encrypted replay becomes 'ready' (key loaded +
    // re-checked), so decryption fires without a full page reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay.payloadBlobUrl, replay.encrypted, access]);

  // B112: board orientation follows the ACTIVE perspective. Prefer the recorder's
  // captured localPlayerId; fall back to the first player key for older replays.
  // Re-runs on flip (activeDecoded changes) → the flipped player drops to the
  // bottom tray without re-fetching anything.
  useEffect(() => {
    const players = activeDecoded?.frames[0]?.state?.players;
    if (!players) return;
    // Shared POV rule (playback.ts) — the clip surfaces resolve orientation the
    // same way, so the board can never orient differently between them.
    const connected = resolveConnectedPlayer(players, activeDecoded?.meta.localPlayerId);
    if (connected) setConnectedPlayer(connected);
  }, [activeDecoded, setConnectedPlayer]);

  // B112: lazily fetch + decode the alt perspective from the auth-gated
  // endpoint (first flip / enabling auto-switch). Null when not entitled.
  const altDecodedRef = useRef<CollapsedReplay | null>(null);
  altDecodedRef.current = altDecoded;
  const ensureAlt = useCallback(async (): Promise<CollapsedReplay | null> => {
    if (altDecodedRef.current) return altDecodedRef.current;
    try {
      const res = await fetch(`/api/replays/${replay.slug}/perspective`, {
        headers: installToken ? { 'X-Install-Token': installToken } : {},
      });
      if (!res.ok) return null;
      const body = await res.json();
      if (!body?.ok || typeof body.payload !== 'string') return null;
      const alt = collapseReplay(decodeReplay(JSON.parse(body.payload)));
      altDecodedRef.current = alt;
      setAltDecoded(alt);
      return alt;
    } catch {
      return null;
    }
  }, [replay.slug, installToken]);

  // B128 v2: "both hands face up" — the double-sided experience. Instead of
  // flipping the board between seats, merge the OTHER recording's unmasked
  // hand into the shown board (revealHands.ts). No POV choreography at all:
  // you watch one stable board with complete information. Defaults ON for
  // double-sided replays; the manual Flip (cinematic curtain) remains for
  // literally sitting in the other seat.
  const [curtain, setCurtain] = useState(false);
  const handoffBusyRef = useRef(false);
  const skipAnimRef = useRef(false);
  const [revealHands, setRevealHands] = useState(true);

  // Eagerly fetch the alt perspective when entitled + reveal is on — the
  // unmasked hand should be there from the first frame.
  useEffect(() => {
    if (canFlip && revealHands) void ensureAlt();
  }, [canFlip, revealHands, ensureAlt]);

  // Enriched frames for the SHOWN timeline (works from either seat — the
  // "other" recording is whichever one the viewer isn't watching). Falls back
  // to the raw frames until the alt payload lands.
  const revealedFrames = useMemo(() => {
    if (!revealHands || !canFlip || !decoded || !altDecoded) return null;
    const shown = pov === 'canonical' ? decoded : altDecoded;
    const other = pov === 'canonical' ? altDecoded : decoded;
    return revealHiddenHand(shown, other);
  }, [revealHands, canFlip, decoded, altDecoded, pov]);

  // Curtain for the MANUAL flip (board only — sidebar + controls stay up): a
  // snappy dip to black that masks the board mirroring. User-initiated via the
  // Flip button, so no label/hold theatrics needed.
  const CURTAIN_FADE_MS = 160;
  const CURTAIN_HOLD_MS = 80; // let the swapped board paint behind the black
  const runCurtainSwap = useCallback(() => {
    if (handoffBusyRef.current) return;
    const shown = pov === 'canonical' ? decoded : altDecodedRef.current;
    const other = pov === 'canonical' ? altDecodedRef.current : decoded;
    if (!shown || !other) return;

    handoffBusyRef.current = true;
    stopAutoplay();
    stopPlayback();
    setCurtain(true);
    window.setTimeout(() => {
      skipAnimRef.current = true; // the swap render must snap, not FLIP-animate
      const target = mapFrameIndex(shown.frames, currentIndexRef.current, other.frames);
      setPov(pov === 'canonical' ? 'alt' : 'canonical');
      setCurrentIndex(target);
      window.setTimeout(() => {
        setCurtain(false);
        window.setTimeout(() => { handoffBusyRef.current = false; }, CURTAIN_FADE_MS);
      }, CURTAIN_HOLD_MS);
    }, CURTAIN_FADE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pov, decoded, stopAutoplay, stopPlayback, setCurrentIndex]);

  // B112: manual flip between the two players' recordings. Lazily fetches the
  // alt perspective on first use; no-ops if not entitled.
  const flipPov = useCallback(async () => {
    if (!canFlip || handoffBusyRef.current) return;
    if (pov === 'canonical' && !(await ensureAlt())) return;
    runCurtainSwap();
  }, [canFlip, pov, ensureAlt, runCurtainSwap]);

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
  // B128 v2: render from the hand-revealed frames when available (same length
  // + indices as `frames` — only the hidden opponent hand differs).
  const displayFrames = revealedFrames ?? frames;
  const displayFramesRef = useRef(displayFrames);
  displayFramesRef.current = displayFrames;
  useEffect(() => {
    if (!frames || frames.length === 0) return;
    if (boardRafRef.current != null) return; // already scheduled — coalesce
    boardRafRef.current = requestAnimationFrame(() => {
      boardRafRef.current = null;
      const src = displayFramesRef.current ?? frames;
      const i = Math.max(0, Math.min(src.length - 1, currentIndexRef.current));
      // B108: this effect can run more than once for a single step (a re-render
      // lands on the same currentIndex), which would push the SAME frame's state
      // twice — re-triggering the FrameAnimator and double-playing one-shot
      // animations like the attack lunge. Dedupe: only push when the frame
      // actually changed.
      if (i === lastPushedIndexRef.current) return;
      lastPushedIndexRef.current = i;
      // B228: stamp any "named card" (Ryder Azadi et al) onto the board cards
      // so GameCard can show a persistent bubble — the log-only signal is easy
      // to miss.
      stampNamedCards(src[i].state, namedCardMapRef.current);
      setGameState(src[i].state);
    });
  }, [frames, displayFrames, currentIndex, setGameState]);
  // Re-decode (new frames array) or a reveal on/off flip must be allowed to
  // re-push even at the same index, so reset the dedupe when identity changes.
  // The re-push of the SAME position must snap (hand stubs swap for revealed
  // cards — nothing should FLIP-animate).
  useEffect(() => { lastPushedIndexRef.current = -1; skipAnimRef.current = true; }, [frames, displayFrames]);
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

  if (loadError) {
    return (
      <div style={{ padding: 32, color: '#ff6b6b', fontFamily: 'var(--font-barlow), sans-serif' }}>
        Failed to load replay: {loadError}
      </div>
    );
  }

  // B170 / ADR 0010: encrypted replay the viewer can't open yet (no extension /
  // too old / key not loaded). Show the tiered gate instead of the board; the
  // re-check re-resolves so the user doesn't have to reload after acting.
  if (replay.encrypted && access && access !== 'ready' && access !== 'plaintext') {
    return (
      <div style={{ display: 'flex', height: 'calc(100vh - var(--kb-header-h, 0px))', alignItems: 'center', justifyContent: 'center' }}>
        <PrivateReplayGate tier={access} onRecheck={resolveAccess} onOpenKeyManager={async () => { await openKeyManager(); }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--kb-header-h, 0px))', overflow: 'hidden' }}>
      {/* B121: onboarding CTA for visitors without the extension (the viewer has
          no global header). Renders nothing for extension users / once dismissed. */}
      <InstallExtensionCta variant="banner" alreadyLinked={hasLinkedExtension} />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Gameboard fills the row; RedesignChrome's docked panel overlays on the
          right (fixed position), with the chevrons offset past it. */}
      {/* data-frame/-frames: a stable machine-readable "viewer is at frame N of M"
          sentinel for tests (1-based, collapsed timeline) — no visual footprint. */}
      {/* zIndex: 0 makes the board a stacking context, so gameboard-internal
          z-indexes can't escape above the fixed chrome (they were pointer-
          intercepting the corner controls; MUI portals to <body> are unaffected). */}
      <div ref={boardRef} data-testid="board" data-frame={currentIndex + 1} data-frames={frames?.length ?? 0} style={{ flex: 1, position: 'relative', minWidth: 0, zIndex: 0 }}>
        {frames ? (
          <>
            <Gameboard />
            <FrameAnimator
              containerRef={boardRef}
              enabled={animate}
              direction={lastTransition && lastTransition.to < lastTransition.from ? -1 : 1}
              skipNextRef={skipAnimRef}
              // B134: the displayed POV — maps a resourced card's controller to
              // its own/opponent resource pile (incl. the hands-up alt view).
              localPlayerId={activeDecoded?.meta.localPlayerId ?? null}
              // B138: scale animations with playback speed (shared with the clip reel).
              speedRef={speedRef}
            />
            {showSummary && endStats && (
              <EndGameSummary
                stats={endStats}
                players={(replay.players as any[]) || []}
                localPlayerId={anonymize ? null : (activeDecoded?.meta.localPlayerId ?? null)}
                onClose={() => setSummaryDismissed(true)}
              />
            )}
            {showSideboard && sideboard && (
              <SideboardSplash
                sideboard={sideboard}
                currentGameNumber={series?.current ?? null}
                localPlayerId={anonymize ? null : (activeDecoded?.meta.localPlayerId ?? null)}
                onClose={() => setSideboardOpen(false)}
              />
            )}
            {/* B128: the flip curtain — a snappy dip to black over ONLY the
                gameboard (sidebar + floating controls stay up) that masks the
                board mirroring while the POV swaps underneath. */}
            <div
              data-testid="pov-curtain"
              aria-hidden={!curtain}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 60,
                background: '#000',
                opacity: curtain ? 1 : 0,
                pointerEvents: curtain ? 'auto' : 'none',
                transition: 'opacity 160ms ease-in-out',
              }}
            />
          </>
        ) : (
          <div style={{ padding: 32, color: '#a0a8b8', fontFamily: 'var(--font-barlow), sans-serif' }}>
            Loading replay…
          </div>
        )}
      </div>
      {/* The viewer is wrapped in the gameboard's ThemeContextProvider (for
          the board); re-assert the KaraBuddy theme over the chrome so its
          MUI controls match the chrome instead of the gameboard's default
          MUI theme. */}
      <KaraBuddyThemeProvider>
          <RedesignChrome
            mode={isMobile ? 'mobile' : 'desktop'}
            tags={displayTags as any}
            currentIndex={currentIndex}
            onJump={jumpTo}
            replaySlug={replay.slug}
            toOriginalFrame={collapsedToOriginal}
            appendTag={(t) => setTagState((prev) => [...prev, t as any])}
            updateTag={(id, patch) => setTagState((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } as any : t)))}
            removeTag={(id) => setTagState((prev) => prev.filter((t) => t.id !== id))}
            armedTeams={armedTeams}
            lastViewedAt={lastViewedAt}
            messagesByFrame={activeDecoded?.messagesByFrame || null}
            matchup={{
              replay: replay as any,
              matchMeta: replay.match ?? activeDecoded?.meta.match ?? null,
              installToken,
              isOwner,
              anonymize,
              series: series ?? null,
              opponentHistory: opponentHistory ?? null,
              // Resourcing report hidden in the redesign (B216) — omit the trigger.
            }}
            decks={{
              decks: decksForView,
              localPlayerId: anonymize ? null : (activeDecoded?.meta.localPlayerId ?? null),
              payloadBlobUrl: replay.payloadBlobUrl,
              replaySlug: replay.slug,
            }}
            // B150: a persistent rail icon (when there's a swap to show) TOGGLES the
            // sideboard splash; it glows until first opened, and lights blue while
            // open (sideboardOpen).
            onToggleSideboard={sideboard && sideboardHasChanges ? () => setSideboardOpen((v) => !v) : undefined}
            sideboardOpen={sideboardOpen}
            controls={{
              playing, onTogglePlay: toggleAutoplay,
              speed, speeds: PLAYBACK_SPEEDS as { label: string; value: number }[], onSetSpeed: setSpeedValue,
              animate, onToggleAnimate: toggleAnimate,
              stepMode: mode, onSetStepMode: setMode,
              chapters,
              onOpenClip: () => setClipOpen(true),
              clips,
              installToken,
              isOwner,
              // Double-sided (POV) controls — the Playback view renders these
              // when canFlip; otherwise it hides them.
              canFlip: !!canFlip,
              viewLabel: viewingHandle,
              onFlip: flipPov,
              revealHands,
              onRevealHandsChange: setRevealHands,
            }}
            onDockWidthChange={setRedesignDockW}
            onArmedTeamsChange={setArmedTeams}
            canTag={!anonymize}
          />
      </KaraBuddyThemeProvider>
      {/* B136: clip trim builder — its own independent board over the viewer. */}
      {displayFrames && displayFrames.length > 1 && (
        <ClipBuilder
          open={clipOpen}
          onClose={() => setClipOpen(false)}
          replaySlug={replay.slug}
          frames={displayFrames}
          collapsedToOriginal={collapsedToOriginal}
          localPlayerId={activeDecoded?.meta.localPlayerId ?? null}
          chapters={chapters}
          initialIndex={currentIndex}
          installToken={installToken}
          onCreated={refetchClips}
        />
      )}
      {/* Frame chevrons — centred on the SAME vertical axis as the rail/pocket
          icons (offsets derived from the shared chrome layout constants, so they
          can't drift); the right one also dodges the docked panel (redesignDockW). */}
      <FrameNavOverlay
        leftOffset={`calc(max(${CHROME_EDGE_PX}px, env(safe-area-inset-left, ${CHROME_EDGE_PX}px)) + ${(PLAY_SIZE - CHEVRON_W) / 2}px)`}
        rightOffset={`calc(${redesignDockW}px + max(${CHROME_EDGE_PX}px, env(safe-area-inset-right, ${CHROME_EDGE_PX}px)) + ${(PLAY_SIZE - CHEVRON_W) / 2}px)`}
        verticalCenter="50%"
        onStep={step}
        canPrev={currentIndex > 0}
        canNext={!!frames && currentIndex < frames.length - 1}
      />
      </div>
    </div>
  );
}

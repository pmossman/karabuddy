'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThemeContextProvider } from '@/app/_contexts/Theme.context';
import { CosmeticsProvider } from '@/app/_contexts/CosmeticsContext';
import { UserProvider } from '@/app/_contexts/User.context';
import { PopupProvider } from '@/app/_contexts/Popup.context';
import { GameProvider } from '@/app/_contexts/Game.context';
import Gameboard from '@/app/_components/Gameboard/Gameboard';
import { FrameAnimator } from '@/app/(app)/r/[slug]/FrameAnimator';
import { usePlaybackBoard, createDwellStepper, type DwellStepper, PLAYBACK_SPEEDS, PLAYBACK_SPEED_DEFAULT } from '@/app/(app)/r/[slug]/playback';
import { computeFrameDwells, PLAYBACK_TICK_MS } from '@/app/(app)/r/[slug]/frameDwell';
import { decodeReplay, collapseReplay, type Frame } from '@/lib/replayDecoder';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { LeaderBasePair } from '@/app/_components/LeaderBasePair';
import { copyToClipboard } from '@/lib/clipboard';
import { ErrorNote, Loading } from '@/app/_components/StatusUi';
import { useConfirm } from '@/app/_components/Confirm';

// B136: the dedicated clip reel — a stripped, auto-playing, looping view of a
// replay's [start,end] range. Reuses the board pipeline (own GameProvider +
// Gameboard + FrameAnimator + the shared dwell map) with minimal chrome.
export interface ClipPlayerProps {
  clipSlug: string;
  replaySlug: string;
  payloadBlobUrl: string;
  startFrame: number;          // ORIGINAL space (from the DB)
  endFrame: number;            // ORIGINAL space
  title: string | null;
  anonymize: boolean;
  canDelete: boolean;
}

export function ClipPlayer(props: ClipPlayerProps) {
  return (
    <ThemeContextProvider>
      <UserProvider>
        <CosmeticsProvider>
          <PopupProvider>
            <GameProvider>
              <ClipPlayerInner {...props} />
            </GameProvider>
          </PopupProvider>
        </CosmeticsProvider>
      </UserProvider>
    </ThemeContextProvider>
  );
}

function ClipPlayerInner({ clipSlug, replaySlug, payloadBlobUrl, startFrame, endFrame, title, anonymize, canDelete }: ClipPlayerProps) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const boardRef = useRef<HTMLDivElement>(null);
  const skipAnimRef = useRef(false);

  // B138: on mobile, hide the (app)-layout header + zero --kb-header-h so the
  // reel gets the whole screen — consistent with the replay viewer (globals.css
  // `.kb-viewer-mobile`).
  const isMobile = useMediaQuery('(max-width: 900px), (pointer: coarse)');
  useEffect(() => {
    if (!isMobile) return;
    document.documentElement.classList.add('kb-viewer-mobile');
    return () => document.documentElement.classList.remove('kb-viewer-mobile');
  }, [isMobile]);

  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [frames, setFrames] = useState<Frame[]>([]);
  // The recorder's POV, read from the decoded payload — the SAME source the
  // replay viewer orients to (not the DB owner id, which can be null). Drives
  // board orientation + the FrameAnimator's geometry via the shared foundation.
  const [metaLocalPlayerId, setMetaLocalPlayerId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [startOriginal, setStartOriginal] = useState(startFrame);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(PLAYBACK_SPEED_DEFAULT);
  const [copied, setCopied] = useState(false);
  // Reel chrome starts HIDDEN (immersive autoplay), reveals on tap / pause /
  // end. At the end we DON'T loop — we pause, show the chrome, and overlay an
  // end card. A tap toggles the chrome during playback.
  const [chromeShown, setChromeShown] = useState(false);
  const [ended, setEnded] = useState(false);
  const endedRef = useRef(false); endedRef.current = ended;
  const [interact, setInteract] = useState(0); // bump on any tap → restart the hide timer
  const reveal = useCallback(() => { setChromeShown(true); setInteract((n) => n + 1); }, []);       // touching a control keeps chrome up
  const toggleChrome = useCallback(() => { setChromeShown((v) => !v); setInteract((n) => n + 1); }, []); // tapping the board flips it

  const dwellsRef = useRef<number[]>([]);
  const playingRef = useRef(true);
  const speedRef = useRef(PLAYBACK_SPEED_DEFAULT); speedRef.current = speed;
  const barRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const controlsRowRef = useRef<HTMLDivElement>(null);
  const [controlsH, setControlsH] = useState(60); // slide distance = everything below the scrubber
  const resumeAfterScrub = useRef(false);
  const boundsRef = useRef(bounds); boundsRef.current = bounds;
  const segRef = useRef<{ from: number; to: number; start: number; dur: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const scheduleRef = useRef<() => void>(() => {});
  const seekToRef = useRef<(f: number) => void>(() => {});
  // Cumulative TIME fraction per frame (frac[i] = playback time up to frame i ÷
  // total clip time). Mapping the bar to time — not frame index — makes it move
  // at a constant rate even though animation frames dwell far longer than others.
  const cumRef = useRef<{ frac: number[] }>({ frac: [] });
  // Progress bar is painted via direct DOM writes (NOT React state) so the rAF
  // loop never re-renders the heavy Gameboard subtree — that re-render was the
  // jitter. fillRef scales 0→1; knobRef rides the same fraction.
  const fillRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const paint = useCallback((p: number) => {
    const f = Math.max(0, Math.min(1, p));
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${f})`;
    if (knobRef.current) knobRef.current.style.left = `${f * 100}%`;
  }, []);
  // Time fraction (0..1) of the clip a frame sits at — see cumRef.
  const fracOf = useCallback((i: number) => {
    const frac = cumRef.current.frac;
    if (frac.length && i >= 0 && i < frac.length) return frac[i];
    const { s, e } = boundsRef.current; // fallback before frac is built
    return e > s ? Math.max(0, Math.min(1, (i - s) / (e - s))) : 1;
  }, []);
  // The frame whose time-fraction is nearest `t` (0..1) — inverse of fracOf, for
  // scrubbing (so clicking the middle of the bar lands at the clip's mid-TIME).
  const frameAtFrac = useCallback((t: number) => {
    const { s, e } = boundsRef.current;
    const frac = cumRef.current.frac;
    if (!frac.length || e <= s) return Math.round(s + t * (e - s));
    let best = s;
    for (let i = s; i <= e; i++) { if (frac[i] <= t) best = i; else break; }
    if (best < e && frac[best + 1] - t < t - frac[best]) best += 1;
    return best;
  }, []);
  // Paint the bar empty before first browser paint (the fill defaults to scaleX(1)).
  useLayoutEffect(() => { paint(0); }, [paint]);
  // Slide distance = everything below the scrubber (control row + gap + bottom
  // padding) so hiding drops the bar until only the scrubber sits at the very
  // bottom edge — no sliver of the controls left peeking.
  useLayoutEffect(() => {
    const bar = bottomBarRef.current, scrub = barRef.current;
    if (!bar || !scrub) return;
    const measure = () => setControlsH(Math.max(0, bar.offsetHeight - scrub.offsetHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  // Build the cumulative time-fraction table whenever the clip / bounds change.
  useEffect(() => {
    if (state !== 'ready') return;
    const { s, e } = bounds;
    const d = dwellsRef.current;
    let total = 0;
    for (let i = s; i <= e; i++) total += d[i] ?? PLAYBACK_TICK_MS;
    const frac: number[] = new Array(frames.length).fill(1);
    let acc = 0;
    for (let i = 0; i < frames.length; i++) {
      if (i < s) frac[i] = 0;
      else if (i > e) frac[i] = 1;
      else { frac[i] = total > 0 ? acc / total : 0; if (i < e) acc += d[i] ?? PLAYBACK_TICK_MS; }
    }
    cumRef.current = { frac };
  }, [state, bounds, frames]);

  // Fetch + decode the payload, anonymize if needed, resolve the clip bounds
  // (original → collapsed, clamped to what survived a re-collapse).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(payloadBlobUrl);
        const parsed = JSON.parse(await res.text());
        const collapsed = collapseReplay(decodeReplay(parsed));
        const metaPov = collapsed.meta?.localPlayerId ?? null;
        if (anonymize) {
          // Map id→label from the FRAMES (the players summary has no ids), so a
          // viewer without identity access never sees real karabast handles.
          // Owner-first ordering uses the recorder POV — same as the viewer.
          const { anonymizeFrames, anonByIdFromFrames } = await import('@/lib/anonymizeReplay');
          anonymizeFrames(collapsed.frames, anonByIdFromFrames(collapsed.frames, metaPov));
        }
        if (cancelled) return;
        const o2c = (orig: number) => {
          const arr = collapsed.frameRemap;
          if (!arr || arr.length === 0) return Math.min(orig, collapsed.frames.length - 1);
          return arr[Math.min(Math.max(orig, 0), arr.length - 1)] ?? 0;
        };
        const last = collapsed.frames.length - 1;
        const s = Math.max(0, Math.min(last, o2c(startFrame)));
        const e = Math.max(s, Math.min(last, o2c(endFrame)));
        dwellsRef.current = computeFrameDwells(collapsed.frames);
        setFrames(collapsed.frames);
        setMetaLocalPlayerId(metaPov);
        setBounds({ s, e });
        setStartOriginal(startFrame);
        setIdx(s);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [payloadBlobUrl, anonymize, startFrame, endFrame]);

  // Board orientation + frame push via the SHARED playback foundation — POV and
  // animation behaviour are now identical to the replay viewer and the clip
  // builder preview (see playback.ts). The reel always plays forward; the hook
  // snaps on the loop reset / a backward seek.
  const dir = usePlaybackBoard({ frames, metaLocalPlayerId, index: idx, animate: true, skipNextRef: skipAnimRef });

  // Auto-play the [s,e] range on a loop via the SHARED stepping engine — same
  // dwell cadence as the replay viewer (playback.ts). The loop reset (e → s)
  // snaps (skipNextRef) so the FrameAnimator doesn't fly cards backward; each
  // frame opens a progress "segment" the rAF loop below interpolates for a
  // smooth bar.
  const idxRef = useRef(idx); idxRef.current = idx;
  const stepperRef = useRef<DwellStepper | null>(null);
  if (!stepperRef.current) {
    stepperRef.current = createDwellStepper({
      isPlaying: () => playingRef.current,
      speed: () => speedRef.current,
      minDwellMs: 0,
      dwellMs: (f) => dwellsRef.current[f] ?? PLAYBACK_TICK_MS,
      lower: () => boundsRef.current.s,
      upper: () => boundsRef.current.e,
      loop: false, // don't loop — pause + show the end overlay
      show: (f) => { idxRef.current = f; setIdx(f); },
      onFrame: (cur, dwell) => {
        const { e } = boundsRef.current;
        segRef.current = { from: fracOf(cur), to: cur >= e ? 1 : fracOf(cur + 1), start: performance.now(), dur: dwell };
      },
      onEnd: () => { playingRef.current = false; setPlaying(false); setEnded(true); setChromeShown(true); },
    });
  }
  const stepper = stepperRef.current;
  useEffect(() => {
    if (state !== 'ready') return;
    scheduleRef.current = () => stepper.start(idxRef.current); // seek realign
    if (playing) stepper.start(idxRef.current);
    return () => stepper.stop();
  }, [state, playing, bounds, stepper]);

  // Smoothly advance the progress bar within the current frame's dwell.
  useEffect(() => {
    if (state !== 'ready' || !playing) return;
    const loop = () => {
      const seg = segRef.current;
      if (seg) {
        const t = seg.dur > 0 ? Math.min(1, (performance.now() - seg.start) / seg.dur) : 1;
        paint(seg.from + (seg.to - seg.from) * t);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };
  }, [state, playing]);

  // Auto-hide the chrome ~2.6s after the last interaction — but ONLY while it's
  // shown AND playing (paused/ended → it stays put; manual hide stays hidden).
  // `interact` bumps on every tap to restart the timer.
  useEffect(() => {
    if (!chromeShown || !playing || ended) return;
    const t = window.setTimeout(() => setChromeShown(false), 2600);
    return () => window.clearTimeout(t);
  }, [chromeShown, playing, ended, interact]);

  const toggle = useCallback(() => {
    const next = !playingRef.current;
    playingRef.current = next;
    if (next) setEnded(false);
    else setChromeShown(true); // pausing always surfaces the controls
    setPlaying(next);
  }, []);

  // Restart from the top and play — the end overlay's "Replay". Hide the chrome
  // again so the rewatch is immersive from the first frame.
  const replayClip = useCallback(() => {
    setEnded(false);
    setChromeShown(false);
    seekToRef.current(boundsRef.current.s);
    playingRef.current = true;
    setPlaying(true);
  }, []);

  // Spacebar toggles play/pause (replays from the end overlay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      if (endedRef.current) replayClip(); else toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, replayClip]);

  // Snap the playhead to a frame within the clip bounds (skip the animator so a
  // backward jump doesn't fly cards in reverse).
  const seekTo = useCallback((frame: number) => {
    const { s, e } = boundsRef.current;
    const f = Math.max(s, Math.min(e, frame));
    setEnded(false); // any manual seek leaves the end state (skipToEnd re-sets it)
    skipAnimRef.current = true;
    idxRef.current = f;
    setIdx(f);
    paint(fracOf(f));
    segRef.current = null;
    if (playingRef.current) scheduleRef.current(); // realign the timer + glide segment to the new frame
  }, [fracOf, paint]);
  seekToRef.current = seekTo;
  const restart = useCallback(() => seekTo(boundsRef.current.s), [seekTo]);
  // Jump to the last frame and surface the end overlay (mirrors reaching the end
  // via playback) — paused, chrome up.
  const skipToEnd = useCallback(() => {
    playingRef.current = false; setPlaying(false);
    seekToRef.current(boundsRef.current.e);
    setEnded(true); setChromeShown(true);
  }, []);

  // Arrow keys hop a frame; Shift+arrow hops a bigger jump.
  useEffect(() => {
    const STEP = 1, BIG_STEP = 10;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      if (playingRef.current) { playingRef.current = false; setPlaying(false); } // hopping pauses
      const step = (e.shiftKey ? BIG_STEP : STEP) * (e.key === 'ArrowLeft' ? -1 : 1);
      seekTo(idxRef.current + step);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seekTo]);

  // Click / drag anywhere on the scrubber to seek. Pause while scrubbing, resume
  // after if we were playing (so the auto-play driver doesn't fight the drag).
  const scrubToX = (clientX: number) => {
    const el = barRef.current;
    const { s, e } = boundsRef.current;
    if (!el || e <= s) return;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    seekTo(frameAtFrac(t)); // map the click's TIME position → frame (bar is time-scaled)
  };
  const onScrubDown = (ev: React.PointerEvent) => {
    ev.preventDefault();
    resumeAfterScrub.current = playingRef.current;
    playingRef.current = false; setPlaying(false);
    scrubToX(ev.clientX);
    const onMove = (m: PointerEvent) => scrubToX(m.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (resumeAfterScrub.current) { playingRef.current = true; setPlaying(true); }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const clipUrl = typeof window !== 'undefined' ? window.location.href : '';
  const copy = async () => { try { await copyToClipboard(clipUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* */ } };
  // Native share sheet where supported (mobile); fall back to copying the link.
  const share = async () => {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try { await nav.share({ title: title || 'KaraBuddy clip', url: clipUrl }); } catch { /* cancelled */ }
    } else {
      copy();
    }
  };
  const canNativeShare = typeof navigator !== 'undefined' && !!(navigator as any).share;
  const del = async () => {
    if (!(await confirm({ title: 'Delete this clip?', message: 'The link will stop working.', confirmLabel: 'Delete', destructive: true }))) return;
    try {
      const res = await fetch(`/api/clips/${clipSlug}`, { method: 'DELETE' });
      if ((await res.json()).ok) router.push(`/r/${replaySlug}`);
    } catch { /* */ }
  };

  // Leader/base matchup for the end overlay — extracted from the frames (set/
  // number nest under setId there), owner-first like the board. Leaders/bases
  // are public game info, so this shows even for an anonymized viewer.
  const matchup = useMemo(() => {
    const players = frames.find((f) => f?.state?.players)?.state?.players as Record<string, any> | undefined;
    if (!players) return [] as { leader: any; base: any }[];
    let ids = Object.keys(players);
    if (metaLocalPlayerId && ids.includes(metaLocalPlayerId)) ids = [metaLocalPlayerId, ...ids.filter((i) => i !== metaLocalPlayerId)];
    return ids.slice(0, 2).map((id) => ({ leader: players[id]?.leader, base: players[id]?.base }));
  }, [frames, metaLocalPlayerId]);

  if (state === 'error') {
    return <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><ErrorNote>Couldn’t load this clip.</ErrorNote></div>;
  }

  // The top chrome (title + watch-full) fades + slides down slightly when shown.
  const topChrome: React.CSSProperties = {
    opacity: chromeShown ? 1 : 0,
    pointerEvents: chromeShown ? 'auto' : 'none',
    transform: chromeShown ? 'translateY(0)' : 'translateY(-10px)',
    transition: 'opacity 220ms ease, transform 220ms ease',
  };

  return (
    <>
    {confirmDialog}
    <div style={{ position: 'relative', width: '100%', height: 'calc(100dvh - var(--kb-header-h, 0px))', background: '#0b0b12', overflow: 'hidden' }}>
      {/* Board layer — tapping it (empty area) toggles the chrome. Controls sit
          above as siblings, so tapping a control doesn't reach here. */}
      <div ref={boardRef} onPointerDown={toggleChrome} style={{ position: 'absolute', inset: 0 }}>
        <Gameboard />
        {state === 'ready' && <FrameAnimator containerRef={boardRef} enabled direction={dir.current} skipNextRef={skipAnimRef} localPlayerId={metaLocalPlayerId} speedRef={speedRef} />}
      </div>

      {/* Very slight board dim while the controls are up, so they stand out. */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none', background: '#000', opacity: chromeShown && !ended ? 0.22 : 0, transition: 'opacity 220ms ease' }} />

      {state === 'loading' && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><Loading label="clip" /></div>
      )}

      {/* Top-left: the clip title. */}
      {title && (
        <div style={{ position: 'absolute', top: 'max(12px, env(safe-area-inset-top, 12px))', left: 16, zIndex: 20, fontFamily: 'var(--font-barlow), sans-serif', ...topChrome }}>
          <div style={{ background: 'rgba(11,13,18,0.7)', backdropFilter: 'blur(6px)', border: '1px solid #2e333c', borderRadius: 999, padding: '6px 14px', color: '#e6e6e6', fontSize: 14, fontWeight: 700 }}>
            🎬 {title}
          </div>
        </div>
      )}

      {/* Top-right: open the moment in the full replay viewer. */}
      <div style={{ position: 'absolute', top: 'max(12px, env(safe-area-inset-top, 12px))', right: 16, zIndex: 20, fontFamily: 'var(--font-barlow), sans-serif', ...topChrome }}>
        <Link href={`/r/${replaySlug}?f=${startOriginal + 1}`} prefetch={false} style={{ ...ctrlStyle, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }} data-testid="clip-watch-full">
          Watch full replay
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block' }}>
            <path d="M7 17 17 7" />
            <path d="M8 7h9v9" />
          </svg>
        </Link>
      </div>

      {/* Reel controls (bottom). The progress bar always peeks at the very
          bottom; tapping slides the whole bar UP by the control-row height so
          the controls appear below it. (The root clips the overflow.) */}
      <div
        ref={bottomBarRef}
        onPointerDown={reveal}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20,
          padding: '0 16px max(12px, env(safe-area-inset-bottom, 12px))',
          display: 'flex', flexDirection: 'column', gap: 8,
          transform: chromeShown ? 'translateY(0)' : `translateY(${controlsH}px)`,
          transition: 'transform 260ms cubic-bezier(0.4, 0, 0.2, 1)',
          // Non-interactive while hidden so a tap on the peeking bar reveals
          // (via the board) instead of scrubbing.
          pointerEvents: chromeShown ? 'auto' : 'none',
        }}
      >
        {/* Scrubber — always visible (progress); interactive only when shown. */}
        <div
          ref={barRef}
          onPointerDown={onScrubDown}
          data-testid="clip-scrubber"
          style={{ position: 'relative', padding: '8px 0', cursor: 'pointer', touchAction: 'none' }}
        >
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
            {/* scaleX is written every rAF tick by `paint` — NOT in JSX, so React never resets it */}
            <div ref={fillRef} style={{ height: '100%', width: '100%', background: '#4d9dff', transformOrigin: 'left center' }} />
          </div>
          {/* playhead knob — `left` written by `paint` */}
          <div ref={knobRef} style={{ position: 'absolute', top: '50%', width: 12, height: 12, marginLeft: -6, marginTop: -6, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.6)', pointerEvents: 'none' }} />
        </div>
        <div ref={controlsRowRef} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: 'var(--font-barlow), sans-serif', opacity: chromeShown ? 1 : 0, transition: 'opacity 200ms ease' }}>
          <Ctrl onClick={restart} title="Restart from the beginning" data-testid="clip-restart" aria-label="Restart from the beginning">
            {/* skip-to-start (⏮): unambiguous "back to the beginning" */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ display: 'block' }}>
              <rect x="5" y="5" width="3" height="14" rx="1" />
              <path d="M20 5.5v13a1 1 0 0 1-1.55.83L9 13.2a1 1 0 0 1 0-1.66l9.45-6.13A1 1 0 0 1 20 5.5Z" />
            </svg>
          </Ctrl>
          {/* Play/pause. At the end ▶ means "play again" → replay from the start
              (hitting play at the end otherwise re-ran the last frame). */}
          <Ctrl onClick={() => (endedRef.current ? replayClip() : toggle())} data-testid="clip-play" aria-label={ended ? 'Replay' : playing ? 'Pause' : 'Play'}>{playing && !ended ? '❚❚' : '▶'}</Ctrl>
          <Ctrl onClick={skipToEnd} title="Skip to the end" data-testid="clip-skip-end" aria-label="Skip to the end">
            {/* skip-to-end (⏭) */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ display: 'block' }}>
              <path d="M4 5.5v13a1 1 0 0 0 1.55.83L15 12.8a1 1 0 0 0 0-1.66L5.55 5.05A1 1 0 0 0 4 5.5Z" />
              <rect x="16" y="5" width="3" height="14" rx="1" />
            </svg>
          </Ctrl>
          {/* Playback speed. */}
          <div style={{ display: 'inline-flex', borderRadius: 8, border: '1px solid rgba(77,157,255,0.4)', overflow: 'hidden' }}>
            {PLAYBACK_SPEEDS.map((sp) => (
              <button
                key={sp.value}
                type="button"
                onClick={() => setSpeed(sp.value)}
                data-testid={`clip-speed-${sp.value}`}
                style={{ background: speed === sp.value ? '#4d9dff' : 'rgba(36,48,68,0.85)', color: speed === sp.value ? '#fff' : '#a0a8b8', border: 0, padding: '7px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', backdropFilter: 'blur(6px)' }}
              >
                {sp.label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <Ctrl onClick={copy}>{copied ? 'Copied!' : 'Share link'}</Ctrl>
          {canDelete && <Ctrl onClick={del} danger>Delete</Ctrl>}
        </div>
      </div>

      {/* End overlay — the clip paused at its last frame, darkened, with rewatch
          + share actions centered. Sits BELOW the chrome (z20) so the corner
          "Watch full replay" stays usable for opening the full replay. */}
      {ended && (
        <div
          onPointerDown={(e) => { if (e.target === e.currentTarget) { setEnded(false); reveal(); } }}
          style={{ position: 'absolute', inset: 0, zIndex: 15, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(7, 9, 13, 0.72)', backdropFilter: 'blur(2px)' }}
          data-testid="clip-end-overlay"
        >
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              width: 'min(360px, 92vw)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
              padding: '22px 20px', borderRadius: 16, background: 'rgba(17, 20, 26, 0.97)',
              border: '1px solid #2e333c', boxShadow: '0 18px 50px rgba(0,0,0,0.6)',
              fontFamily: 'var(--font-barlow), sans-serif', textAlign: 'center',
            }}
          >
            {/* Leader/base matchup summary. */}
            {matchup.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
                {matchup.map((m, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: '#6c7588' }}>VS</span>}
                    <LeaderBasePair leader={m.leader} base={m.base} orientation="overlap" width={46} height={32} fit="cover" radius={3} fallback="box" />
                  </Fragment>
                ))}
              </div>
            )}
            <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', lineHeight: 1.25 }}>{title || 'Clip'}</div>
            <div style={{ fontSize: 12, color: '#8b93a5' }}>
              {bounds.e - bounds.s + 1} frames · from frame {startOriginal + 1}
            </div>
            <button
              type="button"
              onClick={replayClip}
              data-testid="clip-replay"
              style={{ ...ctrlStyle, width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, padding: '11px 14px', background: '#4d9dff', borderColor: '#4d9dff', color: '#fff' }}
            >
              {/* circular replay arrow (lucide rotate-ccw) */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block' }}>
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Replay
            </button>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <Ctrl onClick={copy} data-testid="clip-copy-link" style={{ flex: 1, justifyContent: 'center', display: 'flex' }}>{copied ? 'Copied!' : 'Copy link'}</Ctrl>
              {canNativeShare && <Ctrl onClick={share} data-testid="clip-share" style={{ flex: 1, justifyContent: 'center', display: 'flex' }}>Share</Ctrl>}
            </div>
            {canDelete && <Ctrl onClick={del} danger style={{ width: '100%', justifyContent: 'center', display: 'flex' }}>Delete clip</Ctrl>}
          </div>
        </div>
      )}
    </div>
    </>
  );
}

const ctrlStyle: React.CSSProperties = {
  background: 'rgba(36, 48, 68, 0.85)', border: '1px solid rgba(77,157,255,0.4)', color: '#d6e7ff',
  borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(6px)',
};
function Ctrl({ children, danger, style, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button type="button" {...rest} style={{ ...ctrlStyle, ...(danger ? { color: '#ff8f8f', borderColor: '#5a2a2a' } : {}), fontFamily: 'inherit', ...style }}>
      {children}
    </button>
  );
}

'use client';

// B221: the "Watch from the opening" mini-player — a modal overlay riding the
// SHARED playback foundation (B138: same Gameboard + FrameAnimator +
// usePlaybackBoard the viewer, clip reel, and builder preview use), with NO
// viewer chrome: just the board and forward/back stepping. Steps by ACTION
// (computeActionStops — the zoom-through cadence), arrow keys included.
// Playback speed inherits the user's stored viewer setting; there's no UI to
// change it here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/app/_components/Modal';
import { ThemeContextProvider } from '@/app/_contexts/Theme.context';
import { CosmeticsProvider } from '@/app/_contexts/CosmeticsContext';
import { UserProvider } from '@/app/_contexts/User.context';
import { PopupProvider } from '@/app/_contexts/Popup.context';
import { GameProvider } from '@/app/_contexts/Game.context';
import Gameboard from '@/app/_components/Gameboard/Gameboard';
import { FrameAnimator } from '@/app/(app)/r/[slug]/FrameAnimator';
import { usePlaybackBoard, PLAYBACK_SPEEDS, PLAYBACK_SPEED_DEFAULT, PLAYBACK_SPEED_STORAGE_KEY } from '@/app/(app)/r/[slug]/playback';
import { computeActionStops, nextActionStop } from '@/app/(app)/r/[slug]/actionStops';
import { decodeReplay, collapseReplay, type Frame } from '@/lib/replayDecoder';
import { ErrorNote, Loading } from '@/app/_components/StatusUi';
import { glowButtonStyle } from '@/app/_components/glowButton';

// Decoded-payload cache so the player opens INSTANTLY: the stage calls
// prepareWatch() as soon as a reveal renders, and the modal awaits the same
// promise (already resolved on click in the common case). Failures aren't
// cached; the cap keeps a long session from hoarding payloads.
export interface WatchData {
  frames: Frame[];
  activeByFrame: Array<string | null>;
  metaLocalPlayerId: string | null;
  frameRemap: number[] | null;
  collapsedToOrig: number[] | null;
}
const watchCache = new Map<string, Promise<WatchData>>();
export function prepareWatch(replaySlug: string): Promise<WatchData> {
  let promise = watchCache.get(replaySlug);
  if (!promise) {
    promise = (async () => {
      const meta = await (await fetch(`/api/replays/${replaySlug}`)).json();
      const blobUrl: string | undefined = meta?.data?.payloadBlobUrl;
      if (!blobUrl) throw new Error('no payload');
      const parsed = JSON.parse(await (await fetch(blobUrl)).text());
      const collapsed = collapseReplay(decodeReplay(parsed));
      return {
        frames: collapsed.frames,
        activeByFrame: collapsed.activeByFrame,
        metaLocalPlayerId: collapsed.meta?.localPlayerId ?? null,
        frameRemap: collapsed.frameRemap ?? null,
        collapsedToOrig: collapsed.collapsedToOrig ?? null,
      };
    })();
    promise.catch(() => watchCache.delete(replaySlug));
    watchCache.set(replaySlug, promise);
    if (watchCache.size > 6) {
      const oldest = watchCache.keys().next().value;
      if (oldest && oldest !== replaySlug) watchCache.delete(oldest);
    }
  }
  return promise;
}

export function OpeningWatchModal({
  replaySlug,
  startFrame,
  onClose,
}: {
  replaySlug: string;
  startFrame: number; // ORIGINAL frame space (the opening's decision frame)
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} ariaLabel="Watch from the opening" width="min(1180px, 97vw)">
      <ThemeContextProvider>
        <UserProvider>
          <CosmeticsProvider>
            <PopupProvider>
              <GameProvider>
                <WatchInner replaySlug={replaySlug} startFrame={startFrame} onClose={onClose} />
              </GameProvider>
            </PopupProvider>
          </CosmeticsProvider>
        </UserProvider>
      </ThemeContextProvider>
    </Modal>
  );
}

function WatchInner({ replaySlug, startFrame, onClose }: { replaySlug: string; startFrame: number; onClose: () => void }) {
  const boardRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const skipAnimRef = useRef(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  // The lifted Gameboard hard-sizes itself to 100dvh (viewer/reel are
  // full-bleed surfaces). In a modal we let it render at the size it wants —
  // an inner box exactly viewport-tall — and SCALE that down to fit the
  // modal's board area, so the whole table (both leaders + your hand) is
  // always visible.
  const [fit, setFit] = useState<{ scale: number; innerW: number; innerH: number }>({ scale: 1, innerW: 0, innerH: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const vh = window.innerHeight;
      const scale = el.clientHeight / vh;
      setFit({ scale, innerW: scale > 0 ? el.clientWidth / scale : el.clientWidth, innerH: vh });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, [state]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [activeByFrame, setActiveByFrame] = useState<Array<string | null>>([]);
  const [metaLocalPlayerId, setMetaLocalPlayerId] = useState<string | null>(null);
  const [collapsedToOrig, setCollapsedToOrig] = useState<number[] | null>(null);
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0); idxRef.current = idx;

  // Inherit the viewer's playback speed (localStorage) — read once.
  const speedRef = useRef(PLAYBACK_SPEED_DEFAULT);
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY));
      if (PLAYBACK_SPEEDS.some((o) => o.value === v)) speedRef.current = v;
    } catch {}
  }, []);

  // Consume the preload cache (usually already resolved — the stage warms it
  // when the reveal renders), map the ORIGINAL start frame into collapsed
  // space, and go.
  useEffect(() => {
    let cancelled = false;
    prepareWatch(replaySlug)
      .then((data) => {
        if (cancelled) return;
        const o2c = (orig: number) => {
          const arr = data.frameRemap;
          if (!arr || arr.length === 0) return Math.min(orig, data.frames.length - 1);
          return arr[Math.min(Math.max(orig, 0), arr.length - 1)] ?? 0;
        };
        setFrames(data.frames);
        setActiveByFrame(data.activeByFrame);
        setMetaLocalPlayerId(data.metaLocalPlayerId);
        setCollapsedToOrig(data.collapsedToOrig);
        setIdx(Math.max(0, Math.min(data.frames.length - 1, o2c(startFrame))));
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [replaySlug, startFrame]);

  // Zoom-through stepping: one beat per ACTION (plays, draws, setup decisions).
  const stops = useMemo(
    () => (frames.length ? computeActionStops(frames, activeByFrame) : []),
    [frames, activeByFrame],
  );
  const step = useCallback((dir: 1 | -1) => {
    if (!stops.length) return;
    const next = nextActionStop(stops, idxRef.current, dir);
    if (next === idxRef.current) return;
    if (dir < 0) skipAnimRef.current = true; // backward snaps, like the viewer
    setIdx(next);
  }, [stops]);

  // Arrow keys. The stage's own key handler is suspended while the modal is
  // open (see OpeningStage), so these don't double-fire the session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step]);

  // Unconditional — hooks can't sit below the loading/error early-returns.
  // The foundation tolerates empty frames while the payload loads.
  const dir = usePlaybackBoard({ frames, metaLocalPlayerId, index: idx, animate: true, skipNextRef: skipAnimRef });

  if (state === 'error') return <ErrorNote>Couldn’t load the replay.</ErrorNote>;
  if (state === 'loading') return <Loading label="Loading the game…" />;

  const pos = stops.filter((s) => s <= idx).length;
  const origIdx = collapsedToOrig?.[idx] ?? idx;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        ref={wrapRef}
        style={{ position: 'relative', width: '100%', height: 'min(68vh, 760px)', background: '#0b0b12', borderRadius: 10, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}
      >
        {fit.innerW > 0 && (
          <div
            ref={boardRef}
            style={{
              position: 'relative',
              width: fit.innerW,
              height: fit.innerH,
              flexShrink: 0,
              transform: `scale(${fit.scale})`,
              transformOrigin: 'top center',
              // The board reserves --kb-header-h; zero it inside the box so
              // the full 100dvh layout lands in our scaled frame.
              ['--kb-header-h' as string]: '0px',
            } as React.CSSProperties}
          >
            <Gameboard />
            <FrameAnimator
              containerRef={boardRef}
              enabled
              direction={dir.current}
              skipNextRef={skipAnimRef}
              localPlayerId={metaLocalPlayerId}
              speedRef={speedRef}
            />
          </div>
        )}
        {/* Pop out to the FULL viewer at the current frame, in a new tab. */}
        <a
          data-testid="opening-watch-popout"
          href={`/r/${replaySlug}?f=${origIdx + 1}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open the full replay viewer at this frame"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'rgba(13,16,22,0.85)',
            border: '1px solid #2e333c',
            color: '#a0a8b8',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17L17 7" /><path d="M9 7h8v8" />
          </svg>
        </a>
        <button
          type="button"
          data-testid="opening-watch-close"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 10,
            right: 50,
            zIndex: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'rgba(13,16,22,0.85)',
            border: '1px solid #2e333c',
            color: '#a0a8b8',
            cursor: 'pointer',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18" /><path d="M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <button
          type="button"
          data-testid="opening-watch-prev"
          onClick={() => step(-1)}
          style={{ ...glowButtonStyle, fontSize: 13, padding: '7px 16px' }}
        >
          ◀ Back
        </button>
        <span data-testid="opening-watch-pos" style={{ fontSize: 12.5, color: '#8a93a3', minWidth: 76, textAlign: 'center' }}>
          {pos} / {stops.length}
        </span>
        <button
          type="button"
          data-testid="opening-watch-next"
          onClick={() => step(1)}
          style={{ ...glowButtonStyle, fontSize: 13, padding: '7px 16px' }}
        >
          Forward ▶
        </button>
      </div>
    </div>
  );
}

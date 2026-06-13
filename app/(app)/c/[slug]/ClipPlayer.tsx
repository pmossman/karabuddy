'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThemeContextProvider } from '@/app/_contexts/Theme.context';
import { CosmeticsProvider } from '@/app/_contexts/CosmeticsContext';
import { UserProvider } from '@/app/_contexts/User.context';
import { PopupProvider } from '@/app/_contexts/Popup.context';
import { GameProvider, useGame } from '@/app/_contexts/Game.context';
import Gameboard from '@/app/_components/Gameboard/Gameboard';
import { FrameAnimator } from '@/app/(app)/r/[slug]/FrameAnimator';
import { computeFrameDwells, PLAYBACK_TICK_MS } from '@/app/(app)/r/[slug]/frameDwell';
import { decodeReplay, collapseReplay, type Frame } from '@/lib/replayDecoder';

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
  localPlayerId: string | null;
  anonymize: boolean;
  anonById: Record<string, string> | null; // id → label, for anonymized boards
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

function ClipPlayerInner({ clipSlug, replaySlug, payloadBlobUrl, startFrame, endFrame, title, localPlayerId, anonymize, anonById, canDelete }: ClipPlayerProps) {
  const { setGameState, setConnectedPlayer } = useGame();
  const router = useRouter();
  const boardRef = useRef<HTMLDivElement>(null);
  const skipAnimRef = useRef(false);

  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [frames, setFrames] = useState<Frame[]>([]);
  const [bounds, setBounds] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [startOriginal, setStartOriginal] = useState(startFrame);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [copied, setCopied] = useState(false);

  const dwellsRef = useRef<number[]>([]);
  const playTimer = useRef<number | null>(null);
  const playingRef = useRef(true);

  // Fetch + decode the payload, anonymize if needed, resolve the clip bounds
  // (original → collapsed, clamped to what survived a re-collapse).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(payloadBlobUrl);
        const parsed = JSON.parse(await res.text());
        const collapsed = collapseReplay(decodeReplay(parsed));
        if (anonymize && anonById) {
          const { anonymizeFrames } = await import('@/lib/anonymizeReplay');
          anonymizeFrames(collapsed.frames, new Map(Object.entries(anonById)));
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
        setBounds({ s, e });
        setStartOriginal(startFrame);
        setIdx(s);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [payloadBlobUrl, anonymize, anonById, startFrame, endFrame]);

  // Orient + push the current frame into the board.
  useEffect(() => {
    if (state !== 'ready') return;
    const players = frames[0]?.state?.players;
    if (players) {
      const connected = (localPlayerId && Object.prototype.hasOwnProperty.call(players, localPlayerId)) ? localPlayerId : Object.keys(players)[0] ?? null;
      if (connected) setConnectedPlayer(connected);
    }
  }, [state, frames, localPlayerId, setConnectedPlayer]);

  useEffect(() => {
    const f = frames[idx];
    if (f?.state) setGameState(f.state);
  }, [frames, idx, setGameState]);

  // Auto-play the [s,e] range on a loop. Forward steps animate; the loop reset
  // (e → s) snaps (skipNextRef) so the FrameAnimator doesn't fly cards backward.
  // The driver reads the live idx via a ref and dwells per-frame.
  const idxRef = useRef(idx); idxRef.current = idx;
  useEffect(() => {
    if (state !== 'ready' || !playing) return;
    const { s, e } = bounds;
    const schedule = () => {
      const cur = idxRef.current;
      const dwell = dwellsRef.current[cur] ?? PLAYBACK_TICK_MS;
      playTimer.current = window.setTimeout(() => {
        if (!playingRef.current) return;
        if (idxRef.current >= e) { skipAnimRef.current = true; setIdx(s); }
        else setIdx(idxRef.current + 1);
        schedule();
      }, dwell);
    };
    schedule();
    return () => { if (playTimer.current != null) { window.clearTimeout(playTimer.current); playTimer.current = null; } };
  }, [state, playing, bounds]);

  const toggle = () => { if (playing) { playingRef.current = false; setPlaying(false); } else { playingRef.current = true; setPlaying(true); } };

  const clipUrl = typeof window !== 'undefined' ? window.location.href : '';
  const copy = async () => { try { await navigator.clipboard.writeText(clipUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* */ } };
  const del = async () => {
    if (!confirm('Delete this clip? The link will stop working.')) return;
    try {
      const res = await fetch(`/api/clips/${clipSlug}`, { method: 'DELETE' });
      if ((await res.json()).ok) router.push(`/r/${replaySlug}`);
    } catch { /* */ }
  };

  const { s, e } = bounds;
  const progress = e > s ? Math.max(0, Math.min(1, (idx - s) / (e - s))) : 1;

  if (state === 'error') {
    return <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: '#ff7a7a' }}>Couldn’t load this clip.</div>;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100dvh - var(--kb-header-h, 0px))', background: '#0b0b12', overflow: 'hidden' }}>
      <div ref={boardRef} style={{ position: 'absolute', inset: 0 }}>
        <Gameboard />
        {state === 'ready' && <FrameAnimator containerRef={boardRef} enabled direction={1} skipNextRef={skipAnimRef} localPlayerId={localPlayerId} />}
      </div>

      {state === 'loading' && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#6c7588', fontSize: 14 }}>Loading clip…</div>
      )}

      {/* Title (top). */}
      {title && (
        <div style={{ position: 'absolute', top: 'max(12px, env(safe-area-inset-top, 12px))', left: 16, right: 16, zIndex: 20, pointerEvents: 'none' }}>
          <div style={{ display: 'inline-block', background: 'rgba(11,13,18,0.7)', backdropFilter: 'blur(6px)', border: '1px solid #2e333c', borderRadius: 999, padding: '6px 14px', color: '#e6e6e6', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-barlow), sans-serif' }}>
            🎬 {title}
          </div>
        </div>
      )}

      {/* Reel controls (bottom). */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20, padding: '0 16px max(12px, env(safe-area-inset-bottom, 12px))', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress * 100}%`, background: '#4d9dff', transition: 'width 120ms linear' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: 'var(--font-barlow), sans-serif' }}>
          <Ctrl onClick={toggle} data-testid="clip-play">{playing ? '❚❚' : '▶'}</Ctrl>
          <Link href={`/r/${replaySlug}?f=${startOriginal + 1}`} prefetch={false} style={{ ...ctrlStyle, textDecoration: 'none' }} data-testid="clip-watch-full">Watch full replay →</Link>
          <div style={{ flex: 1 }} />
          <Ctrl onClick={copy}>{copied ? 'Copied!' : 'Share link'}</Ctrl>
          {canDelete && <Ctrl onClick={del} danger>Delete</Ctrl>}
        </div>
      </div>
    </div>
  );
}

const ctrlStyle: React.CSSProperties = {
  background: 'rgba(36, 48, 68, 0.85)', border: '1px solid rgba(77,157,255,0.4)', color: '#d6e7ff',
  borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(6px)',
};
function Ctrl({ children, danger, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button type="button" {...rest} style={{ ...ctrlStyle, ...(danger ? { color: '#ff8f8f', borderColor: '#5a2a2a' } : {}), fontFamily: 'inherit' }}>
      {children}
    </button>
  );
}

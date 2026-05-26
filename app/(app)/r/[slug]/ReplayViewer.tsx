'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ThemeContextProvider } from '@/app/_contexts/Theme.context';
import { CosmeticsProvider } from '@/app/_contexts/CosmeticsContext';
import { UserProvider } from '@/app/_contexts/User.context';
import { PopupProvider } from '@/app/_contexts/Popup.context';
import { GameProvider, useGame } from '@/app/_contexts/Game.context';
import Gameboard from '@/app/_components/Gameboard/Gameboard';
import { decodeReplay, type Frame, type DecodedReplay } from '@/lib/replayDecoder';
import { TagSidebar } from './TagSidebar';

interface ReplayRow {
  slug: string;
  gameId: string;
  ownerToken: string;
  players: any;
  durationMs: number;
  actionCount: number;
  payloadBlobUrl: string;
  payloadSizeBytes: number;
  visibility: string;
  createdAt: string;
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tagState, setTagState] = useState<TagRow[]>(initialTags);
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
        // Pick the first player as the "viewer perspective" (matches what
        // karabast does in spectator mode).
        const firstPlayerId = result.frames[0]?.state?.players
          ? Object.keys(result.frames[0].state.players)[0]
          : null;
        if (firstPlayerId) setConnectedPlayer(firstPlayerId);
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
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [frames, activeByFrame, currentIndex, mode, step]);

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
      <TagSidebar
        replay={replay}
        frames={frames}
        currentIndex={currentIndex}
        onStep={step}
        onJump={setCurrentIndex}
        tags={tagState}
        setTags={setTagState}
        playerUsernames={playerUsernames}
        mode={mode}
        setMode={setMode}
      />
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        {frames ? (
          <Gameboard />
        ) : (
          <div style={{ padding: 32, color: '#a0a8b8', fontFamily: 'var(--font-barlow), sans-serif' }}>
            Loading replay…
          </div>
        )}
      </div>
    </div>
  );
}

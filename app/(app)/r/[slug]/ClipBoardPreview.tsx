'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Gameboard from '@/app/_components/Gameboard/Gameboard';
import { useGame } from '@/app/_contexts/Game.context';
import type { Frame } from '@/lib/replayDecoder';

// B136: an INDEPENDENT board preview for the clip builder + reel viewer. The
// real Gameboard hard-codes `height: 100dvh` (it's built for the full viewport),
// so we render it at full viewport size inside an absolutely-positioned layer
// and CSS-`scale` it to fill the (smaller) preview box — a faithful miniature.
// It reads its OWN GameProvider (mount this inside a nested <GameProvider>), so
// driving its frame never touches the underlying replay viewer's board.
export function ClipBoardPreview({
  frames,
  index,
  localPlayerId,
}: {
  frames: Frame[];
  index: number;            // which frame to show (clamped by the caller)
  localPlayerId: string | null;
}) {
  const { setGameState, setConnectedPlayer } = useGame();
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);

  // Orient the board to the recorder's POV (bottom).
  useEffect(() => {
    const players = frames[0]?.state?.players;
    if (!players) return;
    const connected = (localPlayerId && Object.prototype.hasOwnProperty.call(players, localPlayerId))
      ? localPlayerId
      : Object.keys(players)[0] ?? null;
    if (connected) setConnectedPlayer(connected);
  }, [frames, localPlayerId, setConnectedPlayer]);

  // Push the requested frame's state into THIS board's context (snap, no
  // animation — scrubbing is bidirectional).
  useEffect(() => {
    const f = frames[Math.max(0, Math.min(frames.length - 1, index))];
    if (f?.state) setGameState(f.state);
  }, [frames, index, setGameState]);

  // Fit the full-viewport board into the preview box.
  useLayoutEffect(() => {
    const fit = () => {
      const box = boxRef.current;
      if (!box) return;
      const w = box.clientWidth, h = box.clientHeight;
      const vw = window.innerWidth || 1, vh = window.innerHeight || 1;
      setScale(Math.min(w / vw, h / vh));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
  return (
    <div ref={boxRef} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#0b0b12', borderRadius: 10 }}>
      <div
        style={{
          position: 'absolute',
          left: '50%', top: '50%',
          width: vw, height: vh,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center',
          pointerEvents: 'none', // the preview is non-interactive
        }}
      >
        <Gameboard />
      </div>
    </div>
  );
}

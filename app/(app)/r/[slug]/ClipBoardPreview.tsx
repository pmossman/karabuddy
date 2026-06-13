'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Gameboard from '@/app/_components/Gameboard/Gameboard';
import { useGame } from '@/app/_contexts/Game.context';
import { FrameAnimator } from './FrameAnimator';
import type { Frame } from '@/lib/replayDecoder';

// B136: an INDEPENDENT board preview for the clip builder. The real Gameboard
// hard-codes `height: 100dvh` (built for the full viewport), so we render it at
// full viewport size inside an absolutely-positioned layer and CSS-`scale` it to
// fill the (smaller) preview box — a faithful miniature. It reads its OWN
// GameProvider (mount inside a nested one), so driving its frame never touches
// the underlying replay viewer's board.
//
// The FrameAnimator is mounted over the box (its containerRef) — it works in
// screen-pixel space (getBoundingClientRect + relative offsets), so it animates
// the SCALED board correctly. Forward play steps animate; a scrub (handle drag,
// backward, or a >1 jump) snaps via skipNextRef.
export function ClipBoardPreview({
  frames,
  index,
  animate,
  localPlayerId,
}: {
  frames: Frame[];
  index: number;            // which frame to show (clamped by the caller)
  animate: boolean;         // true during preview PLAY → animate forward steps
  localPlayerId: string | null;
}) {
  const { setGameState, setConnectedPlayer } = useGame();
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const prevIdx = useRef(index);
  const dir = useRef(1);
  const skipRef = useRef(true); // first push snaps

  useEffect(() => {
    const players = frames[0]?.state?.players;
    if (!players) return;
    const connected = (localPlayerId && Object.prototype.hasOwnProperty.call(players, localPlayerId))
      ? localPlayerId
      : Object.keys(players)[0] ?? null;
    if (connected) setConnectedPlayer(connected);
  }, [frames, localPlayerId, setConnectedPlayer]);

  // Push the requested frame. Animate only a forward single step DURING play;
  // anything else (scrub, backward, jump, or not playing) snaps.
  useEffect(() => {
    const i = Math.max(0, Math.min(frames.length - 1, index));
    const delta = i - prevIdx.current;
    dir.current = delta >= 0 ? 1 : -1;
    if (!animate || delta <= 0 || delta > 1) skipRef.current = true;
    prevIdx.current = i;
    const f = frames[i];
    if (f?.state) setGameState(f.state);
  }, [frames, index, animate, setGameState]);

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
          pointerEvents: 'none',
        }}
      >
        <Gameboard />
      </div>
      {/* Same card-movement choreography as the main board. */}
      <FrameAnimator containerRef={boxRef} enabled direction={dir.current} skipNextRef={skipRef} localPlayerId={localPlayerId} />
    </div>
  );
}

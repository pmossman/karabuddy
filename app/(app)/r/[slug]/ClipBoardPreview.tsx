'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import Gameboard from '@/app/_components/Gameboard/Gameboard';
import { FrameAnimator } from './FrameAnimator';
import { usePlaybackBoard } from './playback';
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
  speedRef,
}: {
  frames: Frame[];
  index: number;            // which frame to show (clamped by the caller)
  animate: boolean;         // true during preview PLAY → animate forward steps
  localPlayerId: string | null;
  speedRef?: RefObject<number | null>; // preview speed → scales animations
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const skipRef = useRef(true); // first push snaps
  // Shared playback foundation — identical POV + frame-push to the reel player
  // and the replay viewer (see playback.ts).
  const dir = usePlaybackBoard({ frames, metaLocalPlayerId: localPlayerId, index, animate, skipNextRef: skipRef });

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
      <FrameAnimator containerRef={boxRef} enabled direction={dir.current} skipNextRef={skipRef} localPlayerId={localPlayerId} speedRef={speedRef} />
    </div>
  );
}

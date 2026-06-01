'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// B100: free-drag resize for the mobile viewer sheets. Pointer events (not
// touch/mouse separately) so one path handles finger + trackpad, with
// pointer-capture so a drag that leaves the handle keeps tracking. The handle
// element must set `touchAction: 'none'` or the browser steals the gesture
// for scrolling.
//
//   axis  — which screen axis the drag reads ('y' for top/bottom sheets that
//           resize height, 'x' for left/right sheets that resize width).
//   grow  — sign mapping drag direction → size: +1 if moving in the positive
//           axis direction enlarges the sheet, -1 if it shrinks it. A bottom
//           sheet grabbed at its TOP edge grows as you drag UP (clientY down)
//           → grow:-1; a left sheet grabbed at its RIGHT edge grows as you
//           drag RIGHT → grow:+1.
//
// min/max are read on every move so a viewport rotate/resize re-clamps without
// stale bounds; the returned size is clamped on read too.
//
// storageKey — when set, the size persists to localStorage and is restored on
// mount (and re-restored when the key changes, e.g. on an orientation flip, so
// portrait height + landscape width are remembered independently). Initialized
// to `initial`, then hydrated from storage in an effect (mirrors the desktop
// sidebar-width pattern) to avoid an SSR hydration mismatch.
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function useDragSize({
  axis,
  grow,
  initial,
  min,
  max,
  storageKey,
}: {
  axis: 'x' | 'y';
  grow: 1 | -1;
  initial: number;
  min: number;
  max: number;
  storageKey?: string;
}) {
  const [size, setSize] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ start: number; startSize: number } | null>(null);

  // Restore on mount / when the storage key changes (orientation flip). Falls
  // back to `initial` (already the current orientation's default) when nothing
  // is stored for that key yet.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const v = raw == null ? NaN : Number(raw);
      setSize(Number.isFinite(v) && v > 0 ? clamp(v, min, max) : clamp(initial, min, max));
    } catch {
      setSize(clamp(initial, min, max));
    }
    // initial/min/max intentionally excluded — re-restore only on key change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
      dragRef.current = { start: axis === 'x' ? e.clientX : e.clientY, startSize: clamp(size, min, max) };
      setDragging(true);
    },
    [axis, size, min, max],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = dragRef.current;
      if (!s) return;
      const cur = axis === 'x' ? e.clientX : e.clientY;
      setSize(clamp(s.startSize + (cur - s.start) * grow, min, max));
    },
    [axis, grow, min, max],
  );

  const end = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    // Persist the final size (functional update reads the latest value without
    // a stale closure).
    if (storageKey) {
      setSize((s) => {
        try { window.localStorage.setItem(storageKey, String(Math.round(s))); } catch {}
        return s;
      });
    }
  }, [storageKey]);

  return {
    size: clamp(size, min, max),
    dragging,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    } as const,
  };
}

// The visible grabber pill. `orientation` is the bar's long axis: horizontal
// for a top/bottom sheet edge (resizes height), vertical for a left/right edge
// (resizes width). Spread the hook's handleProps onto it.
import React from 'react';

export function Grabber({
  orientation,
  dragging,
  label,
  handleProps,
  style,
}: {
  orientation: 'horizontal' | 'vertical';
  dragging: boolean;
  label: string;
  handleProps: React.HTMLAttributes<HTMLDivElement>;
  style?: React.CSSProperties;
}) {
  const horizontal = orientation === 'horizontal';
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-label={label}
      {...handleProps}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        cursor: horizontal ? 'ns-resize' : 'ew-resize',
        touchAction: 'none',
        userSelect: 'none',
        width: horizontal ? '100%' : 22,
        height: horizontal ? 22 : '100%',
        background: dragging ? 'rgba(77, 157, 255, 0.14)' : 'transparent',
        transition: 'background 120ms ease',
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'block',
          borderRadius: 999,
          background: dragging ? 'rgba(77, 157, 255, 0.95)' : 'rgba(150, 170, 200, 0.5)',
          width: horizontal ? 40 : 4,
          height: horizontal ? 4 : 40,
          transition: 'background 120ms ease',
        }}
      />
    </div>
  );
}

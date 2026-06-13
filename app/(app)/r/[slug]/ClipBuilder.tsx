'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameProvider } from '@/app/_contexts/Game.context';
import type { Frame } from '@/lib/replayDecoder';
import type { Chapter } from '@/lib/replayChapters';
import { ClipBoardPreview } from './ClipBoardPreview';
import { computeFrameDwells, PLAYBACK_TICK_MS } from './frameDwell';

// B136: the clip trim builder — a large modal over the replay viewer with its
// OWN independent board (nested GameProvider; the underlying viewer board never
// changes as you scrub). Loom/iPhone-style trim: a timeline with draggable
// start/end handles + a playhead + tag/chapter markers; dragging a handle seeks
// the preview board. Title + Create → a shareable clip link.
interface Props {
  open: boolean;
  onClose: () => void;
  replaySlug: string;
  frames: Frame[];                       // collapsed displayFrames
  collapsedToOriginal: (c: number) => number;
  localPlayerId: string | null;
  chapters: Chapter[];                   // collapsed-space markers (tags + beats)
  initialIndex: number;                  // viewer's current frame (collapsed)
  installToken: string;
}

const SPEEDS = [0.5, 1, 2] as const;

export function ClipBuilder(props: Props) {
  const { open, onClose } = props;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 220, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'min(3vw, 24px)' }}
    >
      <div
        role="dialog"
        aria-label="Create a clip"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1000px, 96vw)', maxHeight: '94vh', display: 'flex', flexDirection: 'column',
          background: '#11141a', border: '1px solid #2e333c', borderRadius: 14, overflow: 'hidden',
          boxShadow: '0 18px 50px rgba(0,0,0,0.6)', color: '#e6e6e6', fontFamily: 'var(--font-barlow), sans-serif',
        }}
      >
        {/* Nested GameProvider → the builder's board is fully independent. */}
        <GameProvider>
          <ClipBuilderInner {...props} />
        </GameProvider>
      </div>
    </div>
  );
}

function ClipBuilderInner({
  onClose, replaySlug, frames, collapsedToOriginal, localPlayerId, chapters, initialIndex, installToken,
}: Props) {
  const n = frames.length;
  const last = Math.max(0, n - 1);
  const clamp = (i: number) => Math.max(0, Math.min(last, i));

  const [start, setStart] = useState(() => clamp(initialIndex));
  const [end, setEnd] = useState(() => clamp(initialIndex + Math.min(20, last - clamp(initialIndex)) || Math.min(last, clamp(initialIndex) + 1)));
  const [focus, setFocus] = useState(() => clamp(initialIndex)); // which frame the preview shows
  const [title, setTitle] = useState('');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);          // preview speed, independent of the main board
  const speedRef = useRef(1); speedRef.current = speed;
  const dwells = useMemo(() => computeFrameDwells(frames), [frames]);
  const dwellsRef = useRef<number[]>(dwells); dwellsRef.current = dwells;
  const [busy, setBusy] = useState(false);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const playTimer = useRef<number | null>(null);
  const playheadRef = useRef(start);

  // Ensure a valid window if the defaults collide on a tiny replay.
  useEffect(() => { if (end <= start) setEnd(Math.min(last, start + 1)); }, [start, end, last]);

  const frameFromX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el || n <= 1) return 0;
    const r = el.getBoundingClientRect();
    const t = (clientX - r.left) / r.width;
    return clamp(Math.round(t * last));
  }, [n, last]);

  const stopPreview = useCallback(() => {
    setPlaying(false);
    if (playTimer.current != null) { window.clearTimeout(playTimer.current); playTimer.current = null; }
  }, []);

  // Drag a handle: seek the preview to it.
  const dragHandle = (which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    stopPreview();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const move = (clientX: number) => {
      const f = frameFromX(clientX);
      if (which === 'start') { const v = Math.min(f, end - 1); setStart(v); setFocus(v); }
      else { const v = Math.max(f, start + 1); setEnd(v); setFocus(v); }
    };
    move(e.clientX);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Click the track → move the nearest handle there.
  const onTrackClick = (e: React.PointerEvent) => {
    if (e.target !== trackRef.current) return;
    stopPreview();
    const f = frameFromX(e.clientX);
    if (Math.abs(f - start) <= Math.abs(f - end)) { const v = Math.min(f, end - 1); setStart(v); setFocus(v); }
    else { const v = Math.max(f, start + 1); setEnd(v); setFocus(v); }
  };

  const playPreview = useCallback(() => {
    stopPreview();
    setPlaying(true);
    playheadRef.current = start;
    setFocus(start);
    // Dwell per-frame (same choreography map as the main board) ÷ the preview's
    // own speed, so animations get time to play and the speed is independent.
    const tick = () => {
      const cur = playheadRef.current;
      const dwell = (dwellsRef.current[cur] ?? PLAYBACK_TICK_MS) / speedRef.current;
      playTimer.current = window.setTimeout(() => {
        playheadRef.current = cur >= end ? start : cur + 1;
        setFocus(playheadRef.current);
        tick();
      }, dwell);
    };
    tick();
  }, [start, end, stopPreview]);
  useEffect(() => stopPreview, [stopPreview]);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/replays/${replaySlug}/clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
        body: JSON.stringify({ startFrame: collapsedToOriginal(start), endFrame: collapsedToOriginal(end), title: title.trim() || undefined }),
      });
      const body = await res.json();
      if (body.ok) setCreatedSlug(body.slug);
      else setError(body.error || 'Could not create the clip.');
    } catch {
      setError('Network error — try again.');
    } finally {
      setBusy(false);
    }
  };

  const clipUrl = createdSlug ? `${typeof window !== 'undefined' ? window.location.origin : ''}/c/${createdSlug}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(clipUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* noop */ }
  };

  const pct = (i: number) => (last === 0 ? 0 : (i / last) * 100);
  const lenFrames = end - start + 1;

  return (
    <>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #2e333c' }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Create a clip</div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 0, color: '#a0a8b8', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </header>

      {/* Independent preview board. */}
      <div style={{ padding: '12px 16px 0', flex: '1 1 auto', minHeight: 0 }}>
        <div style={{ height: 'min(48vh, 420px)' }}>
          <ClipBoardPreview frames={frames} index={focus} animate={playing} localPlayerId={localPlayerId} />
        </div>
      </div>

      {/* Trim timeline. */}
      <div style={{ padding: '14px 22px 4px' }}>
        <div
          ref={trackRef}
          onPointerDown={onTrackClick}
          data-testid="clip-track"
          style={{ position: 'relative', height: 40, borderRadius: 10, background: '#1b1f27', border: '1px solid #2e333c', cursor: 'pointer', touchAction: 'none' }}
        >
          {/* dimmed outside */}
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct(start)}%`, background: 'rgba(0,0,0,0.45)', borderRadius: '10px 0 0 10px' }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${100 - pct(end)}%`, background: 'rgba(0,0,0,0.45)', borderRadius: '0 10px 10px 0' }} />
          {/* selection */}
          <div style={{ position: 'absolute', left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%`, top: 0, bottom: 0, background: 'rgba(77, 157, 255, 0.18)', borderTop: '2px solid #4d9dff', borderBottom: '2px solid #4d9dff' }} />
          {/* chapter / tag markers */}
          {chapters.map((c, i) => (
            <div key={i} title={c.label} style={{ position: 'absolute', left: `${pct(c.frameIndex)}%`, top: 6, bottom: 6, width: 2, marginLeft: -1, background: c.kind === 'tag' ? 'rgba(255, 195, 87, 0.85)' : 'rgba(160, 168, 184, 0.5)', pointerEvents: 'none' }} />
          ))}
          {/* playhead */}
          <div style={{ position: 'absolute', left: `${pct(focus)}%`, top: -3, bottom: -3, width: 2, marginLeft: -1, background: '#fff', boxShadow: '0 0 6px rgba(255,255,255,0.6)', pointerEvents: 'none' }} />
          {/* handles */}
          <Handle posPct={pct(start)} testid="clip-handle-start" onPointerDown={dragHandle('start')} />
          <Handle posPct={pct(end)} testid="clip-handle-end" onPointerDown={dragHandle('end')} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#8a93a6' }}>
          <span>Frame {start + 1}</span>
          <span>{lenFrames} frame{lenFrames === 1 ? '' : 's'}</span>
          <span>Frame {end + 1}</span>
        </div>
      </div>

      {/* Controls + create. */}
      <div style={{ padding: '10px 22px 18px', display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid #2e333c' }}>
        {createdSlug ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: '#7fd97f', fontWeight: 600 }}>✓ Clip created — share the link:</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input readOnly value={clipUrl} data-testid="clip-link" style={{ flex: 1, minWidth: 0, background: '#0b0d12', border: '1px solid #2e333c', borderRadius: 8, padding: '8px 10px', color: '#d6e7ff', fontSize: 12.5 }} />
              <Btn onClick={copy}>{copied ? 'Copied!' : 'Copy'}</Btn>
              <Btn variant="primary" onClick={() => window.open(clipUrl, '_blank')}>Open clip ↗</Btn>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Btn onClick={playing ? stopPreview : playPreview} data-testid="clip-preview-play">{playing ? '❚❚ Pause' : '▶ Preview'}</Btn>
              {/* Preview speed — independent of the main board. */}
              <div style={{ display: 'inline-flex', borderRadius: 8, border: '1px solid #2e333c', overflow: 'hidden' }}>
                {SPEEDS.map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => setSpeed(sp)}
                    data-testid={`clip-speed-${sp}`}
                    style={{
                      background: speed === sp ? '#4d9dff' : 'transparent',
                      color: speed === sp ? '#fff' : '#a0a8b8',
                      border: 0, padding: '7px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {sp}×
                  </button>
                ))}
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                placeholder="Clip title (optional)"
                data-testid="clip-title"
                style={{ flex: 1, minWidth: 140, background: '#0b0d12', border: '1px solid #2e333c', borderRadius: 8, padding: '8px 10px', color: '#e6e6e6', fontSize: 13, fontFamily: 'inherit' }}
              />
              <Btn variant="primary" onClick={create} disabled={busy} data-testid="clip-create">{busy ? 'Creating…' : 'Create clip'}</Btn>
            </div>
            {error && <div style={{ fontSize: 12, color: '#ff7a7a' }}>{error}</div>}
          </>
        )}
      </div>
    </>
  );
}

function Handle({ posPct, onPointerDown, testid }: { posPct: number; onPointerDown: (e: React.PointerEvent) => void; testid: string }) {
  return (
    <div
      onPointerDown={onPointerDown}
      data-testid={testid}
      role="slider"
      tabIndex={0}
      style={{
        position: 'absolute', left: `${posPct}%`, top: -6, bottom: -6, width: 16, marginLeft: -8,
        background: '#4d9dff', borderRadius: 6, cursor: 'ew-resize', touchAction: 'none',
        boxShadow: '0 1px 4px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{ width: 2, height: 16, background: 'rgba(255,255,255,0.7)', borderRadius: 2 }} />
    </div>
  );
}

function Btn({ children, onClick, variant, disabled, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...rest}
      style={{
        background: variant === 'primary' ? '#4d9dff' : 'rgba(77,157,255,0.12)',
        border: variant === 'primary' ? 0 : '1px solid rgba(77,157,255,0.4)',
        color: variant === 'primary' ? '#fff' : '#a7d2ff',
        borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

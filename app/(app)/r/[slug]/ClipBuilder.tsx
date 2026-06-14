'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GameProvider } from '@/app/_contexts/Game.context';
import type { Frame } from '@/lib/replayDecoder';
import type { Chapter, ChapterKind } from '@/lib/replayChapters';
import { ClipBoardPreview } from './ClipBoardPreview';
import { computeFrameDwells, PLAYBACK_TICK_MS } from './frameDwell';
import { PLAYBACK_SPEEDS, PLAYBACK_SPEED_DEFAULT } from './playback';

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
  chapters: Chapter[];                   // collapsed-space beats (rounds / leader deploys / tags)
  initialIndex: number;                  // viewer's current frame (collapsed)
  installToken: string;
  onCreated?: () => void;                // fired after a clip is created (refetch the picker)
}

const SNAP_PX = 16;     // a handle within this many px of a chapter beat sticks to it
const LEADER_SQ = 40;   // leader-deploy thumbnail size (square, cropped to the art)
const LEADER_GAP = 5;   // min gap between adjacent leader thumbnails
const LEADER_SQ_TOP = -(LEADER_SQ + 18); // thumbnail top, relative to track top

// Same color language as the Jump-to navigator (JumpToMenu) so the seek-bar
// markers read identically: rounds blue, leader deploys gold, tags green.
const KIND_COLOR: Record<ChapterKind, string> = {
  start: '#8b93a5',
  round: '#4d9dff',
  leader: '#e0c64a',
  tag: '#6bd968',
  end: '#e07a5f',
};

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
  onClose, replaySlug, frames, collapsedToOriginal, localPlayerId, chapters, initialIndex, installToken, onCreated,
}: Props) {
  const n = frames.length;
  const last = Math.max(0, n - 1);
  const clamp = (i: number) => Math.max(0, Math.min(last, i));

  const [start, setStart] = useState(() => clamp(initialIndex));
  const [end, setEnd] = useState(() => clamp(initialIndex + Math.min(20, last - clamp(initialIndex)) || Math.min(last, clamp(initialIndex) + 1)));
  const [focus, setFocus] = useState(() => clamp(initialIndex)); // which frame the preview shows
  const [lastHandle, setLastHandle] = useState<'start' | 'end'>('end'); // arrow keys nudge this one
  const [title, setTitle] = useState('');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(PLAYBACK_SPEED_DEFAULT); // preview speed, independent of the main board
  const speedRef = useRef(PLAYBACK_SPEED_DEFAULT); speedRef.current = speed;
  const dwells = useMemo(() => computeFrameDwells(frames), [frames]);
  const dwellsRef = useRef<number[]>(dwells); dwellsRef.current = dwells;
  const [busy, setBusy] = useState(false);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const playTimer = useRef<number | null>(null);
  const playheadRef = useRef(start);

  // Track pixel width — needed to lay out the leader-deploy thumbnails so they
  // never overlap (the %-positioned dots can sit arbitrarily close).
  const [trackW, setTrackW] = useState(0);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ensure a valid window if the defaults collide on a tiny replay.
  useEffect(() => { if (end <= start) setEnd(Math.min(last, start + 1)); }, [start, end, last]);

  // Snap targets = the chapter beats (round starts, leader deploys, tags, game
  // start/end) — the boundaries you actually want to clip at.
  const snapFrames = useMemo(() => chapters.map((c) => c.frameIndex), [chapters]);

  // Lay out leader-deploy thumbnails: each sits at its dot's x, but a left→right
  // pass pushes neighbors apart so the squares never overlap, then the cluster
  // is clamped inside the track. `dotX` (true frame position) and `mx` (shifted
  // thumbnail center) can differ — an elbow connector bridges the two.
  const leaderLayout = useMemo(() => {
    if (!trackW || last === 0) return [] as { c: Chapter; dotX: number; mx: number }[];
    const items = chapters
      .filter((c) => c.kind === 'leader' && c.art)
      .map((c) => ({ c, dotX: (c.frameIndex / last) * trackW, mx: (c.frameIndex / last) * trackW }));
    for (let i = 1; i < items.length; i++) {
      const min = items[i - 1].mx + LEADER_SQ + LEADER_GAP;
      if (items[i].mx < min) items[i].mx = min;
    }
    if (items.length) {
      const overR = items[items.length - 1].mx + LEADER_SQ / 2 - trackW;
      if (overR > 0) items.forEach((it) => { it.mx -= overR; });
      const overL = LEADER_SQ / 2 - items[0].mx;
      if (overL > 0) items.forEach((it) => { it.mx += overL; });
    }
    return items;
  }, [chapters, trackW, last]);

  // Frame under the cursor — but if a chapter beat is within SNAP_PX, stick to
  // it (the common case: line a clip up at the start/end of a round).
  const frameFromX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el || n <= 1) return 0;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left;
    const raw = clamp(Math.round((x / r.width) * last));
    let best = raw, bestDx = Infinity;
    for (const sp of snapFrames) {
      const dx = Math.abs((sp / last) * r.width - x);
      if (dx < bestDx) { bestDx = dx; best = sp; }
    }
    return bestDx <= SNAP_PX ? best : raw;
  }, [n, last, snapFrames]);

  const stopPreview = useCallback(() => {
    setPlaying(false);
    if (playTimer.current != null) { window.clearTimeout(playTimer.current); playTimer.current = null; }
  }, []);

  // Drag a handle to seek it; a click without a drag plays the preview from it.
  const dragHandle = (which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation(); // don't let the track's pointerdown also fire
    stopPreview();
    setLastHandle(which);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const downX = e.clientX;
    let moved = false;
    const move = (clientX: number) => {
      if (Math.abs(clientX - downX) > 3) moved = true;
      const f = frameFromX(clientX);
      if (which === 'start') { const v = Math.min(f, end - 1); setStart(v); setFocus(v); }
      else { const v = Math.max(f, start + 1); setEnd(v); setFocus(v); }
    };
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) playPreview(which === 'start' ? start : end); // tap = preview from here
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Pointer-down on the track: inside the selection → play from there; outside →
  // move the nearer handle to that frame.
  const onTrackClick = (e: React.PointerEvent) => {
    const f = frameFromX(e.clientX);
    if (f >= start && f <= end) { playPreview(f); return; }
    stopPreview();
    if (Math.abs(f - start) <= Math.abs(f - end)) { const v = Math.min(f, end - 1); setStart(v); setFocus(v); setLastHandle('start'); }
    else { const v = Math.max(f, start + 1); setEnd(v); setFocus(v); setLastHandle('end'); }
  };

  // Play the preview, optionally from a given frame (a click within the
  // selection / a tap on a handle starts here); loops back to `start` at `end`.
  const playPreview = useCallback((from?: number) => {
    stopPreview();
    setPlaying(true);
    const begin = Math.max(start, Math.min(end, from ?? start));
    playheadRef.current = begin;
    setFocus(begin);
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

  // Arrow keys nudge the last-interacted handle one frame (micro-adjustment).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; // don't fight the title field
      e.preventDefault();
      stopPreview();
      const delta = e.key === 'ArrowLeft' ? -1 : 1;
      if (lastHandle === 'start') { const v = Math.max(0, Math.min(end - 1, start + delta)); setStart(v); setFocus(v); }
      else { const v = Math.max(start + 1, Math.min(last, end + delta)); setEnd(v); setFocus(v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lastHandle, start, end, last, stopPreview]);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/replays/${replaySlug}/clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
        body: JSON.stringify({ startFrame: collapsedToOriginal(start), endFrame: collapsedToOriginal(end), title: title.trim() || undefined }),
      });
      const body = await res.json();
      if (body.ok) { setCreatedSlug(body.slug); onCreated?.(); }
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
          <ClipBoardPreview frames={frames} index={focus} animate={playing} localPlayerId={localPlayerId} speedRef={speedRef} />
        </div>
      </div>

      {/* Trim timeline. Extra top padding makes room for the chapter dots,
          round-number labels, and leader-deploy card thumbnails above the
          track. */}
      <div style={{ padding: '60px 22px 4px' }}>
        <div
          ref={trackRef}
          onPointerDown={onTrackClick}
          data-testid="clip-track"
          style={{ position: 'relative', height: 40, borderRadius: 10, background: '#1b1f27', border: '1px solid #2e333c', cursor: 'pointer', touchAction: 'none' }}
        >
          {/* dimmed outside (click-through so the track handles the pointer) */}
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct(start)}%`, background: 'rgba(0,0,0,0.45)', borderRadius: '10px 0 0 10px', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${100 - pct(end)}%`, background: 'rgba(0,0,0,0.45)', borderRadius: '0 10px 10px 0', pointerEvents: 'none' }} />
          {/* selection */}
          <div style={{ position: 'absolute', left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%`, top: 0, bottom: 0, background: 'rgba(77, 157, 255, 0.18)', borderTop: '2px solid #4d9dff', borderBottom: '2px solid #4d9dff', pointerEvents: 'none' }} />
          {/* Chapter beats — same visual language as the Jump-to navigator.
              A colored stem through the track + a ring/dot above it; rounds get
              their number, leader deploys are solid gold, tags solid green.
              These are also the magnetic snap targets. (Leader thumbnails are
              drawn in a separate overlay below so they can avoid overlap.) */}
          {chapters.map((c, i) => {
            if (c.kind === 'start') return null; // the track's left edge IS the start
            const color = KIND_COLOR[c.kind];
            const solid = c.kind === 'leader' || c.kind === 'tag' || c.kind === 'end';
            const roundN = c.kind === 'round' ? c.label.replace(/\D/g, '') : null;
            const title = c.sublabel ? `${c.label} — ${c.sublabel}` : c.label;
            return (
              <div key={`c${i}`} title={title} style={{ position: 'absolute', left: `${pct(c.frameIndex)}%`, top: 0, bottom: 0, pointerEvents: 'none' }}>
                {/* stem down through the track */}
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 1, marginLeft: -0.5, background: `${color}59` }} />
                {/* dot + round-number label above the track */}
                <div style={{ position: 'absolute', left: 0, top: -22, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, lineHeight: 1 }}>
                  {roundN ? <span style={{ fontSize: 9.5, fontWeight: 800, color, fontFamily: 'inherit' }}>{roundN}</span> : <span style={{ height: 11 }} aria-hidden />}
                  <span style={{ width: 9, height: 9, borderRadius: '50%', boxSizing: 'border-box', border: `2px solid ${color}`, background: solid ? color : '#11141a' }} />
                </div>
              </div>
            );
          })}
          {/* Leader-deploy thumbnails — a square crop of the leader's portrait
              art, pushed apart so they never overlap, each joined to its true
              dot by an orthogonal (vertical→horizontal→vertical) elbow. */}
          {leaderLayout.map(({ c, dotX, mx }, i) => {
            const color = KIND_COLOR.leader;
            const title = c.sublabel ? `${c.label} — ${c.sublabel}` : c.label;
            const railY = LEADER_SQ_TOP + LEADER_SQ + 6;   // y of the horizontal jog
            const segLeft = Math.min(mx, dotX);
            const segW = Math.abs(mx - dotX);
            return (
              <div key={`lt${i}`} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                {/* elbow connector */}
                <div style={{ position: 'absolute', left: mx, top: LEADER_SQ_TOP + LEADER_SQ, width: 1.5, height: railY - (LEADER_SQ_TOP + LEADER_SQ), marginLeft: -0.75, background: color }} />
                <div style={{ position: 'absolute', left: segLeft, top: railY, width: segW || 1.5, height: 1.5, background: color }} />
                <div style={{ position: 'absolute', left: dotX, top: railY, width: 1.5, height: 8, marginLeft: -0.75, background: color }} />
                {/* square art thumbnail */}
                <div
                  title={title}
                  style={{
                    position: 'absolute', left: mx - LEADER_SQ / 2, top: LEADER_SQ_TOP, width: LEADER_SQ, height: LEADER_SQ,
                    borderRadius: 4, border: `1.5px solid ${color}`, boxShadow: '0 1px 5px rgba(0,0,0,0.6)',
                    backgroundColor: '#11141a', backgroundImage: `url(${c.art})`, backgroundRepeat: 'no-repeat',
                    backgroundSize: '165%', backgroundPosition: 'center 26%',
                  }}
                />
              </div>
            );
          })}
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
              <Btn onClick={() => (playing ? stopPreview() : playPreview())} data-testid="clip-preview-play">{playing ? '❚❚ Pause' : '▶ Preview'}</Btn>
              {/* Preview speed — independent of the main board. */}
              <div style={{ display: 'inline-flex', borderRadius: 8, border: '1px solid #2e333c', overflow: 'hidden' }}>
                {PLAYBACK_SPEEDS.map((sp) => (
                  <button
                    key={sp.value}
                    type="button"
                    onClick={() => setSpeed(sp.value)}
                    data-testid={`clip-speed-${sp.value}`}
                    style={{
                      background: speed === sp.value ? '#4d9dff' : 'transparent',
                      color: speed === sp.value ? '#fff' : '#a0a8b8',
                      border: 0, padding: '7px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {sp.label}
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

'use client';

import { tokens } from '@/app/_theme/karabuddyTokens';
import { Icon } from './icons';

// B216 redesign — the Playback sidebar view: the whole-replay transport controls
// (play/pause, speed, card animation, step granularity) lifted out of the old
// floating pill/FAB into the unified sidebar.
export interface PlaybackControls {
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  speeds: { label: string; value: number }[];
  onSetSpeed: (v: number) => void;
  animate: boolean;
  onToggleAnimate: () => void;
  stepMode: 'action' | 'frame';
  onSetStepMode: (m: 'action' | 'frame') => void;
  // Double-sided (POV) — only rendered when canFlip.
  canFlip: boolean;
  viewLabel: string;
  onFlip: () => void;
  revealHands: boolean;
  onRevealHandsChange: (v: boolean) => void;
}

const seg = (on: boolean): React.CSSProperties => ({
  flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  border: `1px solid ${on ? tokens.led.on : 'rgba(255,255,255,0.14)'}`,
  background: on ? 'rgba(77,210,255,0.18)' : 'rgba(255,255,255,0.05)',
  color: on ? '#eaf9ff' : 'rgba(255,255,255,0.75)',
});
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: tokens.color.textMuted };

export function PlaybackFeature({ playing, onTogglePlay, speed, speeds, onSetSpeed, animate, onToggleAnimate, stepMode, onSetStepMode, canFlip, viewLabel, onFlip, revealHands, onRevealHandsChange }: PlaybackControls) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '16px 16px 28px', color: tokens.color.text }}>
      <button type="button" onClick={onTogglePlay}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: '14px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 800, color: '#eaf9ff', background: 'rgba(77,210,255,0.16)', border: `1px solid ${tokens.led.on}` }}>
        <span style={{ display: 'inline-flex' }}>{playing ? Icon.pause : Icon.play}</span>
        {playing ? 'Pause' : 'Play'}
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={label}>Speed</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {speeds.map((s) => (
            <button key={s.value} type="button" onClick={() => onSetSpeed(s.value)} style={seg(Math.abs(s.value - speed) < 1e-6)}>{s.label}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={label}>Step by</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => onSetStepMode('action')} style={seg(stepMode === 'action')}>Action</button>
          <button type="button" onClick={() => onSetStepMode('frame')} style={seg(stepMode === 'frame')}>Frame</button>
        </div>
        <span style={{ fontSize: 11.5, color: tokens.color.textMuted, lineHeight: 1.4 }}>
          {stepMode === 'action' ? 'Arrows jump to the next action (plays through its animation).' : 'Arrows step one raw frame at a time.'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={label}>Card animation</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => { if (!animate) onToggleAnimate(); }} style={seg(animate)}>On</button>
          <button type="button" onClick={() => { if (animate) onToggleAnimate(); }} style={seg(!animate)}>Off</button>
        </div>
      </div>

      {canFlip && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={label}>Perspective</span>
          <button type="button" onClick={onFlip}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', padding: '11px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 800, color: '#eaf9ff', background: 'rgba(77,210,255,0.14)', border: `1px solid ${tokens.led.on}` }}>
            <span>Flip seat</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: tokens.color.textSecondary }}>viewing {viewLabel}</span>
          </button>
          <span style={label}>Both hands face up</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => { if (!revealHands) onRevealHandsChange(true); }} style={seg(revealHands)}>On</button>
            <button type="button" onClick={() => { if (revealHands) onRevealHandsChange(false); }} style={seg(!revealHands)}>Off</button>
          </div>
        </div>
      )}
    </div>
  );
}

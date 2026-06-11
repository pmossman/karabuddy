import { describe, it, expect } from 'vitest';
import { frameActivePlayerId, shouldHandoff } from '@/app/(app)/r/[slug]/povHandoff';

// B128: hotseat auto-switch decision logic. Flip ONLY when the frame's active
// player is exactly the other recording's side — anything malformed must never
// flip (a wrong flip mid-playback is far worse than a missed one).

const frame = (players: Record<string, { isActionPhaseActivePlayer?: boolean }>) => ({ state: { players } });

describe('frameActivePlayerId', () => {
  it('finds the flagged player', () => {
    expect(frameActivePlayerId(frame({ p1: { isActionPhaseActivePlayer: true }, p2: { isActionPhaseActivePlayer: false } }))).toBe('p1');
    expect(frameActivePlayerId(frame({ p1: {}, p2: { isActionPhaseActivePlayer: true } }))).toBe('p2');
  });
  it('returns null when nobody is flagged or the frame is malformed', () => {
    expect(frameActivePlayerId(frame({ p1: {}, p2: {} }))).toBeNull();
    expect(frameActivePlayerId({ state: {} })).toBeNull();
    expect(frameActivePlayerId(null)).toBeNull();
  });
});

describe('shouldHandoff', () => {
  const activeP2 = frame({ p1: { isActionPhaseActivePlayer: false }, p2: { isActionPhaseActivePlayer: true } });

  it('flips when the other side is active', () => {
    expect(shouldHandoff({ frame: activeP2, shownLocalId: 'p1', otherLocalId: 'p2' })).toBe(true);
  });
  it('holds when the shown side is active', () => {
    expect(shouldHandoff({ frame: activeP2, shownLocalId: 'p2', otherLocalId: 'p1' })).toBe(false);
  });
  it('holds on missing/foreign active ids and missing locals (no flip loops)', () => {
    expect(shouldHandoff({ frame: frame({ p1: {}, p2: {} }), shownLocalId: 'p1', otherLocalId: 'p2' })).toBe(false);
    // Active id belongs to NEITHER recording (e.g. id drift) → never flip.
    expect(shouldHandoff({ frame: frame({ p3: { isActionPhaseActivePlayer: true } }), shownLocalId: 'p1', otherLocalId: 'p2' })).toBe(false);
    expect(shouldHandoff({ frame: activeP2, shownLocalId: null, otherLocalId: 'p2' })).toBe(false);
    expect(shouldHandoff({ frame: activeP2, shownLocalId: 'p1', otherLocalId: null })).toBe(false);
    // Same local id on both sides (degenerate) → never flip.
    expect(shouldHandoff({ frame: activeP2, shownLocalId: 'p2', otherLocalId: 'p2' })).toBe(false);
  });
});

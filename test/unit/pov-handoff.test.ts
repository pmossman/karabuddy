import { describe, it, expect } from 'vitest';
import { frameActivePlayerId, actorOfFrameVisuals, shouldHandoff } from '@/app/(app)/r/[slug]/povHandoff';

// B128: hotseat auto-flip decision logic. karabast advances
// isActionPhaseActivePlayer to the NEXT actor as soon as an action resolves,
// so the actor of frame N's VISUALS is the flag of frame N−1 (verified against
// real replays). Flip ONLY when that actor is exactly the other recording's
// side — anything malformed must never flip (a wrong flip mid-playback is far
// worse than a missed one).

const frame = (players: Record<string, { isActionPhaseActivePlayer?: boolean }>) => ({ state: { players } });
const P1 = frame({ p1: { isActionPhaseActivePlayer: true }, p2: { isActionPhaseActivePlayer: false } });
const P2 = frame({ p1: { isActionPhaseActivePlayer: false }, p2: { isActionPhaseActivePlayer: true } });
const NONE = frame({ p1: {}, p2: {} });

describe('frameActivePlayerId', () => {
  it('finds the flagged player', () => {
    expect(frameActivePlayerId(P1)).toBe('p1');
    expect(frameActivePlayerId(P2)).toBe('p2');
  });
  it('returns null when nobody is flagged or the frame is malformed', () => {
    expect(frameActivePlayerId(NONE)).toBeNull();
    expect(frameActivePlayerId({ state: {} })).toBeNull();
    expect(frameActivePlayerId(null)).toBeNull();
  });
});

describe('actorOfFrameVisuals (lagged attribution)', () => {
  it("frame N's visuals belong to frame N−1's flag", () => {
    const frames = [P1, P2, P1]; // flags: p1, p2, p1
    expect(actorOfFrameVisuals(frames, 1)).toBe('p1'); // frame 1 shows p1's action
    expect(actorOfFrameVisuals(frames, 2)).toBe('p2'); // frame 2 shows p2's action
  });
  it('frame 0 uses its own flag (the first actor)', () => {
    expect(actorOfFrameVisuals([P2, P1], 0)).toBe('p2');
  });
});

describe('shouldHandoff', () => {
  // Real-replay shape: the frame SHOWING p2's action carries p1's flag
  // (already advanced) — the lag is what makes the flip land on the visuals.
  const frames = [P1, P2, P1, P2];

  it('flips when the current visuals belong to the other side', () => {
    // frame 2's visuals = flag of frame 1 = p2 → flip away from p1's seat.
    expect(shouldHandoff({ frames, index: 2, shownLocalId: 'p1', otherLocalId: 'p2' })).toBe(true);
  });
  it('holds when the visuals belong to the shown side', () => {
    expect(shouldHandoff({ frames, index: 2, shownLocalId: 'p2', otherLocalId: 'p1' })).toBe(false);
    // frame 1's visuals = flag of frame 0 = p1 → p1's seat keeps it.
    expect(shouldHandoff({ frames, index: 1, shownLocalId: 'p1', otherLocalId: 'p2' })).toBe(false);
  });
  it('holds on missing/foreign actors and missing locals (no flip loops)', () => {
    expect(shouldHandoff({ frames: [NONE, NONE], index: 1, shownLocalId: 'p1', otherLocalId: 'p2' })).toBe(false);
    // Actor id belongs to NEITHER recording (e.g. id drift) → never flip.
    const foreign = [frame({ p3: { isActionPhaseActivePlayer: true } }), NONE];
    expect(shouldHandoff({ frames: foreign, index: 1, shownLocalId: 'p1', otherLocalId: 'p2' })).toBe(false);
    expect(shouldHandoff({ frames, index: 2, shownLocalId: null, otherLocalId: 'p2' })).toBe(false);
    expect(shouldHandoff({ frames, index: 2, shownLocalId: 'p1', otherLocalId: null })).toBe(false);
    // Same local id on both sides (degenerate) → never flip.
    expect(shouldHandoff({ frames, index: 2, shownLocalId: 'p2', otherLocalId: 'p2' })).toBe(false);
  });
});

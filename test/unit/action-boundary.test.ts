import { describe, expect, it } from 'vitest';
import { actionBoundary } from '@/app/(app)/r/[slug]/actionBoundary';

// B104: action-mode stepping snaps to action STARTS (first frame of each run of
// a shared active player), and forward/back must be inverses.
describe('actionBoundary', () => {
  // Segments: A = [0..2], B = [3..6], A2 = [7..9]. (Adjacent segments always
  // differ in active player; A and A2 are separate runs of the same player.)
  const active = ['A', 'A', 'A', 'B', 'B', 'B', 'B', 'A', 'A', 'A'];
  const total = active.length;

  it('forward lands on the start of the next segment', () => {
    expect(actionBoundary(active, total, 0, 1)).toBe(3); // from A-start → B-start
    expect(actionBoundary(active, total, 2, 1)).toBe(3); // from A-end   → B-start
    expect(actionBoundary(active, total, 3, 1)).toBe(7); // from B-start → A2-start
  });

  it('backward lands on the start of the previous segment, not its end', () => {
    expect(actionBoundary(active, total, 7, -1)).toBe(3); // from A2-start → B-start (not 6)
    expect(actionBoundary(active, total, 3, -1)).toBe(0); // from B-start  → A-start (not 2)
  });

  it('a forward step then a back step returns to the starting action (the B104 bug)', () => {
    for (const start of [0, 3, 7]) {
      const fwd = actionBoundary(active, total, start, 1);
      expect(actionBoundary(active, total, fwd, -1)).toBe(start);
    }
  });

  it('mid-segment backward snaps to the current run start (canonical action position)', () => {
    expect(actionBoundary(active, total, 5, -1)).toBe(3); // mid-B → B-start
  });

  it('clamps at the ends', () => {
    expect(actionBoundary(active, total, 9, 1)).toBe(9);  // already last → stay
    expect(actionBoundary(active, total, 0, -1)).toBe(0); // already first → stay
  });

  it('handles a single-segment replay', () => {
    const one = ['A', 'A', 'A'];
    expect(actionBoundary(one, one.length, 1, 1)).toBe(2);  // no next segment → last frame
    expect(actionBoundary(one, one.length, 1, -1)).toBe(0); // no prev segment → first frame
  });
});

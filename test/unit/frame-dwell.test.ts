import { describe, it, expect } from 'vitest';
import { computeFrameDwells } from '@/app/(app)/r/[slug]/frameDwell';
import { dwellFor, LEADER_DEPLOY_FULL_MS, UNIT_PLAY_TOTAL_MS, PLAYBACK_TICK_MS } from '@/app/(app)/r/[slug]/animationTiming';

// B146: the autoplay/clip dwell must outlast the animation the FrameAnimator
// actually plays — which it derives from the BOARD DIFF. The collapse can strip
// a play/deploy's log line, so a log-only classifier under-budgets and autoplay
// advances mid-animation (hard-cancelling it). These lock in that the dwell is
// driven by the board diff, not the log.

const frame = (state: any) => ({ state }) as any;
const player = (leaderZone: string, ground: any[] = [], hand: any[] = []) => ({
  user: { username: 'A' },
  leader: { uuid: 'L', zone: leaderZone, controllerId: 'p1' },
  cardPiles: { groundArena: ground, spaceArena: [], hand, resources: [], discard: [] },
});
const mk = (leaderZone: string, ground: any[] = [], hand: any[] = []) =>
  frame({ newMessages: [], players: { p1: player(leaderZone, ground, hand) } });

describe('B146: dwell is board-diff driven (robust to a stripped log)', () => {
  it('budgets a leader deploy (base → arena) with an EMPTY log', () => {
    const dwells = computeFrameDwells([mk('base'), mk('groundArena')]);
    expect(dwells[1]).toBe(dwellFor(LEADER_DEPLOY_FULL_MS)); // not the 300ms tick
  });

  it('budgets a unit play (hand → arena) with an EMPTY log', () => {
    const u = { uuid: 'U', zone: 'groundArena', controllerId: 'p1' };
    const f0 = mk('base', [], [{ uuid: 'U', zone: 'hand', controllerId: 'p1' }]);
    const f1 = mk('base', [u]);
    const dwells = computeFrameDwells([f0, f1]);
    expect(dwells[1]).toBe(dwellFor(UNIT_PLAY_TOTAL_MS));
  });

  it('a settle frame with no board change stays the default tick', () => {
    const dwells = computeFrameDwells([mk('groundArena'), mk('groundArena')]);
    expect(dwells[1]).toBe(PLAYBACK_TICK_MS);
  });
});

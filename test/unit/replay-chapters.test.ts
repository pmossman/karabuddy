import { describe, expect, it } from 'vitest';
import { computeChapters } from '@/lib/replayChapters';

// Frame builder: phase + each player's leader zone ('base' = undeployed).
type P = { lz?: string; leaderName?: string };
function frame(phase: string, p1: P = {}, p2: P = {}) {
  const mk = (name: string, p: P) => ({
    user: { username: name },
    leader: { name: p.leaderName ?? `${name}'s leader`, zone: p.lz ?? 'base' },
  });
  return { state: { phase, players: { p1: mk('Ann', p1), p2: mk('Bob', p2) } } };
}

describe('computeChapters', () => {
  it('marks game start + end, and a round at each action-phase start (not frame 0)', () => {
    const frames = [
      frame('setup'),     // 0
      frame('action'),    // 1 → Round 1
      frame('action'),    // 2
      frame('regroup'),   // 3
      frame('action'),    // 4 → Round 2
      frame('regroup'),   // 5
    ];
    const ch = computeChapters(frames);
    expect(ch[0]).toMatchObject({ frameIndex: 0, kind: 'start' });
    const rounds = ch.filter((c) => c.kind === 'round');
    expect(rounds).toEqual([
      { frameIndex: 1, kind: 'round', label: 'Round 1' },
      { frameIndex: 4, kind: 'round', label: 'Round 2' },
    ]);
    expect(ch[ch.length - 1]).toMatchObject({ frameIndex: 5, kind: 'end', label: 'Game end' });
  });

  it('emits a leader chapter on the first deployed frame, once per player', () => {
    const frames = [
      frame('action'),                                   // 0
      frame('action', { lz: 'groundArena', leaderName: 'Luke Skywalker' }), // 1 Ann flips
      frame('action', { lz: 'groundArena', leaderName: 'Luke Skywalker' }), // 2 (no dup)
      frame('action', { lz: 'groundArena' }, { lz: 'spaceArena', leaderName: 'The Mandalorian' }), // 3 Bob flips
    ];
    const leaders = computeChapters(frames).filter((c) => c.kind === 'leader');
    expect(leaders).toEqual([
      { frameIndex: 1, kind: 'leader', label: 'Luke Skywalker deploys', sublabel: 'Ann' },
      { frameIndex: 3, kind: 'leader', label: 'The Mandalorian deploys', sublabel: 'Bob' },
    ]);
  });

  it('orders by frame, with start first and end last', () => {
    const frames = [frame('setup'), frame('action', { lz: 'groundArena' })];
    const ch = computeChapters(frames);
    expect(ch.map((c) => c.kind)).toEqual(['start', 'round', 'leader', 'end']);
    // round + leader both land on frame 1; round sorts before leader.
    expect(ch.map((c) => c.frameIndex)).toEqual([0, 1, 1, 1]);
  });

  it('returns [] for empty input', () => {
    expect(computeChapters(null)).toEqual([]);
    expect(computeChapters([])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { decodeReplay, firstSnapshot, leadersOf, summarizePlayers } from '@/lib/replayDecoder';
import { extractReplayFacts } from '@/lib/statsExtract';
import { leaderShapePayload, LEIA, LUKE, VADER } from '../fixtures/karabast-leader-shapes';

describe('leadersOf', () => {
  it('reads the leaders[] array (new shape) and the single leader (old shape)', () => {
    expect(leadersOf({ leaders: [VADER, LUKE] })).toEqual([VADER, LUKE]);
    expect(leadersOf({ leader: VADER })).toEqual([VADER]);
    expect(leadersOf({ leaders: [], leader: VADER })).toEqual([VADER]);
    expect(leadersOf({})).toEqual([]);
    expect(leadersOf(null)).toEqual([]);
  });
});

describe.each(['old', 'new'] as const)('%s-shape replay', (shape) => {
  const payload = leaderShapePayload(shape);

  it('decodes with players[pid].leader on every frame', () => {
    const { frames } = decodeReplay(payload);
    expect(frames).toHaveLength(2);
    for (const f of frames) {
      expect(f.state.players.p1.leader.setId).toEqual(VADER.setId);
      expect(f.state.players.p2.leader.setId).toEqual(LUKE.setId);
    }
    expect(frames[1].state.players.p1.leader.zone).toBe('groundArena');
  });

  it('summarizes the replays.players column with both leaders', () => {
    const players = summarizePlayers(firstSnapshot(payload)?.players);
    const p1 = players.find((p) => p.id === 'p1')!;
    const p2 = players.find((p) => p.id === 'p2')!;
    expect(p1).toEqual({
      id: 'p1',
      username: 'Alice',
      leader: { name: 'Darth Vader', set: 'SOR', number: 10 },
      base: { name: 'Dagobah Swamp', set: 'SOR', number: 20 },
    });
    expect(p2.leader).toEqual({ name: 'Luke Skywalker', set: 'SOR', number: 5 });
    if (shape === 'new') expect(p2.secondLeader).toEqual({ name: 'Leia Organa', set: 'SOR', number: 9 });
    else expect(p2).not.toHaveProperty('secondLeader');
  });

  it('extracts stats leaders for both seats', () => {
    const { matchFact } = extractReplayFacts(decodeReplay(payload), { gameId: 'g', winners: ['p1'], ownerPlayerId: 'p1' });
    const p1 = matchFact!.players.find((p) => p.playerId === 'p1')!;
    const p2 = matchFact!.players.find((p) => p.playerId === 'p2')!;
    expect(p1.leader).toBe('SOR_010');
    expect(p2.leader).toBe('SOR_005');
    const expectedP2Aspects = shape === 'new' ? [...LUKE.aspects, ...LEIA.aspects, 'command'] : [...LUKE.aspects, 'command'];
    expect(new Set(p2.aspects)).toEqual(new Set(expectedP2Aspects));
  });
});

describe('new-shape twin leaders', () => {
  it('keeps the full leaders[] array on decoded frames, first leader first', () => {
    const { frames } = decodeReplay(leaderShapePayload('new'));
    expect(frames[0].state.players.p2.leaders.map((l: any) => l.name)).toEqual(['Luke Skywalker', 'Leia Organa']);
    expect(frames[0].state.players.p2.leader.name).toBe('Luke Skywalker');
  });
});

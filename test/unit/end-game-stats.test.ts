import { describe, expect, it } from 'vitest';
import { computeEndGameStats } from '@/lib/endGameStats';

// Tiny gamestate-frame builder. Each player entry: base damage/hp, the
// available (ready) resource count, and arena/discard membership by uuid.
type P = { dmg?: number; hp?: number; avail?: number; arena?: string[]; discard?: string[] };
function frame(phase: string, p1: P, p2: P) {
  const mk = (name: string, p: P) => ({
    user: { username: name },
    base: { damage: p.dmg ?? 0, hp: p.hp ?? 30 },
    availableResources: p.avail ?? 0,
    cardPiles: {
      groundArena: (p.arena ?? []).map((uuid) => ({ uuid })),
      spaceArena: [],
      discard: (p.discard ?? []).map((uuid) => ({ uuid })),
      hand: [], deck: [], resources: [],
    },
  });
  return { state: { phase, players: { p1: mk('Ann', p1), p2: mk('Bob', p2) } } };
}

describe('computeEndGameStats', () => {
  // Ann beats Bob by destroying his base. Along the way: Ann plays u1, Bob
  // plays u2, Ann kills u2, Ann heals her own base, and one round completes.
  const frames = [
    frame('action',  { dmg: 0, avail: 2, arena: ['u1'] }, { dmg: 0, avail: 3 }),
    frame('action',  { dmg: 0, avail: 2, arena: ['u1'] }, { dmg: 10, avail: 3 }),
    frame('regroup', { dmg: 0, arena: ['u1'] },           { dmg: 10 }),
    frame('action',  { dmg: 5, avail: 1, arena: ['u1'] }, { dmg: 25, avail: 0, arena: ['u2'] }),
    frame('action',  { dmg: 2, avail: 1, arena: ['u1'] }, { dmg: 30, avail: 0, discard: ['u2'] }),
  ];

  it('attributes base damage dealt to the opposing base', () => {
    const s = computeEndGameStats(frames, ['p1'])!;
    const ann = s.players.find((p) => p.playerId === 'p1')!;
    const bob = s.players.find((p) => p.playerId === 'p2')!;
    expect(ann.baseDamageDealt).toBe(30); // 10 + 15 + 5 onto Bob's base
    expect(bob.baseDamageDealt).toBe(5);  // Bob's one hit onto Ann's base
  });

  it('counts healing as the gross damage removed from own base', () => {
    const s = computeEndGameStats(frames, ['p1'])!;
    expect(s.players.find((p) => p.playerId === 'p1')!.baseDamageHealed).toBe(3); // 5 → 2
    expect(s.players.find((p) => p.playerId === 'p2')!.baseDamageHealed).toBe(0);
  });

  it('counts cards played + enemy units defeated', () => {
    const s = computeEndGameStats(frames, ['p1'])!;
    const ann = s.players.find((p) => p.playerId === 'p1')!;
    const bob = s.players.find((p) => p.playerId === 'p2')!;
    expect(ann.cardsPlayed).toBe(1);
    expect(bob.cardsPlayed).toBe(1);
    expect(ann.unitsDefeated).toBe(1); // killed Bob's u2
    expect(bob.unitsDefeated).toBe(0);
  });

  it('sums floated resources over completed rounds only (drops the decided round)', () => {
    const s = computeEndGameStats(frames, ['p1'])!;
    // One action→regroup transition; floats the last action frame's unspent.
    expect(s.rounds).toBe(1);
    expect(s.players.find((p) => p.playerId === 'p1')!.resourcesFloated).toBe(2);
    expect(s.players.find((p) => p.playerId === 'p2')!.resourcesFloated).toBe(3);
  });

  it('reports a base-destruction win', () => {
    const s = computeEndGameStats(frames, ['p1'])!;
    expect(s.endReason).toBe('base');
    expect(s.players.find((p) => p.playerId === 'p2')!.baseDestroyed).toBe(true);
    expect(s.players.find((p) => p.playerId === 'p1')!.won).toBe(true);
    expect(s.players.find((p) => p.playerId === 'p2')!.won).toBe(false);
  });

  it('infers a concession when there is a winner but no base fell', () => {
    const conceded = [
      frame('action', { dmg: 0 }, { dmg: 0 }),
      frame('action', { dmg: 3 }, { dmg: 12 }), // Bob alive at 12/30
    ];
    expect(computeEndGameStats(conceded, ['p1'])!.endReason).toBe('concede');
  });

  it('reports unknown when there is no winner signal', () => {
    const s = computeEndGameStats(frames, null)!;
    expect(s.endReason).toBe('unknown');
    expect(s.players.every((p) => p.won === null)).toBe(true);
  });

  it('returns null for empty input', () => {
    expect(computeEndGameStats([], ['p1'])).toBeNull();
    expect(computeEndGameStats(null, null)).toBeNull();
  });
});

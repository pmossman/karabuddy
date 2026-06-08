import { describe, expect, it } from 'vitest';
import { buildMomentCard, cardArtUrl, CARDBACK } from '@/lib/momentCard';
import { HIDDEN_SET } from '@/lib/replayDecoder';

const unit = (set: string, number: number, extra: any = {}) => ({ setId: { set, number }, type: 'unit', name: `${set}-${number}`, ...extra });
const player = (username: string, units: any[] = [], extra: any = {}) => ({
  user: { username },
  leader: { setId: { set: 'ASH', number: 5 }, type: 'leader', name: 'Luke', zone: 'base', damage: 0 },
  base: { setId: { set: 'SEC', number: 25 }, type: 'base', name: 'Amnesty Housing', damage: 3 },
  cardPiles: { groundArena: units, spaceArena: [], hand: [{}, {}], resources: [{}, {}, {}] },
  availableResources: 3,
  ...extra,
});
const decoded = (overrides: any = {}): any => ({
  frames: [
    { state: { roundNumber: 1, players: { p1: player('Alice', [unit('SOR', 1)]), p2: player('Bob', [unit('JTL', 7)]) } } },
    { state: { roundNumber: 3, players: { p1: player('Alice', [unit('SOR', 1, { damage: 2, power: 3, hp: 4 })]), p2: player('Bob') } } },
  ],
  meta: { localPlayerId: 'p2' },
  ...overrides,
});

describe('cardArtUrl', () => {
  it('plain unit', () => {
    expect(cardArtUrl(unit('SOR', 1))).toBe('https://karabast-data.s3.amazonaws.com/cards/SOR/en/standard/large/001.webp?v=3');
  });
  it('deployed leader uses front art; leader at base uses -base', () => {
    expect(cardArtUrl({ setId: { set: 'ASH', number: 5 }, type: 'leader', zone: 'groundArena' })).toContain('/ASH/en/standard/large/005.webp');
    expect(cardArtUrl({ setId: { set: 'ASH', number: 5 }, type: 'leader', zone: 'base' })).toContain('/ASH/en/standard/large/005-base.webp');
  });
  it('base card is plain (no -base)', () => {
    expect(cardArtUrl({ setId: { set: 'SEC', number: 25 }, type: 'base' })).toContain('/SEC/en/standard/large/025.webp');
  });
  it('hidden/opponent stub → cardback', () => {
    expect(cardArtUrl({ setId: { set: HIDDEN_SET, number: 0 } })).toBe(CARDBACK);
    expect(cardArtUrl(null)).toBe(CARDBACK);
  });
});

describe('buildMomentCard', () => {
  it('picks the requested frame (1-based label) and reads round', () => {
    const m = buildMomentCard({ decoded: decoded(), ownerPlayerId: 'p1', frameIndexOriginal: 1, players: [{ id: 'p1', username: 'Alice' }, { id: 'p2', username: 'Bob' }] });
    expect(m.frameLabel).toBe('Frame 2');
    expect(m.roundLabel).toBe('Round 3');
  });

  it('puts the owner (POV) on the bottom', () => {
    const m = buildMomentCard({ decoded: decoded(), ownerPlayerId: 'p1', frameIndexOriginal: 0, players: [{ id: 'p1', username: 'Alice' }, { id: 'p2', username: 'Bob' }] });
    expect(m.matchup.bottom.name).toBe('Alice');
    expect(m.matchup.top.name).toBe('Bob');
  });

  it('falls back to meta.localPlayerId when ownerPlayerId is missing', () => {
    const m = buildMomentCard({ decoded: decoded(), ownerPlayerId: null, frameIndexOriginal: 0 });
    expect(m.matchup.bottom.name).toBe('Bob'); // meta.localPlayerId = p2
  });

  it('uses anonymized labels when provided (samples)', () => {
    const anon = new Map([['p1', 'Player1'], ['p2', 'Player2']]);
    const m = buildMomentCard({ decoded: decoded(), ownerPlayerId: 'p1', frameIndexOriginal: 0, anonById: anon });
    expect(m.matchup.bottom.name).toBe('Player1');
    expect(m.matchup.top.name).toBe('Player2');
  });

  it('clamps an out-of-range frame', () => {
    const m = buildMomentCard({ decoded: decoded(), ownerPlayerId: 'p1', frameIndexOriginal: 99 });
    expect(m.frameLabel).toBe('Frame 2'); // last frame
  });

  it('omits tagLine without a comment, truncates a long one', () => {
    expect(buildMomentCard({ decoded: decoded(), ownerPlayerId: 'p1', frameIndexOriginal: 0 }).tagLine).toBeNull();
    const long = 'x'.repeat(300);
    const m = buildMomentCard({ decoded: decoded(), ownerPlayerId: 'p1', frameIndexOriginal: 0, tagComment: long });
    expect(m.tagLine!.length).toBeLessThanOrEqual(140);
    expect(m.tagLine!.endsWith('…')).toBe(true);
  });

  it('carries ground/space unit art + damage, split by arena', () => {
    const m = buildMomentCard({ decoded: decoded(), ownerPlayerId: 'p2', frameIndexOriginal: 1, players: [{ id: 'p2', username: 'Bob' }, { id: 'p1', username: 'Alice' }] });
    const aliceTop = m.matchup.top; // p1 on top now (p2 is POV)
    expect(aliceTop.ground[0].damage).toBe(2);
    expect(aliceTop.ground[0].artUrl).toContain('/SOR/en/standard/large/001.webp');
    expect(aliceTop.space).toHaveLength(0); // spaceArena empty in the fixture
    expect(aliceTop.base?.damage).toBe(3);
  });

  it('splits ground vs space and counts overflow per arena', () => {
    const u = (n: number) => ({ setId: { set: 'SOR', number: n }, type: 'unit', name: `g${n}` });
    const s = (n: number) => ({ setId: { set: 'JTL', number: n }, type: 'unit', name: `s${n}` });
    const p = {
      user: { username: 'Z' }, leader: null, base: null,
      cardPiles: { groundArena: [u(1), u(2), u(3), u(4), u(5), u(6), u(7)], spaceArena: [s(1), s(2)], hand: [], resources: [] },
    };
    const dec: any = { frames: [{ state: { roundNumber: 2, players: { p1: p, p2: { user: { username: 'Y' }, cardPiles: {} } } } }], meta: { localPlayerId: 'p1' } };
    const m = buildMomentCard({ decoded: dec, ownerPlayerId: 'p1', frameIndexOriginal: 0 });
    expect(m.matchup.bottom.ground).toHaveLength(5);
    expect(m.matchup.bottom.extraGround).toBe(2);
    expect(m.matchup.bottom.space).toHaveLength(2);
    expect(m.matchup.bottom.extraSpace).toBe(0);
  });
});

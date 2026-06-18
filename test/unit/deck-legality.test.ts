import { describe, expect, it } from 'vitest';
import { validateDeck } from '@/lib/deckLegality';
import type { TournamentDeck } from '@/lib/schema';

const card = (id: string, count: number) => ({ id, count });
const legalDeck = (over: Partial<TournamentDeck> = {}): TournamentDeck => ({
  leader: card('ASH_005', 1),
  base: card('JTL_024', 1),
  // 50 maindeck: 17×3 (51) is fine for size; keep it simple with distinct ids.
  deck: Array.from({ length: 50 }, (_, i) => card(`SET_${100 + i}`, 1)),
  sideboard: [],
  ...over,
});

describe('validateDeck', () => {
  it('a well-formed deck is legal', () => {
    expect(validateDeck(legalDeck()).legal).toBe(true);
  });

  it('flags a sideboard over 10 (the reported case)', () => {
    const d = legalDeck({ sideboard: [card('SET_900', 4), card('SET_901', 4), card('SET_902', 4)] }); // 12
    const r = validateDeck(d);
    expect(r.legal).toBe(false);
    expect(r.violations.find((v) => v.code === 'sideboard_size')?.message).toContain('12');
  });

  it('flags a maindeck under 50', () => {
    const d = legalDeck({ deck: [card('SET_100', 40)] });
    expect(validateDeck(d).violations.some((v) => v.code === 'deck_size')).toBe(true);
  });

  it('flags a missing leader or base', () => {
    expect(validateDeck(legalDeck({ leader: null })).violations.some((v) => v.code === 'no_leader')).toBe(true);
    expect(validateDeck(legalDeck({ base: null })).violations.some((v) => v.code === 'no_base')).toBe(true);
  });

  it('flags >3 copies of a card by TITLE across deck + sideboard (reprints count together)', () => {
    // Two printings of "Darth Vader, Dark Lord of the Sith" (different ids, SAME
    // title) + 2 in the sideboard = 4 total.
    const d = legalDeck({
      deck: [...Array.from({ length: 48 }, (_, i) => card(`SET_${200 + i}`, 1)), card('SOR_010', 2)],
      sideboard: [card('SHD_010', 2)],
    });
    const titleOf = (id: string) => (id === 'SOR_010' || id === 'SHD_010' ? 'Darth Vader, Dark Lord of the Sith' : null);
    const r = validateDeck(d, { titleOf });
    expect(r.legal).toBe(false);
    expect(r.violations.find((v) => v.code === 'copy_limit')?.message).toContain('Darth Vader, Dark Lord of the Sith ×4');
  });

  it('B167: two cards sharing a NAME but a different SUBTITLE are distinct (3 + 1 is legal)', () => {
    // 3× "Luke Skywalker, Jedi Knight" + 1× "Luke Skywalker, Answering the Call".
    const d = legalDeck({
      deck: [...Array.from({ length: 46 }, (_, i) => card(`SET_${300 + i}`, 1)), card('SOR_LUKE', 3), card('TWI_LUKE', 1)],
    });
    const titleOf = (id: string) =>
      id === 'SOR_LUKE' ? 'Luke Skywalker, Jedi Knight'
      : id === 'TWI_LUKE' ? 'Luke Skywalker, Answering the Call'
      : null;
    const r = validateDeck(d, { titleOf });
    expect(r.legal).toBe(true);
    expect(r.violations.some((v) => v.code === 'copy_limit')).toBe(false);
  });

  it('a null deck is illegal', () => {
    expect(validateDeck(null).legal).toBe(false);
    expect(validateDeck(undefined).violations[0].code).toBe('no_deck');
  });
});

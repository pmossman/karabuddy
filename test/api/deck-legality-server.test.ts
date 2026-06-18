import { describe, it, expect } from 'vitest';
import { getDb } from '@/lib/db';
import { cards } from '@/lib/schema';
import { validateDeckServer } from '@/lib/deckLegalityServer';

// B167: the tournament 3-copy limit resolves card TITLES (name + subtitle) from
// the catalog, so two cards sharing a name but a different subtitle are distinct.
const seedCard = (cardId: string, name: string, subtitle: string | null) =>
  getDb().insert(cards).values({ cardId, name, subtitle }).onConflictDoUpdate({ target: cards.cardId, set: { name, subtitle } });

const filler = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}_${i}`, count: 1 }));
const deckOf = (cardsIn: { id: string; count: number }[]) => ({
  leader: { id: 'ASH_005', count: 1 }, base: { id: 'JTL_024', count: 1 }, deck: cardsIn, sideboard: [],
}) as any;

describe('validateDeckServer — copy limit keys on name + subtitle', () => {
  it('3 of one Luke + 1 of another (same name, different subtitle) is LEGAL', async () => {
    await seedCard('SOR_005', 'Luke Skywalker', 'Jedi Knight');
    await seedCard('TWI_905', 'Luke Skywalker', 'Answering the Call');
    const deck = deckOf([...filler(46, 'A'), { id: 'SOR_005', count: 3 }, { id: 'TWI_905', count: 1 }]);
    const r = await validateDeckServer(deck);
    expect(r.legal).toBe(true);
    expect(r.violations.some((v) => v.code === 'copy_limit')).toBe(false);
  });

  it('4 of the SAME Luke (one title — incl. a reprint) is ILLEGAL', async () => {
    await seedCard('SOR_005', 'Luke Skywalker', 'Jedi Knight');
    await seedCard('REP_005', 'Luke Skywalker', 'Jedi Knight'); // a reprint: same name+subtitle
    const deck = deckOf([...filler(46, 'B'), { id: 'SOR_005', count: 3 }, { id: 'REP_005', count: 1 }]);
    const r = await validateDeckServer(deck);
    expect(r.legal).toBe(false);
    expect(r.violations.find((v) => v.code === 'copy_limit')?.message).toContain('Luke Skywalker, Jedi Knight ×4');
  });
});

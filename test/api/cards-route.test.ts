import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/cards/route';
import { getDb } from '@/lib/db';
import { cards } from '@/lib/schema';

describe('GET /api/cards', () => {
  it('returns cost/name for requested ids, ignores unknown, empty for no ids', async () => {
    await getDb().insert(cards).values([
      { cardId: 'SOR_001', name: 'Director Krennic', subtitle: 'Aspiring to Power', cost: 5, type: 'leader', aspects: ['vigilance'], arena: 'ground', source: 'seed' },
      { cardId: 'SEC_038', name: 'Condemn', cost: 3, type: 'upgrade', source: 'seed' },
    ]);
    const res = await GET(new Request('http://t/api/cards?ids=SOR_001,SEC_038,NOPE_999'));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.cards.SOR_001).toMatchObject({ name: 'Director Krennic', subtitle: 'Aspiring to Power', cost: 5, type: 'leader' });
    expect(body.cards.SEC_038.cost).toBe(3);
    expect(body.cards.NOPE_999).toBeUndefined();

    const empty = await (await GET(new Request('http://t/api/cards'))).json();
    expect(empty.cards).toEqual({});
  });
});

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

  it('?q= name search returns playable cards, prefix-first, excluding leaders/bases', async () => {
    await getDb().insert(cards).values([
      { cardId: 'X_1', name: 'Ninth Sister', subtitle: 'Hulking Inquisitor', type: 'unit', source: 'seed' },
      { cardId: 'X_2', name: 'The Ninth Squad', type: 'unit', source: 'seed' },
      { cardId: 'X_3', name: 'Ninth Inquisitor', subtitle: 'a leader', type: 'leader', source: 'seed' }, // leader → excluded
    ]);
    const body = await (await GET(new Request('http://t/api/cards?q=ninth'))).json();
    expect(body.ok).toBe(true);
    const names = body.results.map((r: any) => r.name);
    expect(names).toContain('Ninth Sister');
    expect(names).toContain('The Ninth Squad');
    expect(names).not.toContain('Ninth Inquisitor'); // leader excluded
    // prefix match ("Ninth …") ranks before the mid-string match ("The Ninth …")
    expect(names.indexOf('Ninth Sister')).toBeLessThan(names.indexOf('The Ninth Squad'));
  });
});

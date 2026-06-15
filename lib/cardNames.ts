// Resolve card ids → display names from the seeded `cards` catalog. Shared by
// the deck-legality copy check + the tournament Discord posts.
import { inArray } from 'drizzle-orm';
import { getDb } from './db';
import { cards } from './schema';

export async function cardNamesByIds(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (want.length === 0) return new Map();
  const rows = await getDb().select({ cardId: cards.cardId, name: cards.name }).from(cards).where(inArray(cards.cardId, want));
  return new Map(rows.map((r) => [r.cardId, r.name ?? r.cardId]));
}
